'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import {
  CheckCircle2,
  ChevronDown,
  Dumbbell,
  History,
  Hourglass,
  Maximize2,
  Medal,
  Sparkles,
  Star,
  Trophy,
  Undo2,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CountUp } from '@/components/betting/count-up'
import { BetDetailsDialog } from '@/components/betting/bet-details-dialog'
import { SPORTS, SPORT_COLORS, sportLabel } from '@/lib/sports'
import type {
  BetDto,
  BetStatus,
  ExpressDayStat,
  FormatStat,
  SportStat,
  StatsResponse,
} from '@/lib/types'
import { betOutcome, fmtOdds, fmtShortDate, fmtTime, fmtUnits, plural, scoreOf } from '@/lib/format'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------------
   Общий итог статистики: сколько ставок зашло / не зашло, какой спорт
   прогнозируется лучше + отдельные итоги «Ставки дня» и «Экспресса дня».
   Первая секция вкладки «Статистика». Возвраты не влияют на проходимость.
------------------------------------------------------------------------- */

const WON_COLOR = '#10b981'

type TileTone = 'won' | 'lost' | 'void'

const TILE_TONES: Record<TileTone, { box: string; icon: string }> = {
  won: { box: 'border-emerald-200 bg-emerald-50/80', icon: 'text-emerald-600' },
  lost: { box: 'border-rose-200 bg-rose-50/80', icon: 'text-rose-600' },
  void: { box: 'border-zinc-200 bg-zinc-50', icon: 'text-zinc-500' },
}

function OutcomeTile({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: LucideIcon
  label: string
  value: number
  hint: string
  tone: TileTone
}) {
  const t = TILE_TONES[tone]
  return (
    <div className={cn('flex items-center gap-3 rounded-xl border p-3 sm:p-4', t.box)}>
      <Icon className={cn('size-6 shrink-0 sm:size-7', t.icon)} aria-hidden />
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="text-[11px] font-semibold tracking-wider text-zinc-600 uppercase">
          {label}
        </span>
        <span className="text-xl font-extrabold text-zinc-900 tabular-nums sm:text-2xl">
          <CountUp value={value} />
        </span>
        <span className="text-[11px] text-zinc-500">{hint}</span>
      </div>
    </div>
  )
}

/** Стековая полоса долей: зашло / не зашло / возвраты */
function ProportionBar({
  won,
  lost,
  voided,
  ariaLabel,
}: {
  won: number
  lost: number
  voided: number
  ariaLabel: string
}) {
  const settled = won + lost + voided
  if (settled === 0) return null
  const pct = (n: number) => (n / settled) * 100
  return (
    <div
      className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-100"
      role="img"
      aria-label={ariaLabel}
    >
      <div
        className="h-full bg-emerald-500 transition-[width] duration-700"
        style={{ width: `${pct(won)}%` }}
      />
      <div
        className="h-full bg-rose-500 transition-[width] duration-700"
        style={{ width: `${pct(lost)}%` }}
      />
      <div
        className="h-full bg-zinc-300 transition-[width] duration-700"
        style={{ width: `${pct(voided)}%` }}
      />
    </div>
  )
}

function winrateTone(v: number): string {
  if (v >= 55) return 'text-emerald-600'
  if (v >= 45) return 'text-amber-600'
  return 'text-rose-600'
}

