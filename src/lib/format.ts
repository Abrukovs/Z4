import { parseISO } from 'date-fns'
import type { BetStatus } from '@/lib/types'

// Числа — с точкой как в букмекерских котировках (2.45), даты — по-русски.
// ВАЖНО: весь сайт оперирует московским временем (источники, расчёты дней,
// подписи «(МСК)») — поэтому даты и время рендерим в Europe/Moscow
// независимо от часового пояса браузера пользователя.

const MSK_TZ = 'Europe/Moscow'

/** Сдвиг МСК от UTC в миллисекундах (в Москве нет сезонных переводов) */
export const MSK_OFFSET_MS = 3 * 60 * 60 * 1000

/**
 * Полночь МОСКОВСКИХ суток. Баг 25.10 («экспресс субботы не зашёл»):
 * границы «дня» везде были UTC-полуночью — матчи 00:00–03:00 МСК
 * прилипали к прошлому дню (Бостон 02:00 МСК уезжал в пятничный разбор,
 * экспресс субботы «терял» ноги). Единая точка правды для всех окон.
 */
export function mskStartOfDay(d = new Date()): Date {
  return new Date(
    Math.floor((d.getTime() + MSK_OFFSET_MS) / 86400e3) * 86400e3 - MSK_OFFSET_MS,
  )
}

/** Ключ московских суток «YYYY-MM-DD» (для группировки дней по МСК) */
export function mskDayKey(d = new Date()): string {
  const msk = new Date(d.getTime() + MSK_OFFSET_MS)
  return `${msk.getUTCFullYear()}-${String(msk.getUTCMonth() + 1).padStart(2, '0')}-${String(msk.getUTCDate()).padStart(2, '0')}`
}

const MONTHS_FULL = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
] as const
const MONTHS_SHORT = [
  'янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.',
  'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.',
] as const

/** Календарные компоненты (день/месяц/час/минута) в МСК для ISO-строки или Date */
function mskParts(value: string | Date): { d: number; m: number; hh: string; mm: string } {
  // Даты без времени ('YYYY-MM-DD') парсим как UTC-полночь, чтобы день не «прыгал» в других TZ
  const date =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00Z`)
      : typeof value === 'string'
        ? parseISO(value)
        : value
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: MSK_TZ,
    day: 'numeric',
    month: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date)
  const num = (t: Intl.DateTimeFormatPart['type']) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0)
  return {
    d: num('day'),
    m: num('month'),
    hh: String(num('hour')).padStart(2, '0'),
    mm: String(num('minute')).padStart(2, '0'),
  }
}

export function fmtOdds(v: number): string {
  return v.toFixed(2)
}

export function fmtUnits(v: number, withSign = true): string {
  const s = v.toFixed(2)
  return withSign && v > 0 ? `+${s}` : s
}

export function fmtPct(v: number, digits = 0): string {
  return `${v.toFixed(digits)}%`
}

/** «4 сентября, 17:05» — по МСК */
export function fmtDateTime(iso: string | Date): string {
  const p = mskParts(iso)
  return `${p.d} ${MONTHS_FULL[p.m - 1]}, ${p.hh}:${p.mm}`
}

/** «4 сентября» — по МСК */
export function fmtFullDate(iso: string | Date): string {
  const p = mskParts(iso)
  return `${p.d} ${MONTHS_FULL[p.m - 1]}`
}

/** «4 сент.» — по МСК */
export function fmtShortDate(iso: string | Date): string {
  const p = mskParts(iso)
  return `${p.d} ${MONTHS_SHORT[p.m - 1]}`
}

/** «17:05» — по МСК */
export function fmtTime(iso: string | Date): string {
  const p = mskParts(iso)
  return `${p.hh}:${p.mm}`
}

/** «Через 2 ч 15 мин» / «Матч начался» */
export function fmtFromNow(iso: string, now: number): string {
  const diff = new Date(iso).getTime() - now
  if (diff <= 0) return 'Матч начался'
  const hours = Math.floor(diff / 3_600_000)
  const minutes = Math.floor((diff % 3_600_000) / 60_000)
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    return `Через ${days} ${plural(days, ['день', 'дня', 'дней'])}`
  }
  if (hours > 0) return `Через ${hours} ч ${minutes} мин`
  if (minutes > 0) return `Через ${minutes} ${plural(minutes, ['минуту', 'минуты', 'минут'])}`
  return 'Начинается'
}

/** «02:14:35» */
export function fmtCountdown(iso: string, now: number): string {
  const diff = Math.max(0, new Date(iso).getTime() - now)
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  const s = Math.floor((diff % 60_000) / 1000)
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

/** Русская плюрализация: plural(3, ['прогноз', 'прогноза', 'прогнозов']) */
export function plural(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100
  const d = abs % 10
  if (abs > 10 && abs < 20) return forms[2]
  if (d > 1 && d < 5) return forms[1]
  if (d === 1) return forms[0]
  return forms[2]
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

export interface ConfidenceMeta {
  label: string
  className: string
}

/** Низкая <60 / Средняя 60–79 / Высокая ≥80 */
export function confidenceMeta(c: number): ConfidenceMeta {
  if (c >= 80) return { label: 'Высокая', className: 'text-emerald-400' }
  if (c >= 60) return { label: 'Средняя', className: 'text-amber-400' }
  return { label: 'Низкая', className: 'text-rose-400' }
}

export const STATUS_META: Record<
  BetStatus,
  { label: string; className: string; dot: string }
> = {
  won: {
    label: 'Выигрыш',
    className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    dot: 'bg-emerald-400',
  },
  lost: {
    label: 'Проигрыш',
    className: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    dot: 'bg-rose-400',
  },
  void: {
    label: 'Возврат',
    className: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
    dot: 'bg-zinc-400',
  },
  pending: {
    label: 'Ожидается',
    className: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    dot: 'bg-amber-400',
  },
}

/** Итог ставки в юнитах: выиграла +2.10 / проиграла -1.00 / возврат 0.00 */
export function betOutcome(status: string, stake: number, odds: number): number {
  if (status === 'won') return stake * (odds - 1)
  if (status === 'lost') return -stake
  return 0
}

/** «Реальный счёт 3:2 ОТ — прогноз сыграл…» → «3:2 ОТ» — для показа прямо в строке */
export function scoreOf(note: string | null | undefined): string | null {
  if (!note) return null
  const m = note.match(/сч[её]т\s+([^—·]+)/i)
  if (!m) return null
  const s = m[1].replace(/\s+/g, ' ').trim()
  return s.length > 0 ? s.slice(0, 30) : null
}
