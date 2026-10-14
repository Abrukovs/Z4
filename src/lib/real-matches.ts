import ZAI from 'z-ai-web-dev-sdk'
import { promises as fs } from 'fs'
import path from 'path'
import { SPORT_KEYS, type RealMatchDto, type RealMatchStatus, type SportKey } from '@/lib/types'

/**
 * Реальное расписание матчей с матч-центра «Спорт-Экспресс».
 *
 * Страница вида https://www.sport-express.net/live/{sport}/{дд-ММ-гггг}
 * содержит статический HTML со строками матчей:
 *   [лига] [тур] [время] [статус] [хозяева] [счёт] [гости] [...доп. колонки]
 *
 * Парсер извлекает строки в этой структуре, нормализует статусы и кэширует
 * результат в памяти на 10 минут (TTL), чтобы не дёргать источник на каждый запрос.
 */

const SOURCE_NAME = 'Спорт-Экспресс'
const SOURCE_BASE = 'https://www.sport-express.net/live'

/** Расписание живёт по московскому времени: МСК = UTC+3 */
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000

/**
 * Кэш в памяти на 2 минуты: расписание теперь источник live-счётов для
 * карточек прогнозов, поэтому держим его свежим; источник дёргается
 * не чаще раза в две минуты на вид спорта — вежливая нагрузка.
 */
const CACHE_TTL_MS = 2 * 60 * 1000

/** Виды спорта на матч-центре (путь в URL) */
const URL_SPORTS: Record<SportKey, string> = {
  football: 'football',
  hockey: 'hockey',
  tennis: 'tennis',
  basketball: 'basketball',
}

/** Нормализация статусов со страницы (ключи без «ё», в нижнем регистре) */
const STATUS_MAP: Record<string, RealMatchStatus> = {
  'не начался': 'upcoming',
  'идет': 'live',
  'завершен': 'finished',
  'отменен': 'canceled',
  'перенесен': 'canceled',
  'отложен': 'canceled', // матч отложен — прогноз возвращается
  'отказ': 'canceled', // теннис: отказ (травма) — без счёта, возврат
}

/**
 * Live-статусы матч-центра: у каждого вида спорта своя фаза («1-й тайм»,
 * «2-я четверть», «3-й период», «2-й сет», «перерыв», «2-й перерыв»).
 * Описание фазы сохраняем — она показывается в UI рядом со счётом.
 */
const LIVE_STATUS_RE: RegExp[] = [
  /^идет$/,
  /^\d+-[йая]+ (тайм|четверть|период|сет)$/i, // 1-й тайм / 2-я четверть / 3-й период / 2-й сет
  /^перерыв$/i, // перерыв между таймами — матч продолжится
  /^\d+-й перерыв$/i, // хоккей: межпериодный перерыв
  /^овертайм$/i,
  /^тай-брейк$/i,
]

export interface RealMatchesData {
  date: string
  fetchedAt: string
  source: { name: string; urls: Record<SportKey, string> }
  sports: Record<SportKey, RealMatchDto[]>
}

/* ------------------------------ Утилиты ------------------------------ */

const isTimeLine = (l: string) => /^\d{1,2}:\d{2}$/.test(l)
const isPureNumber = (l: string) => /^\d+([.,]\d+)?$/.test(l)
const isScoreLine = (l: string) => /^- : -$/.test(l) || /^\d+ : \d+$/.test(l)
const hasLetters = (l: string) => /[A-Za-zА-Яа-яЁё]/.test(l)
const isNameLine = (l: string) => l.length >= 2 && !isPureNumber(l) && !isScoreLine(l) && !isTimeLine(l) && l !== '-' && l !== ':'

function normalizeLine(l: string): string {
  return l
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&laquo;/gi, '«')
    .replace(/&raquo;/gi, '»')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/\u00a0/g, ' ')
    .trim()
}

function htmlToLines(html: string): string[] {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, '\n')
    .split('\n')
    .map(normalizeLine)
    .filter(Boolean)
}