/** Общая строка итога: иконка, зашло/не зашло, полоса, проходимость, прибыль */
function SummaryRow({
  icon: Icon,
  color,
  label,
  sublabel,
  badge,
  won,
  lost,
  voided,
  pendingNote,
  winrate,
  profit,
  footnote,
  delay,
  dataAttr,
  barAriaLabel,
  asListItem = true,
}: {
  icon: LucideIcon
  color: string
  label: string
  sublabel?: string
  badge?: { text: string; title: string }
  won: number
  lost: number
  voided: number
  pendingNote?: string
  winrate: number
  profit: number
  footnote?: string
  delay: number
  dataAttr?: { name: string; value: string }
  barAriaLabel: string
  /** false — когда роль listitem несёт внешняя обёртка (строка + подраздел) */
  asListItem?: boolean
}) {
  const decided = won + lost
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, margin: '-20px' }}
      transition={{ duration: 0.35, delay }}
      role={asListItem ? 'listitem' : undefined}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-zinc-200 bg-white/60 p-3 transition-colors hover:border-zinc-300 sm:p-3.5"
      {...(dataAttr ? { [dataAttr.name]: dataAttr.value } : {})}
    >
      {/* Название + счёт зашло/не зашло */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:flex-none sm:w-56">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-lg"
          style={{ backgroundColor: `${color}1f`, color }}
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-zinc-900">
            {label}
            {badge && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-white px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-emerald-700 uppercase"
                title={badge.title}
              >
                <Trophy className="size-3" aria-hidden />
                {badge.text}
              </span>
            )}
          </span>
          {sublabel && <span className="text-[10px] text-zinc-400">{sublabel}</span>}
          <span className="text-[11px] text-zinc-500 tabular-nums">
            <span className="font-semibold text-emerald-600">{won} зашло</span>
            <span className="text-zinc-400"> · </span>
            <span className="font-semibold text-rose-600">{lost} не зашло</span>
            {voided > 0 && <span className="text-zinc-400"> · {voided} возврат</span>}
            {pendingNote && <span className="text-zinc-400"> · {pendingNote}</span>}
          </span>
        </div>
      </div>

      {/* Полоса зашло/не зашло */}
      <div className="w-full min-w-[9rem] flex-1 sm:w-auto">
        <ProportionBar won={won} lost={lost} voided={voided} ariaLabel={barAriaLabel} />
        {footnote && <p className="mt-1 text-[10px] text-zinc-400">{footnote}</p>}
      </div>

      {/* Проходимость и прибыль */}
      <div className="ml-auto flex items-center gap-3 sm:ml-0 sm:w-44 sm:justify-end">
        <div className="flex flex-col items-end leading-tight">
          <span className={cn('text-base font-extrabold tabular-nums', winrateTone(winrate))}>
            {decided > 0 ? `${Math.round(winrate)}%` : '—'}
          </span>
          <span className="text-[10px] text-zinc-400">проходимость</span>
        </div>
        <div className="flex flex-col items-end leading-tight">
          <span
            className={cn(
              'text-sm font-bold font-mono tabular-nums',
              profit > 0 ? 'text-emerald-600' : profit < 0 ? 'text-rose-600' : 'text-zinc-500',
            )}
          >
            {fmtUnits(profit)} юн.
          </span>
          <span className="text-[10px] text-zinc-400">прибыль</span>
        </div>
      </div>
    </motion.div>
  )
}

/** Строка вида спорта (обёртка над SummaryRow) */
function SportRow({ stat, isBest, delay }: { stat: SportStat; isBest: boolean; delay: number }) {
  const meta = SPORTS[stat.sport]
  const decided = stat.won + stat.lost
  return (
    <SummaryRow
      icon={meta?.icon ?? Dumbbell}
      color={SPORT_COLORS[stat.sport] ?? WON_COLOR}
      label={sportLabel(stat.sport)}
      badge={isBest ? { text: 'Топ', title: 'Лучший спорт по проходимости' } : undefined}
      won={stat.won}
      lost={stat.lost}
      voided={stat.void}
      winrate={stat.winrate}
      profit={stat.profit}
      footnote={decided > 0 && decided < 3 ? 'малая выборка — итог ориентировочный' : undefined}
      delay={delay}
      dataAttr={{ name: 'data-sport-row', value: stat.sport }}
      barAriaLabel={`${sportLabel(stat.sport)}: ${stat.won} зашло, ${stat.lost} не зашло, ${stat.void} возвратов`}
    />
  )
}

