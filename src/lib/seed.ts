import { db } from '@/lib/db'
import { backfillBetOfDayFlags, ensureRealBets, forceGenerateRealBets } from '@/lib/real-bets'
import { isBodEligible } from '@/lib/bod-rules'
import { recomputeTipsterCounters } from '@/lib/tipster-counters'
import { refreshMarketIntel } from '@/lib/odds-intel'

/**
 * Обслуживание данных сайта «Ставка Дня».
 *
 * ВИРТУАЛЬНЫЕ (ДЕМО) ПРОГНОЗЫ ПОЛНОСТЬЮ УДАЛЕНЫ (Task 21, решение пользователя):
 * сайт работает только с реальными матчами из живого расписания
 * (см. lib/real-bets.ts + lib/real-matches.ts). Все пути генерации
 * выдуманных событий, «виртуального времени» и демо-истории ликвидированы.
 */

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Ростер аналитиков: каждый специализируется на своём виде спорта */
const TIPSTERS: { name: string; role: string; sport: 'football' | 'tennis' | 'hockey' | 'basketball' }[] = [
  { name: 'Алексей Соколов', role: 'Главный аналитик · футбол', sport: 'football' },
  { name: 'Мария Волкова', role: 'Эксперт по теннису', sport: 'tennis' },
  { name: 'Игорь Морозов', role: 'Хоккейный аналитик', sport: 'hockey' },
  { name: 'Дмитрий Орлов', role: 'Статистик · баскетбол', sport: 'basketball' },
]

// ---------------------------------------------------------------------------
// Ротация «Ставки дня» (только реальные прогнозы)
// ---------------------------------------------------------------------------

/**
 * Ротация ставки дня: если сегодняшняя «Ставка дня» уже рассчитана — продвигаем
 * лучший предстоящий РЕАЛЬНЫЙ прогноз дня (макс. уверенность, при равенстве —
 * более ранний матч) и снимаем флаг со старой. Если предстоящих нет (самый
 * конец дня) — оставляем флаг на рассчитанной, чтобы hero показал итог.
 *
 * Правило редакции (29.09): в «Ставку дня» не берём события со средним кэфом
 * ниже 1.50 — активная ставка с низким кэфом ротируется на подходящую замену,
 * при подборе кандидатов подходящие по кэфу — в приоритете.
 */
export async function promoteBetOfDay(): Promise<void> {
  const now = new Date()
  const start = startOfDay(now)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)

  const current = await db.bet.findFirst({
    where: { isBetOfDay: true, matchDate: { gte: start, lt: end } },
  })
  // Текущая остаётся, только если она ещё в игре И проходит порог кэфа 1.50:
  // низкий кэф — меняем на лучшую подходящую замену
  if (current && current.status === 'pending' && isBodEligible(current)) return

  // Кандидаты — исключительно реальные прогнозы (демо не существует)
  const candidates = await db.bet.findMany({
    where: { isRealMatch: true, status: 'pending', matchDate: { gte: now, lt: end } },
  })
  if (candidates.length === 0) return

  // Правило кэфа: сначала подходящие (≥ 1.50); если таких нет — любой лучший,
  // чтобы hero не пустовал
  const eligible = candidates.filter(isBodEligible)
  const pool = [...(eligible.length > 0 ? eligible : candidates)]
  pool.sort(
    (a, b) => b.confidence - a.confidence || a.matchDate.getTime() - b.matchDate.getTime(),
  )
  const best = pool[0]
  if (!best || current?.id === best.id) return

  // Снимаем флаг только с АКТИВНЫХ ставок дня: рассчитанные (исторические)
  // BOD сохраняют isBetOfDay — по ним в статистике копится итог «Ставки дня».
  await db.bet.updateMany({
    where: { isBetOfDay: true, status: 'pending', NOT: { id: best.id } },
    data: { isBetOfDay: false },
  })
  await db.bet.update({ where: { id: best.id }, data: { isBetOfDay: true } })
}

// ---------------------------------------------------------------------------
// Единое обслуживание данных (общий троттл 30 c)
// ---------------------------------------------------------------------------
let lastMaintenanceRun = 0
const MAINTENANCE_THROTTLE_MS = 30_000

