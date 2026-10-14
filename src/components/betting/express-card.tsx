'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Dumbbell,
  History,
  Layers,
  Maximize2,
  Share2,
  TrendingUp,
  Undo2,
  Wallet,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { SportGlyph } from '@/components/betting/sport-chip'
import { LiveIndicator } from '@/components/betting/live-indicator'
import { BetDetailsDialog } from '@/components/betting/bet-details-dialog'
import { useNow } from '@/components/betting/use-now'
import { SPORTS, SPORT_COLORS } from '@/lib/sports'
import { fmtOdds, fmtTime, fmtUnits, plural, scoreOf } from '@/lib/format'
import type {
  BetDto,
  BetStatus,
  ExpressDayStat,
  ExpressDto,
  ExpressLegDto,
} from '@/lib/types'
import { cn } from '@/lib/utils'

/** Нога из завтрашнего расписания — календарный день отличается */
function isTomorrowLeg(leg: ExpressLegDto, now: number): boolean {
  return new Date(leg.matchDate).toDateString() !== new Date(now).toDateString()
}

/** Одна нога текущего экспресса: матч, чемпионат, выбор, время и примерный кэф */
function ExpressLeg({ leg, index }: { leg: ExpressLegDto; index: number }) {
  const now = useNow(60_000)
  const tomorrow = now !== null && isTomorrowLeg(leg, now)
  const starting = now !== null && new Date(leg.matchDate).getTime() - now < 30 * 60_000
  // Вид спорта и чемпионат: видно «откуда матч» (запрос пользователя)
  const sportColor = SPORT_COLORS[leg.sport] ?? '#10b981'
  const SportIcon = SPORTS[leg.sport]?.icon ?? Dumbbell
  const sportName = SPORTS[leg.sport]?.label ?? 'Спорт'

  return (
    <li
      className="flex items-center gap-3 rounded-xl border border-amber-500/15 bg-zinc-100 p-3 transition-colors duration-200 hover:border-amber-500/30 hover:bg-zinc-100 md:gap-4 md:p-3.5"
      aria-label={`Нога ${index + 1}: ${sportName}, ${leg.league}, ${leg.homeTeam} — ${leg.awayTeam}, ${leg.selection}, коэффициент ≈${fmtOdds(leg.odds)}`}
    >
      {/* Номер ноги */}
      <span
        aria-hidden
        className="grid size-7 shrink-0 place-items-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs font-bold text-amber-600 tabular-nums"
      >
        {index + 1}
      </span>

      {/* Матч, выбор и чемпионат */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-zinc-900">
          {leg.homeTeam} — {leg.awayTeam}
        </p>
        <p className="truncate text-xs text-zinc-600" title={leg.selection}>
          {leg.selection}
        </p>
        {/* Откуда матч: вид спорта + чемпионат */}
        <p
          className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-none text-zinc-500"
          title={`${sportName} · ${leg.league}`}
        >
          <span
            className="grid size-4 shrink-0 place-items-center rounded"
            style={{ backgroundColor: `${sportColor}1f`, color: sportColor }}
            aria-hidden
          >
            <SportIcon className="size-2.5" />
          </span>
          <span className="shrink-0 font-semibold" style={{ color: sportColor }}>
            {sportName}
          </span>
          <span aria-hidden className="text-zinc-300">·</span>
          <span className="min-w-0 truncate">{leg.league}</span>
        </p>
        {leg.liveInfo ? (
          <LiveIndicator
            phase={leg.liveInfo.phase}
            score={leg.liveInfo.score}
            size="xs"
            className="mt-1"
          />
        ) : null}
      </div>

      {/* Время и кэф */}
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span
          className={
            tomorrow
              ? 'inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600'
              : 'text-[11px] font-semibold text-zinc-600'
          }
        >
          {tomorrow && <CalendarDays className="size-3" aria-hidden />}
          {tomorrow ? 'завтра, ' : ''}
          {fmtTime(leg.matchDate)}
          {!tomorrow && starting ? ' · скоро' : ''}
        </span>
        <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-sm font-bold text-amber-600 tabular-nums">
          ≈{fmtOdds(leg.odds)}
        </span>
      </div>
    </li>
  )
}

/* ---------- Прошедшие экспрессы: какие исходы были в каждой комбинации ---------- */

/** «16 сентября, вт» — день недели не «прыгает» в чужих часовых поясах */
function expressDayLabel(date: string): string {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    weekday: 'short',
  }).formatToParts(new Date(`${date}T00:00:00Z`))
  const get = (t: Intl.DateTimeFormatPart['type']) =>
    parts.find((p) => p.type === t)?.value ?? ''
  return `${get('day')} ${get('month')}, ${get('weekday')}`
}

