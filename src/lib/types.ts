// Shared types matching API JSON responses (dates serialized as ISO strings)

export type SportKey = 'football' | 'tennis' | 'hockey' | 'basketball'

export type BetStatus = 'pending' | 'won' | 'lost' | 'void'

export interface TipsterDto {
  id: string
  name: string
  role: string
  /** Специализация по виду спорта (null — универсальный аналитик) */
  sport?: SportKey | null
  avatarUrl?: string | null
  wins: number
  losses: number
}

export interface BetDto {
  id: string
  sport: SportKey
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
  status: BetStatus
  resultNote?: string | null
  /** true — прогноз на матч из РЕАЛЬНОГО расписания (коэффициент примерный) */
  isRealMatch?: boolean
  /** Начавшийся матч: живая фаза и текущий счёт из расписания */
  liveInfo?: LiveInfoDto | null
  /** Линия рынка (web-search): кэф на наш выбор для сравнения ценности */
  marketOdds?: number | null
  /** Домен источника линии, напр. «bookmaker-ratings.ru» */
  marketSource?: string | null
  /** Вердикт сравнения с рынком: «Наш кэф выше линии…» */
  marketNote?: string | null
  marketCheckedAt?: string | null
  isBetOfDay: boolean
  tipsterId?: string | null
  tipster?: TipsterDto | null
  /** Подробный разбор логики «звезды» — сырой JSON из БД (Task 37);
 *   парсится на клиенте через parseStarLogic() из '@/lib/star-logic' */
  starLogic?: string | null
}

/* ---------------- Подробный разбор логики «звезды» ---------------- */

/** Один фактор разбора: за (pro) или против (con) выбора */
export interface StarLogicFactor {
  /** Короткий заголовок, напр. «Устойчивость на подаче» */
  title: string
  /** 1–2 предложения пояснения */
  detail: string
  /** pro — аргумент ЗА выбор, con — риск/контраргумент */
  side: 'pro' | 'con'
}

/** Структурированный разбор прогноза «звезды» (Мария Волкова, Task 37) */
export interface StarLogic {
  /** Главный тезис выбора — одной фразой */
  thesis: string
  /** 3–6 ключевых факторов с оценкой за/против */
  factors: StarLogicFactor[]
  /** Сценарий: как должен развиваться матч, чтобы ставка прошла */
  scenario: string
  /** Главный риск — что ломает ставку */
  risks: string
  /** Почему НЕ противоположный исход / другой рынок */
  alternative: string
  /** Обоснование размера ставки (юниты) */
  stakeLogic: string
}

/** Живое состояние матча: фаза («1-й тайм») и текущий счёт («0:0») */
export interface LiveInfoDto {
  phase: string
  score?: string | null
}

export interface BetsResponse {
  bets: BetDto[]
  /** true — лента «сегодня» строится на реальных матчах из живого расписания */
  realMode?: boolean
}