/** Живая фаза матча? «1-й тайм», «перерыв», «2-й сет» и т.п. */
function isLivePhase(key: string): boolean {
  return LIVE_STATUS_RE.some((re) => re.test(key))
}

function detectStatus(raw: string): RealMatchStatus | null {
  const key = raw.toLowerCase().replace(/ё/g, 'е')
  if (STATUS_MAP[key]) return STATUS_MAP[key]
  if (isLivePhase(key)) return 'live'
  return null
}

/**
 * Лига ищется шагами назад от времени. Кандидат не должен быть участником
 * уже разобранного матча — иначе это «хвост» предыдущей строки. Для тенниса
 * ход назад короче (матчи идут плотно, шаги назад ловят имена игроков) и
 * строки со скобками (страна/сеед игрока) отбраковываются.
 */
function findLeague(
  lines: string[],
  timeIdx: number,
  participants: Set<string>,
  isTennis: boolean,
): string | null {
  const maxDepth = isTennis ? 1 : 3
  for (let k = timeIdx - 1; k >= 0 && k >= timeIdx - maxDepth; k--) {
    const l = lines[k]
    if (isPureNumber(l) || l.length < 3) continue
    if (/(финал|круг|тур|раунд)/i.test(l) || /^1\/\d+/.test(l)) continue
    if (participants.has(l)) continue
    if (detectStatus(l)) continue // строка статуса — не лига
    if (isTimeLine(l) || isScoreLine(l)) continue
    if (isTennis && /\(/.test(l)) continue // имя игрока со страной/сеедом — не лига
    return l
  }
  return null
}

/** Явный заголовок теннисного турнира: «ATP. US Open (Нью-Йорк, США)»,
 * «ATP Challenger (Комо, Италия)», «WTA. ...», «ITF. ...» */
const TENNIS_TOURNAMENT_STRONG_RE = /^(ATP|WTA|ITF)\b/i
const TENNIS_TOURNAMENT_SOFT_RE = /челленджер|challenger|открытый чемпионат/i

/**
 * Лига для тенниса: walk-forward назад до заголовка турнирного блока.
 *
 * Проход 1 (глубокий, до 600 строк): явный заголовок — строки с префиксом
 * ATP/WTA/ITF или словом «Челленджер». Внутри блока между матчами только
 * «шум» (счёты по сетам, имена, круги, статусы) — он не подходит под шаблон.
 *
 * Проход 2 (короткий, ≤6 строк): «голый» заголовок блока вроде «US Open» —
 * ближайшая чистая строка без скобок (имена игроков всегда со страной),
 * не счёт/статус/круг. На старте блока это заголовок, в середине блока
 * шума без скобок не бывает → вернёт null и останется «липкая» лига.
 */
function findTennisLeague(
  lines: string[],
  timeIdx: number,
  participants: Set<string>,
): string | null {
  for (let k = timeIdx - 1; k >= 0 && k >= timeIdx - 600; k--) {
    const l = lines[k]
    // Навигация страницы содержит голые «ATP»/«WTA»/«ITF» — это не заголовки
    if (l.length <= 4 || /^(ATP|WTA|ITF)$/i.test(l)) continue
    if (l.length <= 90 && !isTimeLine(l) && !isScoreLine(l)) {
      if (TENNIS_TOURNAMENT_STRONG_RE.test(l) || TENNIS_TOURNAMENT_SOFT_RE.test(l)) return l
    }
  }
  for (let k = timeIdx - 1; k >= 0 && k >= timeIdx - 6; k--) {
    const l = lines[k]
    if (isPureNumber(l) || isTimeLine(l) || isScoreLine(l) || l.length < 3) continue
    if (detectStatus(l)) continue
    if (participants.has(l)) continue
    if (/\(/.test(l)) continue // имя игрока со страной/сеедом
    if (/^1\/\d+/.test(l)) continue
    if (/(финал|круг|тур|раунд)/i.test(l)) continue
    if (l.startsWith('/')) continue // партнёр в парном разряде
    if (l.length <= 60) return l
  }
  return null
}

/** Гости: первая «именная» строка (с буквами) после счёта/хозяев */
function findAwayIdx(lines: string[], from: number, limit = 10): number {
  for (let k = from; k < lines.length && k < from + limit; k++) {
    if (isNameLine(lines[k]) && hasLetters(lines[k])) return k
  }
  return -1
}

/**
 * Счёт по сетам для тенниса: числа после хозяев и после гостей попарно.
 *
 * Геймы идут ПОДРЯД сразу после имени игрока и обрываются на первой
 * НЕ-числовой строке. Раньше окно гостей было «9 строк после имени» —
 * оно ЗАТЕКАЛО в следующий матч (геймы соседа, числа заголовков блоков):
 * [6,6,6] превращалось в [6,6,6,6,4], длины расходились и счёт
 * «завершённого» матча терялся → ставки зависали в «в игре».
 */
function tennisScore(lines: string[], homeIdx: number, awayIdx: number): string | undefined {
  const homeGames: number[] = []
  for (let k = homeIdx + 1; k < awayIdx; k++) {
    if (/^\d+$/.test(lines[k])) homeGames.push(Number(lines[k]))
    else break // геймы хозяев — подряд; дальше уже чужие строки
  }
  const awayGames: number[] = []
  // Сколько геймов ждать у гостей: не больше, чем взято у хозяев
  const expected = homeGames.length > 0 ? homeGames.length : 5
  for (let k = awayIdx + 1; k < lines.length && awayGames.length < expected; k++) {
    if (/^\d+$/.test(lines[k])) awayGames.push(Number(lines[k]))
    else break // текст (следующий матч/заголовок блока) — счёт закончился
  }
  if (homeGames.length > 0 && homeGames.length === awayGames.length) {
    const sane = homeGames.every((h, i) => {
      const a = awayGames[i]
      return h <= 7 && a <= 7 && h !== a // валидный сет: 0–7 геймов, без равных
    })
    if (sane) return homeGames.map((h, i) => `${h}-${awayGames[i]}`).join(' ')
  }
  return undefined
}

function parseMatches(html: string, sport: SportKey): RealMatchDto[] {
  const lines = htmlToLines(html)
  const seen = new Set<string>()
  const participants = new Set<string>()
  const out: RealMatchDto[] = []
  let currentLeague = ''
  const isTennis = sport === 'tennis'

  for (let i = 0; i < lines.length; i++) {
    if (!isTimeLine(lines[i])) continue
    const status = detectStatus(lines[i + 1] ?? '')
    if (!status) continue

    const home = lines[i + 2] ?? ''
    if (!home || !isNameLine(home) || !hasLetters(home)) continue

    // Счёт вида «X : Y» / «- : -» идёт сразу после хозяев (кроме тенниса)
    const rawScore = lines[i + 3] ?? ''
    let score: string | undefined
    let scanFrom = i + 3
    if (/^(\d+) : (\d+)$/.test(rawScore)) {
      score = rawScore.replace(/\s/g, '')
    }

    // Теннисные пары: «[хозяин-1] [/ хозяин-2] [гость-1] [/ гость-2]» —
    // строка-партнёр начинается со «/»; склеиваем в полные имена пар
    let homeName = home
    if (sport === 'tennis' && /^\/\s/.test(lines[scanFrom] ?? '')) {
      homeName = `${home} ${lines[scanFrom].trim()}`
      scanFrom++
    }

    const awayIdx = findAwayIdx(lines, scanFrom)
    if (awayIdx < 0) continue
    let awayName = lines[awayIdx]
    if (sport === 'tennis' && /^\/\s/.test(lines[awayIdx + 1] ?? '')) {
      awayName = `${awayName} ${lines[awayIdx + 1].trim()}`
    }
    if (awayName === homeName) continue

    if (sport === 'tennis') {
      score = tennisScore(lines, i + 2, awayIdx)
    }

    // Лига: заголовок блока перед матчем либо «липкая» лига блока.
    // Теннис: глубокий walk-forward до заголовка турнира («ATP. US Open…»)
    const leagueCandidate = isTennis
      ? findTennisLeague(lines, i, participants)
      : findLeague(lines, i, participants, false)
    if (leagueCandidate) currentLeague = leagueCandidate
    const league = currentLeague

    const key = `${league}|${lines[i]}|${homeName}|${awayName}|${status}`
    if (seen.has(key)) continue
    seen.add(key)

    participants.add(homeName)
    participants.add(awayName)

    out.push({
      league: league || 'Расписание',
      time: lines[i],
      status,
      // Фаза live-матча («1-й тайм» / «перерыв» / «2-й сет») — для показа в UI
      phase: status === 'live' ? lines[i + 1] : undefined,
      home: homeName,
      away: awayName,
      score,
    })
  }

  return out
}

/* ------------------------------ Кэш и загрузка ------------------------------ */

interface CacheEntry {
  data: RealMatchesData
  ts: number
}

/** Кэш по датам расписания (сегодня + вчерашние незакрытые матчи после полуночи) */
const cacheByDate = new Map<string, CacheEntry>()
const inflightByDate = new Map<string, Promise<RealMatchesData>>()
let zaiPromise: Promise<ZAI> | null = null

/* --- Дисковый кэш расписания ----------------------------------------------
   Перезапуск сервера / HMR-перезагрузка модуля раньше означали ПОЛНОСТЬЮ
   холодный кэш: первый пользователь ждал ~12 секунд полного парсинга
   источника и видел пустое расписание с нулями. Теперь последний успешный
   снимок расписания хранится в db/real-matches-cache.json и поднимается
   в память при старте: роут мгновенно отдаёт его (stale-while-revalidate),
   а свежие данные тянутся в фоне. */

const CACHE_FILE = path.join(process.cwd(), 'db', 'real-matches-cache.json')
const FILE_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000
let fileCachePromise: Promise<void> | null = null

function loadFileCache(): Promise<void> {
  if (!fileCachePromise) {
    fileCachePromise = (async () => {
      try {
        const raw = await fs.readFile(CACHE_FILE, 'utf8')
        const parsed = JSON.parse(raw) as Record<string, CacheEntry>
        const now = Date.now()
        for (const [date, entry] of Object.entries(parsed)) {
          if (!entry?.data?.sports || now - entry.ts > FILE_CACHE_MAX_AGE_MS) continue
          if (!cacheByDate.has(date)) cacheByDate.set(date, entry)
        }
      } catch {
        // нет файла / битый JSON — обычный холодный старт
      }
    })()
  }
  return fileCachePromise
}

let lastDiskWrite = 0
function persistCacheAsync(): void {
  const now = Date.now()
  if (now - lastDiskWrite < 30_000) return // троттл записи: не чаще раза в 30 с
  lastDiskWrite = now
  void (async () => {
    try {
      const payload: Record<string, CacheEntry> = Object.fromEntries(cacheByDate)
      await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true })
      await fs.writeFile(CACHE_FILE, JSON.stringify(payload))
    } catch {
      // диск недоступен — молча: память всё равно работает
    }
  })()
}

