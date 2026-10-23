'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { parseISO, format } from 'date-fns'
import { ru } from 'date-fns/locale'
import {
  Activity,
  BadgeCheck,
  Filter,
  Flame,
  Layers,
  Loader2,
  Maximize2,
  Medal,
  Percent,
  RotateCcw,
  Star,
  Target,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StatusBadge } from '@/components/betting/status-badge'
import { BetDetailsDialog } from '@/components/betting/bet-details-dialog'
import { GitHubBackupCard } from '@/components/betting/github-backup-card'
import { ErrorLogCard } from '@/components/betting/error-log-card'
import { HistoryExportCard } from '@/components/betting/history-export-card'
import { OverallSummary } from '@/components/betting/overall-summary'
import { sportLabel, SPORT_COLORS, SPORT_LIST } from '@/lib/sports'
import type { BetDto, StatsFilterState, StatsResponse } from '@/lib/types'
import { betOutcome, fmtOdds, fmtShortDate, fmtUnits, plural } from '@/lib/format'
import { cn } from '@/lib/utils'

const WON_COLOR = '#10b981'

function ChartCard({
  title,
  caption,
  children,
  delay = 0,
}: {
  title: string
  caption?: string
  children: React.ReactNode
  delay?: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.45, delay }}
    >
      <Card className="border-zinc-200 bg-white/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold tracking-wide text-zinc-700 uppercase">
            {title}
          </CardTitle>
          {caption && <p className="text-xs text-zinc-600">{caption}</p>}
        </CardHeader>
        <CardContent className="pt-2">{children}</CardContent>
      </Card>
    </motion.div>
  )
}

function SmallStat({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: LucideIcon
  label: string
  value: React.ReactNode
  accent: string
}) {
  return (
    <Card className="border-zinc-200 bg-white/70 transition-colors hover:border-zinc-300">
      <CardContent className="flex items-center gap-3 p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-700">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-xs font-semibold tracking-wider text-zinc-600 uppercase">
            {label}
          </span>
          <span className={cn('text-xl font-extrabold tabular-nums', accent)}>{value}</span>
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------- Тултипы ---------------------------------- */
interface TooltipPayloadItem {
  value?: number | string
  name?: string
  payload?: Record<string, unknown>
}

function AreaTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: TooltipPayloadItem[]
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]
  const raw = point.payload as { date: string; cumulativeProfit: number } | undefined
  if (!raw) return null
  const dateLabel = format(parseISO(raw.date), 'd MMMM', { locale: ru })
  return (
    <div className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs shadow-xl">
      <p className="mb-0.5 font-semibold text-zinc-800">{dateLabel}</p>
      <p className="text-emerald-600">
        Прибыль: <span className="font-mono font-bold">{fmtUnits(raw.cumulativeProfit)} юн.</span>
      </p>
    </div>
  )
}

function BarTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: TooltipPayloadItem[]
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]
  const raw = point.payload as
    | {
        sport: string
        total: number
        won: number
        lost: number
        void: number
        winrate: number
        profit: number
      }
    | undefined
  if (!raw) return null
  return (
    <div className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs shadow-xl">
      <p className="mb-0.5 font-semibold text-zinc-800">{sportLabel(raw.sport)}</p>
      <p className="text-zinc-700">
        Проходимость: <span className="font-bold text-emerald-600">{raw.winrate}%</span>
      </p>
      <p className="text-zinc-500">
        {raw.won} зашло · {raw.lost} не зашло
        {raw.void > 0 ? ` · ${raw.void} возврат` : ''}
      </p>
      <p className="text-zinc-500">
        Прибыль: <span className="font-mono font-semibold">{fmtUnits(raw.profit)} юн.</span>
      </p>
    </div>
  )
}

/* ---------------- Последние завершённые прогнозы (клик → разбор) --------- */