/**
 * Идемпотентная миграция ростера: дополняет список типстеров до 4-х
 * (специалисты по видам спорта), обновляет роли/специализации и
 * переназначает существующие real-прогнозы профильным аналитикам
 * (против «теннисного эксперта» на футбольном матче). Один раз за процесс.
 */
let rosterEnsured = false
export async function ensureTipsterRoster(): Promise<void> {
  if (rosterEnsured) return
  rosterEnsured = true
  try {
    for (const t of TIPSTERS) {
      const existing = await db.tipster.findFirst({ where: { name: t.name } })
      if (existing) {
        await db.tipster.update({
          where: { id: existing.id },
          data: { role: t.role, sport: t.sport },
        })
      } else {
        await db.tipster.create({ data: { name: t.name, role: t.role, sport: t.sport } })
      }
    }

    // Переназначение: real-прогнозы получают профильного типстера своего спорта
    const bySport = new Map<string, string[]>()
    for (const t of await db.tipster.findMany({ select: { id: true, sport: true } })) {
      if (!t.sport) continue
      const list = bySport.get(t.sport) ?? []
      list.push(t.id)
      bySport.set(t.sport, list)
    }
    const realBets = await db.bet.findMany({
      where: { isRealMatch: true, status: 'pending' },
      select: { id: true, sport: true, tipsterId: true },
    })
    const used = new Map<string, number>()
    for (const bet of realBets) {
      const pool = bySport.get(bet.sport) ?? []
      if (pool.length === 0 || pool.includes(bet.tipsterId ?? '')) continue
      const n = used.get(bet.sport) ?? 0
      used.set(bet.sport, n + 1)
      await db.bet.update({
        where: { id: bet.id },
        data: { tipsterId: pool[n % pool.length] },
      })
    }
    await recomputeTipsterCounters()
  } catch (e) {
    console.error('[seed] ensureTipsterRoster error:', e)
    rosterEnsured = false // повторим на следующем тике
  }
}

/**
 * maintenanceTick: 0) миграция ростера (раз за процесс); 1) ротация ставки дня;
 * 1b) ретро-флаги «Ставки дня» по прошедшим дням (история для статистики);
 * 2) фоновое обслуживание реальных прогнозов (расчёт по настоящим счётам +
 * генерация при нехватке — без блокировки роута); 3) линия рынка (web-search).
 * Вызывается во всех GET-роутах под общим троттлом 30 c (force=true обходит).
 */
export async function maintenanceTick(force = false): Promise<void> {
  const ts = Date.now()
  if (!force && ts - lastMaintenanceRun < MAINTENANCE_THROTTLE_MS) return
  lastMaintenanceRun = ts

  await ensureTipsterRoster()
  await promoteBetOfDay()
  backfillBetOfDayFlags() // фон: свой троттл 10 мин, ошибки не роняют тик
  ensureRealBets() // фон: не ждём — LLM/сеть не должны тормозить роуты
  refreshMarketIntel() // фон: линия рынка (web-search), свой троттл 10 мин
}

let inflight: Promise<void> | null = null

/**
 * Проверка свежести данных: прогнозы на сегодня генерирует движок реальных
 * матчей (в фоне, см. ensureRealBets). Демо-пересев больше не существует.
 * Вызывается в GET-обработчиках API. Защищено от параллельного выполнения.
 */
export async function ensureFreshData(): Promise<void> {
  if (inflight) return inflight
  const run = async () => {
    const start = startOfDay(new Date())
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
    const count = await db.bet.count({
      where: { isRealMatch: true, matchDate: { gte: start, lt: end } },
    })
    // Пустой день: пинаем генерацию реальных прогнозов без блокировки роута
    if (count === 0) ensureRealBets()
    await maintenanceTick()
  }
  inflight = run().finally(() => {
    inflight = null
  })
  return inflight
}

/**
 * Принудительное обновление (POST /api/seed): подбирает новые прогнозы
 * на реальные матчи (кнопка работает как «обновить данные»).
 */
export async function forceReseed(): Promise<void> {
  if (inflight) await inflight
  await forceGenerateRealBets()
}
