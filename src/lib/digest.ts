import { db } from '@/lib/db'
import { betOutcome, scoreOf } from '@/lib/format'
import { EXPRESS_STAKE } from '@/lib/express-history'
import { parseStarLogic } from '@/lib/star-logic'
import { resolveRealBets } from '@/lib/real-bets'
import type { Bet, DigestSettings } from '@prisma/client'

/**
 * Рассылка в Telegram (Task 40–50).
 *
 * ОДНО сообщение в сутки — УТРОМ (sendHour, 9:00 МСК по умолчанию),
 * по просьбе владельца «разбор нужен только 1 — утром, а вечером
 * не надо, многовато» (Task 50). Сообщение объединяет:
 *   • сводку дня — «N зашло · M мимо · …» одной строкой;
 *   • ПОЛНЫЙ разбор зашедших накануне главных ставок (Task 46→49):
 *     «Ставка дня» со счётом и всей аргументацией, зашедшие исходы
 *     «Экспресса дня» с полным разбором каждой ноги, зашедший прогноз
 *     эксперта целиком, «Ещё зашло» — прочие выигрыши дня одной строкой.
 * Лимит Telegram 4096 решается разбивкой на части
 * (splitHtmlForTelegram), а не обрезкой текста. Проигравшие и прочая
 * лента НЕ разбираются.
 *
 * Отправка: 1) cron по расписанию — POST /api/digest/send
 * (kind 'morning'); 2) вручную кнопкой; 3) при открытии сайта после
 * наступления часа отправки (дедупы по журналу DigestLog). Подключение
 * бота: /start — мини-сервис telegram-bot отвечает мгновенно и подключает
 * чат через POST /api/digest/telegram-ingest.
 */

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000

const MONTHS_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
] as const

export const DIGEST_SETTINGS_ID = 'main'

/** Минимально правдоподобный формат токена BotFather: «123456:AA…» */
const BOT_TOKEN_RE = /^[0-9]{5,}:[A-Za-z0-9_-]{20,}$/

/** Идентификатор чата Telegram: число (личный чат >0, группа/канал <0) */
const CHAT_ID_RE = /^-?[0-9]{3,}$/

/* ------------------------------ Типы ------------------------------ */

export interface DigestPick {
  id: string
  sport: string
  league: string
  homeTeam: string
  awayTeam: string
  matchDate: string // ISO
  selection: string
  odds: number
  stake: number
  status: 'pending' | 'won' | 'lost' | 'void'
  /** Счёт из resultNote («2:1», «6-1 6-1») — для компактной строки */
  score: string | null
  resultNote: string | null
  /** Итог в юнитах: +2.55 / −2.00 / 0 */
  profit: number
  tipsterName: string | null
  /** Уверенность прогноза, % — «почему ставка дня / нога экспресса» */
  confidence: number
  /** Разбор ДО матча (Bet.analysis) — выжимка для сообщения */
  analysis: string | null
  /** Тезис «звезды» из starLogic — «почему Мария так решила» */
  thesis: string | null
}

/** «Экспресс дня» вчерашнего дня (топ-3 по уверенности, без ставки дня) */
export interface DigestExpress {
  status: 'pending' | 'won' | 'lost' | 'void'
  /** Итог экспресса в юнитах (null — ещё в игре) */
  profit: number | null
  /** Произведение кэфов всех ног */
  totalOdds: number
  /** Кэф по сыгравшим/невыбывшим ногам (выплата = 10 × effectiveOdds) */
  effectiveOdds: number
  /** Уверенность ног, % — для строки «почему эти матчи» */
  confidences: number[]
  legs: DigestPick[]
}

export interface DigestSummary {
  dateKey: string // YYYY-MM-DD (МСК разбора)
  dateLabel: string // «4 октября»
  total: number
  won: number
  lost: number
  void: number
  pending: number
  /** Прибыль дня по рассчитанным (юниты) */
  profit: number
}

export interface DigestData {
  dateKey: string
  dateLabel: string
  betOfDay: DigestPick[]
  /** «Экспресс дня» за разобранный день (null — не собрался, <2 ног) */
  express: DigestExpress | null
  /** Прогноз по теннису (бывший блок «звезды»); в сообщении — без имени */
  star: { tipsterName: string; tipsterRole: string; sport: string; picks: DigestPick[] } | null
  /** Прочие ЗАШЕДШИЕ прогнозы дня (лента: не СД/экспресс/эксперт) —
   *  строка «Ещё зашло: …» в кратком сообщении (Task 44) */
  otherWins: DigestPick[]
  summary: DigestSummary
  /** Готовое сообщение для Telegram (HTML) — единый утренний разбор */
  telegramHtml: string
}