const DAY_PILL: Record<BetStatus, { label: string; pill: string; accent: string }> = {
  won: {
    label: 'зашёл',
    pill: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
    accent: 'border-l-emerald-500',
  },
  lost: {
    label: 'не зашёл',
    pill: 'border-rose-500/30 bg-rose-500/10 text-rose-700',
    accent: 'border-l-rose-500',
  },
  void: {
    label: 'возврат',
    pill: 'border-zinc-400/40 bg-zinc-400/10 text-zinc-600',
    accent: 'border-l-zinc-400',
  },
  pending: {
    label: 'в игре',
    pill: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
    accent: 'border-l-amber-400',
  },
}

const LEG_ICON: Record<BetStatus, LucideIcon> = {
  won: CheckCircle2,
  lost: XCircle,
  void: Undo2,
  pending: History,
}

const LEG_ICON_CLS: Record<BetStatus, string> = {
  won: 'text-emerald-600',
  lost: 'text-rose-600',
  void: 'text-zinc-400',
  pending: 'text-amber-600',
}

/** Нога прошедшего экспресса: исход, счёт матча и кэф — клик открывает разбор */
function HistoryLegRow({ leg, onSelect }: { leg: BetDto; onSelect: (b: BetDto) => void }) {
  const StatusIcon = LEG_ICON[leg.status]
  const color = SPORT_COLORS[leg.sport] ?? '#10b981'
  const SportIcon = SPORTS[leg.sport]?.icon ?? Dumbbell
  const score = scoreOf(leg.resultNote)
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(leg)}
        data-history-leg={leg.id}
        aria-label={`Разбор: ${leg.homeTeam} — ${leg.awayTeam}, ${leg.selection}`}
        title="Открыть разбор прогноза"
        className="group flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-amber-50/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
      >
        <StatusIcon
          className={cn('size-4 shrink-0', LEG_ICON_CLS[leg.status])}
          aria-label={DAY_PILL[leg.status].label}
        />
        <span
          className="grid size-6 shrink-0 place-items-center rounded"
          style={{ backgroundColor: `${color}1f`, color }}
          aria-hidden
        >
          <SportIcon className="size-3" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-tight">
          <span className="truncate text-xs text-zinc-600">
            <span className="font-semibold text-zinc-900">
              {leg.homeTeam} — {leg.awayTeam}
            </span>
            <span className="text-zinc-400"> · </span>
            {leg.selection}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-[10px] text-zinc-400">
            <span className="shrink-0 tabular-nums">{fmtTime(leg.matchDate)}</span>
            <span className="min-w-0 truncate">{leg.league}</span>
            {score ? (
              <span
                className={cn(
                  'shrink-0 font-bold tabular-nums',
                  leg.status === 'won'
                    ? 'text-emerald-600'
                    : leg.status === 'lost'
                      ? 'text-rose-600'
                      : 'text-zinc-400',
                )}
              >
                счёт {score}
              </span>
            ) : null}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[11px] font-semibold text-amber-600 tabular-nums">
          ≈{fmtOdds(leg.odds)}
        </span>
        <Maximize2
          className="size-3 shrink-0 text-zinc-300 transition-colors group-hover:text-amber-500"
          aria-hidden
        />
      </button>
    </li>
  )
}

/** Один прошедший день экспресса: итог + исходы всех ног со счетами */
function HistoryDayItem({
  day,
  onSelect,
  delay,
}: {
  day: ExpressDayStat
  onSelect: (b: BetDto) => void
  delay: number
}) {
  const legsWon = day.legs.filter((l) => l.status === 'won').length
  const legsLost = day.legs.filter((l) => l.status === 'lost').length
  const meta = DAY_PILL[day.status]
  return (
    <motion.div
      role="listitem"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay }}
      className={cn(
        'shrink-0 overflow-hidden rounded-xl border border-zinc-200 border-l-2 bg-white',
        meta.accent,
      )}
      data-history-day={day.date}
    >
      {/* Итог дня: дата, число событий, кэф, что зашло / не зашло */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-zinc-100 bg-amber-500/[0.05] px-3 py-2">
        <span className="text-xs font-bold text-zinc-900">{expressDayLabel(day.date)}</span>
        <span className="text-[11px] text-zinc-500">
          {day.legs.length} {plural(day.legs.length, ['событие', 'события', 'событий'])} ·{' '}
          <span className="font-mono font-semibold text-amber-600 tabular-nums">
            ≈{fmtOdds(day.totalOdds)}
          </span>{' '}
          · 10 юн.
        </span>
        {(legsWon > 0 || legsLost > 0) && (
          <span className="flex items-center gap-1.5 text-[10px] font-bold">
            {legsWon > 0 && <span className="text-emerald-600">{legsWon} зашло</span>}
            {legsLost > 0 && <span className="text-rose-600">{legsLost} не зашло</span>}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] font-bold',
              meta.pill,
            )}
          >
            {meta.label}
          </span>
          {day.profit !== null && (
            <span
              className={cn(
                'font-mono text-[11px] font-bold tabular-nums',
                day.profit > 0
                  ? 'text-emerald-600'
                  : day.profit < 0
                    ? 'text-rose-600'
                    : 'text-zinc-400',
              )}
            >
              {fmtUnits(day.profit)} юн.
            </span>
          )}
        </span>
      </div>
      {/* Ноги: что именно было в комбинации и как сыграло */}
      <ul className="divide-y divide-zinc-100">
        {day.legs.map((leg) => (
          <HistoryLegRow key={leg.id} leg={leg} onSelect={onSelect} />
        ))}
      </ul>
    </motion.div>
  )
}