/** Карточка рассчитанного пика: открывает диалог с полным разбором */
function RecentPickCard({
  bet,
  onOpen,
}: {
  bet: BetDto
  onOpen: () => void
}) {
  const outcome = betOutcome(bet.status, bet.stake, bet.odds)
  return (
    <button
      type="button"
      onClick={onOpen}
      data-sport={bet.sport}
      aria-label={`Открыть разбор: ${bet.homeTeam} — ${bet.awayTeam}, ${bet.selection}`}
      title={`Разбор прогноза — итог: ${bet.resultNote ?? 'подробнее в карточке'}`}
      className="bet-sport-accent group flex cursor-pointer flex-col gap-2 rounded-xl border border-zinc-200 bg-white/70 p-4 text-left transition-all duration-200 hover:border-emerald-500/40 hover:shadow-[0_10px_28px_-18px_rgba(16,185,129,0.45)] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-600 tabular-nums">
          <BadgeCheck className="size-3.5 shrink-0 text-emerald-600" aria-label="Реальный матч" />
          {fmtShortDate(bet.matchDate)}
        </span>
        <StatusBadge status={bet.status} />
      </div>

      <p className="text-sm leading-snug font-bold text-zinc-900">
        {bet.homeTeam} — {bet.awayTeam}
      </p>
      <p className="text-xs font-medium text-zinc-600 uppercase">{bet.league}</p>

      <p className="truncate text-sm text-zinc-800" title={bet.selection}>
        {bet.selection}
      </p>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-zinc-200 pt-2 text-xs">
        <span className="font-mono font-bold text-amber-600 tabular-nums">
          ≈
          {fmtOdds(bet.odds)}
        </span>
        <span
          className={cn(
            'font-mono font-bold tabular-nums',
            outcome > 0 ? 'text-emerald-600' : outcome < 0 ? 'text-rose-600' : 'text-zinc-600',
          )}
        >
          {fmtUnits(outcome)} юн.
        </span>
        <Maximize2
          className="size-3.5 shrink-0 text-zinc-600 transition-colors group-hover:text-emerald-600"
          aria-hidden
        />
      </div>
    </button>
  )
}

/* --------------------- Панель фильтров статистики ---------------------- */

/** Значения по умолчанию: фильтры не применены, вся история */
export const DEFAULT_STATS_FILTERS: StatsFilterState = {
  sport: 'all',
  outcome: 'all',
  category: 'all',
  expert: 'all',
}

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Все прогнозы' },
  { value: 'bod', label: 'Ставка дня' },
  { value: 'express', label: 'Экспресс дня' },
  { value: 'feed', label: 'Лента прогнозов' },
]

const OUTCOME_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Все исходы' },
  { value: 'won', label: 'Зашло' },
  { value: 'lost', label: 'Не зашло' },
  { value: 'void', label: 'Возвраты' },
  { value: 'pending', label: 'Ещё в игре' },
]

