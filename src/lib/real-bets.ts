import { db } from '@/lib/db'
import type ZAI from 'z-ai-web-dev-sdk'
import {
  getRealMatches,
  getRealMatchesCached,
  getZai,
  hasUpcomingToday,
  mskDateStr,
  mskDateTimeToUtc,
  mskDateOf,
  mskTomorrowDateStr,
} from './real-matches'
import { recomputeTipsterCounters } from './tipster-counters'
import { isBodEligible, TENNIS_LOW_RE, TENNIS_LOW_PENALTY } from './bod-rules'
import { hasForeignGlitch } from './llm'
import { parseStarLogic } from './star-logic'
import type { RealMatchDto, RealMatchesData, SportKey, StarLogic } from '@/lib/types'

/**
 * Движок прогнозов на РЕАЛЬНЫЕ матчи.
 *
 * 1) Выбирает предстоящие матчи из живого расписания (приоритет топ-лигам).
 * 2) Генерирует прогнозы: один batch-запрос к LLM (рынок, ПРИМЕРНЫЙ коэффициент,
 *    уверенность, разбор по-русски); при сбое LLM — детерминированная эвристика.
 * 3) Записывает в БД (isRealMatch=true), чистит сегодняшние демо-прогнозы
 *    и продвигает лучший реальный матч в «Ставку дня».
 * 4) resolveRealBets(): авто-расчёт по НАСТОЯЩИМ счётам из расписания.
 */

/* ------------------------------ Утилиты ------------------------------ */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const round2 = (v: number) => Math.round(v * 100) / 100
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))])
}

function startOfLocalDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

const SPORT_LABEL: Record<SportKey, string> = {
  football: 'футбол',
  hockey: 'хоккей',
  basketball: 'баскетбол',
  tennis: 'теннис',
}

/* --------------------------- Выбор матчей ---------------------------- */

const LEAGUE_PRIORITY = [
  'лига чемпионов',
  'лига европы',
  'лига конференций',
  // Лига наций УЕФА — топ-сборные, есть в линии любой конторы (03.10:
  // в дни паузы клубного футбола это самый «известный» доступный турнир)
  'лига наций',
  'премьер-лиг',
  'ла лига',
  'серия а',
  'бундеслиг',
  'лига 1',
  'рпл',
  'чемпионат россии',
  'кхл',
  'нхл',
  'нба',
  'евролига',
  'atp',
  'wta',
]

/** Понижение приоритета: женские/молодёжные/низшие турниры и микролиги.
 *  Вторая лига РФ (и ниже) — легальна в ЛЕНТЕ (просьба 03.10: «в Ленте
 *  прогнозов оставьте Вторую Лигу РФ Б и прочее»), но понижена в приоритете,
 *  чтобы не вытеснять топ-турниры; в «Ставку дня» она не проходит вовсе
 *  (белый список лиг — bod-rules.ts) */
const LEAGUE_PENALTIES: { re: RegExp; penalty: number }[] = [
  { re: /сан-марино|андорра|гибралтар|мальт[аы]|люксембург|лихтенштейн|косово|черногори/i, penalty: 12 },
  { re: /двойк|челлендж|квалифик|itf/i, penalty: 8 },
  { re: /чемпионат\s+росси[\s\S]*?вторая\s+лиг|вторая\s+лиг[\s\S]*?(групп|дивизион|«)/i, penalty: 4 },
  { re: /жен/i, penalty: 6 },
  { re: /юниор|молодеж|молодёжн|резерв/i, penalty: 5 },
  { re: /товарищ/i, penalty: 4 },
  { re: /студенческ|университет/i, penalty: 3 },
]

function leagueScore(league: string): number {
  const l = league.toLowerCase()
  let s = 40
  for (let i = 0; i < LEAGUE_PRIORITY.length; i++) {
    if (l.includes(LEAGUE_PRIORITY[i])) {
      s = i
      break
    }
  }
  for (const p of LEAGUE_PENALTIES) if (p.re.test(l)) s += p.penalty
  return s
}

/* ------------- Топ-турниры тенниса: правила в bod-rules.ts ------------- */

// TENNIS_LOW_RE / TENNIS_MAJOR_RE / TENNIS_MAIN_TOUR_RE и isTopTennisEvent
// живут в bod-rules.ts — единый источник правил для «Ставки дня» и ленты
// (импортируем TENNIS_LOW_RE и TENNIS_LOW_PENALTY для приоритетов отбора).

/** Квоты по видам спорта для разнообразия ленты прогнозов. Лимит поднят
 *  до 10 (03.10): низшие дивизионы РФ вернулись в ленту — им нужно место
 *  рядом с топ-турнирами, не вытесняя их. */
const QUOTA: Record<SportKey, number> = { football: 4, hockey: 2, basketball: 1, tennis: 1 }
const MAX_REAL_BETS = 10

interface SelectedMatch {
  sport: SportKey
  m: RealMatchDto
  start: number
}

/**
 * Отбор предстоящих матчей для прогнозов: только upcoming (старт минимум через
 * 5 минут — чтобы отсчёт был виден); приоритет топ-лигам и более раннему
 * времени (вечерний прайм-тайм важнее поздних матчей); квоты по видам спорта.
 * used — пары, уже покрытые прогнозами.
 */
export function selectMatches(
  data: RealMatchesData,
  now: number,
  used: Set<string>,
): SelectedMatch[] {
  const candidates: (SelectedMatch & { score: number })[] = []

  for (const sport of Object.keys(data.sports) as SportKey[]) {
    for (const m of data.sports[sport] ?? []) {
      if (m.status !== 'upcoming') continue
      if (used.has(`${m.home}|${m.away}`)) continue
      // Парные разряды (имена со «/») парсятся некорректно — в прогнозы не берём
      if (m.home.includes('/') || m.away.includes('/') || m.away.startsWith('/')) continue
      // Низшие дивизионы РФ снова РАЗРЕШЕНЫ в ленте (03.10: «в Ленте
      // прогнозов оставьте Вторую Лигу РФ Б и прочее») — они понижены в
      // приоритете отбора (LEAGUE_PENALTIES), а в «Ставку дня» не проходят
      // белый список лиг (isBodEligible → isKnownFootballLeague).
      // Теннис со временем 00:00 — сетка дня ещё не опубликована (заглушка
      // источника, Task 36): реальное время неизвестно, линии букмекеров
      // на такие матчи нет, отсчёт до «полуночи» врёт — в прогнозы не берём
      if (sport === 'tennis' && m.time === '00:00') continue
      const start = mskDateTimeToUtc(data.date, m.time).getTime()
      if (start <= now + 5 * 60 * 1000) continue // уже идёт/ вот-вот начнётся
      candidates.push({
        sport,
        m,
        start,
        score:
          leagueScore(m.league) +
          (sport === 'tennis' && TENNIS_LOW_RE.test(m.league) ? TENNIS_LOW_PENALTY : 0) +
          (start < now + 2 * 60 * 60 * 1000 ? 0 : 3),
      })
    }
  }

  // Приоритет: топ-лиги, затем более ранний старт (ближе к «сегодня»)
  candidates.sort((a, b) => a.score - b.score || a.start - b.start)
  if (candidates.length === 0) return []

  const remaining = { ...QUOTA }
  let total = QUOTA.football + QUOTA.hockey + QUOTA.basketball + QUOTA.tennis
  const out: SelectedMatch[] = []
  const picked = new Set<string>()

  const pool = candidates

  // Проход 1: по квотам
  for (const c of pool) {
    if (out.length >= total) break
    if (remaining[c.sport] <= 0) continue
    const key = `${c.m.home}|${c.m.away}`
    if (picked.has(key)) continue
    picked.add(key)
    remaining[c.sport]--
    out.push({ sport: c.sport, m: c.m, start: c.start })
  }
  // Проход 2: добираем любыми видами до лимита
  for (const c of pool) {
    if (out.length >= Math.min(MAX_REAL_BETS, pool.length)) break
    // Теннис — только один прогноз дня («звезда», Task 34):
    // квота уже закрыта в проходе 1, сверх неё теннис не добираем
    if (c.sport === 'tennis') continue
    const key = `${c.m.home}|${c.m.away}`
    if (picked.has(key)) continue
    picked.add(key)
    out.push({ sport: c.sport, m: c.m, start: c.start })
  }
  return out.slice(0, MAX_REAL_BETS)
}

