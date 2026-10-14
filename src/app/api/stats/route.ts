import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureFreshData, maintenanceTick } from '@/lib/seed'
import { computeExpressDays } from '@/lib/express-history'
import { SPORT_KEYS, type SportKey } from '@/lib/types'

export const dynamic = 'force-dynamic'

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/* ----------------------------- Фильтры ------------------------------ */

const OUTCOME_VALUES = ['won', 'lost', 'void', 'pending'] as const
const CATEGORY_VALUES = ['bod', 'express', 'feed'] as const

interface StatsQuery {
  sport: SportKey | 'all'
  outcome: (typeof OUTCOME_VALUES)[number] | 'all'
  category: (typeof CATEGORY_VALUES)[number] | 'all'
  expert: string | 'all'
}

function parseQuery(req: NextRequest): StatsQuery {
  const p = req.nextUrl.searchParams
  const sportParam = p.get('sport')
  const sport: SportKey | 'all' =
    sportParam === 'football' ||
    sportParam === 'tennis' ||
    sportParam === 'hockey' ||
    sportParam === 'basketball'
      ? sportParam
      : 'all'
  const outcomeParam = p.get('outcome')
  const outcome = (OUTCOME_VALUES as readonly string[]).includes(outcomeParam ?? '')
    ? (outcomeParam as (typeof OUTCOME_VALUES)[number])
    : 'all'
  const categoryParam = p.get('category')
  const category = (CATEGORY_VALUES as readonly string[]).includes(categoryParam ?? '')
    ? (categoryParam as (typeof CATEGORY_VALUES)[number])
    : 'all'
  // идентификаторы tipster — cuid (буквы+цифры): защита от мусора в URL
  const expertParam = p.get('expert')
  const expert = expertParam && /^[a-z0-9]{15,}$/i.test(expertParam) ? expertParam : 'all'
  return { sport, outcome, category, expert }
}

/* ------------------------------- Роут -------------------------------- */

