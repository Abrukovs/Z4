import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'

/**
 * Линия рынка: web-search реальных котировок на наш выбор.
 *
 * Конвейер: поиск сниппетов по «Команда А Команда Б <выбор> коэффициент» →
 * LLM-извлечение кэфа на ИМЕННО наш рынок (таймаут 15с) → фолбэк-регексп
 * по сниппетам → вердикт сравнения → запись в Bet.marketOdds*.
 *
 * Устойчивость: любой сбой (нет токена, таймаут, пустой поиск) — поля
 * остаются null, карточка показывает прежний «примерный диапазон».
 * Вызовы фоновые (fire-and-forget), троттл: не чаще 10 мин глобально
 * и не чаще 2 ч на конкретную ставку (marketCheckedAt в БД).
 */

const SEARCH_TIMEOUT_MS = 20_000
const LLM_TIMEOUT_MS = 15_000
const GLOBAL_THROTTLE_MS = 10 * 60_000
const PER_BET_TTL_MS = 2 * 60 * 60_000
const LLM_MIN_LEN = 16 // «{"odds":null}» — короткий JSON валиден

type ZaiClient = Awaited<ReturnType<typeof ZAI.create>>
let cached: ZaiClient | null = null

async function getClient(): Promise<ZaiClient> {
  if (!cached) cached = await ZAI.create()
  return cached
}

interface SearchItem {
  url: string
  name: string
  snippet: string
  host_name: string
}

/* ------------------------- Поисковый запрос ------------------------- */

/** «ТБ 5.5 — тотал больше 5.5 шайб» → «ТБ 5.5»; «П2 — победа…» → «П2» */
function shortSelection(selection: string): string {
  return selection.split(' — ')[0].trim()
}

/** Рыночные слова для уточнения запроса */
function marketWords(market: string): string {
  if (/тотал/i.test(market)) return 'тотал'
  if (/фора/i.test(market)) return 'фора'
  if (/побед/i.test(market)) return 'победа'
  return ''
}

function buildQuery(home: string, away: string, market: string, selection: string): string {
  const parts = [home, away, shortSelection(selection), marketWords(market), 'коэффициент']
  return parts.filter(Boolean).join(' ')
}

/* --------------------- Извлечение: LLM → фолбэк --------------------- */

interface Extracted {
  odds: number | null
  source: string | null
}

function isValidOdds(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 1.05 && v <= 10
}

/** LLM-извлечение кэфа на наш рынок из сниппетов (timeout, strict JSON) */
async function extractViaLlm(
  query: string,
  match: string,
  market: string,
  selection: string,
  items: SearchItem[],
): Promise<Extracted | null> {
  try {
    const zai = await getClient()
    const context = items
      .slice(0, 6)
      .map((r, i) => `${i + 1}. [${r.host_name}] ${r.name}\n${r.snippet}`)
      .join('\n\n')

    const system =
      'Ты — ассистент спортивного аналитика. Извлекаешь букмекерские коэффициенты ' +
      'из фрагментов веб-поиска. Отвечаешь СТРОГО JSON без пояснений и без markdown.'
    const user =
      `МАТЧ: ${match}\nНАШ РЫНОК: ${market}\nНАШ ВЫБОР: ${selection}\n\n` +
      `Результаты поиска (запрос: «${query}»):\n${context}\n\n` +
      `Найди коэффициент букмекеров ИМЕННО на наш выбор. ` +
      `Если в фрагментах есть кэф только на ДРУГОЙ рынок (например победа, когда нужен тотал) — ` +
      `считай, что не найден. Верни JSON вида {"odds": <число|null>, "source": "<домен|null>"}.`

    const request = zai.chat.completions.create({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 120,
      temperature: 0,
    })
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('odds-intel LLM timeout')), LLM_TIMEOUT_MS)
    })
    const res = await Promise.race([request, timeout])
    const text = res.choices?.[0]?.message?.content?.trim()
    if (!text || text.length < LLM_MIN_LEN) return null

    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    const parsed = JSON.parse(jsonText) as { odds?: unknown; source?: unknown }
    const odds = isValidOdds(parsed.odds) ? parsed.odds : null
    const source =
      typeof parsed.source === 'string' && parsed.source.length > 2
        ? parsed.source.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
        : null
    if (!odds && !source) return null
    return { odds, source }
  } catch {
    cached = null // клиент мог протухнуть — пересоздадим на следующей попытке
    return null
  }
}

