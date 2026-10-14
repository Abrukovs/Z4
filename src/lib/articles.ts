import { db } from '@/lib/db'
import type { Bet, Tipster } from '@prisma/client'
import { mskDateOf, mskDateStr } from '@/lib/real-matches'
import { plural } from '@/lib/format'
import { EDITOR_SYSTEM_PROMPT, hasForeignGlitch, llmParagraphs, llmText } from '@/lib/llm'

/**
 * Движок редакционных материалов («Разборы»).
 *
 * Статьи генерируются офлайн из РЕАЛЬНЫХ данных ленты: разбор ключевого
 * матча, итоги расчётного дня и превью завтрашней программы. Каждый вид
 * материала появляется не чаще одного раза в московский день (дедуп
 * по slug) — тексты собираются из шаблонов с детерминированной вариативностью.
 */

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000

/** Детерминированный хеш строки (выбор вариантов шаблонов) */
function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

function pickBy<T>(seed: string, arr: T[]): T {
  return arr[hashStr(seed) % arr.length]
}

/** Время матча по МСК, «HH:MM» */
function mskTime(d: Date): string {
  const msk = new Date(d.getTime() + MSK_OFFSET_MS)
  return `${String(msk.getUTCHours()).padStart(2, '0')}:${String(msk.getUTCMinutes()).padStart(2, '0')}`
}

/** День недели по МСК в родительном падеже для дат типа «4 сентября» */
const MONTHS_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

function mskDayLabel(d: Date): string {
  const msk = new Date(d.getTime() + MSK_OFFSET_MS)
  return `${msk.getUTCDate()} ${MONTHS_RU[msk.getUTCMonth()]}`
}

function mskHour(d: Date): number {
  return new Date(d.getTime() + MSK_OFFSET_MS).getUTCHours()
}

/** Транслитерация для slug: «Порту — Морейренси» → «portu-moreirensi» */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
}

function slugifyTeams(home: string, away: string): string {
  const translit = (s: string) =>
    s
      .toLowerCase()
      .split('')
      .map((ch) => TRANSLIT[ch] ?? (/[a-z0-9]/.test(ch) ? ch : ' '))
      .join('')
      .trim()
      .replace(/\s+/g, '-')
  return `${translit(home)}-${translit(away)}`.slice(0, 60)
}

/* ---------- Вид 1: разбор ключевого матча ---------- */