export interface PublicDigestSettings {
  telegramEnabled: boolean
  hasToken: boolean
  tokenPreview: string | null
  telegramChatId: string | null
  telegramChatTitle: string | null
  sendHour: number
}

export interface TelegramChatOption {
  id: string
  title: string
  type: string
}

/* --------------------------- Дата (МСК) --------------------------- */

/** Московское «сегодня» со сдвигом: offsetDays=1 → вчерашний день разбора */
function mskDayWindow(offsetDays: number): { startUtc: Date; endUtc: Date; dateKey: string } {
  const mskMs = Date.now() + MSK_OFFSET_MS - offsetDays * 24 * 60 * 60 * 1000
  const startUtc = new Date(mskMs)
  startUtc.setUTCHours(0, 0, 0, 0)
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000)
  const dateKey = mskDateKeyOf(startUtc)
  return { startUtc, endUtc, dateKey }
}

/** Ключ «YYYY-MM-DD» из UTC-миллисекунд московского времени */
function mskDateKeyOf(mskStartUtc: Date): string {
  const msk = new Date(mskStartUtc.getTime() + MSK_OFFSET_MS)
  return `${msk.getUTCFullYear()}-${String(msk.getUTCMonth() + 1).padStart(2, '0')}-${String(msk.getUTCDate()).padStart(2, '0')}`
}

/** «4 октября» по ключу даты */
export function mskDateLabelOf(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  if (!y || !m || !d) return dateKey
  return `${d} ${MONTHS_RU[m - 1]}`
}

/** Текущий час по МСК (для «пора отправлять?») */
export function moscowHourNow(): number {
  return (new Date().getUTCHours() + 3) % 24
}

/* --------------------------- Сбор данных -------------------------- */

function toPick(b: Bet & { tipster: { name: string } | null }): DigestPick {
  const status = (['won', 'lost', 'void', 'pending'].includes(b.status)
    ? b.status
    : 'pending') as DigestPick['status']
  return {
    id: b.id,
    sport: b.sport,
    league: b.league,
    homeTeam: b.homeTeam,
    awayTeam: b.awayTeam,
    matchDate: b.matchDate.toISOString(),
    selection: b.selection,
    odds: b.odds,
    stake: b.stake,
    status,
    score: scoreOf(b.resultNote),
    resultNote: b.resultNote,
    profit: betOutcome(status, b.stake, b.odds),
    tipsterName: b.tipster?.name ?? null,
    confidence: b.confidence,
    analysis: b.analysis?.trim() || null,
    thesis: parseStarLogic(b.starLogic)?.thesis ?? null,
  }
}

/** Топ-эксперт сайта: единственный теннисный аналитик («звезда», Мария) */
async function getStarTipster() {
  const bySport = await db.tipster.findFirst({ where: { sport: 'tennis' } })
  if (bySport) return bySport
  return db.tipster.findFirst({ where: { name: { contains: 'Волкова' } } })
}

/**
 * «Экспресс дня» за разобранный день — ровно по формуле живой карточки
 * /api/express и ретроспективы /api/stats (computeExpressDays):
 * топ-3 прогноза дня по уверенности БЕЗ «Ставки дня», 10 юн. на комбинацию.
 * Зашёл — ни одна нога не проиграла (возврат выбрасывает ногу из кэфа);
 * не зашёл — есть проигравшая нога; все возвраты — возврат дня.
 */
function buildExpressOfDay(
  dayBets: (Bet & { tipster: { name: string } | null })[],
): DigestExpress | null {
  const legs = dayBets
    .filter((b) => !b.isBetOfDay)
    .sort((a, b) => b.confidence - a.confidence || a.matchDate.getTime() - b.matchDate.getTime())
    .slice(0, 3)
  if (legs.length < 2) return null // экспресс собирается минимум из 2 ног

  const picks = legs.map(toPick)
  const round2 = (v: number) => Math.round(v * 100) / 100
  const totalOdds = round2(legs.reduce((p, l) => p * l.odds, 1))

  if (picks.some((p) => p.status === 'pending')) {
    return {
      status: 'pending',
      profit: null,
      totalOdds,
      effectiveOdds: totalOdds,
      confidences: picks.map((p) => p.confidence),
      legs: picks,
    }
  }
  if (picks.some((p) => p.status === 'lost')) {
    return {
      status: 'lost',
      profit: -EXPRESS_STAKE,
      totalOdds,
      effectiveOdds: totalOdds,
      confidences: picks.map((p) => p.confidence),
      legs: picks,
    }
  }
  // Возвратные ноги выбывают из кэфа: эффективный кэф — по выигравшим
  const effectiveOdds = round2(
    picks.filter((p) => p.status === 'won').reduce((p, l) => p * l.odds, 1),
  )
  if (effectiveOdds > 1) {
    return {
      status: 'won',
      profit: round2(EXPRESS_STAKE * (effectiveOdds - 1)),
      totalOdds,
      effectiveOdds,
      confidences: picks.map((p) => p.confidence),
      legs: picks,
    }
  }
  return {
    status: 'void',
    profit: 0,
    totalOdds,
    effectiveOdds,
    confidences: picks.map((p) => p.confidence),
    legs: picks,
  }
}