export async function GET(req: NextRequest) {
  try {
    await ensureFreshData()
    await maintenanceTick()
    const q = parseQuery(req)

    // СТАТИСТИКА — ТОЛЬКО РЕАЛЬНЫЕ МАТЧИ (живое расписание, настоящие счёты).
    // tipster включён сразу: эти же записи идут в recent / betOfDay.bets /
    // expressOfDay.days[].legs — клик по ним открывает разбор с аналитиком.
    const bets = await db.bet.findMany({
      where: { isRealMatch: true },
      orderBy: [{ matchDate: 'desc' }, { createdAt: 'desc' }],
      include: { tipster: true },
    })

    // Ноги «Экспресса дня» ретроспективно (формула едина с /api/express):
    // нужно до фильтрации — категория «Экспресс дня» = прогнозы-ноги.
    const { days: expressDays, totals: exTotals } = computeExpressDays(bets)
    const expressLegIds = new Set(expressDays.flatMap((d) => d.legs.map((l) => l.id)))

    // Выборка под фильтры пользователя (03.10): вид спорта, исход,
    // категория (Ставка дня / Экспресс дня / Лента), эксперт.
    const population = bets.filter((b) => {
      if (q.category === 'bod' && !b.isBetOfDay) return false
      if (q.category === 'express' && !expressLegIds.has(b.id)) return false
      if (q.category === 'feed' && (b.isBetOfDay || expressLegIds.has(b.id))) return false
      if (q.sport !== 'all' && b.sport !== q.sport) return false
      if (q.outcome !== 'all' && b.status !== q.outcome) return false
      if (q.expert !== 'all' && b.tipsterId !== q.expert) return false
      return true
    })

    const total = population.length
    const won = population.filter((b) => b.status === 'won').length
    const lost = population.filter((b) => b.status === 'lost').length
    const voided = population.filter((b) => b.status === 'void').length
    const pending = population.filter((b) => b.status === 'pending').length

    const decided = population.filter((b) => b.status === 'won' || b.status === 'lost')
    const winrate = decided.length > 0 ? (won / decided.length) * 100 : 0

    const profit = round2(
      decided.reduce((acc, b) => {
        if (b.status === 'won') return acc + b.stake * (b.odds - 1)
        if (b.status === 'lost') return acc - b.stake
        return acc
      }, 0),
    )
    const totalStaked = round2(
      population
        .filter((b) => b.status !== 'pending')
        .reduce((acc, b) => acc + b.stake, 0),
    )
    const roi = totalStaked > 0 ? (profit / totalStaked) * 100 : 0
    const avgOdds =
      decided.length > 0 ? decided.reduce((acc, b) => acc + b.odds, 0) / decided.length : 0

    // Текущая серия: идём от свежих завершённых, пропуская возвраты
    let streakType: 'won' | 'lost' | null = null
    let streakCount = 0
    for (const b of population) {
      if (b.status === 'pending' || b.status === 'void') continue
      if (streakType === null) {
        streakType = b.status as 'won' | 'lost'
        streakCount = 1
      } else if (b.status === streakType) {
        streakCount++
      } else {
        break
      }
    }

    // Максимальная серия побед (хронологический порядок)
    const chronological = [...population].sort(
      (a, b) => a.matchDate.getTime() - b.matchDate.getTime(),
    )
    let bestStreak = 0
    let run = 0
    for (const b of chronological) {
      if (b.status === 'won') {
        run++
        if (run > bestStreak) bestStreak = run
      } else if (b.status === 'lost') {
        run = 0
      }
    }

    // Серия прибыли по дням — за всё время (от первого рассчитанного прогноза
    // выборки до сегодня). При активных фильтрах «всё время» считается от
    // первого прогноза, подходящего под фильтр, — график показывает историю
    // именно этой выборки.
    const today = startOfDay(new Date())
    const settledTs = population
      .filter((b) => b.status !== 'pending')
      .map((b) => startOfDay(b.matchDate).getTime())
    const firstTs = settledTs.length > 0 ? Math.min(...settledTs) : today.getTime()
    // страховка от бесконечного роста окна (очень давняя история)
    const windowStart = new Date(
      Math.max(firstTs, today.getTime() - 400 * 24 * 60 * 60 * 1000),
    )
    const dayKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const perDay = new Map<string, number>()
    for (const b of population) {
      if (b.status === 'pending') continue
      const key = dayKey(startOfDay(b.matchDate))
      const delta =
        b.status === 'won' ? b.stake * (b.odds - 1) : b.status === 'lost' ? -b.stake : 0
      perDay.set(key, (perDay.get(key) ?? 0) + delta)
    }
    const daysCount = Math.min(
      400,
      Math.max(1, Math.round((today.getTime() - windowStart.getTime()) / 86400000) + 1),
    )
    const profitSeries: { date: string; cumulativeProfit: number }[] = []
    let cumulative = 0
    for (let i = 0; i < daysCount; i++) {
      const day = new Date(windowStart.getTime() + i * 24 * 60 * 60 * 1000)
      const key = dayKey(day)
      cumulative += perDay.get(key) ?? 0
      profitSeries.push({ date: key, cumulativeProfit: round2(cumulative) })
    }

    // Разбивка по видам спорта (завершённые прогнозы выборки)
    const bySport: {
      sport: string
      total: number
      won: number
      lost: number
      void: number
      winrate: number
      profit: number
    }[] = []
    for (const sport of SPORT_KEYS) {
      const sBets = population.filter((b) => b.sport === sport && b.status !== 'pending')
      if (sBets.length === 0) continue
      const sWon = sBets.filter((b) => b.status === 'won').length
      const sLost = sBets.filter((b) => b.status === 'lost').length
      const sVoid = sBets.filter((b) => b.status === 'void').length
      const sDecided = sWon + sLost
      const sProfit = sBets.reduce((acc, b) => {
        if (b.status === 'won') return acc + b.stake * (b.odds - 1)
        if (b.status === 'lost') return acc - b.stake
        return acc
      }, 0)
      bySport.push({
        sport,
        total: sBets.length,
        won: sWon,
        lost: sLost,
        void: sVoid,
        winrate: sDecided > 0 ? round2((sWon / sDecided) * 100) : 0,
        profit: round2(sProfit),
      })
    }

    // «Ставка дня»: итоги формата — ВСЕГДА по полной истории (не зависят
    // от фильтров): это отдельный «итог формата», а не фильтр выборки.
    const bodBets = bets.filter((b) => b.isBetOfDay)
    const bodWon = bodBets.filter((b) => b.status === 'won').length
    const bodLost = bodBets.filter((b) => b.status === 'lost').length
    const bodVoid = bodBets.filter((b) => b.status === 'void').length
    const bodPending = bodBets.filter((b) => b.status === 'pending').length
    const bodDecided = bodWon + bodLost
    const bodProfit = round2(
      bodBets.reduce((acc, b) => {
        if (b.status === 'won') return acc + b.stake * (b.odds - 1)
        if (b.status === 'lost') return acc - b.stake
        return acc
      }, 0),
    )
    const betOfDay = {
      total: bodBets.length,
      won: bodWon,
      lost: bodLost,
      void: bodVoid,
      pending: bodPending,
      winrate: bodDecided > 0 ? round2((bodWon / bodDecided) * 100) : 0,
      profit: bodProfit,
      // Конкретные ставки формата — для подраздела с датами и разборами
      bets: bodBets,
    }

    // «Экспресс дня» (ретроспектива) — итоги формата по полной истории
    const exDecided = exTotals.won + exTotals.lost
    const expressOfDay = {
      total: exTotals.won + exTotals.lost + exTotals.void,
      won: exTotals.won,
      lost: exTotals.lost,
      void: exTotals.void,
      pending: exTotals.pending,
      winrate: exDecided > 0 ? round2((exTotals.won / exDecided) * 100) : 0,
      profit: round2(exTotals.profit),
      // Конкретные дни с ногами — для подраздела с разборами
      days: expressDays,
    }

    // Последние прогнозы выборки: обычно завершённые (по ним есть итог);
    // при фильтре «Ещё в игре» — активные (иначе список был бы пуст).
    const recent =
      q.outcome === 'pending'
        ? population.filter((b) => b.status === 'pending').slice(0, 8)
        : population.filter((b) => b.status !== 'pending').slice(0, 8)

    // Мета фильтров (всегда по полной истории — опции не «прыгают»):
    // виды спорта и эксперты, встречающиеся в реальных прогнозах.
    const filterSports = SPORT_KEYS.filter((s) => bets.some((b) => b.sport === s))
    const expertMap = new Map<
      string,
      { id: string; name: string; sport: string | null; count: number }
    >()
    for (const b of bets) {
      const key = b.tipsterId ?? 'none'
      const cur = expertMap.get(key)
      if (cur) cur.count++
      else
        expertMap.set(key, {
          id: key,
          name: b.tipster?.name ?? 'Без эксперта',
          sport: b.tipster?.sport ?? null,
          count: 1,
        })
    }
    const filterExperts = [...expertMap.values()].sort((a, b) => b.count - a.count)

    return NextResponse.json({
      totals: { total, won, lost, void: voided, pending },
      winrate: round2(winrate),
      roi: round2(roi),
      profit,
      currentStreak: streakType ? { type: streakType, count: streakCount } : { type: 'won', count: 0 },
      bestStreak,
      avgOdds: round2(avgOdds),
      totalStaked,
      profitSeries,
      // Первый день истории выборки (при фильтрах — от первого подходящего
      // прогноза; без фильтров — от первого прогноза сайта)
      since: windowStart.toISOString(),
      bySport,
      betOfDay,
      expressOfDay,
      recent,
      // Опции фильтров для панели статистики
      filters: { sports: filterSports, experts: filterExperts },
    })
  } catch (error) {
    console.error('GET /api/stats error:', error)
    return NextResponse.json({ error: 'Не удалось загрузить статистику' }, { status: 500 })
  }
}