/**
 * Лучший предстоящий теннисный матч для «прогноза звезды»: те же фильтры
 * и приоритеты, что и в ленте (Task 37 — турниры ЛЮБЫЕ, приоритет топ-туру;
 * заглушка 00:00 и парные разряды исключены). Нужен, чтобы теннисный
 * эксперт гарантированно получил СВОЙ прогноз дня, даже когда слоты
 * ленты заняли другие виды спорта.
 */
function bestTennisCandidate(
  data: RealMatchesData,
  now: number,
  used: Set<string>,
): SelectedMatch | null {
  const list: (SelectedMatch & { score: number })[] = []
  for (const m of data.sports.tennis ?? []) {
    if (m.status !== 'upcoming') continue
    if (used.has(`${m.home}|${m.away}`)) continue
    if (m.home.includes('/') || m.away.includes('/') || m.away.startsWith('/')) continue
    // Заглушка времени (Task 36): матч без опубликованного времени старта —
    // звезда не должна давать прогноз на «призрачный» матч без линии
    if (m.time === '00:00') continue
    const start = mskDateTimeToUtc(data.date, m.time).getTime()
    if (start <= now + 5 * 60 * 1000) continue
    list.push({
      sport: 'tennis',
      m,
      start,
      score:
        leagueScore(m.league) +
        (TENNIS_LOW_RE.test(m.league) ? TENNIS_LOW_PENALTY : 0) +
        (start < now + 2 * 60 * 60 * 1000 ? 0 : 3),
    })
  }
  list.sort((a, b) => a.score - b.score || a.start - b.start)
  return list[0] ?? null
}

/* ------------------------- Рынки и эвристика ------------------------- */

interface BetPlan {
  market: string
  selection: string
  odds: number
  confidence: number
  stake: number
  analysis: string
}

/** Баскетбольный тотал: НБА играет ~220 очков, остальные лиги ~155 */
function basketballLine(league: string): number {
  return /нба|nba/i.test(league) ? 218.5 : 158.5
}

function heuristicPlan(sport: SportKey, m: RealMatchDto, rand: () => number): BetPlan {
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]
  const oddsOf = (a: number, b: number) => round2(a + rand() * (b - a))

  if (sport === 'football') {
    const variants: BetPlan[] = [
      {
        market: 'Исход матча (1X2)',
        selection: 'П1 — победа хозяев',
        odds: oddsOf(1.55, 2.05),
        confidence: 60 + Math.floor(rand() * 21),
        analysis: `${m.home} дома играет агрессивнее и стабильнее набирает очки на своём поле, тогда как ${m.away} на выезде часто действует вторым номером. Домашний фактор и поддержка трибун — главный аргумент выбора.`,
      },
      {
        market: 'Исход матча (1X2)',
        selection: 'П2 — победа гостей',
        odds: oddsOf(1.55, 2.05),
        confidence: 58 + Math.floor(rand() * 21),
        analysis: `${m.away} приезжает в хорошей форме и по составу выглядит сильнее, а ${m.home} в последних домашних матчах терял очки. Гости обязаны реализовать перевес в классе.`,
      },
      {
        market: 'Тотал голов',
        selection: 'ТБ 2.5 — тотал больше 2.5 голов',
        odds: oddsOf(1.72, 1.95),
        confidence: 62 + Math.floor(rand() * 19),
        analysis: `Обе команды играют в открытый футбол: ${m.home} забивает дома почти в каждом матче, ${m.away} не садится в оборону на выезде. Очные встречи этих клубов традиционно верховые — ждём минимум три гола.`,
      },
      {
        market: 'Обе забьют',
        selection: 'Обе забьют — да',
        odds: oddsOf(1.62, 1.88),
        confidence: 60 + Math.floor(rand() * 21),
        analysis: `${m.home} стабильно отличается дома, а оборона ${m.away} в последних матчах пропускала регулярно. С другой стороны, гости тоже создавали моменты в каждом выездном матче — размен голами выглядит закономерным.`,
      },
    ]
    const v = pick(variants)
    return { ...v, stake: 3 + Math.floor(rand() * 8) }
  }

  if (sport === 'hockey') {
    const variants: BetPlan[] = [
      {
        market: 'Исход матча',
        selection: 'П1 — победа хозяев',
        odds: oddsOf(1.62, 2.25),
        confidence: 58 + Math.floor(rand() * 22),
        analysis: `${m.home} на домашнем льду добавляет в атаке и чаще контролирует игру, ${m.away} в гостях выглядит скованнее. При равных составах домашнее преимущество может стать решающим фактором.`,
      },
      {
        market: 'Тотал шайб',
        selection: 'ТБ 5.5 — тотал больше 5.5 шайб',
        odds: oddsOf(1.75, 1.98),
        confidence: 58 + Math.floor(rand() * 20),
        analysis: `${m.home} и ${m.away} играют в атакующий хоккей и не боятся раскрываться: в последних матчах обеих команд шайб было много. Очные встречи этой пары тоже традиционно результативные.`,
      },
    ]
    const v = pick(variants)
    return { ...v, stake: 3 + Math.floor(rand() * 8) }
  }

  if (sport === 'basketball') {
    const line = basketballLine(m.league)
    const total = line > 200 ? '218.5' : '158.5'
    const variants: BetPlan[] = [
      {
        market: 'Исход матча',
        selection: 'П1 — победа хозяев',
        odds: oddsOf(1.55, 2.15),
        confidence: 58 + Math.floor(rand() * 22),
        analysis: `${m.home} дома показывает лучший процент реализации и глубже ротация, ${m.away} дальше летает и хуже выглядит во второй половине. Домашняя поддержка — весомый козырь.`,
      },
      {
        market: 'Тотал очков',
        selection: `ТБ ${total} — тотал больше ${total} очков`,
        odds: oddsOf(1.82, 2.02),
        confidence: 57 + Math.floor(rand() * 20),
        analysis: `${m.home} и ${m.away} играют в быстрый атакующий баскетбол с высокой результативностью. Темп обеих команд высокий, защита не является их сильной стороной — ждём «верховой» матч.`,
      },
    ]
    const v = pick(variants)
    return { ...v, stake: 3 + Math.floor(rand() * 8) }
  }

  // tennis
  const variants: BetPlan[] = [
    {
      market: 'Победа в матче',
      selection: 'П1 — победа первого игрока',
      odds: oddsOf(1.4, 2.3),
      confidence: 58 + Math.floor(rand() * 23),
      analysis: `${m.home} подходит к матчу в лучшей форме: стабильная подача и уверенная игра на задней линии. ${m.away} в предыдущих раундах выглядел менее убедительно — фаворит должен дожать.`,
    },
    {
      market: 'Победа в матче',
      selection: 'П2 — победа второго игрока',
      odds: oddsOf(1.4, 2.3),
      confidence: 57 + Math.floor(rand() * 22),
      analysis: `${m.away} демонстрирует более высокий уровень игры на ключевых мячах и увереннее действует на приеме. У ${m.home} просадки на подаче — шанс для андердога.`,
    },
  ]
  const v = pick(variants)
  return { ...v, stake: 3 + Math.floor(rand() * 8) }
}

/* --------------------------- LLM-генерация --------------------------- */

const SYSTEM_PROMPT =
  'Ты — старший аналитик сайта спортивных прогнозов «Ставка Дня». Ты пишешь конкретные, честные и живые разборы по-русски, без воды и без выдумывания точных цифр сверх общих знаний о командах.'

interface LlmTip {
  market?: string
  selection?: string
  odds?: number
  confidence?: number
  stake?: number
  analysis?: string
}