/** Строка особого формата («Ставка дня» / «Экспресс дня») */
function FormatRow({
  stat,
  icon,
  color,
  label,
  sublabel,
  delay,
  rowKey,
}: {
  stat: FormatStat
  icon: LucideIcon
  color: string
  label: string
  sublabel: string
  delay: number
  rowKey: string
}) {
  return (
    <SummaryRow
      icon={icon}
      color={color}
      label={label}
      sublabel={sublabel}
      won={stat.won}
      lost={stat.lost}
      voided={stat.void}
      pendingNote={stat.pending > 0 ? `${stat.pending} в игре` : undefined}
      winrate={stat.winrate}
      profit={stat.profit}
      delay={delay}
      dataAttr={{ name: 'data-format-row', value: rowKey }}
      barAriaLabel={`${label}: ${stat.won} зашло, ${stat.lost} не зашло, ${stat.void} возвратов`}
      asListItem={false}
    />
  )
}

/* ----------------------------------------------------------------------
   Подразделы форматов: конкретные «Ставки дня» и дни «Экспресса дня».
   Каждая строка кликабельна и открывает полный разбор в диалоге.
----------------------------------------------------------------------- */

const OUTCOME_PILL: Record<BetStatus, { label: string; pill: string; dot: string }> = {
  won: { label: 'Зашло', pill: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  lost: { label: 'Не зашло', pill: 'border-rose-200 bg-rose-50 text-rose-600', dot: 'bg-rose-500' },
  void: { label: 'Возврат', pill: 'border-zinc-200 bg-zinc-50 text-zinc-500', dot: 'bg-zinc-400' },
  pending: { label: 'В игре', pill: 'border-amber-200 bg-amber-50 text-amber-600', dot: 'bg-amber-500' },
}

/** Компактный бейдж исхода в терминах раздела: зашло / не зашло / возврат / в игре */
function OutcomePill({ status }: { status: BetStatus }) {
  const m = OUTCOME_PILL[status]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold',
        m.pill,
      )}
    >
      <span className={cn('size-1.5 rounded-full', m.dot)} aria-hidden />
      {m.label}
    </span>
  )
}

const LEG_STATUS_ICON: Record<BetStatus, LucideIcon> = {
  won: CheckCircle2,
  lost: XCircle,
  void: Undo2,
  pending: Hourglass,
}
const LEG_STATUS_CLS: Record<BetStatus, string> = {
  won: 'text-emerald-500',
  lost: 'text-rose-500',
  void: 'text-zinc-400',
  pending: 'text-amber-500',
}

/** Шапка подраздела с переключателем сворачивания */
function HistoryHeader({
  title,
  countLabel,
  open,
  onToggle,
  toggleKey,
}: {
  title: string
  countLabel: string
  open: boolean
  onToggle: () => void
  toggleKey: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      data-history-toggle={toggleKey}
      className="group flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-2.5 py-2 text-left transition-colors hover:border-emerald-400/70 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
    >
      <History className="size-3.5 shrink-0 text-amber-500" aria-hidden />
      <span className="text-[11px] font-bold tracking-wider text-zinc-600 uppercase">{title}</span>
      <span className="text-[10px] font-medium text-zinc-400 tabular-nums">{countLabel}</span>
      <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 transition-colors group-hover:text-emerald-500">
        {open ? 'свернуть' : 'показать'}
        <ChevronDown
          className={cn('size-3.5 transition-transform duration-200', open && 'rotate-180')}
          aria-hidden
        />
      </span>
    </button>
  )
}

