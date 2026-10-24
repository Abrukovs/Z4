import { promises as fs } from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { logErrorBg, logInfoBg } from '@/lib/error-log'

/**
 * ВЕЧНЫЙ АРХИВ ИСТОРИИ ПРОГНОЗОВ (просьба владельца 23.10:
 * «Куда делись прошлые прогнозы экспертов? Их не надо удалять,
 * если память заполнена — скажите, я хотя бы скачаю»).
 *
 * Причина пропажи: платформа НОЧЬЮ СБРАСЫВАЕТ окружение — SQLite-файл
 * удаляется, история остаётся только за текущий день. Никто прогнозы
 * не удалял и память не заполнялась — данные стирает сброс сервера.
 *
 * Решение: каждый прогноз навсегда хранится в JSON-архиве
 *   data/bet-history.json        — tracked в git: переживает сбросы и
 *                                  пушится в GitHub (это НЕ база, секретов нет)
 *   .git/local-backup/bet-history.json — зеркало (папка .git выживает всегда)
 *
 * Логика:
 *  - syncBetArchive():     БД → архив (обновление статусов won/lost/void)
 *  - restoreHistoryFromArchive(): архив → БД после сброса (вставка
 *    утерянных прогнозов; прошедшие «висящие» pending помечаются возвратом
 *    с честной пометкой — на статистику не влияет)
 *  - buildBetsCsv():       выгрузка всей истории в CSV (кнопка «Скачать»)
 */

const ARCHIVE_DIR = path.join(process.cwd(), 'data')
const ARCHIVE_PATH = path.join(ARCHIVE_DIR, 'bet-history.json')
const ARCHIVE_MIRROR_DIR = path.join(process.cwd(), '.git', 'local-backup')
const ARCHIVE_MIRROR_PATH = path.join(ARCHIVE_MIRROR_DIR, 'bet-history.json')

const SYNC_THROTTLE_MS = 10 * 60 * 1000 // обычный sync — раз в 10 минут
let lastSyncAt = 0
let restoreDone = false

export interface ArchivedBet {
  id: string
  sport: string
  league: string
  homeTeam: string
  awayTeam: string
  matchDate: string // ISO
  market: string
  selection: string
  odds: number
  stake: number
  confidence: number
  analysis: string
  status: string // pending | won | lost | void
  resultNote: string | null
  isRealMatch: boolean
  isBetOfDay: boolean
  starLogic: string | null
  marketOdds: number | null
  marketSource: string | null
  marketNote: string | null
  marketCheckedAt: string | null
  tipsterName: string | null
  createdAt: string
  updatedAt: string
}

interface ArchiveFile {
  version: 1
  updatedAt: string
  bets: ArchivedBet[]
}

/* ------------------------------ чтение ------------------------------- */

async function readArchiveFile(filePath: string): Promise<Map<string, ArchivedBet>> {
  const map = new Map<string, ArchivedBet>()
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as ArchiveFile
    if (parsed && Array.isArray(parsed.bets)) {
      for (const b of parsed.bets) {
        if (b && typeof b.id === 'string') map.set(b.id, b)
      }
    }
  } catch {
    // нет файла / битый JSON — начинаем с пустого архива
  }
  return map
}

/** Архив из data/, при отсутствии — зеркало из .git/local-backup */
async function readArchive(): Promise<Map<string, ArchivedBet>> {
  let map = await readArchiveFile(ARCHIVE_PATH)
  if (map.size === 0) {
    map = await readArchiveFile(ARCHIVE_MIRROR_PATH)
  }
  return map
}

/* ------------------------------ запись ------------------------------- */