function makeMatchReview(bet: Bet & { tipster: Tipster | null }): {
  slug: string
  title: string
  excerpt: string
  content: string
  category: string
  sport: string
  matchRef: string
  readMinutes: number
  authorId: string | null
} {
  const { homeTeam: h, awayTeam: a, league, selection, odds, stake, confidence, analysis } = bet
  const time = mskTime(bet.matchDate)
  const seed = bet.id
  const matchRef = `${h} — ${a}`

  const titles = [
    `Разбор: ${h} — ${a}. За что мы топим`,
    `${h} — ${a}: почему «${selection}» смотрится играбельно`,
    `Большой разбор: ${h} против ${a}`,
  ]
  const title = pickBy(seed, titles)

  const excerpts = [
    `Ключевой матч программы в ${time} МСК: разбираем расклады «${h} — ${a}», объясняем выбор «${selection}» и честно говорим о рисках.`,
    `Наш выбор в паре «${h} — ${a}» — ${selection}. Логика ставки, размер риска и что может пойти не так — в разборе.`,
    `Почему в матче «${h} — ${a}» мы за «${selection}»: аргументы, примерный кэф ${odds.toFixed(2)} и план на дистанции.`,
  ]
  const excerpt = pickBy(seed + 'e', excerpts)

  const lead = pickBy(seed + 'l', [
    `Сегодня в центре внимания встреча в рамках ${league}. Стартовый свисток — в ${time} по московскому времени, и это один из матчей, ради которых мы вообще открывали программу дня.`,
    `Программа дня богата, но именно матч «${h} — ${a}» (${league}, ${time} МСК) притягивает внимание: здесь сочетаются живой турнирный расклад и понятная статистическая логика.`,
    `${league} редко балует перекосами, но «${h} — ${a}» — исключение: пары последних встреч этой пары читаются как учебник по открытому футболу.`,
  ])

  const logic = analysis.trim()

  const oddsPara = pickBy(seed + 'o', [
    `Примерный коэффициент на наш выбор — около ${odds.toFixed(2)}. Подчёркиваем: это модельная оценка, а не линия букмекера. Реальные котировки могут отличаться в обе стороны, поэтому сверяйтесь с линией перед ставкой.`,
    `Мы оцениваем событие в ${odds.toFixed(2)}. Это примерный кэф по нашей модели — если у букмекера он заметно выше, ценность растёт, если ниже — ставка теряет смысл.`,
    `Ориентир по коэффициенту — ${odds.toFixed(2)}. Ключ к дистанции прост: брать хуже нашей оценки нельзя, лучше или равно — можно.`,
  ])

  const riskPara = pickBy(seed + 'r', [
    `Риск-менеджмент: на этот выбор мы выделяем ${stake} из 10 юнитов — ${{ 61: 'умеренный', 69: 'повышенный', 70: 'уверенный' }[confidence] ?? 'сбалансированный'} размер для уверенности ${confidence}%. Никогда не повышайте сумму только потому, что «очень хочется»: дистанция наказывает за эмоции.`,
    `Размер ставки — ${stake} юнитов при уверенности ${confidence}%. Правило простое: уверенность растёт — размер растёт плавно; уверенность падает — размер режется сразу. Один матч не должен решать исход недели.`,
    `${stake} юнитов на ${confidence}% уверенности — расчётный размер. Напомним базовое правило банка: единица — это фиксированный процент от банкролла, а не «сколько не жалко». Именно так переживаются серии из 3–4 минусов подряд.`,
  ])

  const watchPara = pickBy(seed + 'w', [
    `За чем следить в матче: первые 15 минут покажут, кто контролирует темп. Если всё пойдёт по нашему сценарию, коэффициент на соседние рынки просядет уже к перерыву — поздний вход будет менее выгодным.`,
    `Что может сломать прогноз: ранний гол в «неудобную» сторону меняет всю геометрию матча, а красная карточка или погодный фактор вообще обнуляет предматчевую логику. Мы учитывали это при выборе рынка — он устойчивее к сценарным качелям.`,
    `Дополнительный аргумент: домашние матчи ${h} традиционно громче на трибунах, но ${a} в последних выездах не садились в оборону. Это усиливает выбранный рынок: сценарий «ничего не происходит» здесь маловероятен.`,
  ])

  const outro = pickBy(seed + 'f', [
    `Итог: выбор «${selection}» остаётся нашей основной позицией в этом матче. Поставите или просто последите за игрой — разбор останется актуальным до старта. Честный итог по счёту будет в истории прогнозов.`,
    `Итог: «${selection}» в матче «${h} — ${a}» — ставка дня с полным разбором. Результат посчитаем по настоящему счёту и честно покажем в статистике — как всегда.`,
    `Финальная точка: наш выбор — ${selection}, размер — ${stake} юнитов, примерный кэф — ${odds.toFixed(2)}. Разбор закончен, мяч на стороне матча. Спасибо, что читаете.`,
  ])

  const content = [
    lead,
    logic,
    oddsPara,
    riskPara,
    watchPara,
    outro,
  ].join('\n\n')

  return {
    // Дата в слаге — дата МАТЧА: один матч → один слаг в любой день создания
    slug: `razbor-${mskDateOf(bet.matchDate.getTime())}-${slugifyTeams(h, a)}`,
    title,
    excerpt,
    content,
    category: 'Разбор матча',
    sport: bet.sport,
    matchRef,
    readMinutes: 4,
    authorId: bet.tipsterId,
  }
}

/* ---------- Вид 2: итоги расчётного дня ---------- */