/** Строка конкретной ставки: дата, матч, выбор, кэф, итог; клик → разбор */
function BetHistoryRow({
  bet,
  onSelect,
  delay,
}: {
  bet: BetDto
  onSelect: (b: BetDto) => void
  delay: number
}) {
  const outcome = betOutcome(bet.status, bet.stake, bet.odds)
  const potential = bet.stake * (bet.odds - 1)
  const color = SPORT_COLORS[bet.sport] ?? WON_COLOR
  const SportIcon = SPORTS[bet.sport]?.icon ?? Dumbbell
  return (
    <motion.div
      role="listitem"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay }}
    >
      <button
        type="button"
        onClick={() => onSelect(bet)}
        data-bod-bet={bet.id}
        aria-label={`Разбор ставки дня от ${fmtShortDate(bet.matchDate)}: ${bet.homeTeam} — ${bet.awayTeam}, ${bet.selection}`}
        title="Открыть разбор прогноза"
        className="group flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left transition-all hover:border-emerald-400/60 hover:shadow-[0_8px_20px_-14px_rgba(16,185,129,0.5)] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
      >
        {/* Когда: дата и время матча */}
        <span className="flex w-12 shrink-0 flex-col items-center leading-tight">
          <span className="text-xs font-bold text-zinc-800 tabular-nums">
            {fmtShortDate(bet.matchDate)}
          </span>
          <span className="text-[10px] text-zinc-400 tabular-nums">{fmtTime(bet.matchDate)}</span>
        </span>
        {/* Вид спорта */}
        <span
          className="grid size-7 shrink-0 place-items-center rounded-md"
          style={{ backgroundColor: `${color}1f`, color }}
          aria-hidden
        >
          <SportIcon className="size-3.5" />
        </span>
        {/* Матч и выбор */}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-tight">
          <span className="truncate text-[13px] font-bold text-zinc-900">
            {bet.homeTeam} — {bet.awayTeam}
          </span>
          <span className="truncate text-[11px] text-zinc-500">
            {bet.selection} ·{' '}
            <span className="font-mono font-semibold text-amber-600">≈{fmtOdds(bet.odds)}</span>
          </span>
          {/* Реальный счёт матча — что именно сыграло/проиграло */}
          {scoreOf(bet.resultNote) && (
            <span
              className={cn(
                'truncate text-[10px] font-semibold tabular-nums',
                bet.status === 'won'
                  ? 'text-emerald-600'
                  : bet.status === 'lost'
                    ? 'text-rose-600'
                    : 'text-zinc-400',
              )}
            >
              счёт {scoreOf(bet.resultNote)}
            </span>
          )}
        </span>
        {/* Итог ставки */}
        <span className="flex shrink-0 flex-col items-end gap-0.5 leading-tight">
          <OutcomePill status={bet.status} />
          {bet.status === 'pending' ? (
            <span className="font-mono text-[10px] font-semibold text-amber-600/90 tabular-nums">
              потенц. +{potential.toFixed(2)}
            </span>
          ) : (
            <span
              className={cn(
                'font-mono text-[11px] font-bold tabular-nums',
                outcome > 0 ? 'text-emerald-600' : outcome < 0 ? 'text-rose-600' : 'text-zinc-400',
              )}
            >
              {fmtUnits(outcome)} юн.
            </span>
          )}
        </span>
        <Maximize2
          className="size-3.5 shrink-0 text-zinc-300 transition-colors group-hover:text-emerald-500"
          aria-hidden
        />
      </button>
    </motion.div>
  )
}

/** Подраздел «Ставки дня»: какие конкретно ставки когда были */
function BetOfDayHistory({
  bets,
  open,
  onToggle,
  onSelect,
}: {
  bets: BetDto[]
  open: boolean
  onToggle: () => void
  onSelect: (b: BetDto) => void
}) {
  const pendingCount = bets.filter((b) => b.status === 'pending').length
  const countLabel = `${bets.length} ${plural(bets.length, ['ставка', 'ставки', 'ставок'])}${
    pendingCount > 0 ? ` · ${pendingCount} в игре` : ''
  }`
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-1.5" data-bod-history>
      <HistoryHeader
        title="Какие ставки были"
        countLabel={countLabel}
        open={open}
        onToggle={onToggle}
        toggleKey="bod"
      />
      {open && (
        <div
          className="dark-scrollbar mt-1 flex max-h-72 flex-col gap-1.5 overflow-y-auto p-0.5"
          role="list"
          aria-label="Конкретные ставки дня"
        >
          {bets.map((bet, i) => (
            <BetHistoryRow key={bet.id} bet={bet} onSelect={onSelect} delay={i * 0.04} />
          ))}
          <p className="px-2 py-1 text-[10px] text-zinc-400">
            Нажмите на ставку — откроется полный разбор с итогом матча.
          </p>
        </div>
      )}
    </div>
  )
}