function buildUserPrompt(matches: SelectedMatch[]): string {
  const list = matches
    .map(
      (sm, i) =>
        `${i + 1}. ${SPORT_LABEL[sm.sport]} · ${sm.m.league} · ${sm.m.time} МСК · ${sm.m.home} — ${sm.m.away}`,
    )
    .join('\n')

  return `Ниже — реальные матчи сегодняшнего расписания (время московское). Для КАЖДОГО матча выбери один прогноз.

Матчи:
${list}

Разрешённые рынки:
- футбол: «П1 — победа хозяев», «П2 — победа гостей», «Ничья (Х)», «ТБ 2.5 — тотал больше 2.5 голов», «ТМ 2.5 — тотал меньше 2.5 голов», «Обе забьют — да»
- хоккей: «П1 — победа хозяев», «П2 — победа гостей», «ТБ 5.5 — тотал больше 5.5 шайб», «ТМ 5.5 — тотал меньше 5.5 шайб»
- баскетбол: «П1 — победа хозяев», «П2 — победа гостей», «ТБ 218.5 — тотал больше 218.5 очков» (если НБА), иначе «ТБ 158.5 — тотал больше 158.5 очков», аналогично «ТМ»
- теннис: «П1 — победа первого игрока», «П2 — победа второго игрока» (победа в матче, не по сетам)

Ответ СТРОГО валидным JSON-массивом без какого-либо текста до или после:
[{"n":1,"market":"Тотал голов","selection":"ТБ 2.5 — тотал больше 2.5 голов","odds":1.85,"confidence":72,"stake":5,"analysis":"2–3 предложения: форма команд, мотивация, стиль игры, история очных встреч. По-русски, 200–400 символов."}]

Правила:
- "n" — номер матча из списка выше, по порядку
- market — название рынка (например «Исход матча (1X2)», «Тотал голов», «Тотал шайб», «Тотал очков», «Обе забьют», «Победа в матче»)
- odds — ПРИМЕРНЫЙ реалистичный коэффициент 1.30–2.60, как в букмекерской линии
- confidence — уверенность 55–85; stake — размер ставки 3–10
- выбор распредели разнообразно: не все прогнозы на один и тот же исход`
}

function parseLlmJson(text: string, count: number): Map<number, LlmTip> {
  const out = new Map<number, LlmTip>()
  try {
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start < 0 || end <= start) return out
    const arr = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(arr)) return out
    for (const item of arr) {
      const n = Number(item?.n)
      if (Number.isInteger(n) && n >= 1 && n <= count) {
        out.set(n, {
          market: typeof item.market === 'string' ? item.market : undefined,
          selection: typeof item.selection === 'string' ? item.selection : undefined,
          odds: typeof item.odds === 'number' ? item.odds : undefined,
          confidence: typeof item.confidence === 'number' ? item.confidence : undefined,
          stake: typeof item.stake === 'number' ? item.stake : undefined,
          analysis: typeof item.analysis === 'string' ? item.analysis : undefined,
        })
      }
    }
  } catch {
    // невалидный JSON — используем эвристику
  }
  return out
}

async function llmPredictions(matches: SelectedMatch[]): Promise<Map<number, LlmTip>> {
  try {
    const zai = await getZai()
    const completion = await withTimeout(
      zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(matches) },
        ],
        thinking: { type: 'disabled' },
      }),
      90_000,
    )
    if (!completion) return new Map()
    const text = completion.choices[0]?.message?.content ?? ''
    return parseLlmJson(text, matches.length)
  } catch (e) {
    console.error('[real-bets] LLM generation failed:', e)
    return new Map()
  }
}

/** Определяет тип прогноза из текста selection (надёжно для любого LLM-ответа) */
type BetKind = 'P1' | 'P2' | 'X' | 'TB' | 'TM' | 'BTTS'

function detectKind(sport: SportKey, text: string): { kind: BetKind; line?: number } | null {
  const t = text.toLowerCase()
  const btts = /обе забьют/.test(t)
  if (btts && sport === 'football') return { kind: 'BTTS' }
  const tb = t.match(/тб\s*(\d+(?:[.,]\d+)?)/)
  if (tb) return { kind: 'TB', line: Number(tb[1].replace(',', '.')) }
  const tm = t.match(/тм\s*(\d+(?:[.,]\d+)?)/)
  if (tm) return { kind: 'TM', line: Number(tm[1].replace(',', '.')) }
  if (/п1|победа хозяев|первого игрока|перв(ая|ой) команд/i.test(text)) return { kind: 'P1' }
  if (/п2|победа гостей|второго игрока|втор(ая|ой) команд/i.test(text)) return { kind: 'P2' }
  if (/ничья/.test(t) && sport === 'football') return { kind: 'X' }
  return null
}

/** Канонические строки рынка для вида спорта и типа прогноза */
function canonicalStrings(sport: SportKey, kind: BetKind, line: number, home: string, away: string) {
  switch (kind) {
    case 'P1':
      return {
        market: sport === 'tennis' ? 'Победа в матче' : sport === 'hockey' || sport === 'basketball' ? 'Исход матча' : 'Исход матча (1X2)',
        selection: sport === 'tennis' ? `П1 — победа ${home}` : 'П1 — победа хозяев',
      }
    case 'P2':
      return {
        market: sport === 'tennis' ? 'Победа в матче' : sport === 'hockey' || sport === 'basketball' ? 'Исход матча' : 'Исход матча (1X2)',
        selection: sport === 'tennis' ? `П2 — победа ${away}` : 'П2 — победа гостей',
      }
    case 'X':
      return { market: 'Исход матча (1X2)', selection: 'Ничья (Х)' }
    case 'TB':
      return {
        market: sport === 'football' ? 'Тотал голов' : sport === 'hockey' ? 'Тотал шайб' : sport === 'basketball' ? 'Тотал очков' : 'Тотал геймов',
        selection: `ТБ ${line} — тотал больше ${line}${sport === 'football' ? ' голов' : sport === 'hockey' ? ' шайб' : sport === 'basketball' ? ' очков' : ' геймов'}`,
      }
    case 'TM':
      return {
        market: sport === 'football' ? 'Тотал голов' : sport === 'hockey' ? 'Тотал шайб' : sport === 'basketball' ? 'Тотал очков' : 'Тотал геймов',
        selection: `ТМ ${line} — тотал меньше ${line}${sport === 'football' ? ' голов' : sport === 'hockey' ? ' шайб' : sport === 'basketball' ? ' очков' : ' геймов'}`,
      }
    case 'BTTS':
      return { market: 'Обе забьют', selection: 'Обе забьют — да' }
  }
}

/** Линия по умолчанию для тоталов, если LLM её не указал */
function defaultLine(sport: SportKey, kind: BetKind, league: string): number | null {
  if (kind !== 'TB' && kind !== 'TM') return null
  switch (sport) {
    case 'football':
      return 2.5
    case 'hockey':
      return 5.5
    case 'basketball':
      return basketballLine(league)
    default:
      return null
  }
}

/** Сборка плана из LLM-подсказки с санитайзом; при сбое — эвристика */
function buildPlan(
  sport: SportKey,
  m: RealMatchDto,
  tip: LlmTip | undefined,
  rand: () => number,
): BetPlan {
  const fallback = heuristicPlan(sport, m, rand)
  if (!tip) return fallback

  const raw = `${tip.market ?? ''} ${tip.selection ?? ''}`
  const detected = detectKind(sport, raw)

  if (detected) {
    let { kind, line } = detected
    if (kind === 'P1' || kind === 'P2' || kind === 'X' || kind === 'BTTS') line = 0
    if ((kind === 'TB' || kind === 'TM') && !line) {
      line = defaultLine(sport, kind, m.league) ?? 0
    }
    const c = canonicalStrings(sport, kind, line ?? 0, m.home, m.away)
    const analysis =
      tip.analysis && tip.analysis.trim().length >= 60 ? tip.analysis.trim() : fallback.analysis
    return {
      market: c.market,
      selection: c.selection,
      odds: round2(clamp(tip.odds ?? fallback.odds, 1.2, 3.5)),
      confidence: Math.round(clamp(tip.confidence ?? fallback.confidence, 50, 90)),
      stake: Math.round(clamp(tip.stake ?? fallback.stake, 1, 10)),
      analysis,
    }
  }
  return fallback
}

/* ----------------- Подробный разбор логики «звезды» (Task 37) --------- */

/** Дополнение к обычному LLM-разбору: структура, по которой читатель
 *  видит КАЖДЫЙ шаг логики Марии Волковой — тезис, факторы за/против,
 *  сценарий, риск, почему не альтернатива и почему такой размер ставки. */
const STAR_LOGIC_SYSTEM_PROMPT =
  'Ты — Мария Волкова, ведущий теннисный эксперт сайта «Ставка Дня». Ты разбираешь матч так, чтобы читатель понял каждый шаг: почему этот игрок, этот рынок и именно такой размер ставки. Пиши по-русски, конкретно и честно; точную статистику не выдумывай — опирайся на общие знания об игроках и турнире.'