/** Фолбэк-регексп: числа 1.10–4.99 в сниппетах, где упомянут наш рынок */
function extractViaRegex(market: string, selection: string, items: SearchItem[]): Extracted | null {
  const short = shortSelection(selection)
  const lineValue = short.match(/(\d+(?:[.,]\d+)?)/)?.[1] // «5.5» из «ТБ 5.5»
  const marketRe = /тотал|фора|побед|ТБ|ТМ|П1|П2|Х2|1X/i

  for (const it of items) {
    const text = `${it.name} ${it.snippet}`
    // Сниппет должен упоминать наш рынок (значение линии или рыночное слово)
    const mentionsMarket =
      (lineValue && text.includes(lineValue)) || (marketRe.test(short) && marketRe.test(text))
    if (!mentionsMarket) continue

    // Числа вида 1.86 / 2,04 рядом со словами о кэфах
    const oddsRe = /(?:коэф\w*|кф|кэф\w*|котировк\w*)[^0-9]{0,25}(\d[.,]\d{2})/gi
    let m: RegExpExecArray | null
    while ((m = oddsRe.exec(text)) !== null) {
      const v = Number(m[1].replace(',', '.'))
      if (isValidOdds(v)) return { odds: v, source: it.host_name }
    }
    // «х1.86», «@1.86», «- 1.86» рядом с названием БК
    const tagRe = /(?:[хx@]|1xbet|париматч|винлайн|лига ставок|фаворит)[^0-9]{0,12}(\d[.,]\d{2})/gi
    while ((m = tagRe.exec(text)) !== null) {
      const v = Number(m[1].replace(',', '.'))
      if (isValidOdds(v)) return { odds: v, source: it.host_name }
    }
  }
  return null
}

/* --------------------------- Вердикт --------------------------- */

function buildVerdict(ourOdds: number, marketOdds: number, source: string | null): string {
  const diff = ourOdds - marketOdds
  const src = source ? ` по данным ${source}` : ''
  if (diff >= 0.05) {
    return `Наш кэф ${ourOdds.toFixed(2)} выше линии рынка (${marketOdds.toFixed(2)}${src}) — есть запас ценности.`
  }
  if (diff <= -0.05) {
    return `Наш кэф ${ourOdds.toFixed(2)} ниже линии рынка (${marketOdds.toFixed(2)}${src}) — кэф у книг теснее нашего.`
  }
  return `Наш кэф ${ourOdds.toFixed(2)} практически совпадает с линией рынка (${marketOdds.toFixed(2)}${src}).`
}

/* ------------------------ Публичный API ------------------------ */

interface IntelTarget {
  id: string
  homeTeam: string
  awayTeam: string
  market: string
  selection: string
  odds: number
  marketCheckedAt: Date | null
}

let lastGlobalRun = 0
let inflight: Promise<void> | null = null

async function searchWeb(query: string): Promise<SearchItem[]> {
  const zai = await getClient()
  const request = zai.functions.invoke('web_search', {
    query,
    num: 6,
    recency_days: 7,
  })
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('odds-intel search timeout')), SEARCH_TIMEOUT_MS)
  })
  const results = (await Promise.race([request, timeout])) as SearchItem[]
  return Array.isArray(results) ? results : []
}