/** Сборка утреннего разбора за день (по умолчанию — вчера по МСК) */
export async function buildDigest(offsetDays = 1): Promise<DigestData> {
  const { startUtc, endUtc, dateKey } = mskDayWindow(offsetDays)

  const dayBets = await db.bet.findMany({
    where: { isRealMatch: true, matchDate: { gte: startUtc, lt: endUtc } },
    include: { tipster: { select: { name: true } } },
    orderBy: { matchDate: 'asc' },
  })

  const star = await getStarTipster()

  const betOfDay = dayBets.filter((b) => b.isBetOfDay).map(toPick)
  const express = buildExpressOfDay(dayBets)
  // Дедупликация: прогноз «звезды», ставший «Ставкой дня», уже показан в
  // блоке BOD — не дублируем его в секции топ-эксперта.
  const bodIds = new Set(betOfDay.map((p) => p.id))
  const starPicks = star
    ? dayBets
        .filter((b) => b.tipsterId === star.id && !bodIds.has(b.id))
        .map(toPick)
    : []

  // Прочие зашедшие исходы дня (лента): не СД, не нога экспресса, не
  // прогноз эксперта — попадают в строку «Ещё зашло: …» краткого сообщения
  const legIds = new Set((express?.legs ?? []).map((l) => l.id))
  const starIds = new Set(starPicks.map((p) => p.id))
  const otherWins = dayBets
    .filter(
      (b) => b.status === 'won' && !bodIds.has(b.id) && !legIds.has(b.id) && !starIds.has(b.id),
    )
    .map(toPick)

  const settled = dayBets.filter((b) => b.status !== 'pending')
  const summary: DigestSummary = {
    dateKey,
    dateLabel: mskDateLabelOf(dateKey),
    total: dayBets.length,
    won: dayBets.filter((b) => b.status === 'won').length,
    lost: dayBets.filter((b) => b.status === 'lost').length,
    void: dayBets.filter((b) => b.status === 'void').length,
    pending: dayBets.filter((b) => b.status === 'pending').length,
    profit: settled.reduce((acc, b) => acc + betOutcome(b.status, b.stake, b.odds), 0),
  }

  const digest: DigestData = {
    dateKey,
    dateLabel: summary.dateLabel,
    betOfDay,
    express,
    star: star
      ? { tipsterName: star.name, tipsterRole: star.role, sport: star.sport, picks: starPicks }
      : null,
    otherWins,
    summary,
    telegramHtml: '',
  }
  digest.telegramHtml = buildTelegramHtml(digest)
  return digest
}

/* ----------------------- Сообщение Telegram ----------------------- */

/** Экранирование HTML для parse_mode=HTML */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Короткая запись выбора: «П2 — победа гостей» → «П2», «ТБ 5.5 — …» → «ТБ 5.5» */
function shortSelection(selection: string): string {
  return selection.split('—')[0].trim()
}

/** «+9.75 юн.» — выплата зашедшей ставки в юнитах */
function fmtProfit(v: number): string {
  const sign = v > 0 ? '+' : v < 0 ? '−' : ''
  return `${sign}${Math.abs(v).toFixed(2)} юн.`
}

/** Эмодзи вида спорта для блока эксперта */
const SPORT_EMOJI: Record<string, string> = {
  tennis: '🎾',
  football: '⚽',
  hockey: '🏒',
  basketball: '🏀',
}