function buildStarLogicPrompt(m: RealMatchDto, plan: BetPlan): string {
  return `Матч (реальное расписание): ${m.league} · ${m.home} — ${m.away} · старт ${m.time} МСК.
Прогноз сайта: ${plan.market} — «${plan.selection}», коэффициент ≈${plan.odds}, уверенность ${plan.confidence}%, размер ставки ${plan.stake} юнитов.

Верни СТРОГО валидный JSON-объект без какого-либо текста до или после:
{"thesis":"главный тезис выбора одной фразой","factors":[{"title":"короткий заголовок фактора","detail":"1–2 предложения пояснения","side":"pro"}],"scenario":"как должен развиваться матч, чтобы прогноз прошёл","risks":"главный риск — при каком развитии ставка проигрывает","alternative":"почему НЕ противоположный исход и не другой рынок","stakeLogic":"почему именно такой размер ставки в юнитах"}

Правила:
- factors: 4–5 пунктов; side: "pro" — аргумент ЗА выбор, "con" — контраргумент; минимум один "con" для честности
- thesis ≤ 200 символов; detail 80–250 символов; остальные поля 100–300 символов
- всё по-русски, живым языком аналитика, без воды и без выдуманных точных цифр`
}

/** Свернуть все тексты разбора в одну строку — для проверки на сбои */
function starLogicFlat(logic: StarLogic): string {
  return [
    logic.thesis,
    ...logic.factors.flatMap((f) => [f.title, f.detail]),
    logic.scenario,
    logic.risks,
    logic.alternative,
    logic.stakeLogic,
  ].join(' ')
}

/** Слово со смешанной кириллицей и латиницей («Алькаarrи») — сбой генерации */
const MIXED_SCRIPT_RE = /[\u0400-\u04FF][A-Za-z]|[A-Za-z][\u0400-\u04FF]/

/** LLM-разбор логики звезды: невалидный ответ или иноязычный сбой → null.
 *  Одна попытка с низкой температурой на ретрае; дальше — эвристика. */
async function llmStarLogic(m: RealMatchDto, plan: BetPlan): Promise<StarLogic | null> {
  const attempt = async (temperature?: number): Promise<StarLogic | null> => {
    try {
      const zai = await getZai()
      const completion = await withTimeout(
        zai.chat.completions.create({
          messages: [
            { role: 'assistant', content: STAR_LOGIC_SYSTEM_PROMPT },
            { role: 'user', content: buildStarLogicPrompt(m, plan) },
          ],
          ...(temperature !== undefined ? { temperature } : {}),
          thinking: { type: 'disabled' },
        }),
        90_000,
      )
      if (!completion) return null
      const text = completion.choices[0]?.message?.content ?? ''
      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      if (start < 0 || end <= start) return null
      const logic = parseStarLogic(text.slice(start, end + 1))
      // Сбои генерации: иероглифы/иноязычные вставки или склейки кириллицы
      // с латиницей внутри слова («Алькаarrи») — попытка не годится
      if (!logic) return null
      const flat = starLogicFlat(logic)
      if (hasForeignGlitch(flat) || MIXED_SCRIPT_RE.test(flat)) return null
      return logic
    } catch (e) {
      console.error('[real-bets] star logic LLM failed:', e)
      return null
    }
  }
  const first = await attempt()
  if (first) return first
  // Ретрай с низкой температурой против иноязычных сбоев JSON-генерации
  return await attempt(0.3)
}

/** Детерминированный разбор логики звезды (сбой LLM — разбор всё равно есть) */
function heuristicStarLogic(m: RealMatchDto, plan: BetPlan): StarLogic {
  const detected = detectKind('tennis', `${plan.market} ${plan.selection}`)
  const pickFirst = detected?.kind !== 'P2'
  const pick = (pickFirst ? m.home : m.away).replace(/\s*\([^)]*\)/g, '').trim()
  const opp = (pickFirst ? m.away : m.home).replace(/\s*\([^)]*\)/g, '').trim()
  const fav = plan.odds <= 1.75
  const fair = round2(100 / plan.confidence)
  const edge = (plan.odds / fair - 1) * 100
  return {
    thesis: fav
      ? `Перевес ${pick} в классе и стабильности: при кэфе ${plan.odds} фаворит должен решать матч на своей подаче.`
      : `Ценность: рынок недооценивает ${pick} — кэф ${plan.odds} выше справедливого при текущей форме игрока.`,
    factors: [
      {
        title: 'Форма и уверенность',
        detail: `${pick} подходит к матчу ровнее: меньше просадок на собственной подаче и увереннее геймы на приёме, чем у ${opp}.`,
        side: 'pro',
      },
      {
        title: 'Матч-ап стилей',
        detail: `Стили складываются в пользу ${pick}: контроль розыгрышей с задней линии против менее стабильных длинных мячей ${opp}.`,
        side: 'pro',
      },
      {
        title: 'Очные встречи',
        detail:
          plan.confidence >= 70
            ? `В личных противостояниях перевес на стороне ${pick} — психологическое преимущество в ключевых геймах.`
            : `История очных встреч ровная — преимущество не гарантировано, отсюда умеренная уверенность ${plan.confidence}%.`,
        side: plan.confidence >= 70 ? 'pro' : 'con',
      },
      {
        title: 'Нагрузка и усталость',
        detail: `Риск: при длинных матчах в предыдущих кругах к концу встречи у ${pick} возможна просадка процента первой подачи.`,
        side: 'con',
      },
      {
        title: 'Ценность коэффициента',
        detail:
          edge >= 0
            ? `При уверенности ${plan.confidence}% справедливый кэф ≈${fair} — наш ${plan.odds} даёт запас +${edge.toFixed(1)}%.`
            : `Кэф ${plan.odds} близок к справедливому (${fair}) — запас ценности минимальный, ставка ближе к нейтральной.`,
        side: edge >= 0 ? 'pro' : 'con',
      },
    ],
    scenario: `${pick} удерживает собственную подачу, берёт минимум один брейк в сете и не позволяет ${opp} навязать затяжные розыгрыши — победа в двух-трёх сетах закрывает прогноз.`,
    risks: `${opp} начинает агрессивно играть на приёме и ломает ритм: ранний брейк и перевес в уверенности переходят к сопернику.`,
    alternative: `Противоположный исход дороже по кэфу, но требует полного разворота формы; тотал геймов сложнее контролировать — исход матча выглядит самым управляемым рынком.`,
    stakeLogic: `${plan.stake} юнитов при уверенности ${plan.confidence}%: ${
      plan.stake >= 6
        ? 'повышенная ставка — совпадение формы, матч-апа и ценности кэфа'
        : plan.stake >= 4
          ? 'средняя ставка — перевес есть, но риски матча не позволяют ставить максимум'
          : 'осторожная ставка — перевес тонкий, размер ограничен риском'
    }.`,
  }
}

/** Приложить разбор логики к прогнозу звезды (tennis) и сохранить в БД */
async function attachStarLogic(betId: string, m: RealMatchDto, plan: BetPlan): Promise<void> {
  try {
    const logic = (await llmStarLogic(m, plan)) ?? heuristicStarLogic(m, plan)
    await db.bet.update({ where: { id: betId }, data: { starLogic: JSON.stringify(logic) } })
  } catch (e) {
    console.error('[real-bets] attachStarLogic error:', e)
  }
}

/** Замок на globalThis: параллельные тики не должны дублировать LLM-вызов */
const globalForStar = globalThis as unknown as { __starLogicInflight?: Promise<boolean> | null }

/** Добор разбора для уже созданного прогноза звезды (до Task 37 без starLogic):
 *  ближайший pending-теннис без разбора → генерируем и сохраняем */