export async function getZai(): Promise<ZAI> {
  if (!zaiPromise) zaiPromise = ZAI.create()
  return zaiPromise
}

/** Дата страницы (дд-ММ-гггг) по московскому времени */
export function mskDateStr(): string {
  return mskDateStrFromMsk(Date.now() + MSK_OFFSET_MS)
}

/** Завтрашняя дата страницы (дд-ММ-гггг) по московскому времени */
export function mskTomorrowDateStr(): string {
  return mskDateStrFromMsk(Date.now() + MSK_OFFSET_MS + 24 * 60 * 60 * 1000)
}

/** Резолв параметра дня расписания: 'today' | 'tomorrow' → дата страницы */
export function resolveDayParam(v: string | null): string {
  return v === 'tomorrow' ? mskTomorrowDateStr() : mskDateStr()
}

/** Дата страницы из UTC-миллисекунд московского времени */
function mskDateStrFromMsk(mskMs: number): string {
  const msk = new Date(mskMs)
  const dd = String(msk.getUTCDate()).padStart(2, '0')
  const mm = String(msk.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = msk.getUTCFullYear()
  return `${dd}-${mm}-${yyyy}`
}

/** Дата (дд-ММ-гггг) по МСК из произвольного момента (UTC-мс) */
export function mskDateOf(msUtc: number): string {
  return mskDateStrFromMsk(msUtc + MSK_OFFSET_MS)
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/**
 * Загрузка HTML страницы расписания. Основной путь — прямой HTTP-запрос
 * (быстро, без лимитов), fallback — remote-функция page_reader через SDK.
 */
/** Кулдаун page_reader после rate-limit (429): не дёргаем сервис, пока пауза активна */
let pageReaderCooldownUntil = 0
const PAGE_READER_COOLDOWN_MS = 10 * 60 * 1000

async function fetchSportOnce(zai: ZAI | null, url: string): Promise<string> {
  // 1) Прямой запрос: расписание — статический HTML, рендеринг не нужен
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) {
      const html = await res.text()
      if (html.length > 10_000) return html
    }
  } catch {
    // сеть/таймаут — пробуем через page_reader
  }
  // 2) page_reader (может быть недоступен или требовать ожидания).
  //    При 429 (rate-limit) уходим в кулдаун: расписание отдаётся из stale-кэша,
  //    а фоновое обновление повторится после паузы — сервис не долбим.
  if (zai && Date.now() > pageReaderCooldownUntil) {
    try {
      const res = await zai.functions.invoke('page_reader', { url })
      return res?.data?.html ?? ''
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('429') || /too many requests/i.test(msg)) {
        pageReaderCooldownUntil = Date.now() + PAGE_READER_COOLDOWN_MS
        console.warn('[real-matches] page_reader rate-limited → кулдаун 10 мин, отдаём stale-кэш')
      }
      return ''
    }
  }
  return ''
}