/**
 * Прошедшие экспрессы: последние рассчитанные дни с полным составом
 * комбинации — видно, какие исходы зашли, какие нет, с реальными счётами.
 */
function ExpressHistory({ days }: { days: ExpressDayStat[] }) {
  const [open, setOpen] = useState(true)
  const [selectedBet, setSelectedBet] = useState<BetDto | null>(null)

  const daysWon = days.filter((d) => d.status === 'won').length
  const daysLost = days.filter((d) => d.status === 'lost').length
  const profit = days.reduce((s, d) => s + (d.profit ?? 0), 0)

  return (
    <section
      aria-label="Прошедшие экспрессы с исходами"
      data-express-past
      className="border-t border-amber-500/15 pt-4"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="express-past-list"
        className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5 text-left transition-colors hover:border-amber-500/40 hover:bg-amber-500/[0.1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
      >
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-amber-500/30 bg-amber-500/10"
        >
          <History className="size-4 text-amber-600" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1 leading-tight">
          <span className="text-sm font-bold text-zinc-900">Прошедшие экспрессы</span>
          <span className="text-[11px] text-zinc-600">
            {days.length} {plural(days.length, ['день', 'дня', 'дней'])} · какие исходы были в
            каждой комбинации
          </span>
          {/* Мобильная сводка: чипы под заголовком, чтобы не обрезались */}
          <span className="flex flex-wrap items-center gap-1.5 md:hidden">
            {daysWon > 0 && (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                {daysWon} зашло
              </span>
            )}
            {daysLost > 0 && (
              <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                {daysLost} не зашло
              </span>
            )}
            <span
              className={cn(
                'font-mono text-[11px] font-bold tabular-nums',
                profit > 0 ? 'text-emerald-600' : profit < 0 ? 'text-rose-600' : 'text-zinc-500',
              )}
            >
              {fmtUnits(profit)} юн.
            </span>
          </span>
        </span>
        <span className="hidden shrink-0 items-center gap-1.5 md:flex">
          {daysWon > 0 && (
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
              {daysWon} зашло
            </span>
          )}
          {daysLost > 0 && (
            <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-700">
              {daysLost} не зашло
            </span>
          )}
          <span
            className={cn(
              'font-mono text-[11px] font-bold tabular-nums',
              profit > 0 ? 'text-emerald-600' : profit < 0 ? 'text-rose-600' : 'text-zinc-500',
            )}
          >
            {fmtUnits(profit)} юн.
          </span>
        </span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-zinc-400 transition-transform duration-200',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div
          id="express-past-list"
          className="dark-scrollbar mt-2.5 flex max-h-96 flex-col gap-2 overflow-y-auto pr-0.5"
          role="list"
          aria-label="Прошедшие дни экспресса дня"
        >
          {days.map((day, i) => (
            <HistoryDayItem
              key={day.date}
              day={day}
              onSelect={setSelectedBet}
              delay={Math.min(i, 6) * 0.05}
            />
          ))}
          <p className="px-1 py-0.5 text-[10px] text-zinc-400">
            Нажмите на событие — откроется разбор с итогом матча. Полная история экспрессов —
            во вкладке «Статистика».
          </p>
        </div>
      )}

      <BetDetailsDialog bet={selectedBet} onOpenChange={(o) => !o && setSelectedBet(null)} />
    </section>
  )
}

/**
 * «Экспресс дня» — виртуальная комбинация топ-пиков ленты.
 * Общий кэф — произведение примерных коэффициентов; честная пометка,
 * что это иллюстрация комбинации, а не линия букмекера.
 *
 * Ниже текущей комбинации — прошедшие экспрессы: состав каждой комбинации
 * и исход каждой ноги (зашло / не зашло, реальный счёт матча).
 */