/** Один матч: поиск → извлечение → вердикт → запись в БД */
async function intelForBet(bet: IntelTarget): Promise<void> {
  const query = buildQuery(bet.homeTeam, bet.awayTeam, bet.market, bet.selection)
  const match = `${bet.homeTeam} — ${bet.awayTeam}`

  let items: SearchItem[] = []
  try {
    items = await searchWeb(query)
  } catch {
    cached = null
    // Поиск недоступен: фиксируем время проверки, чтобы не долбить API
    await db.bet.update({
      where: { id: bet.id },
      data: { marketCheckedAt: new Date() },
    })
    return
  }

  const llmHit = await extractViaLlm(query, match, bet.market, bet.selection, items)
  const regexHit = llmHit ? null : extractViaRegex(bet.market, bet.selection, items)
  let hit = llmHit ?? regexHit

  // Sanity-щит: найденная «линия рынка» не должна отличаться от нашего
  // примерного кэфа сильнее ~1.65× в обе стороны. Сильное расхождение почти
  // всегда означает, что извлечён кэф на ДРУГОЙ рынок/матч (например «3.65»
  // против нашего 1.95 на П2 Флориды) — такая «линия» только сбивает вердикт.
  // Записываем только время проверки: повторим поиск через 2 часа.
  if (hit?.odds) {
    const ratio = hit.odds / bet.odds
    if (ratio > 1.65 || ratio < 0.6) {
      console.warn(
        `[odds-intel] подозрительная линия ${hit.odds} против нашей ${bet.odds} ` +
          `(${bet.homeTeam} — ${bet.awayTeam}) — вероятно чужой рынок, не записываем`,
      )
      hit = null
    }
  }

  const data: { marketOdds: number | null; marketSource: string | null; marketNote: string | null; marketCheckedAt: Date } = {
    marketOdds: null,
    marketSource: null,
    marketNote: null,
    marketCheckedAt: new Date(),
  }

  if (hit?.odds) {
    data.marketOdds = hit.odds
    data.marketSource = hit.source
    data.marketNote = buildVerdict(bet.odds, hit.odds, hit.source)
  }

  await db.bet.update({ where: { id: bet.id }, data })
}

/**
 * Фоновое обновление линии рынка: ставка дня (pending, реальный матч) и
 * свежие real-прогнозы на сегодня. Глобальный троттл 10 мин, на ставку — 2 ч.
 */
export function refreshMarketIntel(): void {
  const now = Date.now()
  if (now - lastGlobalRun < GLOBAL_THROTTLE_MS) return
  if (inflight) return
  lastGlobalRun = now

  inflight = (async () => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start.getTime() + 48 * 60 * 60 * 1000)

    const staleBefore = new Date(now - PER_BET_TTL_MS)
    // Приоритет: активная ставка дня, затем сегодняшние real-прогнозы
    const betOfDay = await db.bet.findFirst({
      where: {
        isBetOfDay: true,
        status: 'pending',
        isRealMatch: true,
        matchDate: { gte: start, lt: end },
        OR: [{ marketCheckedAt: null }, { marketCheckedAt: { lt: staleBefore } }],
      },
      orderBy: { matchDate: 'asc' },
    })
    const candidates: IntelTarget[] = []
    if (betOfDay) {
      candidates.push(betOfDay)
    } else {
      const todays = await db.bet.findMany({
        where: {
          status: 'pending',
          isRealMatch: true,
          isBetOfDay: false,
          matchDate: { gte: start, lt: end },
          OR: [{ marketCheckedAt: null }, { marketCheckedAt: { lt: staleBefore } }],
        },
        orderBy: { matchDate: 'asc' },
        take: 2,
      })
      candidates.push(...todays)
    }

    for (const bet of candidates) {
      try {
        await intelForBet(bet)
      } catch (e) {
        console.error('odds-intel: ошибка обновления ставки', bet.id, e)
      }
    }
  })()
    .catch((e) => console.error('odds-intel: фоновой проход упал', e))
    .finally(() => {
      inflight = null
    })
}