function toArchived(bet: {
  id: string
  sport: string
  league: string
  homeTeam: string
  awayTeam: string
  matchDate: Date
  market: string
  selection: string
  odds: number
  stake: number
  confidence: number
  analysis: string
  status: string
  resultNote: string | null
  isRealMatch: boolean
  isBetOfDay: boolean
  starLogic: string | null
  marketOdds: number | null
  marketSource: string | null
  marketNote: string | null
  marketCheckedAt: Date | null
  createdAt: Date
  updatedAt: Date
  tipster?: { name: string } | null
}): ArchivedBet {
  return {
    id: bet.id,
    sport: bet.sport,
    league: bet.league,
    homeTeam: bet.homeTeam,
    awayTeam: bet.awayTeam,
    matchDate: bet.matchDate.toISOString(),
    market: bet.market,
    selection: bet.selection,
    odds: bet.odds,
    stake: bet.stake,
    confidence: bet.confidence,
    analysis: bet.analysis,
    status: bet.status,
    resultNote: bet.resultNote ?? null,
    isRealMatch: bet.isRealMatch,
    isBetOfDay: bet.isBetOfDay,
    starLogic: bet.starLogic ?? null,
    marketOdds: bet.marketOdds ?? null,
    marketSource: bet.marketSource ?? null,
    marketNote: bet.marketNote ?? null,
    marketCheckedAt: bet.marketCheckedAt ? bet.marketCheckedAt.toISOString() : null,
    tipsterName: bet.tipster?.name ?? null,
    createdAt: bet.createdAt.toISOString(),
    updatedAt: bet.updatedAt.toISOString(),
  }
}