export function ExpressCard({
  express,
  history = [],
}: {
  express: ExpressDto | null
  history?: ExpressDayStat[]
}) {
  const [shared, setShared] = useState(false)
  const sportGlyphs = useMemo(
    () => [...new Set((express?.legs ?? []).map((l) => l.sport))],
    [express],
  )

  const handleShare = async () => {
    if (!express) return
    const legsText = express.legs
      .map(
        (l, i) =>
          `${i + 1}. ${SPORTS[l.sport]?.label ?? 'Спорт'} · ${l.league} · ${l.homeTeam} — ${l.awayTeam} · ${l.selection} (≈${fmtOdds(l.odds)})`,
      )
      .join('\n')
    const text = `⚡ Экспресс дня — Ставка Дня\n${legsText}\nОбщий кэф ≈${fmtOdds(express.totalOdds)} · ${express.avgConfidence}% уверенность\n18+, коэффициенты примерные`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Экспресс дня — Ставка Дня', text })
      } else {
        await navigator.clipboard.writeText(text)
        toast.success('Экспресс скопирован в буфер обмена')
      }
      setShared(true)
      setTimeout(() => setShared(false), 2500)
    } catch (e) {
      // Пользователь отменил системный шер — не показываем ошибку
      if ((e as Error)?.name === 'AbortError') return
      toast.error('Не удалось поделиться экспрессом')
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      aria-label="Экспресс дня — комбинация лучших прогнозов"
      className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/[0.07] via-white to-white shadow-[0_16px_48px_-24px_rgba(245,158,11,0.35)]"
    >
      {/* Декор: свечение и верхняя градиентная кромка */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 right-0 size-64 rounded-full bg-amber-500/[0.08] blur-3xl"
      />
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent"
      />

      <div className="relative flex flex-col gap-5 p-5 md:p-6">
        {/* Шапка */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl border border-amber-500/40 bg-amber-500/15">
              <Layers className="size-5 text-amber-600" aria-hidden />
            </span>
            <div>
              <h3 className="text-base font-extrabold tracking-wide text-amber-700 md:text-lg">
                Экспресс дня
              </h3>
              <p className="text-xs text-zinc-600">
                {express ? (
                  <>
                    {express.legs.length}{' '}
                    {plural(express.legs.length, ['событие', 'события', 'событий'])} · лучшие
                    выборы аналитиков
                  </>
                ) : (
                  'новая комбинация собирается к ближайшим матчам'
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-zinc-600" aria-hidden>
              {sportGlyphs.map((s) => (
                <SportGlyph key={s} sport={s} className="size-4" />
              ))}
            </div>
            {express ? (
              <button
                type="button"
                onClick={() => void handleShare()}
                aria-label="Поделиться экспрессом дня"
                title="Поделиться экспрессом"
                className="inline-flex size-9 items-center justify-center rounded-lg border border-zinc-300/60 bg-zinc-200/70 text-zinc-500 transition-all hover:border-amber-500/40 hover:text-amber-600 active:scale-95"
              >
                <Share2 className={shared ? 'size-4 text-emerald-600' : 'size-4'} aria-hidden />
              </button>
            ) : null}
          </div>
        </div>

        {express ? (
          <div className="flex flex-col gap-5 lg:flex-row">
            {/* Ноги текущей комбинации */}
            <ul className="flex min-w-0 flex-1 flex-col gap-2.5">
              {express.legs.map((leg, i) => (
                <ExpressLeg key={leg.id} leg={leg} index={i} />
              ))}
            </ul>

            {/* Сводка */}
            <div className="flex shrink-0 flex-col gap-3 lg:w-72 lg:border-l lg:border-amber-500/15 lg:pl-5">
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.08] p-4 text-center">
                <p className="text-[11px] font-bold tracking-[0.18em] text-amber-600/80 uppercase">
                  Общий коэффициент
                </p>
                <p className="mt-1 font-mono text-4xl font-extrabold text-amber-600 tabular-nums">
                  ≈{fmtOdds(express.totalOdds)}
                </p>
                <p className="mt-1 text-[11px] text-zinc-600">
                  произведение примерных кэфов · средняя уверенность{' '}
                  {express.avgConfidence}%
                </p>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-100 px-4 py-3">
                <span className="flex items-center gap-2 text-xs text-zinc-600">
                  <Wallet className="size-4 text-zinc-600" aria-hidden />
                  При {express.stakeUnits} юнитах
                </span>
                <span className="font-mono text-sm font-bold text-zinc-900 tabular-nums">
                  ≈{express.payoutUnits.toFixed(1)} юн.
                </span>
              </div>

              <p className="flex items-start gap-2 text-[11px] leading-relaxed text-zinc-600">
                <TrendingUp className="mt-0.5 size-3.5 shrink-0 text-zinc-600" aria-hidden />
                Виртуальная комбинация для иллюстрации: коэффициенты примерные, итоги
                считаются по каждому матчу отдельно. 18+
              </p>
            </div>
          </div>
        ) : null}

        {/* Прошедшие экспрессы: состав комбинаций и исходы ног */}
        {history.length > 0 && <ExpressHistory days={history} />}
      </div>
    </motion.section>
  )
}