/** Нога дня экспресса: компактная кликабельная строка со счётом матча */
function ExpressLegRow({ leg, onSelect }: { leg: BetDto; onSelect: (b: BetDto) => void }) {
  const StatusIcon = LEG_STATUS_ICON[leg.status]
  const color = SPORT_COLORS[leg.sport] ?? WON_COLOR
  const SportIcon = SPORTS[leg.sport]?.icon ?? Dumbbell
  const score = scoreOf(leg.resultNote)
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(leg)}
        data-express-leg={leg.id}
        aria-label={`Разбор: ${leg.homeTeam} — ${leg.awayTeam}, ${leg.selection}`}
        title="Открыть разбор прогноза"
        className="group flex w-full cursor-pointer items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-emerald-50/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
      >
        <StatusIcon
          className={cn('size-3.5 shrink-0', LEG_STATUS_CLS[leg.status])}
          aria-label={OUTCOME_PILL[leg.status].label}
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
          {/* Время · лига · реальный счёт — сразу видно, что сыграло */}
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
            ) : leg.status === 'pending' ? (
              <span className="shrink-0 font-bold text-amber-600/80">в игре</span>
            ) : null}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[11px] font-semibold text-amber-600 tabular-nums">
          ≈{fmtOdds(leg.odds)}
        </span>
        <Maximize2
          className="size-3 shrink-0 text-zinc-300 transition-colors group-hover:text-emerald-500"
          aria-hidden
        />
      </button>
    </li>
  )
}

/** Один день экспресса: шапка с итогом дня + кликабельные ноги */
function ExpressDayItem({
  day,
  onSelect,
  delay,
}: {
  day: ExpressDayStat
  onSelect: (b: BetDto) => void
  delay: number
}) {
  const dateLabel = format(parseISO(day.date), 'd MMMM, EEE', { locale: ru })
  const legsWon = day.legs.filter((l) => l.status === 'won').length
  const legsLost = day.legs.filter((l) => l.status === 'lost').length
  return (
    <motion.div
      role="listitem"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay }}
      className="shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-white"
      data-express-day={day.date}
    >
      {/* Итог дня: дата, число событий, кэф, исход, что зашло/не зашло */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-100 bg-zinc-50/70 px-3 py-2">
        <span className="text-xs font-bold text-zinc-900">{dateLabel}</span>
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
          <OutcomePill status={day.status} />
          {day.profit !== null && (
            <span
              className={cn(
                'font-mono text-[11px] font-bold tabular-nums',
                day.profit > 0 ? 'text-emerald-600' : day.profit < 0 ? 'text-rose-600' : 'text-zinc-400',
              )}
            >
              {fmtUnits(day.profit)} юн.
            </span>
          )}
        </span>
      </div>
      {/* Ноги: клик открывает разбор */}
      <ul className="divide-y divide-zinc-100">
        {day.legs.map((leg) => (
          <ExpressLegRow key={leg.id} leg={leg} onSelect={onSelect} />
        ))}
      </ul>
    </motion.div>
  )
}