/**
 * ЕДИНОЕ утреннее сообщение (Task 50): итог вчерашнего дня + ПОЛНЫЙ разбор
 * зашедших. Разбираются ТОЛЬКО зашедшие ставки из главных блоков —
 * «Ставка дня» со счётом и всей аргументацией (без обрезки), зашедшие
 * исходы «Экспресса дня» с полным разбором каждой ноги (если экспресс
 * зашёл целиком — итоговый кэф и выплата), зашедший прогноз эксперта
 * целиком, «Ещё зашло» — прочие выигрыши дня одной строкой. Сводка дня
 * — в начале, подпись с часом отправки — в конце. Сообщение может
 * превышать лимит Telegram 4096 — режем на части в splitHtmlForTelegram()
 * и отправляем последовательно.
 */
export function buildTelegramHtml(d: DigestData, sendHour = 9): string {
  const parts: string[] = [`🌅 <b>Разбор за ${esc(d.dateLabel)}</b>`, '']

  // Сводка дня — одной строкой сразу под заголовком
  const s = d.summary
  if (s.total > 0) {
    const pieces = [
      `${s.won} зашло`,
      s.lost > 0 ? `${s.lost} мимо` : null,
      s.void > 0 ? `${s.void} возврат` : null,
      s.pending > 0 ? `${s.pending} ждёт расчёта` : null,
    ].filter(Boolean)
    parts.push(`📊 <b>За день: ${pieces.join(' · ')}</b>`)
    parts.push('')
  }

  // ⭐ Ставка дня — блок только если зашла (правило «разбираем зашедшее»)
  for (const p of d.betOfDay.filter((x) => x.status === 'won')) {
    const score = p.score ? ` · ${esc(p.score)}` : ''
    parts.push('<b>⭐ Ставка дня — зашла ✅</b>')
    parts.push(`${esc(p.homeTeam)} — ${esc(p.awayTeam)} · ${esc(p.league)}`)
    parts.push(`${esc(p.selection)} @${p.odds.toFixed(2)} · ${fmtProfit(p.profit)}${score}`)
    const why = (p.thesis ?? p.analysis ?? '').trim()
    if (why) parts.push(`📖 Полный разбор: ${esc(fullText(why))}`)
    parts.push('')
  }

  // 🧩 Экспресс дня — только зашедшие исходы («исходы из экспресса»)
  if (d.express) {
    const wonLegs = d.express.legs.filter((l) => l.status === 'won')
    if (d.express.status === 'won') {
      parts.push(
        `<b>🧩 Экспресс дня — зашёл целиком ✅</b> · кэф ${d.express.effectiveOdds.toFixed(2)} · ${fmtProfit(d.express.profit ?? 0)}`,
      )
    } else if (wonLegs.length > 0) {
      const pendingNote = d.express.status === 'pending' ? ' (остальные ждут расчёта)' : ''
      parts.push(
        `<b>🧩 Экспресс дня · зашло ${wonLegs.length} из ${d.express.legs.length}${pendingNote}</b>`,
      )
    }
    wonLegs.forEach((l, i) => {
      const score = l.score ? ` · ${esc(l.score)}` : ''
      parts.push(
        `${i + 1}. ${esc(l.homeTeam)} — ${esc(l.awayTeam)} · ${esc(l.selection)} @${l.odds.toFixed(2)}${score}`,
      )
      const why = (l.thesis ?? l.analysis ?? '').trim()
      if (why) parts.push(`📖 ${esc(fullText(why))}`)
    })
    if (d.express.status === 'won' || wonLegs.length > 0) parts.push('')
  }

  // Прогноз эксперта — только зашедший и ещё не показанный в экспрессе
  // (экспертная ставка могла попасть в топ-3 по уверенности — не дублируем)
  if (d.star) {
    const emoji = SPORT_EMOJI[d.star.sport] ?? '⭐'
    const legIds = new Set((d.express?.legs ?? []).map((l) => l.id))
    for (const p of d.star.picks.filter((x) => x.status === 'won' && !legIds.has(x.id))) {
      const score = p.score ? ` · ${esc(p.score)}` : ''
      parts.push(`<b>${emoji} Прогноз эксперта — зашёл ✅</b>`)
      parts.push(`${esc(p.homeTeam)} — ${esc(p.awayTeam)} · ${esc(p.league)}`)
      parts.push(`${esc(p.selection)} @${p.odds.toFixed(2)} · ${fmtProfit(p.profit)}${score}`)
      const why = (p.thesis ?? p.analysis ?? '').trim()
      if (why) parts.push(`📖 ${esc(fullText(why))}`)
      parts.push('')
    }
  }

  // Прочие зашедшие исходы дня (лента) — одной строкой «Ещё зашло»
  if (d.otherWins.length > 0) {
    const items = d.otherWins
      .map((p) => {
        const score = p.score ? ` (${esc(p.score)})` : ''
        return `${esc(p.homeTeam)} — ${esc(p.awayTeam)} · ${esc(shortSelection(p.selection))} @${p.odds.toFixed(2)}${score}`
      })
      .join(', ')
    parts.push(`Ещё зашло ✅: ${items}`)
    parts.push('')
  }

  const hasWins =
    d.betOfDay.some((x) => x.status === 'won') ||
    (!!d.express && d.express.legs.some((l) => l.status === 'won')) ||
    (!!d.star && d.star.picks.some((p) => p.status === 'won')) ||
    d.otherWins.length > 0

  if (!hasWins) {
    parts.push(
      s.total === 0
        ? 'ℹ️ Вчера прогнозов не было — спокойный день.'
        : 'Накануне из главных ставок не зашло ничего — разборов нет. Новый день уже в ленте сайта.',
    )
    parts.push('')
  }

  parts.push(`— «Ставка Дня» · итог + полный разбор зашедших · ${sendHour}:00 МСК · 18+`)
  return parts.join('\n')
}