/** История с серверной пагинацией (GET /api/bets?tab=history&page=&pageSize=) */
export interface HistoryBetsResponse {
  bets: BetDto[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  /** Источник прогноза в выборке: real | demo | undefined (все) */
  source?: 'real' | 'demo'
}

export interface TipsterStatsDto {
  id: string
  name: string
  role: string
  /** Специализация по виду спорта (null — универсальный аналитик) */
  sport?: SportKey | null
  avatarUrl?: string | null
  wins: number
  losses: number
  totalBets: number
  won: number
  lost: number
  /** Возвраты (отменённые/не состоявшиеся матчи) — не влияют на winrate */
  voided: number
  winrate: number // % of decided
  profit: number // units
  avgOdds: number
  pending: number
  lastResults: BetStatus[] // latest 15 decided, newest first
  /** Ближайший активный прогноз эксперта (pending, реальный матч) — для подсветки топ-эксперта */
  activeBet?: BetDto | null
}

export interface TipstersResponse {
  tipsters: TipsterStatsDto[]
}

/** Профиль аналитика: статистика + последние прогнозы (GET /api/tipsters?id=) */
export interface TipsterProfileResponse {
  tipster: TipsterStatsDto
  bets: BetDto[]
}

/** POST /api/subscribe: успех / дубликат / ошибка валидации */
export type SubscribeResponse =
  | { ok: true }
  | { ok: false; reason: 'duplicate' }
  | { ok: false; error: string }

export interface BetOfDayResponse {
  bet: BetDto | null
}

/* ---------- Разборы (редакционные материалы) ---------- */

export type ArticleCategory = 'Разбор матча' | 'Итоги дня' | 'Взгляд на завтра'

export interface ArticleDto {
  id: string
  slug: string
  title: string
  excerpt: string
  /** Абзацы текста, разделённые \n\n */
  content: string
  category: ArticleCategory
  sport: SportKey
  /** Связка с матчем: «Порту — Морейренси» */
  matchRef?: string | null
  readMinutes: number
  publishedAt: string // ISO
  /** Контент обновлялся (актуально для «Итогов дня» с новыми расчётами) */
  updatedAt?: string // ISO
  author: {
    id: string
    name: string
    role: string
    sport?: SportKey | null
  } | null
}

export interface ArticlesResponse {
  articles: ArticleDto[]
  /** Всего материалов в архиве (для «Показать ещё») */
  total?: number
}

/* ---------- Экспресс дня (виртуальная комбинация топ-пиков) ---------- */

export interface ExpressLegDto {
  id: string
  sport: SportKey
  league: string
  homeTeam: string
  awayTeam: string
  matchDate: string // ISO
  selection: string
  odds: number
  confidence: number
  /** Нога началась раньше, чем экспресс пересобрался */
  liveInfo?: LiveInfoDto | null
}

export interface ExpressDto {
  legs: ExpressLegDto[]
  /** Произведение примерных коэффициентов ног */
  totalOdds: number
  /** Средняя уверенность аналитиков по ногам */
  avgConfidence: number
  /** Иллюстративная сумма ставки (юниты) */
  stakeUnits: number
  /** Иллюстративная выплата (юниты) */
  payoutUnits: number
}

export interface ExpressResponse {
  express: ExpressDto | null
  /** Прошедшие (рассчитанные) дни экспресса с исходами ног — новее сверху */
  history?: ExpressDayStat[]
}

export interface SportStat {
  sport: SportKey
  /** Всего расчётных прогнозов (без pending) */
  total: number
  /** Зашло (выигрыш) */
  won: number
  /** Не зашло (проигрыш) */
  lost: number
  /** Возвраты — в зачёт проходимости не идут */
  void: number
  winrate: number // %
  profit: number // units
}

export interface ProfitPoint {
  date: string // ISO date (day)
  cumulativeProfit: number
}

/** Итог особого формата («Ставка дня» / «Экспресс дня») */
export interface FormatStat {
  /** Всего расчётных (для экспресса — дней) */
  total: number
  /** Зашло (выигрыш; для экспресса — день, где все расчётные ноги выиграли) */
  won: number
  /** Не зашло (для экспресса — день с хоть одной проигравшей ногой) */
  lost: number
  /** Возвраты (все ноги — возвраты) */
  void: number
  /** Ещё в игре (не в зачёт итога) */
  pending: number
  winrate: number // % of decided
  profit: number // units
}

/** Итог «Ставки дня» + конкретные ставки формата (подраздел в статистике) */
export interface BetOfDayStat extends FormatStat {
  /** Все «Ставки дня» (новее раньше), включая сегодняшнюю в игре.
   *  Клик по ставке открывает полный разбор в диалоге. */
  bets: BetDto[]
}

/** День «Экспресса дня» в ретроспективе: топ-3 пика дня как одна комбинация */
export interface ExpressDayStat {
  /** День матчей, YYYY-MM-DD */
  date: string
  /** Итог дня: won / lost / void / pending (ещё в игре) */
  status: BetStatus
  /** Чистый итог дня в юнитах (null — день ещё в игре) */
  profit: number | null
  /** Произведение коэффициентов всех ног дня */
  totalOdds: number
  /** Ноги дня (полные прогнозы): клик по ноге открывает разбор */
  legs: BetDto[]
}

/** Итог «Экспресса дня» + список дней с ногами (подраздел в статистике) */
export interface ExpressOfDayStat extends FormatStat {
  /** Дни формата (новее раньше, включая сегодняшние «в игре») */
  days: ExpressDayStat[]
}

/** Опция фильтра «Эксперт» в панели статистики */
export interface StatsExpertOption {
  id: string
  name: string
  sport: string | null
  /** Сколько реальных прогнозов у эксперта (для подписи) */
  count: number
}

/** Опции фильтров статистики: виды спорта и эксперты с прогнозами */
export interface StatsFilterMeta {
  sports: SportKey[]
  experts: StatsExpertOption[]
}

/** Значения панели фильтров статистики (03.10) */
export interface StatsFilterState {
  /** Вид спорта: 'all' | SportKey */
  sport: string
  /** Исход: 'all' | 'won' | 'lost' | 'void' | 'pending' */
  outcome: string
  /** Категория: 'all' | 'bod' | 'express' | 'feed' */
  category: string
  /** Эксперт: 'all' | tipsterId */
  expert: string
}

export interface StatsResponse {
  totals: {
    total: number
    won: number
    lost: number
    void: number
    pending: number
  }
  winrate: number // % of decided
  roi: number // % profit / staked
  profit: number // units
  currentStreak: {
    type: 'won' | 'lost'
    count: number
  }
  bestStreak: number
  avgOdds: number
  totalStaked: number
  profitSeries: ProfitPoint[]
  /** Первый день истории (ISO): вся статистика считается за всё время от него */
  since?: string
  bySport: SportStat[]
  /** Итог по «Ставке дня»: агрегат + конкретные ставки формата */
  betOfDay?: BetOfDayStat
  /** Итог по «Экспрессу дня»: агрегат + дни с ногами (ретроспектива, 10 юн.) */
  expressOfDay?: ExpressOfDayStat
  /** Последние завершённые прогнозы: карточка кликабельна → разбор в диалоге */
  recent?: BetDto[]
  /** Опции фильтров (по полной истории): виды спорта и эксперты */
  filters?: StatsFilterMeta
}

export const SPORT_KEYS: SportKey[] = ['football', 'tennis', 'hockey', 'basketball']

export function isSportKey(v: unknown): v is SportKey {
  return v === 'football' || v === 'tennis' || v === 'hockey' || v === 'basketball'
}

/* ---------- Реальное расписание матчей (Спорт-Экспресс) ---------- */

export type RealMatchStatus = 'upcoming' | 'live' | 'finished' | 'canceled'

export interface RealMatchDto {
  /** Лига/турнир, напр. «Англия. Премьер-лига» */
  league: string
  /** Время начала по МСК, «HH:MM» */
  time: string
  status: RealMatchStatus
  /** Фаза live-матча как на источнике, напр. «1-й тайм» (только для live) */
  phase?: string
  home: string
  away: string
  /** Счёт: «3:0» (футбол/хоккей/баскетбол) или «3-6 6-2 2-6» (сеты в теннисе); для live — текущий */
  score?: string
}

export interface RealMatchesResponse {
  ok: boolean
  /** Дата страницы расписания (дд-ММ-гггг, день по МСК) */
  date: string
  fetchedAt: string
  source: {
    name: string
    urls: Record<SportKey, string>
  }
  sports: Record<SportKey, RealMatchDto[]>
}

/* ---------------- Утренний разбор в Telegram (Task 40) ---------------- */

/** Один прогноз в утреннем разборе (вчерашний день) */
export interface DigestPickDto {
  id: string
  sport: string
  league: string
  homeTeam: string
  awayTeam: string
  matchDate: string // ISO
  selection: string
  odds: number
  stake: number
  status: BetStatus
  score: string | null
  resultNote: string | null
  /** Итог в юнитах (+2.55 / −2.00 / 0) */
  profit: number
  tipsterName: string | null
  /** Уверенность прогноза, % */
  confidence: number
  /** Разбор ДО матча — выжимка для строки «почему» */
  analysis: string | null
  /** Тезис «звезды» из starLogic — «почему Мария так решила» */
  thesis: string | null
}

/** «Экспресс дня» вчерашнего дня: топ-3 по уверенности, без ставки дня */
export interface DigestExpressDto {
  status: BetStatus
  profit: number | null
  totalOdds: number
  effectiveOdds: number
  confidences: number[]
  legs: DigestPickDto[]
}

export interface DigestSummaryDto {
  dateKey: string
  dateLabel: string
  total: number
  won: number
  lost: number
  void: number
  pending: number
  profit: number
}

export interface DigestDataDto {
  dateKey: string
  dateLabel: string
  betOfDay: DigestPickDto[]
  express: DigestExpressDto | null
  star: { tipsterName: string; tipsterRole: string; sport: string; picks: DigestPickDto[] } | null
  summary: DigestSummaryDto
}

/** Публичные настройки рассылки — токен замаскирован */
export interface DigestSettingsDto {
  telegramEnabled: boolean
  hasToken: boolean
  tokenPreview: string | null
  telegramChatId: string | null
  telegramChatTitle: string | null
  sendHour: number
}

export interface DigestLogDto {
  id: string
  digestDate: string
  channel: string
  success: boolean
  error: string | null
  createdAt: string
}

/** Состояние мини-сервиса Telegram-бота (опрос :3033/health; без секретов).
 *  24.10: владелец должен ВИДЕТЬ, жива ли рассылка, а не гадать по тишине. */
export interface BotHealthDto {
  /** мини-сервис отвечает */
  online: boolean
  /** username бота, напр. «BetCompassBot» */
  username: string | null
  hasToken: boolean
  /** активный опрос Telegram (false при мёртвом токене/выключенной рассылке) */
  polling: boolean
  /** последняя ошибка опроса: «Unauthorized» = токен отклонён Telegram */
  lastError: string | null
  lastPollAt: string | null
}

export interface DigestResponse {
  digest: DigestDataDto
  /** Текст единого утреннего сообщения (итог + полный разбор зашедших) */
  telegramHtml: string
  settings: DigestSettingsDto
  logs: DigestLogDto[]
  moscowHour: number
  /** Живое состояние бота (null — мини-сервис недоступен) */
  bot: BotHealthDto | null
}

export interface DigestSendResponse {
  sent: boolean
  reason?: 'not-configured' | 'too-early' | 'already-sent' | 'no-data' | 'error'
  error?: string
  digestDate?: string
  digestDateLabel?: string
}

export interface TelegramChatsResponse {
  chats?: { id: string; title: string; type: string }[]
  hint?: string
  error?: string
  /** «webhook-active» — сторонний сервис перехватывает сообщения бота */
  code?: 'webhook-active'
}