export function ensureStarLogic(): Promise<boolean> {
  const existing = globalForStar.__starLogicInflight
  if (existing) return existing
  const p = (async () => {
    try {
      const bet = await db.bet.findFirst({
        where: {
          isRealMatch: true,
          status: 'pending',
          sport: 'tennis',
          matchDate: { gte: new Date(Date.now() - 60 * 60 * 1000) },
          OR: [{ starLogic: null }, { starLogic: '' }],
        },
        orderBy: { matchDate: 'asc' },
      })
      if (!bet) return false
      const m: RealMatchDto = {
        league: bet.league,
        time: '',
        status: 'upcoming',
        home: bet.homeTeam,
        away: bet.awayTeam,
      }
      const plan: BetPlan = {
        market: bet.market,
        selection: bet.selection,
        odds: bet.odds,
        confidence: bet.confidence,
        stake: bet.stake,
        analysis: bet.analysis,
      }
      await attachStarLogic(bet.id, m, plan)
      return true
    } catch (e) {
      console.error('[real-bets] ensureStarLogic error:', e)
      return false
    }
  })()
  globalForStar.__starLogicInflight = p
  void p.finally(() => {
    globalForStar.__starLogicInflight = null
  })
  return p
}

/* --------------------- Оценка реальных исходов ----------------------- */

interface ParsedScore {
  home: number
  away: number
  total: number
  display: string
  /** tennis: известна ли сумма геймов (полные сеты) — иначе тоталы не считаем */
  gamesKnown?: boolean
}

/** «2:1» → счёт; «6-4 3-6 7-5» → сеты (итог по сетам + сумма геймов);
 *  для тенниса «2:0»/«0:2» — счёт ПО СЕТАМ из веб-источников (геймы неизвестны) */
export function parseScore(score: string, sport: SportKey): ParsedScore | null {
  const s = score.trim()
  if (sport !== 'tennis') {
    const m = s.match(/^(\d+)\s*:\s*(\d+)$/)
    if (!m) return null
    const home = Number(m[1])
    const away = Number(m[2])
    return { home, away, total: home + away, display: `${home}:${away}` }
  }
  const sets = s.split(/\s+/).filter((x) => /^\d+-\d+$/.test(x))
  if (sets.length === 0) {
    // «Счет 0:2» из веб-сниппетов — счёт по сетам; геймы неизвестны,
    // тоталы по такой строке не считаются (gamesKnown=false)
    const m = s.match(/^(\d)\s*:\s*(\d)$/)
    if (m) {
      const home = Number(m[1])
      const away = Number(m[2])
      if (home <= 2 && away <= 2 && home + away >= 1) {
        return { home, away, total: 0, display: `${home}:${away} по сетам`, gamesKnown: false }
      }
    }
    return null
  }
  let home = 0
  let away = 0
  let games = 0
  for (const set of sets) {
    const [a, b] = set.split('-').map(Number)
    games += a + b
    if (a > b) home++
    else if (b > a) away++
  }
  return { home, away, total: games, display: `${s} (${home}:${away} по сетам)`, gamesKnown: true }
}

/** Оценка прогноза по реальному счёту: 'won' | 'lost' | null (не смогли) */
export function evaluateRealBet(
  bet: { sport: string; market: string; selection: string },
  score: string,
): { status: 'won' | 'lost'; note: string } | null {
  const sport = (bet.sport as SportKey) ?? 'football'
  const parsed = parseScore(score, sport)
  if (!parsed) return null

  const detected = detectKind(sport, `${bet.market} ${bet.selection}`)
  if (!detected) return null

  const { home, away, total, display } = parsed
  // Теннисный счёт известен только по сетам — тоталы геймов не считаем
  if ((detected.kind === 'TB' || detected.kind === 'TM') && parsed.gamesKnown === false) return null
  let won: boolean | null = null
  let detail = ''

  switch (detected.kind) {
    case 'P1':
      won = home > away
      break
    case 'P2':
      won = away > home
      break
    case 'X':
      won = home === away
      break
    case 'TB':
      won = total > (detected.line ?? 0)
      detail = ` · тотал ${total} против линии ${detected.line}`
      break
    case 'TM':
      won = total < (detected.line ?? 0)
      detail = ` · тотал ${total} против линии ${detected.line}`
      break
    case 'BTTS':
      won = home > 0 && away > 0
      detail = ' · обе команды забили'
      break
  }
  if (won === null) return null

  return {
    status: won ? 'won' : 'lost',
    note: `Реальный счёт ${display} — прогноз ${won ? 'сыграл' : 'не сыграл'}${detail}`,
  }
}

/* --------------------------- Генерация и БД -------------------------- */

/** Минимум pending-прогнозов в ленте (ниже — доливаем, в т.ч. из «завтра») */
const MIN_PENDING_FEED = 4

/** День генерации: 'today' — сегодняшнее расписание, 'tomorrow' — завтрашнее */
export type GenDay = 'today' | 'tomorrow'

/** Дата страницы расписания для дня генерации */
function genDateStr(day: GenDay): string {
  return day === 'tomorrow' ? mskTomorrowDateStr() : mskDateStr()
}

/**
 * Политика «звезды» (Task 34 → смягчена в Task 37): теннисный эксперт
 * (Мария Волкова) даёт РОВНО ОДИН прогноз в день. Турниры — ЛЮБЫЕ из
 * расписания (как было до Task 34): приоритет у топ-тура (ATP/WTA/Шлемы),
 * но при их отсутствии в сетке звезда может взять и меньший турнир —
 * читатель иногда имеет линию именно на такие. Защита от «призрачных»
 * матчей (заглушка 00:00, парные разряды) сохранена (Task 36).
 * Функция правит выборку кандидатов дня:
 *  - если pending-теннис на этот день уже есть — второй не создаём;
 *  - если нет — гарантированно вставляем лучший теннисный матч, даже
 *    сверх обычного слота ленты (звезда не остаётся без прогноза дня).
 */
async function applyStarPolicy(
  data: RealMatchesData,
  now: number,
  used: Set<string>,
  selected: SelectedMatch[],
): Promise<SelectedMatch[]> {
  // Сутки генерации по московскому календарю страницы расписания
  const dayStart = mskDateTimeToUtc(data.date, '00:00').getTime()
  const dayEnd = dayStart + 24 * 60 * 60 * 1000
  try {
    const starPending = await db.bet.count({
      where: {
        isRealMatch: true,
        status: 'pending',
        sport: 'tennis',
        matchDate: { gte: new Date(dayStart), lt: new Date(dayEnd) },
      },
    })
    if (starPending > 0) {
      return selected.filter((s) => s.sport !== 'tennis')
    }
    const star = bestTennisCandidate(data, now, used)
    if (star && !selected.some((s) => s.sport === 'tennis')) {
      return [...selected, star]
    }
  } catch (e) {
    console.error('[real-bets] applyStarPolicy error:', e)
  }
  return selected
}

async function generateRealBets(day: GenDay = 'today'): Promise<number> {
  const data = await withTimeout(getRealMatches(false, genDateStr(day)), 30_000)
  if (!data) return 0

  const now = Date.now()
  const start = startOfLocalDay()

  const existing = await db.bet.findMany({
    where: { isRealMatch: true, matchDate: { gte: start } },
    select: { homeTeam: true, awayTeam: true, status: true },
  })
  const used = new Set(existing.map((b) => `${b.homeTeam}|${b.awayTeam}`))
  const pendingReal = existing.filter((b) => b.status === 'pending').length

  const selected = await applyStarPolicy(
    data,
    now,
    used,
    selectMatches(data, now, used).slice(0, Math.max(0, MAX_REAL_BETS - pendingReal)),
  )
  if (selected.length === 0) return 0

  const tips = await llmPredictions(selected)
  const tipsters = await db.tipster.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, sport: true },
  })
  if (tipsters.length === 0) return 0

  let created = 0
  for (let i = 0; i < selected.length; i++) {
    const sm = selected[i]
    const rand = mulberry32(hashStr(`${data.date}|${sm.m.home}|${sm.m.away}`))
    const plan = buildPlan(sm.sport, sm.m, tips.get(i + 1), rand)

    // Профильный аналитик вида спорта (fallback — любой)
    const specialists = tipsters.filter((t) => t.sport === sm.sport)
    const pool = specialists.length > 0 ? specialists : tipsters
    const tipsterId = pool[i % pool.length].id

    // Защита от дублей (Task 36): параллельные генерации успевали записать
    // один матч до 6 раз (каждый инстанс модуля видел свой genInflight).
    // Замок на globalThis закрывает основной путь, а эта проверка прямо
    // перед записью — страховка от любых оставшихся гонок (вкл. межпроцессные)
    const dup = await db.bet.findFirst({
      where: {
        homeTeam: sm.m.home,
        awayTeam: sm.m.away,
        matchDate: new Date(sm.start),
        status: 'pending',
      },
      select: { id: true },
    })
    if (dup) continue

    const rec = await db.bet.create({
      data: {
        sport: sm.sport,
        league: sm.m.league,
        homeTeam: sm.m.home,
        awayTeam: sm.m.away,
        matchDate: new Date(sm.start),
        market: plan.market,
        selection: plan.selection,
        odds: plan.odds,
        stake: plan.stake,
        confidence: plan.confidence,
        analysis: plan.analysis,
        status: 'pending',
        resultNote: null,
        isRealMatch: true,
        isBetOfDay: false,
        tipsterId,
      },
    })
    created++

    // Теннисный прогноз дня = прогноз «звезды» (Мария Волкова — единственный
    // теннисный аналитик): сразу прикладываем подробный разбор её логики
    // (тезис, факторы за/против, сценарий, риски, размер ставки) — Task 37
    if (sm.sport === 'tennis') {
      await attachStarLogic(rec.id, sm.m, plan)
    }
  }

  if (created > 0) {
    // Честность: сегодняшние демо-прогнозы убираем — лента строится на реальных матчах
    await purgeDemoPendingToday()
    await promoteBestRealBet()
  }
  return created
}

