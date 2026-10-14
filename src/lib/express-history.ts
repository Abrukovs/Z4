import type { Bet, Tipster } from '@prisma/client'
import type { BetStatus } from '@/lib/types'

/** Прогноз с аналитиком — как его отдают findMany({ include: { tipster: true } }) */
export type BetWithTipster = Bet & { tipster: Tipster | null }

/** Ставка на комбинацию «Экспресс дня» (юниты) */
export const EXPRESS_STAKE = 10

export interface ExpressDay {
  /** День матчей, YYYY-MM-DD */
  date: string
  /** Итог дня: won / lost / void / pending (ещё в игре) */
  status: BetStatus
  /** Чистый итог дня в юнитах (null — день ещё в игре) */
  profit: number | null
  /** Произведение коэффициентов всех ног дня */
  totalOdds: number
  /** Ноги дня (полные прогнозы): клик по ноге открывает разбор */
  legs: BetWithTipster[]
}

export interface ExpressDaysTotals {
  won: number
  lost: number
  void: number
  pending: number
  profit: number
}

export interface ExpressDaysResult {
  /** Дни — от свежих к старым (ключ YYYY-MM-DD сортируется лексикографически) */
  days: ExpressDay[]
  totals: ExpressDaysTotals
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * Ретроспектива «Экспресса дня»: топ-3 пика дня по уверенности (без ставки
 * дня), по EXPRESS_STAKE юнитов на комбинацию — ровно как живой /api/express
 * собирает текущую комбинацию. День:
 *  зашёл  — ни одна нога не проиграла (возврат выбрасывает ногу из кэфа);
 *  не зашёл — есть проигравшая нога; все ноги возвраты — возврат дня.
 * Дни с ещё не рассчитанными ногами считаются «в игре» и в итог не идут.
 *
 * Единая логика для /api/stats (полная история) и /api/express (последние
 * дни в карточке на главной) — вердикты всегда совпадают.
 */
export function computeExpressDays(bets: BetWithTipster[]): ExpressDaysResult {
  const byDay = new Map<string, BetWithTipster[]>()
  for (const b of bets) {
    if (b.isBetOfDay) continue
    const key = dayKey(startOfDay(b.matchDate))
    const list = byDay.get(key)
    if (list) list.push(b)
    else byDay.set(key, [b])
  }
  const dayEntries = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))

  const days: ExpressDay[] = []
  const totals: ExpressDaysTotals = { won: 0, lost: 0, void: 0, pending: 0, profit: 0 }

  for (const [key, dayBets] of dayEntries) {
    const legs = [...dayBets].sort((a, b) => b.confidence - a.confidence).slice(0, 3)
    if (legs.length < 2) continue // экспресс собирается минимум из 2 ног
    const totalOdds = round2(legs.reduce((p, l) => p * l.odds, 1))
    if (legs.some((l) => l.status === 'pending')) {
      totals.pending++
      days.push({ date: key, status: 'pending', profit: null, totalOdds, legs })
      continue
    }
    if (legs.some((l) => l.status === 'lost')) {
      totals.lost++
      totals.profit -= EXPRESS_STAKE
      days.push({ date: key, status: 'lost', profit: -EXPRESS_STAKE, totalOdds, legs })
      continue
    }
    const effectiveOdds = legs
      .filter((l) => l.status === 'won')
      .reduce((p, l) => p * l.odds, 1)
    if (effectiveOdds > 1) {
      totals.won++
      const dayProfit = EXPRESS_STAKE * (effectiveOdds - 1)
      totals.profit += dayProfit
      days.push({ date: key, status: 'won', profit: round2(dayProfit), totalOdds, legs })
    } else {
      totals.void++
      days.push({ date: key, status: 'void', profit: 0, totalOdds, legs })
    }
  }

  return { days, totals }
}

/** Прошедшие (рассчитанные) дни экспресса — для карточки на главной */
export function finishedExpressDays(days: ExpressDay[], limit: number): ExpressDay[] {
  return days.filter((d) => d.status !== 'pending').slice(0, limit)
}