function makeDaySummary(
  bets: (Bet & { tipster: Tipster | null })[],
  dayStartUtc: Date,
): {
  slug: string
  title: string
  excerpt: string
  content: string
  category: string
  sport: string
  matchRef: null
  readMinutes: number
  authorId: string | null
} | null {
  if (bets.length === 0) return null

  const decided = bets.filter((b) => b.status === 'won' || b.status === 'lost')
  if (decided.length === 0) return null

  const won = decided.filter((b) => b.status === 'won')
  const lost = decided.filter((b) => b.status === 'lost')
  const voids = bets.filter((b) => b.status === 'void')
  const profit = decided.reduce((s, b) => s + (b.status === 'won' ? b.stake * (b.odds - 1) : -b.stake), 0)
  const dateLabel = mskDayLabel(dayStartUtc)

  // Заголовок честный: «в плюсе/в минусе» определяет ДЕНЬГАМ, а не счёту побед
  // (4:4 при крупных размерах может быть минусом)
  const title = profit >= 0
    ? `Итоги дня, ${dateLabel}: ${won.length} из ${decided.length} — в плюсе`
    : won.length >= lost.length
      ? `Итоги дня, ${dateLabel}: ${won.length} из ${decided.length} — в минусе, разбираем ошибки`
      : `Итоги дня, ${dateLabel}: ${decided.length - won.length} ${plural(decided.length - won.length, ['промах', 'промаха', 'промахов'])} — разбираем ошибки`

  const sign = profit >= 0 ? '+' : ''
  const winrate = Math.round((won.length / decided.length) * 100)

  const excerpts = [
    `День закрыт: ${won.length} зашло, ${lost.length} мимо, ${voids.length} возврат. Итог по банку — ${sign}${profit.toFixed(1)} юнита. Считаем без прикрас.`,
    `Честный отчёт за ${dateLabel}: попадание ${winrate}%, итог ${sign}${profit.toFixed(1)} юнита. Что сработало, а что нет — внутри.`,
  ]
  const excerpt = pickBy(dateLabel, excerpts)

  const paragraphs: string[] = []

  const lead = pickBy(dateLabel + 'l', [
    `Программа дня рассчитана по настоящим счётам: ${won.length} ${plural(won.length, ['прогноз сыграл', 'прогноза сыграли', 'прогнозов сыграли'])}, ${lost.length} ${plural(lost.length, ['не зашёл', 'не зашло', 'не зашли'])}${voids.length ? `, ${voids.length} ${plural(voids.length, ['возврат', 'возврата', 'возвратов'])}` : ''}. Итог по банку: ${sign}${profit.toFixed(1)} юнита при среднем размере ${(decided.reduce((s, b) => s + b.stake, 0) / decided.length).toFixed(1)} юнита.`,
    `Игровой день закрыт, все события рассчитаны по реальным результатам. Винрейт дня — ${winrate}% (${won.length} из ${decided.length}), движение банка — ${sign}${profit.toFixed(1)} юнита. Ниже — по каждому матчу.`,
  ])
  paragraphs.push(lead)

  for (const b of decided) {
    const res = b.status === 'won' ? 'Зашло' : 'Не зашло'
    const delta = b.status === 'won' ? b.stake * (b.odds - 1) : -b.stake
    const note = b.resultNote?.trim() || (b.status === 'won' ? 'Прогноз сыграл.' : 'Прогноз не сыграл.')
    const author = b.tipster ? `, автор — ${b.tipster.name}` : ''
    paragraphs.push(
      `${res}: «${b.selection}» в матче ${b.homeTeam} — ${b.awayTeam} (${b.league}, ≈${b.odds.toFixed(2)}). ${note} Движение: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} юнита${author}.`,
    )
  }

  const lesson = profit >= 0
    ? pickBy(dateLabel + 'lp', [
      `Что сработало: дисциплина по размерам. Ни одна ставка дня не превышала расчётный размер, поэтому даже минусные исходы не пробили дневную просадку. Так и выглядит дистанция — без подвигов, но в плюсе.`,
      `Хороший день — но без эйфории: серия побед не повод повышать единицу. Правило дистанции простое: размер меняется раз в месяц по статистике, а не после каждого плюсового дня.`,
    ])
    : pickBy(dateLabel + 'ln', [
      `Что пошло не так: вечерний сценарий перевернул утреннюю логику — классика спортивных ставок. Важно, что размеры были выдержаны: просадка дня осталась в пределах нормы. Один минусовой день не отменяет месяц.`,
      `Минусовой день — часть работы. Разбор показывает: исходы решались тонкими деталями, а не грубыми ошибками в логике. Держим размер, держим дисциплину, завтра новая программа.`,
    ])
  paragraphs.push(lesson)

  const outro = `Полная история расчётов с фильтрами по виду спорта и аналитику — на вкладке «История». Завтра новая программа: расписание уже в разделе «Завтра в спорте». 18+, играйте ответственно.`
  paragraphs.push(outro)

  return {
    slug: `itogi-${mskDateOf(dayStartUtc.getTime())}`,
    title,
    excerpt,
    content: paragraphs.join('\n\n'),
    category: 'Итоги дня',
    sport: 'football', // сводная по всем видам — спорт не отображаем отдельно
    matchRef: null,
    readMinutes: 3,
    authorId: null,
  }
}