/** Подраздел «Экспресс дня»: какие дни были и с какими событиями */
function ExpressDayHistory({
  days,
  open,
  onToggle,
  onSelect,
}: {
  days: ExpressDayStat[]
  open: boolean
  onToggle: () => void
  onSelect: (b: BetDto) => void
}) {
  const pendingCount = days.filter((d) => d.status === 'pending').length
  const countLabel = `${days.length} ${plural(days.length, ['день', 'дня', 'дней'])}${
    pendingCount > 0 ? ` · ${pendingCount} в игре` : ''
  }`
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-1.5" data-express-history>
      <HistoryHeader
        title="Какие экспрессы были"
        countLabel={countLabel}
        open={open}
        onToggle={onToggle}
        toggleKey="express"
      />
      {open && (
        <div
          className="dark-scrollbar mt-1 flex max-h-96 flex-col gap-1.5 overflow-y-auto p-0.5"
          role="list"
          aria-label="Дни экспресса дня"
        >
          {days.map((day, i) => (
            <ExpressDayItem key={day.date} day={day} onSelect={onSelect} delay={i * 0.05} />
          ))}
          <p className="px-2 py-1 text-[10px] text-zinc-400">
            Нажмите на событие — откроется разбор с итогом матча.
          </p>
        </div>
      )}
    </div>
  )
}

function Divider({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="my-1 flex items-center gap-3" aria-hidden>
      <span className="h-px flex-1 bg-zinc-200" />
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-zinc-600 uppercase">
        <Icon className="size-4 text-amber-500" />
        {label}
      </span>
      <span className="h-px flex-1 bg-zinc-200" />
    </div>
  )
}