async function writeArchive(map: Map<string, ArchivedBet>): Promise<void> {
  const bets = [...map.values()].sort((a, b) => (a.matchDate < b.matchDate ? 1 : -1))
  const payload: ArchiveFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    bets,
  }
  const json = JSON.stringify(payload, null, 1)
  // атомарная запись: временный файл + rename. Имя tmp уникально для
  // каждого вызова (PID + счётчик): параллельные синхронизации (тик
  // обслуживания + ретро-расчёт) больше не топчут один файл — инцидент
  // 24.10 «ENOENT rename .tmp» при гонке двух sync'ов.
  await fs.mkdir(ARCHIVE_DIR, { recursive: true })
  const tmp = `${ARCHIVE_PATH}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, json, 'utf8')
  await fs.rename(tmp, ARCHIVE_PATH)
  // зеркало в .git/local-backup (переживает любые сбросы)
  try {
    await fs.mkdir(ARCHIVE_MIRROR_DIR, { recursive: true })
    await fs.writeFile(ARCHIVE_MIRROR_PATH, json, 'utf8')
  } catch {
    // зеркало не критично, если .git недоступен
  }
}

/* ------------------------------- sync -------------------------------- */

/**
 * БД → архив. Обновляет статусы (won/lost/void) и добавляет новые прогнозы.
 * Троттл 10 минут (force=true обходит — например, сразу после расчёта).
 * Пишет на диск ТОЛЬКО при реальных изменениях (нет холостых коммитов git).
 */
export async function syncBetArchive(force = false): Promise<void> {
  const ts = Date.now()
  if (!force && ts - lastSyncAt < SYNC_THROTTLE_MS) return
  lastSyncAt = ts
  try {
    const [dbBets, archive] = await Promise.all([
      db.bet.findMany({ include: { tipster: { select: { name: true } } } }),
      readArchive(),
    ])
    let changed = false
    for (const bet of dbBets) {
      const fresh = toArchived(bet)
      const old = archive.get(bet.id)
      if (!old) {
        archive.set(bet.id, fresh)
        changed = true
      } else if (fresh.updatedAt > old.updatedAt) {
        archive.set(bet.id, fresh)
        changed = true
      }
    }
    if (changed) await writeArchive(archive)
  } catch (e) {
    console.error('[bet-history] sync error:', e)
    logErrorBg('bet-history', 'Не удалось обновить вечный архив прогнозов', e)
  }
}

/* ----------------------------- восстановление ------------------------ */

const RESTORE_VOID_NOTE =
  'Восстановлено из вечного архива: сервер платформы перезагрузился до расчёта матча, итог не сохранился — возврат (на статистику не влияет)'

function startOfLocalDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * Архив → БД. Выполняется один раз за процесс (при первом визите после
 * сброса): вставляет утерянные прогнозы, актуализирует статусы.
 * Прошедшие ставки со статусом pending (сброс оборвал расчёт) получают
 * честный возврат с пояснением — они остаются видимыми в карточках
 * экспертов, но не портят статистику.
 */
export async function restoreHistoryFromArchive(): Promise<number> {
  if (restoreDone) return 0
  restoreDone = true
  try {
    const archive = await readArchive()
    if (archive.size === 0) return 0

    // Индекс текущих ставок по id
    const existing = await db.bet.findMany({ select: { id: true, updatedAt: true } })
    const existingMap = new Map(existing.map((b) => [b.id, b.updatedAt]))
    // Индекс типстеров по имени — восстанавливаем по имени (id после
    // пересоздания БД меняется)
    const tipsters = await db.tipster.findMany({ select: { id: true, name: true } })
    const tipsterByName = new Map(tipsters.map((t) => [t.name, t.id]))
    const dbIds = new Set(existing.map((b) => b.id))

    const todayStart = startOfLocalDay()
    let inserted = 0
    let updated = 0

    for (const ab of archive.values()) {
      const matchDate = new Date(ab.matchDate)
      const exists = existingMap.get(ab.id)

      // Уже есть в БД и архив не новее — пропускаем
      if (exists && new Date(ab.updatedAt) <= exists) continue

      // Прошедший матч, завис в pending (сброс оборвал расчёт) —
      // честный возврат, запись остаётся в истории эксперта
      let status = ab.status
      let resultNote = ab.resultNote
      if (status === 'pending' && matchDate < todayStart) {
        status = 'void'
        resultNote = RESTORE_VOID_NOTE
      }

      const data = {
        id: ab.id,
        sport: ab.sport,
        league: ab.league,
        homeTeam: ab.homeTeam,
        awayTeam: ab.awayTeam,
        matchDate,
        market: ab.market,
        selection: ab.selection,
        odds: ab.odds,
        stake: ab.stake,
        confidence: ab.confidence,
        analysis: ab.analysis,
        status,
        resultNote,
        isRealMatch: ab.isRealMatch,
        isBetOfDay: ab.isBetOfDay,
        starLogic: ab.starLogic,
        marketOdds: ab.marketOdds,
        marketSource: ab.marketSource,
        marketNote: ab.marketNote,
        marketCheckedAt: ab.marketCheckedAt ? new Date(ab.marketCheckedAt) : null,
        createdAt: new Date(ab.createdAt),
        updatedAt: new Date(),
      }

      if (exists) {
        // Архив новее (например, в архиве итог, а в БД сброс вернул pending)
        await db.bet.update({ where: { id: ab.id }, data })
        updated++
      } else {
        const tipsterId = ab.tipsterName ? tipsterByName.get(ab.tipsterName) : null
        await db.bet.create({ data: { ...data, tipsterId } })
        inserted++
        // если типстера с таким именем ещё нет — редкий случай (ростер
        // сеется раньше restore); ставим tipsterId=null, карточка всё
        // равно покажет прогноз в общей ленте
      }
    }

    if (inserted + updated > 0) {
      logInfoBg(
        'bet-history',
        `Архив восстановил историю: вставлено ${inserted}, обновлено ${updated} прогнозов (сброс сервера больше не стирает историю)`,
        { inserted, updated, archiveTotal: archive.size },
      )
    }
    return inserted
  } catch (e) {
    console.error('[bet-history] restore error:', e)
    logErrorBg('bet-history', 'Не удалось восстановить историю прогнозов из архива', e)
    restoreDone = false // повторим на следующем тике
    return 0
  }
}

/* ------------------------------ выгрузка ------------------------------ */

export interface ArchiveStats {
  total: number
  firstDate: string | null
  lastDate: string | null
  updatedAt: string | null
}

export async function getArchiveStats(): Promise<ArchiveStats> {
  const archive = await readArchive()
  if (archive.size === 0) return { total: 0, firstDate: null, lastDate: null, updatedAt: null }
  let first: string | null = null
  let last: string | null = null
  for (const b of archive.values()) {
    if (!first || b.matchDate < first) first = b.matchDate
    if (!last || b.matchDate > last) last = b.matchDate
  }
  let updatedAt: string | null = null
  try {
    const raw = JSON.parse(await fs.readFile(ARCHIVE_PATH, 'utf8')) as ArchiveFile
    updatedAt = raw.updatedAt ?? null
  } catch {
    try {
      const raw = JSON.parse(await fs.readFile(ARCHIVE_MIRROR_PATH, 'utf8')) as ArchiveFile
      updatedAt = raw.updatedAt ?? null
    } catch {
      /* нет файлов-заголовков — ок */
    }
  }
  return { total: archive.size, firstDate: first, lastDate: last, updatedAt }
}

const csvEscape = (v: string | number | null | undefined): string => {
  const s = v === null || v === undefined ? '' : String(v)
  return `"${s.replace(/"/g, '""')}"`
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'В игре',
  won: 'Зашёл',
  lost: 'Не зашёл',
  void: 'Возврат',
}