/**
 * Загрузка страницы расписания с ретраями. Основной путь — прямой HTTP
 * (быстрый), поэтому паузы короткие. null = все попытки провалились.
 */
async function fetchSport(
  zai: ZAI | null,
  sport: SportKey,
  date: string,
): Promise<RealMatchDto[] | null> {
  const url = `${SOURCE_BASE}/${URL_SPORTS[sport]}/${date}`
  const delays = [0, 1000, 3000]
  let html = ''
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) {
      await new Promise((r) => setTimeout(r, delays[attempt]))
    }
    try {
      html = await fetchSportOnce(zai, url)
      if (html) break
    } catch {
      // ретрай на следующей итерации
    }
  }
  if (!html) return null
  return parseMatches(html, sport)
}

/** UTC-момент старта матча: дата страницы «дд-ММ-гггг» + время «HH:MM» по МСК */
export function mskDateTimeToUtc(dateStr: string, time: string): Date {
  const [dd, mm, yyyy] = dateStr.split('-').map(Number)
  const [hh, mi] = time.split(':').map(Number)
  // Страница показывает московское время; UTC = МСК − 3ч
  return new Date(Date.UTC(yyyy, mm - 1, dd, hh, mi) - MSK_OFFSET_MS)
}

/**
 * Загрузка реального расписания на дату (по умолчанию — сегодня по МСК).
 * 4 вида спорта последовательно (лимит частоты запросов) + пауза между ними.
 * Кэш в памяти на 10 минут; force=true обходит кэш.
 * Ошибка вида спорта → данные из stale-кэша этой даты; полная неудача →
 * НЕ затираем кэш пустым результатом, отдаём последний успешный (со флагом stale).
 */
