'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { CalendarDays, Clock, Maximize2, Wallet } from 'lucide-react'
import { RemindToggle } from '@/components/betting/remind-toggle'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SportChip } from '@/components/betting/sport-chip'
import { ConfidenceMeter } from '@/components/betting/confidence-meter'
import { RealBadge } from '@/components/betting/real-badge'
import { LiveIndicator } from '@/components/betting/live-indicator'
import { BetDetailsDialog } from '@/components/betting/bet-details-dialog'
import { useNow } from '@/components/betting/use-now'
import type { BetDto } from '@/lib/types'
import { fmtFromNow, fmtOdds, fmtTime } from '@/lib/format'

export function BetCard({
  bet,
  index,
  isNearest = false,
}: {
  bet: BetDto
  index: number
  isNearest?: boolean
}) {
  const [selected, setSelected] = useState(false)
  const now = useNow(60_000)

  const isLive =
    now !== null && bet.status === 'pending' && new Date(bet.matchDate).getTime() <= now
  const minutesLeft =
    now !== null && bet.status === 'pending'
      ? Math.ceil((new Date(bet.matchDate).getTime() - now) / 60_000)
      : null
  const startingSoon = minutesLeft !== null && minutesLeft > 0 && minutesLeft <= 60
  // Прогноз из завтрашнего расписания (вечерний набор) — календарный день отличается
  const isTomorrow =
    now !== null &&
    bet.status === 'pending' &&
    new Date(bet.matchDate).toDateString() !== new Date(now).toDateString()

  const openDetails = () => setSelected(true)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openDetails()
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-30px' }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.05, 0.3) }}
    >
      <Card
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-label={`Прогноз ${bet.homeTeam} — ${bet.awayTeam}: открыть подробности`}
        onClick={openDetails}
        onKeyDown={handleKeyDown}
        data-sport={bet.sport}
        className="bet-sport-accent group relative cursor-pointer overflow-hidden border-zinc-200 bg-white/70 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-500/40 hover:shadow-[0_12px_36px_-16px_rgba(16,185,129,0.35)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
      >
        {/* Градиентная линия по верхней кромке — подсвечивается при наведении */}
        <div
          aria-hidden
          className="gradient-line-h absolute inset-x-0 top-0 h-px opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        />
        <CardContent className="flex flex-col gap-4 p-4 md:p-5">
          {/* Верхняя строка: спорт, лига, время / «Матч идёт...» */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <SportChip sport={bet.sport} />
              <span
                className="max-w-[180px] truncate text-xs font-semibold tracking-wide text-zinc-600 uppercase md:max-w-[260px]"
                title={bet.league}
              >
                {bet.league}
              </span>
              <RealBadge isReal={!!bet.isRealMatch} size="xs" />
              {isTomorrow && (
                <span
                  title="Прогноз на матч завтрашнего расписания"
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-bold text-emerald-600"
                >
                  <CalendarDays className="size-3" aria-hidden />
                  Завтра
                </span>
              )}
              {isNearest && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-bold text-amber-600">
                  <Clock className="size-3" aria-hidden />
                  Ближайший матч
                </span>
              )}
            </div>
            {isLive ? (
              bet.liveInfo ? (
                <LiveIndicator phase={bet.liveInfo.phase} score={bet.liveInfo.score} size="xs" />
              ) : (
                <span className="inline-flex animate-pulse items-center gap-1.5 text-xs font-bold text-amber-600">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-60" />
                    <span className="relative inline-flex size-2 rounded-full bg-amber-400" />
                  </span>
                  Матч идёт...
                </span>
              )
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
                <Clock className="size-3.5 text-zinc-600" aria-hidden />
                {isTomorrow && (
                  <span className="font-semibold text-emerald-600/90">завтра, </span>
                )}
                <span className="font-mono font-semibold text-zinc-800 tabular-nums">
                  {fmtTime(bet.matchDate)}
                </span>
                {startingSoon ? (
                  <span className="font-mono font-bold text-amber-600 tabular-nums">
                    · Начало через {minutesLeft} мин
                  </span>
                ) : now !== null ? (
                  <span className="font-mono text-zinc-600 tabular-nums">
                    · {fmtFromNow(bet.matchDate, now)}
                  </span>
                ) : null}
              </span>
            )}
            <RemindToggle bet={bet} className="md:opacity-60 md:group-hover:opacity-100" />
            <Maximize2
              className="ml-auto size-3.5 shrink-0 text-zinc-600 transition-all duration-200 group-hover:text-emerald-600 md:opacity-0 md:group-hover:opacity-100"
              aria-hidden
            />
          </div>

          {/* Матч и прогноз */}
          <div className="flex flex-col gap-1">
            <p className="text-lg leading-snug font-bold text-zinc-900">
              {bet.homeTeam} <span className="font-medium text-zinc-600">vs</span> {bet.awayTeam}
            </p>
            <p className="text-sm text-zinc-700">
              <span className="text-zinc-600">{bet.market}:</span>{' '}
              <span className="font-semibold text-zinc-900">{bet.selection}</span>
            </p>
          </div>

          {/* Коэффициент, уверенность, ставка */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Badge
                title={
                  bet.isRealMatch
                    ? 'Примерный коэффициент: аналитическая оценка, не букмекерская линия'
                    : undefined
                }
                className="border-amber-500/40 bg-gradient-to-br from-amber-500/15 to-amber-500/5 px-2.5 py-1 font-mono text-sm font-bold text-amber-600 tabular-nums transition-all duration-200 group-hover:scale-105 group-hover:border-amber-500/60 group-hover:shadow-[0_6px_18px_-8px_rgba(245,158,11,0.6)]"
              >
                {bet.isRealMatch ? '≈' : ''}
                {fmtOdds(bet.odds)}
              </Badge>
              <ConfidenceMeter value={bet.confidence} />
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500">
              <Wallet className="size-3.5 text-zinc-600" aria-hidden />
              Ставка: <span className="font-bold text-amber-600 tabular-nums">{bet.stake} юн.</span>
            </span>
          </div>
        </CardContent>
      </Card>

      <BetDetailsDialog bet={selected ? bet : null} onOpenChange={(o) => !o && setSelected(false)} />
    </motion.div>
  )
}