/** Сигнатура расчётов дня: «W-L-V-N» — меняется при каждом новом результате */
function daySummarySig(bets: (Bet & { tipster: Tipster | null })[]): string {
  let won = 0
  let lost = 0
  let voids = 0
  for (const b of bets) {
    if (b.status === 'won') won++
    else if (b.status === 'lost') lost++
    else if (b.status === 'void') voids++
  }
  return `${won}-${lost}-${voids}-${bets.length}`
}

/* ---------- Вид 3: взгляд на завтра ---------- */

function makeTomorrowPreview(
  bets: (Bet & { tipster: Tipster | null })[],
): {
  slug: string
  title: string
  excerpt: string
  content: string
  category: string
  sport: string
  matchRef: string | null
  readMinutes: number
  authorId: string | null
} | null {
  if (bets.length < 2) return null

  const top = bets[0]
  const dateLabel = mskDayLabel(new Date(top.matchDate))

  const title = `Что смотреть завтра, ${dateLabel}: ${top.homeTeam} — ${top.awayTeam} и не только`

  const excerpts = [
    `Завтрашняя программа из ${bets.length} ${plural(bets.length, ['прогноза', 'прогнозов', 'прогнозов'])}: от ${top.league} до вечерних матчей. Главное событие и все выборы — в превью.`,
    `${bets.length} ${plural(bets.length, ['выбор', 'выбора', 'выборов'])} на завтра уже в ленте. Начинаем с «${top.homeTeam} — ${top.awayTeam}» — и идём по всей связке.`,
  ]
  const excerpt = pickBy(dateLabel + 'z', excerpts)

  const paragraphs: string[] = []

  paragraphs.push(
    pickBy(dateLabel + 'zl', [
      `Завтрашний день богат на события: полное расписание уже доступно во вкладке «Завтра» в разделе живого расписания. Мы отобрали ${bets.length} ${plural(bets.length, ['матч', 'матча', 'матчей'])} с лучшим соотношением уверенности и примерного коэффициента.`,
      `Вечер — время планировать завтра. Из нескольких сотен событий мы выделили ${bets.length} ${plural(bets.length, ['матч', 'матча', 'матчей'])}, где логика выбора читается чище всего. Вот программа.`,
    ]),
  )

  for (const b of bets) {
    const time = mskTime(b.matchDate)
    const author = b.tipster ? ` Выбор ${b.tipster.name} (${b.tipster.role}).` : ''
    paragraphs.push(
      `${time} МСК · ${b.league}. ${b.homeTeam} — ${b.awayTeam}: наш выбор «${b.selection}» с примерным кэфом ${b.odds.toFixed(2)} и уверенностью ${b.confidence}%.${author} ${b.analysis.trim()}`,
    )
  }

  paragraphs.push(
    pickBy(dateLabel + 'zo', [
      `План на день есть, размеры посчитаны. Напоминания о старте матчей можно включить колокольчиком на карточке прогноза — придёт уведомление за 10 минут до свистка. Спокойной ночи и удачного завтра.`,
      `Все выборы появятся в ленте «Прогнозы на сегодня» сразу после полуночи, а пока изучайте расписание и настраивайте напоминания. Завтра встретимся на итогах. 18+.`,
    ]),
  )

  return {
    slug: `zavtra-${mskDateStr()}`,
    title,
    excerpt,
    content: paragraphs.join('\n\n'),
    category: 'Взгляд на завтра',
    sport: top.sport,
    matchRef: `${top.homeTeam} — ${top.awayTeam}`,
    readMinutes: 4,
    authorId: null,
  }
}