/**
 * Полный текст разбора: сохраняем абзацы исходного анализа (переносы строк
 * внутри прогноза — часть «полного разбора», не схлопываем их в одну строку).
 */
function fullText(s: string): string {
  return s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Разбивка длинного HTML на части для Telegram (лимит 4096 символов на
 * сообщение, считая теги). Режем ТОЛЬКО по границам блоков — пустой строке
 * («\n\n»), никогда внутри тега. Каждая часть маркируется «(i/N)».
 * Подпись «— «Ставка Дня» · …» естественным образом остаётся в последней части.
 */
export function splitHtmlForTelegram(html: string, limit = 3800): string[] {
  if (html.length <= limit) return [html]
  const blocks = html.split('\n\n')
  const chunks: string[] = []
  let current: string[] = []
  let currentLen = 0

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current.join('\n\n'))
      current = []
      currentLen = 0
    }
  }

  for (const block of blocks) {
    // Блок сам по себе длиннее лимита — режем по строккам (крайний случай:
    // один гигантский абзац без «\n\n»)
    if (block.length > limit) {
      flush()
      const lines = block.split('\n')
      let piece: string[] = []
      let pieceLen = 0
      for (const line of lines) {
        if (pieceLen + line.length + 1 > limit && piece.length > 0) {
          chunks.push(piece.join('\n'))
          piece = []
          pieceLen = 0
        }
        piece.push(line)
        pieceLen += line.length + 1
      }
      if (piece.length > 0) chunks.push(piece.join('\n'))
      continue
    }
    if (currentLen + block.length + 2 > limit && current.length > 0) {
      flush()
    }
    current.push(block)
    currentLen += block.length + 2
  }
  flush()

  const total = chunks.length
  if (total <= 1) return chunks
  return chunks.map((c, i) => `${c}\n(${i + 1}/${total})`)
}

/* ------------------------- Telegram Bot API ----------------------- */

interface TelegramResult<T> {
  ok: boolean
  result?: T
  error_code?: number
  description?: string
}

async function telegramCall<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<
  { ok: true; result: T } | { ok: false; error: string; code?: 'webhook-active' }
> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12_000)
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal,
      cache: 'no-store',
    })
    const data = (await res.json().catch(() => null)) as TelegramResult<T> | null
    if (res.ok && data?.ok && data.result !== undefined) {
      return { ok: true, result: data.result }
    }
    const desc = data?.description ?? `HTTP ${res.status}`
    // Вебхук стороннего сервиса перехватывает сообщения бота — getUpdates
    // (и кнопка «Найти чат») не работают, пока вебхук активен
    if (desc.includes('webhook is active')) {
      return {
        ok: false,
        error:
          'К боту подключён вебхук стороннего сервиса — он перехватывает сообщения бота, поэтому сайт не видит чаты. Отключите вебхук, чтобы бот получал сообщения напрямую.',
        code: 'webhook-active',
      }
    }
    return { ok: false, error: telegramHumanError(res.status, desc) }
  } catch (e) {
    console.error('telegramCall fetch error:', e, 'cause:', (e as { cause?: unknown })?.cause)
    const msg = e instanceof Error && e.name === 'AbortError' ? 'timeout' : String(e)
    return { ok: false, error: `Telegram не отвечает (${msg})` }
  } finally {
    clearTimeout(timer)
  }
}

