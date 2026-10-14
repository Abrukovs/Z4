'use client'

import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Coins, Flame, type LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CountUp } from '@/components/betting/count-up'
import { SectionHeader } from '@/components/betting/section-header'
import type { StatsResponse } from '@/lib/types'
import { fmtUnits, plural } from '@/lib/format'
import { cn } from '@/lib/utils'

interface KpiProps {
  icon: LucideIcon
  label: string
  value: React.ReactNode
  sub?: string
  accent: string
  iconBg: string
  /** Маленькая стрелка тренда возле значения */
  trend?: 'up' | 'down' | null
}

function KpiCard({ icon: Icon, label, value, sub, accent, iconBg, trend }: KpiProps) {
  const TrendIcon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : null
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.4 }}
      whileHover={{ y: -3 }}
    >
      <Card className="border-zinc-200 bg-white/70 transition-colors hover:border-zinc-300">
        <CardContent className="flex items-center gap-4 p-4 md:p-5">
          <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl', iconBg)}>
            <Icon className="size-5" aria-hidden />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="text-xs font-semibold tracking-wider text-zinc-600 uppercase">
              {label}
            </span>
            <span
              className={cn(
                'flex items-center gap-1 text-2xl font-extrabold tabular-nums',
                accent,
              )}
            >
              {value}
              {TrendIcon && (
                <TrendIcon
                  className={cn('size-4', trend === 'up' ? 'text-emerald-600' : 'text-rose-600')}
                  aria-hidden
                />
              )}
            </span>
            {sub && <span className="truncate text-xs text-zinc-600">{sub}</span>}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

export function StatsStrip({
  stats,
  loading,
  error,
}: {
  stats: StatsResponse | null
  loading: boolean
  error: string | null
}) {
  return (
    <section aria-label="Ключевые показатели" className="mx-auto max-w-6xl px-4 py-8">
      <SectionHeader
        eyebrow="Результаты"
        title="Ключевые показатели"
        subtext="Честная статистика сервиса за всё время работы — без прикрас и скрытых просадок"
      />
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Загрузка показателей">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[88px] rounded-xl bg-zinc-200/70" />
          ))}
        </div>
      ) : error || !stats ? null : (
        <KpiGrid stats={stats} />
      )}
    </section>
  )
}

function KpiGrid({ stats }: { stats: StatsResponse }) {
  const { totals, winrate, roi, profit, currentStreak } = stats
  const decided = totals.won + totals.lost
  const streakLabel =
    currentStreak.type === 'won'
      ? `${currentStreak.count} ${plural(currentStreak.count, ['победа', 'победы', 'побед'])}`
      : `${currentStreak.count} ${plural(currentStreak.count, ['поражение', 'поражения', 'поражений'])}`

  return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={TrendingUp}
          label="Winrate"
          value={<CountUp value={winrate} formatter={(v) => `${v.toFixed(1)}%`} />}
          sub={`из ${decided} ${plural(decided, ['расчётного', 'расчётных', 'расчётных'])} прогнозов`}
          accent="text-zinc-900"
          iconBg="bg-emerald-500/15 text-emerald-600"
          trend={winrate >= 55 ? 'up' : winrate < 45 ? 'down' : null}
        />
        <KpiCard
          icon={roi >= 0 ? TrendingUp : TrendingDown}
          label="ROI"
          value={<CountUp value={roi} formatter={(v) => fmtUnits(v)} />}
          sub={`на ${stats.totalStaked} юнитов оборота`}
          accent={roi >= 0 ? 'text-emerald-600' : 'text-rose-600'}
          iconBg={roi >= 0 ? 'bg-emerald-500/15 text-emerald-600' : 'bg-rose-500/15 text-rose-600'}
          trend={roi >= 0 ? 'up' : 'down'}
        />
        <KpiCard
          icon={Coins}
          label="Прибыль"
          value={<CountUp value={profit} formatter={(v) => `${fmtUnits(v)} юн.`} />}
          sub="за всё время — с первого прогноза"
          accent={profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}
          iconBg="bg-amber-500/15 text-amber-600"
          trend={profit >= 0 ? 'up' : 'down'}
        />
        <KpiCard
          icon={Flame}
          label="Текущая серия"
          value={streakLabel}
          sub="подряд"
          accent={currentStreak.type === 'won' ? 'text-emerald-600' : 'text-rose-600'}
          iconBg="bg-orange-500/15 text-orange-400"
          trend={currentStreak.type === 'won' ? 'up' : 'down'}
        />
      </div>
  )
}