function FilterSelect({
  id,
  icon: Icon,
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  id: string
  icon: LucideIcon
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label
        htmlFor={id}
        className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-zinc-500 uppercase"
      >
        <Icon className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
        {label}
      </label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          id={id}
          className="h-11 w-full bg-white text-sm font-semibold text-zinc-800"
          aria-label={`Фильтр: ${label}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-sm">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** Панель фильтров (запрос 03.10): вид спорта · исход · категория · эксперт.
 *  Меняет общие показатели, график и список «Последние …» ; итоги форматов
 *  («Ставка дня» / «Экспресс дня» ниже) всегда за всю историю. */
function StatsFilterBar({
  filters,
  onChange,
  stats,
  filtersLoading,
  globalTotal,
}: {
  filters: StatsFilterState
  onChange: (f: StatsFilterState) => void
  stats: StatsResponse | null
  filtersLoading: boolean
  globalTotal: number | null
}) {
  const active =
    filters.sport !== 'all' ||
    filters.outcome !== 'all' ||
    filters.category !== 'all' ||
    filters.expert !== 'all'
  const meta = stats?.filters
  const sportOptions: { value: string; label: string }[] = [
    { value: 'all', label: 'Все виды спорта' },
    ...(meta?.sports?.length
      ? meta.sports.map((s) => ({ value: s, label: sportLabel(s) }))
      : SPORT_LIST.map((s) => ({ value: s.key, label: s.label }))),
  ]
  const expertOptions: { value: string; label: string }[] = [
    { value: 'all', label: 'Все эксперты' },
    ...(meta?.experts ?? []).map((e) => ({ value: e.id, label: e.name })),
  ]
  const shown = stats?.totals.total ?? 0
  const set = (patch: Partial<StatsFilterState>) => onChange({ ...filters, ...patch })

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.35 }}
    >
      <Card className="border-zinc-200 bg-white/70">
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <p className="inline-flex items-center gap-2 text-sm font-bold text-zinc-800">
              <Filter className="size-4 shrink-0 text-zinc-400" aria-hidden />
              Фильтры статистики
              {filtersLoading ? (
                <Loader2
                  className="size-4 animate-spin text-emerald-600"
                  role="status"
                  aria-label="Обновление выборки"
                />
              ) : null}
            </p>
            <div className="flex items-center gap-2">
              {active ? (
                <span className="text-xs font-semibold text-zinc-500 tabular-nums">
                  Показано:{' '}
                  <span className="text-zinc-800">{shown}</span>
                  {globalTotal != null ? ` из ${globalTotal}` : ''}{' '}
                  {plural(globalTotal ?? shown, ['прогноза', 'прогнозов', 'прогнозов'])}
                </span>
              ) : (
                <span className="text-xs font-medium text-zinc-500">
                  вся история за всё время
                </span>
              )}
              {active ? (
                <button
                  type="button"
                  onClick={() => onChange(DEFAULT_STATS_FILTERS)}
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-bold text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
                  aria-label="Сбросить фильтры статистики"
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  Сбросить
                </button>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FilterSelect
              id="stats-filter-category"
              icon={Star}
              label="Категория"
              value={filters.category}
              onChange={(v) => set({ category: v })}
              options={CATEGORY_OPTIONS}
              disabled={filtersLoading}
            />
            <FilterSelect
              id="stats-filter-sport"
              icon={Medal}
              label="Вид спорта"
              value={filters.sport}
              onChange={(v) => set({ sport: v })}
              options={sportOptions}
              disabled={filtersLoading}
            />
            <FilterSelect
              id="stats-filter-outcome"
              icon={Target}
              label="Исход"
              value={filters.outcome}
              onChange={(v) => set({ outcome: v })}
              options={OUTCOME_OPTIONS}
              disabled={filtersLoading}
            />
            <FilterSelect
              id="stats-filter-expert"
              icon={UserRound}
              label="Эксперт"
              value={filters.expert}
              onChange={(v) => set({ expert: v })}
              options={expertOptions}
              disabled={filtersLoading}
            />
          </div>
          <p className="text-[11px] leading-snug text-zinc-400">
            «Ставка дня» — главный пик дня; «Экспресс дня» — прогнозы, вошедшие в составы
            экспрессов; «Лента прогнозов» — все остальные. Итоги форматов ниже считаются за
            всю историю и от фильтров не зависят.
          </p>
        </CardContent>
      </Card>
    </motion.div>
  )
}

/* --------------------------------- Вид ------------------------------------ */
export function StatsView({
  stats,
  loading,
  error,
  filters,
  onFiltersChange,
  filtersLoading,
  globalTotal,
}: {
  stats: StatsResponse | null
  loading: boolean
  error: string | null
  filters: StatsFilterState
  onFiltersChange: (f: StatsFilterState) => void
  filtersLoading: boolean
  globalTotal: number | null
}) {
  const [selected, setSelected] = useState<BetDto | null>(null)
  if (loading) {
    return (
      <div className="flex flex-col gap-4" aria-label="Загрузка статистики">
        <Skeleton className="h-80 rounded-xl bg-zinc-200/70" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-xl bg-zinc-200/70" />
          <div className="grid grid-cols-1 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl bg-zinc-200/70" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error || !stats) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-center text-sm text-rose-300"
      >
        Не удалось загрузить статистику: {error}
      </div>
    )
  }

  const filtersActive =
    filters.sport !== 'all' ||
    filters.outcome !== 'all' ||
    filters.category !== 'all' ||
    filters.expert !== 'all'
  const areaData = stats.profitSeries.map((p) => ({
    ...p,
    day: format(parseISO(p.date), 'd MMM', { locale: ru }),
  }))
  // Первый день истории — вся статистика ведётся за всё время от него
  // (при активных фильтрах — от первого прогноза выборки)
  const sinceLabel = stats.since
    ? format(parseISO(stats.since), 'd MMMM yyyy', { locale: ru })
    : null
  const barData = stats.bySport.map((s) => ({
    ...s,
    label: sportLabel(s.sport),
    color: SPORT_COLORS[s.sport] ?? WON_COLOR,
  }))

  return (
    <div className="flex flex-col gap-4">
      {/* Панель фильтров: вид спорта · исход · категория · эксперт (03.10) */}
      <StatsFilterBar
        filters={filters}
        onChange={onFiltersChange}
        stats={stats}
        filtersLoading={filtersLoading}
        globalTotal={globalTotal}
      />

      {/* Общий итог: сколько зашло / не зашло + какой спорт лучше прогнозируется */}
      <OverallSummary stats={stats} />

      <ChartCard
        title={
          filtersActive
            ? 'Кумулятивная прибыль (юниты), выборка'
            : 'Кумулятивная прибыль (юниты), за всё время'
        }
        caption={
          filtersActive
            ? `Выборка по фильтру: ${fmtUnits(stats.profit)} юнитов · ROI ${fmtUnits(stats.roi)}%`
            : `Вся история${sinceLabel ? ` с ${sinceLabel}` : ''}: ${fmtUnits(stats.profit)} юнитов · ROI ${fmtUnits(stats.roi)}%`
        }
      >
        <div
          className="h-64 w-full md:h-72"
          role="img"
          aria-label={
            filtersActive
              ? 'График кумулятивной прибыли по выборке'
              : 'График кумулятивной прибыли за всё время'
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={areaData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e4e4e7" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fill: '#71717a', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: '#d4d4d8' }}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                tick={{ fill: '#71717a', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <Tooltip content={<AreaTooltip />} cursor={{ stroke: '#d4d4d8' }} />
              <Area
                type="monotone"
                dataKey="cumulativeProfit"
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#profitFill)"
                dot={false}
                activeDot={{ r: 4, fill: '#10b981', stroke: '#064e3b' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Проходимость по видам спорта" caption="Доля выигрышей среди расчётных прогнозов" delay={0.05}>
          <div className="h-64 w-full md:h-72" role="img" aria-label="Диаграмма проходимости по видам спорта">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ top: 18, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="#e4e4e7" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#52525b', fontSize: 12 }}
                  tickLine={false}
                  axisLine={{ stroke: '#d4d4d8' }}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: '#71717a', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip content={<BarTooltip />} cursor={{ fill: 'rgba(113,113,122,0.12)' }} />
                <Bar dataKey="winrate" radius={[6, 6, 0, 0]} maxBarSize={56}>
                  {barData.map((entry) => (
                    <Cell key={entry.sport} fill={entry.color} />
                  ))}
                  <LabelList
                    dataKey="winrate"
                    position="top"
                    fill="#52525b"
                    fontSize={11}
                    formatter={(value: number) => `${Math.round(value)}%`}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <div className="grid content-start gap-4 sm:grid-cols-3 lg:grid-cols-1">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: 0.1 }}
          >
            <SmallStat
              icon={Percent}
              label="Средний коэффициент"
              value={fmtOdds(stats.avgOdds)}
              accent="text-amber-600"
            />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: 0.15 }}
          >
            <SmallStat
              icon={Layers}
              label="Всего прогнозов"
              value={`${stats.totals.total} ${plural(stats.totals.total, ['прогноз', 'прогноза', 'прогнозов'])}`}
              accent="text-zinc-900"
            />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: 0.2 }}
          >
            <SmallStat
              icon={Activity}
              label="Активных прогнозов"
              value={`${stats.totals.pending} ${plural(stats.totals.pending, ['прогноз', 'прогноза', 'прогнозов'])}`}
              accent="text-amber-600"
            />
          </motion.div>
          {stats.bestStreak > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: 0.35 }}
              className="sm:col-span-3 lg:col-span-1"
            >
              <SmallStat
                icon={Flame}
                label="Макс. серия побед"
                value={`${stats.bestStreak} ${plural(stats.bestStreak, ['матч', 'матча', 'матчей'])}`}
                sub="подряд за всю историю"
                accent="text-orange-400"
              />
            </motion.div>
          )}
        </div>
      </div>

      {/* Последние завершённые прогнозы: клик по карточке открывает разбор.
          Незавершённые (pending) пики сюда не попадают — по ним итога ещё нет. */}
      {stats.recent && stats.recent.length > 0 && (
        <ChartCard
          title="Последние завершённые прогнозы"
          caption="Нажмите на карточку — откроется разбор с итогом матча"
          delay={0.15}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {stats.recent.map((bet) => (
              <RecentPickCard key={bet.id} bet={bet} onOpen={() => setSelected(bet)} />
            ))}
          </div>
        </ChartCard>
      )}

      {/* Резервная копия: владелец может вручную отправить код в GitHub
          (авто-пуш срабатывает раз в сутки) */}
      <GitHubBackupCard />

      {/* Вечный архив истории: прошлые прогнозы экспертов больше не теряются
          при ночных сбросах сервера + скачивание CSV (23.10) */}
      <HistoryExportCard />

      {/* Журнал ошибок: сбои и предупреждения всех модулей с причинами
          (Task 54 — «не загрузилась ставка от Марии» без объяснений) */}
      <ErrorLogCard />

      {/* Диалог разбора прогноза: анализ, счёт, итог в юнитах */}
      <BetDetailsDialog bet={selected} onOpenChange={(o) => !o && setSelected(null)} />
    </div>
  )
}