export function OverallSummary({ stats }: { stats: StatsResponse }) {
  const { totals, winrate } = stats
  const decided = totals.won + totals.lost
  const settled = totals.won + totals.lost + totals.void
  // Первый день истории — статистика считается за всё время от него (03.10:
  // вопрос пользователя «у нас полная статистика ведётся за всё время?»)
  const sinceLabel = stats.since
    ? format(parseISO(stats.since), 'd MMMM yyyy', { locale: ru })
    : null

  // Выбранная ставка/нога для разбора + свёрнутость подразделов форматов
  const [selectedBet, setSelectedBet] = useState<BetDto | null>(null)
  const [bodHistoryOpen, setBodHistoryOpen] = useState(true)
  const [expressHistoryOpen, setExpressHistoryOpen] = useState(true)

  // Рейтинг: выше проходимость → выше место (при равенстве — больше прибыли)
  const sports = [...(stats.bySport ?? [])]
    .filter((s) => s.won + s.lost > 0)
    .sort((a, b) => b.winrate - a.winrate || b.profit - a.profit)
  const bestSport = sports[0] ?? null

  const bod = stats.betOfDay
  const exp = stats.expressOfDay
  const showBod = !!bod && (bod.total > 0 || bod.pending > 0)
  const showExp = !!exp && (exp.total > 0 || exp.pending > 0)
  const showBodHistory = !!bod && (bod.bets?.length ?? 0) > 0
  const showExpHistory = !!exp && (exp.days?.length ?? 0) > 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.45 }}
    >
      <Card className="border-zinc-200 bg-white/70">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold tracking-wide text-zinc-700 uppercase">
            Общий итог: зашло / не зашло
          </CardTitle>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-600">
            {sinceLabel && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700"
                title="Вся история прогнозов с первого дня — ничего не удаляется и не обрезается"
              >
                <History className="size-3 shrink-0" aria-hidden />
                за всё время · с {sinceLabel}
              </span>
            )}
            Все расчётные прогнозы · возвраты не влияют на проходимость
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-1">
          {settled === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-4 text-center text-sm text-zinc-500">
              Пока нет ни одного рассчитанного прогноза — итог появится после первых
              завершённых матчей.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
                <OutcomeTile
                  icon={CheckCircle2}
                  label="Зашло"
                  value={totals.won}
                  hint={plural(totals.won, ['ставка', 'ставки', 'ставок'])}
                  tone="won"
                />
                <OutcomeTile
                  icon={XCircle}
                  label="Не зашло"
                  value={totals.lost}
                  hint={plural(totals.lost, ['ставка', 'ставки', 'ставок'])}
                  tone="lost"
                />
                <div className="col-span-2 sm:col-span-1">
                  <OutcomeTile
                    icon={Undo2}
                    label="Возвраты"
                    value={totals.void}
                    hint="расчёт не в зачёт"
                    tone="void"
                  />
                </div>
              </div>

              <ProportionBar
                won={totals.won}
                lost={totals.lost}
                voided={totals.void}
                ariaLabel={`Доли исходов: ${totals.won} зашло, ${totals.lost} не зашло, ${totals.void} возвратов`}
              />

              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-sm text-zinc-700">
                  Общая проходимость:{' '}
                  <span className="text-lg font-extrabold text-emerald-600 tabular-nums">
                    {Math.round(winrate)}%
                  </span>{' '}
                  <span className="text-xs text-zinc-500">
                    ({decided} {plural(decided, ['расчётный', 'расчётных', 'расчётных'])} без
                    возвратов)
                  </span>
                </p>
                {totals.pending > 0 && (
                  <p className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600">
                    <Hourglass className="size-3.5" aria-hidden />
                    Ещё {totals.pending} в игре
                  </p>
                )}
              </div>
            </>
          )}

          {sports.length > 0 && (
            <>
              <Divider icon={Medal} label="Какой спорт прогнозируется лучше" />
              <div
                className="flex flex-col gap-2"
                role="list"
                aria-label="Рейтинг видов спорта по проходимости"
              >
                {sports.map((s, i) => (
                  <SportRow
                    key={s.sport}
                    stat={s}
                    isBest={bestSport?.sport === s.sport}
                    delay={0.05 + i * 0.06}
                  />
                ))}
              </div>
              <p className="text-[11px] text-zinc-400">
                Ранжирование по проходимости (доля зашедших среди расчётных). Спорт с
                трофеем — лучший на текущей выборке; при малом числе прогнозов итог
                считается ориентировочным.
              </p>
            </>
          )}

          {/* Отдельные итоги главных форматов сайта + конкретные ставки/дни */}
          {(showBod || showExp) && (
            <>
              <Divider icon={Sparkles} label="Ставка дня и экспресс дня" />
              <div className="flex flex-col gap-2" role="list" aria-label="Итоги форматов дня">
                {showBod && bod && (
                  <div role="listitem" className="flex flex-col gap-1.5">
                    <FormatRow
                      stat={bod}
                      icon={Star}
                      color="#f59e0b"
                      label="Ставка дня"
                      sublabel="главный пик дня"
                      rowKey="bet-of-day"
                      delay={0.1}
                    />
                    {showBodHistory && (
                      <BetOfDayHistory
                        bets={bod.bets}
                        open={bodHistoryOpen}
                        onToggle={() => setBodHistoryOpen((v) => !v)}
                        onSelect={setSelectedBet}
                      />
                    )}
                  </div>
                )}
                {showExp && exp && (
                  <div role="listitem" className="flex flex-col gap-1.5">
                    <FormatRow
                      stat={exp}
                      icon={Zap}
                      color="#ea580c"
                      label="Экспресс дня"
                      sublabel="топ-3 пика дня · 10 юн. на комбинацию"
                      rowKey="express"
                      delay={0.16}
                    />
                    {showExpHistory && (
                      <ExpressDayHistory
                        days={exp.days}
                        open={expressHistoryOpen}
                        onToggle={() => setExpressHistoryOpen((v) => !v)}
                        onSelect={setSelectedBet}
                      />
                    )}
                  </div>
                )}
              </div>
              <p className="text-[11px] text-zinc-400">
                «Ставка дня» — итоги главного пика каждого дня. «Экспресс дня» — день
                зашёл, если ни одна его нога не проиграла (возврат убирает ногу из
                коэффициента); дни с ещё не рассчитанными матчами считаются «в игре» и в
                итог не идут. В подразделах — конкретные ставки и события: нажмите на
                любую, чтобы открыть разбор.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Разбор конкретной ставки или события экспресса из подразделов форматов */}
      <BetDetailsDialog bet={selectedBet} onOpenChange={(o) => !o && setSelectedBet(null)} />
    </motion.div>
  )
}