/** Удаление сегодняшних pending-демо-прогнозов (лента — только реальные матчи) */
export async function purgeDemoPendingToday(): Promise<void> {
  const start = startOfLocalDay()
  await db.bet.deleteMany({
    where: { isRealMatch: false, status: 'pending', matchDate: { gte: start } },
  })
}

/** Лучший реальный прогноз → «Ставка дня»: сегодня в приоритете, вечером —
 *  завтрашний, чтобы хиро-блок не пустовал после расчёта всех матчей дня.
 *  Правило редакции: кэф «Ставки дня» — не ниже 1.50 (наш и рыночный). */
async function promoteBestRealBet(): Promise<void> {
  const start = startOfLocalDay()
  const end = new Date(start.getTime() + 48 * 60 * 60 * 1000)

  const candidates = await db.bet.findMany({
    where: { isRealMatch: true, status: 'pending', matchDate: { gte: start, lt: end } },
  })
  if (candidates.length === 0) return

  // Ставкой дня приоритетно становится сегодняшний матч; если сегодня
  // предстоящих не осталось — лучший из завтрашних
  const dayEnd = start.getTime() + 24 * 60 * 60 * 1000
  const todayCands = candidates.filter((c) => c.matchDate.getTime() < dayEnd)

  // ПРАВИЛО КЭФА (≥ 1.50): сначала — подходящие по кэфу сегодня, затем —
  // подходящие из завтра. Совсем подходящих нет — лучший из любых,
  // чтобы hero не пустовал (лучше низкий кэф, чем пустая главная ставка).
  const eligibleToday = todayCands.filter(isBodEligible)
  const eligibleAll = candidates.filter(isBodEligible)
  let pool =
    eligibleToday.length > 0
      ? eligibleToday
      : eligibleAll.length > 0
        ? eligibleAll
        : todayCands.length > 0
          ? todayCands
          : candidates
  pool = [...pool]
  pool.sort((a, b) => b.confidence - a.confidence || a.matchDate.getTime() - b.matchDate.getTime())
  const best = pool[0]

  // Снимаем флаг только с АКТИВНЫХ ставок дня: рассчитанные (исторические)
  // BOD сохраняют isBetOfDay — по ним копится статистика «Ставки дня».
  await db.bet.updateMany({
    where: { isBetOfDay: true, status: 'pending', NOT: { id: best.id } },
    data: { isBetOfDay: false },
  })
  await db.bet.update({ where: { id: best.id }, data: { isBetOfDay: true } })
}

/** «Ставка дня» всегда живая И проходит порог кэфа: если текущая
 *  рассчитана/отсутствует/ниже 1.50 — продвигаем лучший подходящий
 *  предстоящий прогноз (сегодня → завтра). Активной считается только
 *  РЕАЛЬНАЯ ставка дня: демо-флаг не блокирует ротацию — выдуманный
 *  матч не может занимать hero. */
export async function rotateBetOfDay(): Promise<void> {
  const start = startOfLocalDay()
  const end = new Date(start.getTime() + 48 * 60 * 60 * 1000)
  const active = await db.bet.findFirst({
    where: {
      isBetOfDay: true,
      status: 'pending',
      isRealMatch: true,
      matchDate: { gte: start, lt: end },
    },
  })
  if (active && isBodEligible(active)) return
  await promoteBestRealBet()
}

/* --------- Восстановление истории «Ставки дня» (ретро-флаги) ---------- */

let lastBodBackfill = 0
const BOD_BACKFILL_THROTTLE_MS = 10 * 60_000

/**
 * Ретро-восстановление флагов «Ставки дня» по прошедшим дням: раньше промоут
 * снимал isBetOfDay со ВСЕХ ставок, из-за чего история формата не накапливалась.
 * Для каждого прошедшего дня без флага помечаем лучший прогноз дня
 * (макс. уверенность, при равенстве — более ранний матч). Идемпотентно,
 * сегодня не трогаем (у него свой живой BOD), троттл 10 минут.
 */
export async function backfillBetOfDayFlags(): Promise<void> {
  const ts = Date.now()
  if (ts - lastBodBackfill < BOD_BACKFILL_THROTTLE_MS) return
  lastBodBackfill = ts
  try {
    const start = startOfLocalDay()
    const pastBets = await db.bet.findMany({
      where: { isRealMatch: true, matchDate: { lt: start } },
    })
    if (pastBets.length === 0) return
    const dayKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const byDay = new Map<string, typeof pastBets>()
    for (const b of pastBets) {
      const key = dayKey(startOfLocalDay(b.matchDate))
      const list = byDay.get(key)
      if (list) list.push(b)
      else byDay.set(key, [b])
    }
    for (const dayBets of byDay.values()) {
      if (dayBets.some((b) => b.isBetOfDay)) continue // флаг дня уже есть
      const sorted = [...dayBets].sort(
        (a, b) => b.confidence - a.confidence || a.matchDate.getTime() - b.matchDate.getTime(),
      )
      // Правило кэфа ≥ 1.50 действует и на ретро-дни: «ставкой дня» помечаем
      // лучший ПОДХОДЯЩИЙ прогноз (фолбэк — просто лучший, чтобы день не терял флаг)
      const best = sorted.find(isBodEligible) ?? sorted[0]
      if (best) {
        await db.bet.update({ where: { id: best.id }, data: { isBetOfDay: true } })
      }
    }
  } catch (e) {
    lastBodBackfill = 0 // сброс: повторим на следующем тике
    console.error('[real-bets] backfillBetOfDayFlags error:', e)
  }
}

/* ------------- Запасной расчёт по веб-поиску (матчи вне расписания) ------------- */

/** Матчи вне расписания источника (например, ATP Challenger): расписание их
 *  не покрывает — раньше такие ставки слепо уходили в возврат через 6 часов.
 *  Теперь: > 6ч — пробуем найти счёт веб-поиском; > 24ч без результата — возврат. */
const WEB_SETTLE_MIN_AGE_MS = 6 * 60 * 60 * 1000
const WEB_SETTLE_VOID_AFTER_MS = 24 * 60 * 60 * 1000
/** Ретрай поиска по конкретной ставке — не чаще чем раз в 45 минут */
const WEB_SETTLE_RETRY_MS = 45 * 60 * 1000
/** Максимум web-расчётов за один тик обслуживания (вежливость к поиску) */
const WEB_SETTLE_BUDGET = 3

const webSettleLastAttempt = new Map<string, number>()

/** «Люка Кастелнуово (Швейцария)» → стем «кастелн» — сопоставим с «Кастельнуово Л»,
 *  переживает русские склонения («Ивашко» → «Ивашка») */
function nameStem(fullName: string): string {
  const clean = fullName.replace(/\([^)]*\)/g, ' ').trim()
  const words = clean.split(/\s+/).filter((w) => w.length >= 5)
  const longest = words.sort((a, b) => b.length - a.length)[0] ?? clean.split(/\s+/)[0] ?? ''
  return longest.toLowerCase().slice(0, 6)
}