/* ---------- LLM-обогащение (фолбэк — шаблонный текст) ---------- */

type ReviewDraft = ReturnType<typeof makeMatchReview>
type SummaryDraft = NonNullable<ReturnType<typeof makeDaySummary>>
type PreviewDraft = NonNullable<ReturnType<typeof makeTomorrowPreview>>

/** Спортивная разборка: полный текст (6 абзацев) пишет модель */
async function enrichReview(draft: ReviewDraft, bet: Bet & { tipster: Tipster | null }): Promise<ReviewDraft> {
  const author = bet.tipster ? `Аналитик: ${bet.tipster.name} (${bet.tipster.role}).` : 'Выбор редакции.'
  const user = `Подготовь разбор матча для читателей.
Данные:
- Матч: ${bet.homeTeam} — ${bet.awayTeam} (${bet.league}), старт ${mskTime(bet.matchDate)} МСК.
- Наш прогноз: «${bet.selection}» (рынок: ${bet.market}), примерный кэф ${bet.odds.toFixed(2)}.
- Размер: ${bet.stake} юнитов из 10 при уверенности ${bet.confidence}%.
- ${author}
- Аргумент аналитика: ${bet.analysis.trim()}

Напиши ровно 6 абзацев, разделённых пустой строкой:
1) вводный — почему этот матч интересен;
2) логика выбора — раскрой аргумент аналитика;
3) про примерный кэф и ценность ставки (сверяться с линией);
4) риск-менеджмент: почему именно такой размер при такой уверенности;
5) что может пойти не так и за чем следить по ходу матча;
6) короткий итог.
Общий объём 900–1400 символов. Факты — только из данных выше.
Запрещено: утверждения о турнирном положении, форме, мотивации и составе команд, если их нет в данных. Рассуждай условно: «если команда поведёт в счёте...», «при открытом сценарии...».`

  const text = await llmText(
    { system: EDITOR_SYSTEM_PROMPT, user, maxTokens: 900, temperature: 0.65 },
    (t) => !hasForeignGlitch(t),
  )
  const paragraphs = text ? llmParagraphs(text, 5) : null
  if (!paragraphs) return draft
  return { ...draft, content: paragraphs.slice(0, 7).join('\n\n'), readMinutes: 4 }
}

/** Итоги дня: модель пишет вступление и «урок дня», расчёты по ставкам — из данных */
async function enrichSummary(draft: SummaryDraft): Promise<SummaryDraft> {
  const paragraphs = draft.content.split('\n\n')
  const user = `Подготовь итоговый материал дня.
Факты из заголовка: «${draft.title}».
${paragraphs[0]}

Напиши ДВА абзаца, разделённых пустой строкой:
1) вступительный — живой итог дня по фактам выше (без пересказа каждой ставки);
2) «урок дня» — что сработало / что нет на дистанции, про дисциплину размеров и отсутствие паники после минуса.
400–700 символов. Факты — только из данных выше.`

  const text = await llmText(
    { system: EDITOR_SYSTEM_PROMPT, user, maxTokens: 500, temperature: 0.6 },
    (t) => !hasForeignGlitch(t),
  )
  const parts = text ? llmParagraphs(text, 2) : null
  if (!parts) return draft
  // Шаблонная структура: [лид, ...ставки, урок, аутро] — заменяем лид и урок
  const next = [...paragraphs]
  next[0] = parts[0]
  if (next.length >= 2) next[next.length - 2] = parts[1]
  return { ...draft, content: next.join('\n\n') }
}