export async function getRealMatches(force = false, date = mskDateStr()): Promise<RealMatchesData> {
  await loadFileCache() // поднять дисковый снимок, если память холодная
  const cached = cacheByDate.get(date)
  if (!force && cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data
  const inflight = inflightByDate.get(date)
  if (inflight) return inflight

  const run = (async (): Promise<RealMatchesData> => {
    const urls = Object.fromEntries(
      SPORT_KEYS.map((s) => [s, `${SOURCE_BASE}/${URL_SPORTS[s]}/${date}`]),
    ) as Record<SportKey, string>

    let zai: ZAI | null = null
    try {
      zai = await getZai()
    } catch {
      zai = null // прямой HTTP работает и без SDK (page_reader — лишь fallback)
    }

    let okCount = 0
    const sports = Object.fromEntries(SPORT_KEYS.map((s) => [s, []])) as Record<
      SportKey,
      RealMatchDto[]
    >

    // Последовательно, чтобы не нагружать источник частыми запросами
    for (const s of SPORT_KEYS) {
      if (okCount > 0) {
        // пауза между видами спорта — вежливость к источнику
        await new Promise((r) => setTimeout(r, 600))
      }
      let result: RealMatchDto[] | null = null
      try {
        result = await fetchSport(zai, s, date)
      } catch {
        result = null
      }
      if (result) {
        sports[s] = result
        okCount++
      } else {
        // ошибка сети/лимит: не оставляем вид спорта пустым, если есть stale-кэш
        const stale = cacheByDate.get(date)
        if (stale) sports[s] = stale.data.sports[s] ?? []
      }
    }

    // Пустой, но успешно загруженный день даёт okCount > 0 (парсер вернул [] —
    // это «массив», а не null). okCount === 0 — сеть/источник недоступны:
    if (okCount === 0) {
      if (cached) return cached.data // отдаём stale-кэш, НЕ затирая его пустым
      // холодный старт без сети: пустые данные, не кэшируем (след. тик повторит)
      return { date, fetchedAt: new Date().toISOString(), source: { name: SOURCE_NAME, urls }, sports }
    }

    const data: RealMatchesData = {
      date,
      fetchedAt: new Date().toISOString(),
      source: { name: SOURCE_NAME, urls },
      sports,
    }
    cacheByDate.set(date, { data, ts: Date.now() })
    persistCacheAsync() // снимок на диск — пережить перезапуск/HMR
    return data
  })()

  inflightByDate.set(date, run)
  try {
    return await run
  } finally {
    inflightByDate.delete(date)
  }
}

/**
 * Неблокирующее чтение кэша расписания для флага realMode в /api/bets:
 * возвращает данные, даже если они протухли, и молча запускает фоновое
 * обновление. Никогда не ждёт сеть — маршрут не должен тормозить.
 */
export function getRealMatchesCached(): RealMatchesData | null {
  const date = mskDateStr()
  const cached = cacheByDate.get(date)
  if (!cached) return null
  if (Date.now() - cached.ts > CACHE_TTL_MS) {
    // фоновое обновление без ожидания
    void getRealMatches(true, date).catch(() => {})
  }
  return cached.data
}

/**
 * Stale-while-revalidate для роута /api/real-matches:
 * мгновенно отдаём кэш на дату (пусть и протухший), обновление — в фоне.
 * null — только если кэша на дату вообще нет (холодный старт).
 * Раньше протухший кэш БЛОКИРОВАЛ запрос на полный парсинг источника
 * (~12 секунд) — пользователь в это время видел пустое расписание с нулями.
 */
export function getRealMatchesStale(date: string): RealMatchesData | null {
  const cached = cacheByDate.get(date)
  if (!cached) return null
  if (Date.now() - cached.ts > CACHE_TTL_MS) {
    void getRealMatches(true, date).catch(() => {})
  }
  return cached.data
}

/** Кэш есть на диске? (проверка без поднятия в память — для роута) */
export async function getRealMatchesStaleOrDisk(date: string): Promise<RealMatchesData | null> {
  const memory = getRealMatchesStale(date)
  if (memory) return memory
  await loadFileCache()
  return getRealMatchesStale(date)
}

/** Есть ли в кэше предстоящие матчи сегодня (режим реальных прогнозов)? */
export function hasUpcomingToday(): boolean {
  const data = getRealMatchesCached()
  if (!data) return false
  const nowMs = Date.now()
  return SPORT_KEYS.some((s) =>
    (data.sports[s] ?? []).some((m) => {
      if (m.status !== 'upcoming') return false
      const start = mskDateTimeToUtc(data.date, m.time).getTime()
      return start > nowMs + 15 * 60 * 1000
    }),
  )
}

// HMR-тест: перезагрузка модуля