interface WebScoreHit {
  score: string
  source: string
}

/** Счёт из чужого/старого матча: прямо перед цифрами упоминается год,
 *  отличный от года нашего матча (напр. «в 2018 году … 6:1») — такой
 *  счёт к сегодняшнему матчу не относится, не принимаем его.
 */
function contextHasForeignYear(raw: string, scoreIndex: number, matchYear: number): boolean {
  const ctx = raw.slice(Math.max(0, scoreIndex - 90), scoreIndex)
  for (const m of ctx.matchAll(/((?:19|20)\d{2})/g)) {
    if (Number(m[1]) !== matchYear) return true
  }
  return false
}

/** «Адриан Маннарино (Франция)» → «Адриан Маннарино»: страна/сеед в скобках
 *  только мешают поисковику — в выдаче игрока пишут без них */
function cleanNameForSearch(fullName: string): string {
  return fullName
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Поиск счёта матча через web_search: заголовки и сниппеты результатов.
 *  Счёт принимается только из фрагмента, где упомянуты ОБЕ команды/игрока
 *  (по стемам) — защита от чужих счётов на странице выдачи. */
async function searchScoreViaWeb(bet: {
  homeTeam: string
  awayTeam: string
  sport: string
  matchDate: Date
  market: string
  selection: string
}): Promise<WebScoreHit | null> {
  const d = bet.matchDate
  const day = String(d.getUTCDate()).padStart(2, '0')
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  // Год в запросе НЕ указываем: год «виртуального» календаря сайта в индексе
  // поисковика не существует — из-за него выдача обнулялась. Свежесть
  // обеспечивает recency_days, дату оставляем день.месяц для фильтра.
  const query = `${cleanNameForSearch(bet.homeTeam)} — ${cleanNameForSearch(bet.awayTeam)} итог матча счёт ${day}.${month}`
  try {
    const zai = await getZai()
    const results = (await withTimeout(
      zai.functions.invoke('web_search', { query, num: 6, recency_days: 10 }) as Promise<
        Array<{ name: string; snippet: string; host_name: string }>
      >,
      15_000,
    )) ?? []
    if (!Array.isArray(results) || results.length === 0) return null

    const homeStem = nameStem(bet.homeTeam)
    const awayStem = nameStem(bet.awayTeam)
    const isTennis = bet.sport === 'tennis'
    // Тоталы тенниса требуют счета геймов — «0:2» по сетам не подходит
    const isTennisTotal =
      isTennis && /тотал|ТБ|ТМ/i.test(`${bet.market} ${bet.selection}`)
    const matchYear = bet.matchDate.getUTCFullYear()

    for (const r of results) {
      const text = `${r.name} ${r.snippet ?? ''}`.toLowerCase()
      if (!text.includes(homeStem) || !text.includes(awayStem)) continue
      const raw = `${r.name} ${r.snippet ?? ''}`

      // Превью/прогноз-статьи часто содержат счёт из ИСТОРИИ личных встреч
      // («в 2018 году Таппара разгромила Сторхамар 6:1») — с ними счёт
      // не совпадает с сегодняшним матчем. Такие страницы пропускаем.
      if (
        /прогноз на матч|прогноз и ставк|head-to-head|\bh2h\b|истори\w* встреч|личны\w* встреч/i.test(
          raw,
        )
      ) {
        continue
      }

      // 1) Теннис: полная последовательность сетов «4-6 6-2 6-1»
      if (isTennis) {
        const sets = raw.match(
          /(\d{1,2}-\d{1,2})[,\s]+(\d{1,2}-\d{1,2})(?:[,\s]+(\d{1,2}-\d{1,2}))?/,
        )
        if (sets && !contextHasForeignYear(raw, sets.index ?? 0, matchYear)) {
          const parts = sets[0].split(/[\s,]+/).filter((p) => /^\d{1,2}-\d{1,2}$/.test(p))
          const sane = parts.every((p) => {
            const [a, b] = p.split('-').map(Number)
            return a <= 7 && b <= 7 && a !== b
          })
          if (parts.length >= 2 && sane) {
            return { score: parts.join(' '), source: r.host_name }
          }
        }
      }

      // 2) Счёт «X:Y» — для тенниса (не-тотал) это счёт ПО СЕТАМ
      const m = raw.match(/(\d{1,3})\s*:\s*(\d{1,3})/)
      if (m && !contextHasForeignYear(raw, m.index ?? 0, matchYear)) {
        const a = Number(m[1])
        const b = Number(m[2])
        if (isTennis) {
          if (!isTennisTotal && a <= 2 && b <= 2 && a + b >= 1) {
            return { score: `${a}:${b}`, source: r.host_name }
          }
        } else if (a <= 200 && b <= 200) {
          return { score: `${a}:${b}`, source: r.host_name }
        }
      }
    }
    return null
  } catch {
    return null
  }
}

/* ----------------------- Расчёт по реальным счётам ------------------- */

/** Авто-расчёт real-прогнозов: статус/счёт берём из живого расписания */
export async function resolveRealBets(): Promise<void> {
  const now = new Date()
  const due = await db.bet.findMany({
    where: { isRealMatch: true, status: 'pending', matchDate: { lt: now } },
  })
  if (due.length === 0) return

  const dateCache = new Map<string, RealMatchesData>()
  let updated = 0
  let webBudget = WEB_SETTLE_BUDGET

  for (const bet of due) {
    const dateStr = mskDateOf(bet.matchDate.getTime())
    let data = dateCache.get(dateStr) ?? null
    if (!data) {
      data = (await withTimeout(getRealMatches(false, dateStr), 25_000)) ?? null
      if (!data) continue
      dateCache.set(dateStr, data)
    }

    const list = data.sports[bet.sport as SportKey] ?? []
    const m = list.find((x) => x.home === bet.homeTeam && x.away === bet.awayTeam)
    const ageMs = Date.now() - bet.matchDate.getTime()

    if (!m) {
      if (ageMs > WEB_SETTLE_VOID_AFTER_MS) {
        await db.bet.update({
          where: { id: bet.id },
          data: { status: 'void', resultNote: 'Матч не найден ни в расписании, ни в веб-поиске — возврат' },
        })
        updated++
        continue
      }
      // Запасной путь: матч мог пройти вне расписания источника (ATP Challenger и т.п.)
      if (
        ageMs > WEB_SETTLE_MIN_AGE_MS &&
        webBudget > 0 &&
        Date.now() - (webSettleLastAttempt.get(bet.id) ?? 0) > WEB_SETTLE_RETRY_MS
      ) {
        webSettleLastAttempt.set(bet.id, Date.now())
        webBudget--
        const hit = await searchScoreViaWeb(bet)
        if (hit) {
          const verdict = evaluateRealBet(bet, hit.score)
          if (verdict) {
            await db.bet.update({
              where: { id: bet.id },
              data: {
                status: verdict.status,
                resultNote: `${verdict.note} · счёт по данным веб-поиска (${hit.source})`,
              },
            })
            updated++
            continue
          }
        }
      }
      continue
    }

    if (m.status === 'canceled') {
      await db.bet.update({
        where: { id: bet.id },
        data: { status: 'void', resultNote: 'Матч отменён — возврат' },
      })
      updated++
      continue
    }

    if (m.status === 'finished') {
      // Расписание знает итог: считаем по его счёту (для тенниса — по сетам)
      const verdict = m.score ? evaluateRealBet(bet, m.score) : null
      if (verdict) {
        await db.bet.update({
          where: { id: bet.id },
          data: { status: verdict.status, resultNote: verdict.note },
        })
        updated++
        continue
      }

      // Счёт не спарсился (расписание отдаёт «завершён» без деталей):
      // раньше такая ставка ВЕЧНО висела в «в игре». Теперь — веб-поиск,
      // а спустя 24ч без результата — честный возврат.
      if (
        ageMs > WEB_SETTLE_MIN_AGE_MS &&
        webBudget > 0 &&
        Date.now() - (webSettleLastAttempt.get(bet.id) ?? 0) > WEB_SETTLE_RETRY_MS
      ) {
        webSettleLastAttempt.set(bet.id, Date.now())
        webBudget--
        const hit = await searchScoreViaWeb(bet)
        if (hit) {
          const webVerdict = evaluateRealBet(bet, hit.score)
          if (webVerdict) {
            await db.bet.update({
              where: { id: bet.id },
              data: {
                status: webVerdict.status,
                resultNote: `${webVerdict.note} · счёт по данным веб-поиска (${hit.source})`,
              },
            })
            updated++
            continue
          }
        }
      }
      if (ageMs > WEB_SETTLE_VOID_AFTER_MS) {
        await db.bet.update({
          where: { id: bet.id },
          data: { status: 'void', resultNote: 'Итог матча недоступен — возврат' },
        })
        updated++
      }
      continue
    }
    // live / upcoming (расписание отстаёт) — ждём следующего тика.
    // Страховка: матч «не начался» спустя 6 часов после заявленного старта —
    // вероятно, отложен без обновления статуса, возвращаем ставку
    if (m.status === 'upcoming' && ageMs > 6 * 60 * 60 * 1000) {
      await db.bet.update({
        where: { id: bet.id },
        data: { status: 'void', resultNote: 'Матч не стартовал — возврат' },
      })
      updated++
    }
  }

  if (updated > 0) await recomputeTipsterCounters()
}

/* ------------------------- Обслуживание (tick) ----------------------- */

/**
 * Живое состояние прогнозов: pending-ставки на уже начавшиеся матчи
 * обогащаются фазой («1-й тайм») и текущим счётом из кэша расписания.
 * Чтение неблокирующее: getRealMatchesCached молча обновляет кэш в фоне.
 */
export function collectLiveInfo<
  T extends {
    id: string
    sport: string
    homeTeam: string
    awayTeam: string
    status: string
    matchDate: Date
  },
>(bets: T[]): Record<string, { phase: string; score?: string | null }> {
  const out: Record<string, { phase: string; score?: string | null }> = {}
  const now = Date.now()
  const started = bets.filter((b) => b.status === 'pending' && b.matchDate.getTime() <= now)
  if (started.length === 0) return out

  const data = getRealMatchesCached()
  if (!data) {
    // Холодный кэш (перезапуск сервера): прогреваем в фоне — live-счёты
    // появятся со следующего опроса (клиент опрашивает каждые 60 с)
    void getRealMatches().catch(() => {})
    return out
  }

  for (const b of started) {
    const list = data.sports[b.sport as SportKey] ?? []
    const m = list.find((x) => x.home === b.homeTeam && x.away === b.awayTeam)
    if (m && m.status === 'live') {
      out[b.id] = { phase: m.phase ?? 'идёт', score: m.score ?? null }
    }
  }
  return out
}

/** Состояние генератора на globalThis (Task 36): HMR/Turbopack может держать
 * НЕСКОЛЬКО инстансов модуля (свой genInflight/троттл в каждом) — параллельные
 * запуски плодили дубли прогнозов. globalThis один на процесс — общий замок. */
const globalForGen = globalThis as unknown as {
  __realBetsLastGenAttempt?: number
  __realBetsGenInflight?: Promise<number> | null
}
const getLastGenAttempt = () => globalForGen.__realBetsLastGenAttempt ?? 0
const setLastGenAttempt = (v: number) => {
  globalForGen.__realBetsLastGenAttempt = v
}
const getGenInflight = () => globalForGen.__realBetsGenInflight ?? null
const setGenInflight = (p: Promise<number> | null) => {
  globalForGen.__realBetsGenInflight = p
}
const GEN_THROTTLE_MS = 3 * 60 * 1000

/** Режим реальных прогнозов активен: есть предстоящие матчи или уже есть real-прогнозы */
export async function realModeActive(): Promise<boolean> {
  if (hasUpcomingToday()) return true
  const start = startOfLocalDay()
  const count = await db.bet.count({ where: { isRealMatch: true, matchDate: { gte: start } } })
  return count > 0
}

/** Есть ли у «звезды» (тенн. эксперт) активный прогноз: pending-теннис с датой в будущем */
async function starPendingCount(): Promise<number> {
  return db.bet.count({
    where: { isRealMatch: true, status: 'pending', sport: 'tennis', matchDate: { gte: new Date() } },
  })
}

async function maybeGenerate(): Promise<void> {
  if (getGenInflight()) return
  if (Date.now() - getLastGenAttempt() < GEN_THROTTLE_MS) return

  const start = startOfLocalDay()
  const [pendingReal, starPending] = await Promise.all([
    db.bet.count({
      where: { isRealMatch: true, status: 'pending', matchDate: { gte: start } },
    }),
    starPendingCount(),
  ])
  // Генерация нужна не только при короткой ленте: «звезда» тенниса обязана
  // иметь прогноз дня (Task 34) даже при полной ленте — иначе её карточка
  // пропадает из «Топ-эксперта» и раздела аналитиков
  if (pendingReal >= MIN_PENDING_FEED && starPending > 0) return

  setLastGenAttempt(Date.now())
  const inflight = (async () => {
    let created = 0

    // 1) Основной пул — сегодняшнее расписание: из кэша, иначе тёплая загрузка
    //    (фон, маршрут не ждёт — maybeGenerate вызывается вне ожидания)
    const data = getRealMatchesCached() ?? (await withTimeout(getRealMatches(), 25_000))
    if (data && hasUpcomingToday()) {
      created += await generateRealBets('today')
    }

    // 2) Вечер/ночь: сегодняшние матчи исчерпаны или покрыты не полностью —
    //    добираем прогнозами из завтрашнего расписания, лента не пустеет.
    //    Сюда же «звезда» без прогноза: топ-теннис (Азия) идёт утром по МСК,
    //    вечером её выбор можно добыть только из завтрашней сетки
    const [pendingNow, starNow] = await Promise.all([
      created > 0
        ? db.bet.count({
            where: { isRealMatch: true, status: 'pending', matchDate: { gte: start } },
          })
        : Promise.resolve(pendingReal + created),
      starPendingCount(),
    ])
    if (pendingNow < MIN_PENDING_FEED || starNow === 0) {
      created += await generateRealBets('tomorrow')
    }

    return created
  })()
  setGenInflight(inflight)
  try {
    await inflight
  } catch (e) {
    console.error('[real-bets] generation error:', e)
  } finally {
    setGenInflight(null)
  }
}

/**
 * Единое обслуживание real-прогнозов. Вызывается из maintenanceTick
 * НЕ в ожидании: расчёт по счётам + фоновая генерация при нехватке прогнозов.
 */
export function ensureRealBets(): void {
  void resolveRealBets().catch((e) => console.error('[real-bets] resolve error:', e))
  void maybeGenerate().catch((e) => console.error('[real-bets] ensure error:', e))
  // Разбор логики звезды: добор для прогнозов без него (созд. до Task 37)
  void ensureStarLogic().catch((e) => console.error('[real-bets] star-logic error:', e))
  // Ставка дня всегда живая: после расчёта вечерних матчей продвигаем следующий
  void rotateBetOfDay().catch((e) => console.error('[real-bets] bet-of-day error:', e))
}

/** Принудительная генерация (POST /api/real-bets/seed): обходит троттл,
 *  доливает и из «завтра», если сегодняшний пул исчерпан */
export async function forceGenerateRealBets(): Promise<number> {
  setLastGenAttempt(0)
  const existing = getGenInflight()
  if (existing) return existing
  const inflight = (async () => {
    let created = await generateRealBets('today')

    const start = startOfLocalDay()
    const [pendingReal, starPending] = await Promise.all([
      db.bet.count({
        where: { isRealMatch: true, status: 'pending', matchDate: { gte: start } },
      }),
      starPendingCount(),
    ])
    // «Звезда» без прогноза — добираем из завтрашней сетки (вечером МСК
    // сегодняшний топ-теннис уже сыгран); лента полна — тоже норм,
    // звезда добавляется сверх обычных слотов
    if (pendingReal < MIN_PENDING_FEED || starPending === 0) {
      created += await generateRealBets('tomorrow')
    }
    // Пересчёт лучше не только при создании: ставка дня могла быть рассчитана
    await rotateBetOfDay()
    // Разбор логики звезды для уже существующего прогноза (если ещё нет)
    await ensureStarLogic()
    return created
  })()
  setGenInflight(inflight)
  try {
    return await inflight
  } finally {
    setGenInflight(null)
  }
}