/** Взгляд на завтра: модель пишет вступление и финал, матчи — из данных */
async function enrichPreview(draft: PreviewDraft): Promise<PreviewDraft> {
  const paragraphs = draft.content.split('\n\n')
  const user = `Подготовь вечернее превью завтрашней программы.
Заголовок: «${draft.title}».
Лид из данных: ${paragraphs[0]}

Напиши ДВА коротких абзаца, разделённых пустой строкой:
1) вступительный — почему стоит спланировать завтра заранее;
2) финальный — спокойный совет на вечер (планирование, напоминания о стартах, 18+).
300–500 символов.`

  const text = await llmText(
    { system: EDITOR_SYSTEM_PROMPT, user, maxTokens: 400, temperature: 0.6 },
    (t) => !hasForeignGlitch(t),
  )
  const parts = text ? llmParagraphs(text, 2) : null
  if (!parts) return draft
  const next = [...paragraphs]
  next[0] = parts[0]
  if (next.length >= 2) next[next.length - 1] = parts[1]
  return { ...draft, content: next.join('\n\n') }
}

/* ---------- Обеспечение свежести ---------- */

let inflight: Promise<void> | null = null

/** Максимум свежих разборов на московский день */
const MAX_REVIEWS_PER_DAY = 2

/** Окно московского дня: [startUtc, endUtc) и ключ даты «дд-ММ-гггг» */
function mskDayWindow(offsetDays: number): { startUtc: Date; endUtc: Date; dateKey: string } {
  const mskMs = Date.now() + MSK_OFFSET_MS - offsetDays * 24 * 60 * 60 * 1000
  const startUtc = new Date(mskMs)
  startUtc.setUTCHours(0, 0, 0, 0)
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000)
  return { startUtc, endUtc, dateKey: mskDateOf(startUtc.getTime()) }
}

/**
 * Генерирует и ПОДДЕРЖИВАЕТ материалы:
 *  - «Разбор матча»: лучший pending real-прогноз; дедуп по матчу (слаг с датой
 *    матча + matchRef), не более двух в день;
 *  - «Итоги дня»: для вчера и сегодня — создаются и ОБНОВЛЯЮТСЯ на месте,
 *    когда приходят новые расчёты (сигнатура W-L-V-N); сегодняшние —
 *    не раньше 12:00 МСК;
 *  - «Взгляд на завтра»: после 18:00 МСК по завтрашним real-прогнозам.
 * Идемпотентно: дедуп по slug, одновременный вызов — через inflight.
 */