const SPORT_LABEL: Record<string, string> = {
  football: 'Футбол',
  tennis: 'Теннис',
  hockey: 'Хоккей',
  basketball: 'Баскетбол',
}

function mskStr(iso: string): string {
  // МСК = UTC+3: день матча нужен для человека, не для машины
  const d = new Date(iso)
  return new Date(d.getTime() + 3 * 3600_000).toISOString().replace('T', ' ').slice(0, 16) + ' МСК'
}

/**
 * Полная выгрузка истории в CSV (Excel открывает сразу: ; и BOM).
 * Источник: БД (после restore содержит всё) + записи архива, которых
 * в БД вдруг не оказалось (страховка).
 */
export async function buildBetsCsv(): Promise<string> {
  const dbBets = await db.bet.findMany({
    orderBy: { matchDate: 'asc' },
    include: { tipster: { select: { name: true } } },
  })
  const seen = new Set(dbBets.map((b) => b.id))
  const archive = await readArchive()

  type Row = {
    date: string
    tipster: string | null
    sport: string
    league: string
    match: string
    market: string
    selection: string
    odds: number
    stake: number
    confidence: number
    status: string
    resultNote: string | null
    isBetOfDay: boolean
    created: string
  }
  const rows: Row[] = dbBets.map((b) => ({
    date: b.matchDate.toISOString(),
    tipster: b.tipster?.name ?? null,
    sport: b.sport,
    league: b.league,
    match: `${b.homeTeam} — ${b.awayTeam}`,
    market: b.market,
    selection: b.selection,
    odds: b.odds,
    stake: b.stake,
    confidence: b.confidence,
    status: b.status,
    resultNote: b.resultNote,
    isBetOfDay: b.isBetOfDay,
    created: b.createdAt.toISOString(),
  }))
  for (const ab of archive.values()) {
    if (seen.has(ab.id)) continue
    rows.push({
      date: ab.matchDate,
      tipster: ab.tipsterName,
      sport: ab.sport,
      league: ab.league,
      match: `${ab.homeTeam} — ${ab.awayTeam}`,
      market: ab.market,
      selection: ab.selection,
      odds: ab.odds,
      stake: ab.stake,
      confidence: ab.confidence,
      status: ab.status,
      resultNote: ab.resultNote,
      isBetOfDay: ab.isBetOfDay,
      created: ab.createdAt,
    })
  }
  rows.sort((a, b) => (a.date > b.date ? 1 : -1))

  const head = [
    'Дата матча',
    'Эксперт',
    'Вид спорта',
    'Лига',
    'Матч',
    'Рынок',
    'Выбор',
    'Коэф.',
    'Ставка (юн.)',
    'Уверенность (%)',
    'Итог',
    'Комментарий',
    'Ставка дня',
    'Опубликован',
  ]
  const lines = [head.map(csvEscape).join(';')]
  for (const r of rows) {
    lines.push(
      [
        mskStr(r.date),
        r.tipster ?? '—',
        SPORT_LABEL[r.sport] ?? r.sport,
        r.league,
        r.match,
        r.market,
        r.selection,
        r.odds,
        r.stake,
        r.confidence,
        STATUS_LABEL[r.status] ?? r.status,
        r.resultNote ?? '',
        r.isBetOfDay ? 'Да' : '',
        mskStr(r.created),
      ]
        .map(csvEscape)
        .join(';'),
    )
  }
  return '\uFEFF' + lines.join('\r\n')
}