function telegramHumanError(status: number, desc: string): string {
  if (status === 401) return 'Токен бота неверный (Telegram: 401 Unauthorized)'
  if (status === 404) return 'Бот с таким токеном не найден (404)'
  if (status === 429) return 'Слишком много запросов к Telegram — попробуйте позже'
  return `Telegram: ${desc}`
}

/** Отправка сообщения (parse_mode=HTML) */
export async function sendTelegramMessage(
  token: string,
  chatId: string,
  html: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await telegramCall<{ message_id: number }>(token, 'sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  })
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}

/**
 * Снять с бота вебхук стороннего сервиса (deleteWebhook). Отправка сообщений
 * работает и с вебхуком — мешает он только приёму чатов (getUpdates).
 * Возвращает ok=true, даже если вебхука и не было (идемпотентно).
 */
export async function deleteTelegramWebhook(
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await telegramCall<boolean>(token, 'deleteWebhook', {
    drop_pending_updates: false,
  })
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}

interface TelegramUpdate {
  message?: { chat: TelegramChat }
  edited_message?: { chat: TelegramChat }
  channel_post?: { chat: TelegramChat }
  my_chat_member?: { chat: TelegramChat }
}

interface TelegramChat {
  id: number
  type: string
  title?: string
  username?: string
  first_name?: string
  last_name?: string
}

/** Чаты, писавшие боту (getUpdates) — для кнопки «Найти чат» в UI */
export async function listTelegramChats(
  token: string,
): Promise<{ ok: boolean; chats?: TelegramChatOption[]; error?: string; code?: 'webhook-active' }> {
  const r = await telegramCall<unknown[]>(token, 'getUpdates', { limit: 100 })
  if (!r.ok) return { ok: false, error: r.error, code: r.code }
  const updates = r.result as TelegramUpdate[]
  const byId = new Map<number, TelegramChat>()
  for (const u of updates) {
    const chat = u.message?.chat ?? u.edited_message?.chat ?? u.channel_post?.chat ?? u.my_chat_member?.chat
    if (chat) byId.set(chat.id, chat)
  }
  const chats: TelegramChatOption[] = [...byId.values()].map((c) => ({
    id: String(c.id),
    title:
      c.title ??
      [c.first_name, c.last_name].filter(Boolean).join(' ') ??
      c.username ??
      `Чат ${c.id}`,
    type: c.type,
  }))
  return { ok: true, chats }
}

/* ---------------------- Авто-подключение чата --------------------- */

export interface AutoDetectResult {
  ok: boolean
  chatId?: string
  chatTitle?: string
  /** Пришло ли приветственное сообщение (шлём один раз за всё время) */
  welcomeSent?: boolean
  reason?: string
}

/**
 * Авто-подключение чата (Task 42): владелец просто жмёт /start в Telegram —
 * сайт сам находит последний чат из getUpdates, сохраняет его, включает
 * рассылку и присылает короткое приветствие. Открывать настройки не нужно.
 * Вызывается из GET /api/digest (визит сайта) и sendDailyDigest (cron).
 */
export async function autoDetectChat(
  token: string,
  sendHour: number,
): Promise<AutoDetectResult> {
  const list = await listTelegramChats(token)
  if (!list.ok) return { ok: false, reason: list.error }
  const chats = list.chats ?? []
  if (chats.length === 0) return { ok: false, reason: 'no-chats' }

  // последний чат, писавший боту — с огромной вероятностью владелец,
  // только что нажавший /start (подменить можно вручную в настройках)
  const chat = chats[chats.length - 1]
  await saveDigestSettings({
    telegramChatId: chat.id,
    telegramChatTitle: chat.title,
    telegramEnabled: true,
  })

  // приветствие — один раз, чтобы владелец сразу увидел, что бот живой
  const welcomeSent = await sendWelcomeOnce(token, chat.id, sendHour)
  return { ok: true, chatId: chat.id, chatTitle: chat.title, welcomeSent }
}

/**
 * Приветственное сообщение при первом подключении чата — строго один раз
 * за всё время (дедуп по DigestLog channel='welcome'). Используется и
 * авто-подключением (autoDetectChat), и мгновенным подключением через
 * мини-сервис бота (POST /api/digest/telegram-ingest).
 */
export async function sendWelcomeOnce(
  token: string,
  chatId: string,
  sendHour: number,
): Promise<boolean> {
  const welcomed = await db.digestLog.findFirst({ where: { channel: 'welcome', success: true } })
  if (welcomed) return false
  const html = [
    '✅ <b>Бот «Ставка Дня» подключён</b>',
    '',
    `Каждое утро в ${sendHour}:00 МСК — одно сообщение за вчерашний день: итог (сколько зашло/мимо) и полный разбор зашедших главных ставок — «Ставка дня», исходы «Экспресса дня» и прогноз эксперта с обоснованием.`,
    '',
    '— «Ставка Дня» · 18+',
  ].join('\n')
  const r = await sendTelegramMessage(token, chatId, html)
  await db.digestLog.create({
    data: {
      digestDate: mskDateKeyOf(new Date()),
      channel: 'welcome',
      success: r.ok,
      error: r.ok ? null : (r.error ?? 'unknown'),
      message: html,
    },
  })
  return r.ok
}

/* --------------------------- Настройки ---------------------------- */

interface SettingsPatch {
  telegramEnabled?: boolean
  telegramBotToken?: string | null
  telegramChatId?: string | null
  telegramChatTitle?: string | null
  sendHour?: number
}

export async function getDigestSettings(): Promise<DigestSettings> {
  const row = await db.digestSettings.findUnique({ where: { id: DIGEST_SETTINGS_ID } })
  if (row) return row
  return db.digestSettings.create({
    data: { id: DIGEST_SETTINGS_ID, sendHour: 9 },
  })
}

export function publicSettings(s: DigestSettings): PublicDigestSettings {
  const token = s.telegramBotToken
  const preview = token
    ? `${token.slice(0, 8)}…${token.slice(-4)} (${token.length} симв.)`
    : null
  return {
    telegramEnabled: s.telegramEnabled,
    hasToken: !!token,
    tokenPreview: preview,
    telegramChatId: s.telegramChatId,
    telegramChatTitle: s.telegramChatTitle,
    sendHour: s.sendHour,
  }
}

export function validateSettingsPatch(patch: SettingsPatch): string | null {
  if (patch.telegramBotToken !== undefined) {
    const t = patch.telegramBotToken
    if (t !== null && t !== '' && !BOT_TOKEN_RE.test(t)) {
      return 'Токен выглядит неправильно: формат «123456789:AA…» из @BotFather'
    }
  }
  if (patch.telegramChatId !== undefined) {
    const c = patch.telegramChatId
    if (c !== null && c !== '' && !CHAT_ID_RE.test(c)) {
      return 'Chat ID — это число (личный чат или группа), например 123456789'
    }
  }
  if (patch.sendHour !== undefined) {
    if (!Number.isInteger(patch.sendHour) || patch.sendHour < 6 || patch.sendHour > 12) {
      return 'Час отправки — от 6 до 12 утра (МСК)'
    }
  }
  return null
}

export async function saveDigestSettings(
  patch: SettingsPatch,
): Promise<DigestSettings> {
  await getDigestSettings() // гарантирует наличие строки
  const data: Record<string, unknown> = {}
  if (patch.telegramBotToken !== undefined) {
    const t = patch.telegramBotToken?.trim() ?? ''
    data.telegramBotToken = t === '' ? null : t
  }
  if (patch.telegramChatId !== undefined) {
    const c = patch.telegramChatId?.trim() ?? ''
    data.telegramChatId = c === '' ? null : c
  }
  if (patch.telegramChatTitle !== undefined) {
    data.telegramChatTitle = patch.telegramChatTitle?.trim() || null
  }
  if (patch.telegramEnabled !== undefined) data.telegramEnabled = patch.telegramEnabled
  if (patch.sendHour !== undefined) data.sendHour = patch.sendHour
  return db.digestSettings.update({ where: { id: DIGEST_SETTINGS_ID }, data })
}

/* ------------------------ Отправка + журнал ----------------------- */

export interface DigestSendOutcome {
  sent: boolean
  reason?: 'not-configured' | 'too-early' | 'already-sent' | 'no-data' | 'error'
  error?: string
  digestDate?: string
  digestDateLabel?: string
}

/**
 * Отправка ЕДИНОГО утреннего сообщения (итог + полный разбор зашедших).
 *  auto=true  — расписание/визит сайта: проверяет час МСК и отсутствие
 *               отправки за сегодня (дедуп); пропущенный крон догоняется
 *               первым визитом сайта после sendHour;
 *  auto=false — вручную: шлём всегда (кнопка «Отправить сейчас»).
 *
 * Если токен сохранён, а чата ещё нет — сначала пробуем авто-подключение
 * (владелец мог нажать /start): чат подхватится сам, рассылка включится.
 */
let morningAutoInflight = false

export async function sendDailyDigest(auto: boolean): Promise<DigestSendOutcome> {
  if (!auto) return sendDailyDigestInner(false)
  // Защита от параллельных автопосылок (визит сайта + тик крона одновременно)
  if (morningAutoInflight) return { sent: false, reason: 'already-sent' }
  morningAutoInflight = true
  try {
    return await sendDailyDigestInner(true)
  } finally {
    morningAutoInflight = false
  }
}

async function sendDailyDigestInner(auto: boolean): Promise<DigestSendOutcome> {
  let settings = await getDigestSettings()
  let token = settings.telegramBotToken?.trim()
  let chatId = settings.telegramChatId?.trim()

  // Авто-подключение: владелец нажал /start — чат подключается сам,
  // настройки открывать не обязательно (welcome + включение рассылки)
  if (token && !chatId) {
    const detected = await autoDetectChat(token, settings.sendHour)
    if (detected.ok && detected.chatId) {
      chatId = detected.chatId
      settings = await getDigestSettings() // telegramEnabled теперь true
      token = settings.telegramBotToken?.trim()
    }
  }

  if (!token || !chatId) {
    return { sent: false, reason: 'not-configured' }
  }

  // Дешёвые проверки — ДО тяжёлой работы (resolveRealBets тянет веб):
  // функция вызывается fire-and-forget при каждом визите сайта
  const dateKey = mskDayWindow(1).dateKey
  if (auto) {
    if (moscowHourNow() < settings.sendHour) {
      return { sent: false, reason: 'too-early', digestDate: dateKey }
    }
    const sent = await db.digestLog.findFirst({
      where: {
        digestDate: dateKey,
        success: true,
        channel: { in: ['telegram', 'telegram-manual'] },
      },
    })
    if (sent) {
      return { sent: false, reason: 'already-sent', digestDate: dateKey }
    }
    // автоотправка имеет смысл только при включённой настройке
    if (!settings.telegramEnabled) {
      return { sent: false, reason: 'not-configured', digestDate: dateKey }
    }
    // Анти-спам: не долбим Telegram весь день при сломанном токене —
    // максимум 5 неудачных автопопыток на одну дату разбора
    const failed = await db.digestLog.count({
      where: { digestDate: dateKey, success: false, channel: 'telegram' },
    })
    if (failed >= 5) {
      return { sent: false, reason: 'already-sent', digestDate: dateKey }
    }
  }

  // Вчерашние вечерние матчи могли ещё не рассчитаться (сайт никто не
  // открывал ночью) — сначала авто-расчёт по реальным счётам, затем
  // сборка. Иначе разбор в 9:00 уйдёт пустым («N ещё в игре»).
  try {
    await resolveRealBets()
  } catch (e) {
    console.error('sendDailyDigest: resolveRealBets error:', e)
  }

  const digest = await buildDigest(1)
  // Разбираем только зашедшее — если ставок не было вовсе, отправлять нечего.
  // День «всё мимо» всё равно получает честную строку без разборов.
  if (digest.summary.total === 0) {
    return { sent: false, reason: 'no-data', digestDate: digest.dateKey }
  }

  // Единое сообщение может превышать лимит Telegram 4096 символов — режем
  // на части ТОЛЬКО по границам блоков (splitHtmlForTelegram) и отправляем
  // последовательно; сводка дня и подпись остаются в последней части.
  // В журнал пишем полный текст (в UI предпросмотр показывает всё).
  const html = buildTelegramHtml(digest, settings.sendHour)
  const chunks = splitHtmlForTelegram(html)
  let sendOk = true
  let sendError: string | undefined
  for (const chunk of chunks) {
    const r = await sendTelegramMessage(token, chatId, chunk)
    if (!r.ok) {
      sendOk = false
      sendError = r.error
      break
    }
  }

  await db.digestLog.create({
    data: {
      digestDate: digest.dateKey,
      channel: auto ? 'telegram' : 'telegram-manual',
      success: sendOk,
      error: sendOk ? null : (sendError ?? 'unknown'),
      message: html,
    },
  })

  return {
    sent: sendOk,
    reason: sendOk ? undefined : 'error',
    error: sendError,
    digestDate: digest.dateKey,
    digestDateLabel: digest.dateLabel,
  }
}

/** Последние записи журнала — для блока «История отправок» в UI */
export async function getRecentDigestLogs(limit = 6) {
  const logs = await db.digestLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      digestDate: true,
      channel: true,
      success: true,
      error: true,
      createdAt: true,
    },
  })
  return logs.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() }))
}