export async function ensureFreshArticles(): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const now = new Date()
      const { startUtc: dayStartUtc, endUtc: dayEndUtc } = mskDayWindow(0)
      const { startUtc: prevStartUtc, endUtc: prevEndUtc } = mskDayWindow(1)

      const existing = await db.article.findMany({
        where: { publishedAt: { gte: dayStartUtc, lt: dayEndUtc } },
        select: { slug: true, category: true },
      })
      const slugs = new Set(existing.map((a) => a.slug))
      const havePreview = existing.some((a) => a.category === 'Взгляд на завтра')

      /* --- Разбор матча --- */
      const reviewsToday = existing.filter((a) => a.category === 'Разбор матча').length
      if (reviewsToday < MAX_REVIEWS_PER_DAY) {
        // Матчи, по которым уже есть разбор (за последние 3 дня) — не дублируем
        const recentReviews = await db.article.findMany({
          where: {
            category: 'Разбор матча',
            publishedAt: { gte: new Date(dayStartUtc.getTime() - 2 * 24 * 60 * 60 * 1000) },
          },
          select: { matchRef: true },
        })
        const reviewedMatches = new Set(recentReviews.map((a) => a.matchRef))

        const reviewCandidates = await db.bet.findMany({
          where: {
            isRealMatch: true,
            status: 'pending',
            matchDate: { gte: dayStartUtc },
          },
          include: { tipster: true },
          orderBy: [{ isBetOfDay: 'desc' }, { confidence: 'desc' }],
          take: 12,
        })
        const notStarted = reviewCandidates.filter(
          (b) => b.matchDate.getTime() > now.getTime() + 30 * 60 * 1000,
        )
        const pool = notStarted.length > 0 ? notStarted : reviewCandidates
        const reviewBet = pool.find((b) => !reviewedMatches.has(`${b.homeTeam} — ${b.awayTeam}`))
        if (reviewBet) {
          const template = makeMatchReview(reviewBet)
          if (!slugs.has(template.slug)) {
            // LLM-обогащение: живой текст вместо шаблона (сбой → шаблон)
            const draft = await enrichReview(template, reviewBet)
            await db.article.create({ data: draft }).catch(() => undefined) // slug-конфликт → пропускаем
            slugs.add(draft.slug)
          }
        }
      }

      /* --- Итоги дня: вчера (полный пересчёт после ночного цикла) + сегодня --- */
      for (const [startUtc, endUtc, isToday] of [
        [prevStartUtc, prevEndUtc, false],
        [dayStartUtc, dayEndUtc, true],
      ] as const) {
        const resolved = await db.bet.findMany({
          where: {
            isRealMatch: true,
            status: { in: ['won', 'lost', 'void'] },
            matchDate: { gte: startUtc, lt: endUtc },
          },
          include: { tipster: true },
          orderBy: { matchDate: 'asc' },
          take: 12,
        })
        if (resolved.length === 0) continue
        // Дневные итоги публикуем с полудня, чтобы материал не рождался пустым
        if (isToday && mskHour(now) < 12) continue

        const draft = makeDaySummary(resolved, startUtc)
        if (!draft) continue
        const sig = daySummarySig(resolved)
        const current = await db.article.findUnique({
          where: { slug: draft.slug },
          select: { id: true, contentSig: true },
        })
        if (!current) {
          if (!slugs.has(draft.slug)) {
            // LLM пишет лид и «урок дня»; расчёты по ставкам — детерминированные
            const enriched = await enrichSummary(draft)
            await db.article.create({ data: { ...enriched, contentSig: sig } }).catch(() => undefined)
            slugs.add(enriched.slug)
          }
        } else if (current.contentSig !== sig) {
          // Пришли новые результаты — переписываем материал на месте,
          // publishedAt сохраняем (позиция в ленте не прыгает)
          const enriched = await enrichSummary(draft)
          await db.article
            .update({
              where: { id: current.id },
              data: { title: enriched.title, excerpt: enriched.excerpt, content: enriched.content, contentSig: sig },
            })
            .catch(() => undefined)
        }
      }

      // --- Взгляд на завтра: после 18:00 МСК, из завтрашних real-прогнозов ---
      if (!havePreview && mskHour(now) >= 18) {
        const endOfTomorrow = new Date(dayEndUtc.getTime() + 24 * 60 * 60 * 1000)
        const tomorrowBets = await db.bet.findMany({
          where: {
            isRealMatch: true,
            status: 'pending',
            matchDate: { gte: dayEndUtc, lt: endOfTomorrow },
          },
          include: { tipster: true },
          orderBy: { confidence: 'desc' },
          take: 5,
        })
        const template = makeTomorrowPreview(tomorrowBets)
        if (template && !slugs.has(template.slug)) {
          const draft = await enrichPreview(template)
          await db.article.create({ data: draft }).catch(() => undefined)
        }
      }

    } catch (e) {
      console.error('ensureFreshArticles error:', e)
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** Последние материалы для ленты (с автором) */
export async function listArticles(limit = 6) {
  return db.article.findMany({
    include: { author: true },
    orderBy: { publishedAt: 'desc' },
    take: limit,
  })
}

/** Всего материалов в архиве */
export async function countArticles(): Promise<number> {
  return db.article.count()
}
