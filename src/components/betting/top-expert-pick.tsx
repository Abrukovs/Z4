'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Award,
  BadgeCheck,
  Brain,
  CalendarClock,
  ChevronRight,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { SportChip } from '@/components/betting/sport-chip'
import { LiveIndicator } from '@/components/betting/live-indicator'
import { TipsterProfileDialog } from '@/components/betting/tipster-profile-dialog'
import { BetDetailsDialog } from '@/components/betting/bet-details-dialog'
import { useNow } from '@/components/betting/use-now'
import type { TipsterStatsDto } from '@/lib/types'
import { fmtCountdown, fmtDateTime, fmtOdds, fmtPct, fmtTime, fmtUnits, initials, plural } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Минимум рассчитанных прогнозов, чтобы winrate считался надёжным */
const MIN_DECIDED = 5

/**
 * Топ-эксперт: лучший winrate среди аналитиков с активным прогнозом
 * (при равном winrate — выше прибыль). Профиты без активной ставки
 * не участвуют: подсвечиваем только тех, у кого есть «живой» выбор.
 */
function pickTopExpert(tipsters: TipsterStatsDto[]): TipsterStatsDto | null {
  const candidates = tipsters.filter((t) => t.activeBet)
  if (candidates.length === 0) return null
  return candidates.slice().sort((a, b) => {
    const wrA = a.won + a.lost >= MIN_DECIDED ? a.winrate : -1
    const wrB = b.won + b.lost >= MIN_DECIDED ? b.winrate : -1
    if (wrB !== wrA) return wrB - wrA
    return b.profit - a.profit
  })[0]
}

/* ---------- Чип статистики ---------- */
function StatChip({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: string
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/5 px-2.5 py-1">
      <span className="text-[10px] font-semibold tracking-wider text-zinc-600 uppercase">{label}</span>
      <span className={cn('font-mono text-sm font-bold tabular-nums', accent ?? 'text-zinc-900')}>{value}</span>
    </span>
  )
}

/* ---------- Аватар ---------- */
function ExpertAvatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#f59e0b,#52525b)] p-[2.5px]',
        size === 'md' ? 'size-12' : 'size-9',
      )}
    >
      <span
        className={cn(
          'grid size-full place-items-center rounded-full bg-zinc-100 font-extrabold text-amber-600',
          size === 'md' ? 'text-sm' : 'text-[11px]',
        )}
      >
        {initials(name)}
      </span>
    </span>
  )
}

interface TopExpertPickProps {
  tipsters: TipsterStatsDto[]
  loading: boolean
  /** hero — широкая карточка под «Ставкой дня»; express — компактный стрип под «Экспрессом дня» */
  variant: 'hero' | 'express'
}

export function TopExpertPick({ tipsters, loading, variant }: TopExpertPickProps) {
  const [profileOpen, setProfileOpen] = useState(false)
  const [betOpen, setBetOpen] = useState(false)
  const now = useNow(1000)

  const top = useMemo(() => pickTopExpert(tipsters), [tipsters])

  if (loading) {
    return variant === 'hero' ? (
      <div className="mx-auto mt-4 w-full max-w-6xl px-4" aria-label="Загрузка топ-эксперта">
        <Skeleton className="h-36 rounded-2xl bg-zinc-200/70" />
      </div>
    ) : (
      <Skeleton className="mt-3 h-16 rounded-2xl bg-zinc-200/70" aria-label="Загрузка топ-эксперта" />
    )
  }

  if (!top || !top.activeBet) return null
  const bet = top.activeBet
  const betStarted = now !== null && new Date(bet.matchDate).getTime() - now <= 0

  /* ---------------- Компактный стрип под «Экспрессом дня» ---------------- */
  if (variant === 'express') {
    return (
      <>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="mt-3"
        >
          <Card
            role="button"
            tabIndex={0}
            aria-label={`Топ-эксперт ${top.name}: активный прогноз — открыть профиль`}
            onClick={() => setProfileOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setProfileOpen(true)
              }
            }}
            className="group cursor-pointer border-amber-500/30 bg-gradient-to-r from-amber-500/[0.08] via-white/80 to-white/80 transition-all duration-200 hover:border-amber-500/50 hover:shadow-[0_10px_30px_-14px_rgba(245,158,11,0.4)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
          >
            <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold tracking-wider text-amber-600 uppercase">
                <Award className="size-3" aria-hidden />
                Топ-эксперт
              </span>
              <span className="flex min-w-0 items-center gap-2.5">
                <ExpertAvatar name={top.name} size="sm" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-bold text-zinc-900">{top.name}</span>
                  <span className="text-[11px] font-medium text-zinc-600">
                    {fmtPct(top.winrate, 1)} побед · {fmtUnits(top.profit)} юн.
                  </span>
                </span>
              </span>
              <span className="hidden h-8 w-px bg-zinc-200 md:block" aria-hidden />
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <SportChip sport={bet.sport} />
                <span className="truncate font-semibold text-zinc-800">
                  {bet.homeTeam} — {bet.awayTeam}
                </span>
                <span className="truncate font-bold text-amber-600">{bet.selection.split(' — ')[0]}</span>
                <span className="font-mono font-bold text-zinc-900 tabular-nums">{fmtOdds(bet.odds)}</span>
                <span className="inline-flex items-center gap-1 text-zinc-600">
                  <CalendarClock className="size-3.5" aria-hidden />
                  {betStarted && bet.liveInfo ? (
                    <LiveIndicator phase={bet.liveInfo.phase} score={bet.liveInfo.score} size="sm" />
                  ) : betStarted ? (
                    <span className="animate-pulse font-semibold text-amber-600">матч идёт…</span>
                  ) : (
                    fmtTime(bet.matchDate)
                  )}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
                Профиль
                <ChevronRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
              </span>
            </CardContent>
          </Card>
        </motion.div>
        <TipsterProfileDialog tipsterId={profileOpen ? top.id : null} onOpenChange={setProfileOpen} />
      </>
    )
  }

  /* ---------------- Широкая карточка под «Ставкой дня» ---------------- */
  return (
    <>
      <div className="mx-auto mt-4 w-full max-w-6xl px-4">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.15 }}
        >
          <Card className="relative overflow-hidden border-amber-500/35 bg-white/80 shadow-[0_18px_50px_-28px_rgba(245,158,11,0.45)] ring-1 ring-amber-500/15 backdrop-blur-sm">
            <div aria-hidden className="gradient-line-h absolute inset-x-0 top-0 h-px" />
            <div
              aria-hidden
              className="pointer-events-none absolute -top-20 -right-20 size-56 rounded-full bg-amber-500/10 blur-3xl"
            />
            <CardContent className="relative flex flex-col gap-6 p-5 md:p-6 lg:flex-row lg:items-stretch lg:justify-between">
              {/* Левая часть: эксперт и его активный выбор */}
              <div className="flex min-w-0 max-w-2xl flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[11px] font-bold tracking-wider text-amber-600 uppercase">
                    <Award className="size-3.5" aria-hidden />
                    Топ-эксперт сайта
                  </span>
                  {/* Звезда тенниса: ровно 1 прогноз в день (Task 34→37);
                      приоритет — топ-турниры, но может взять любой из расписания */}
                  {top.sport === 'tennis' && (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold text-emerald-600"
                      title="Ровно один прогноз в день: приоритет у топ-турниров, но при их отсутствии Мария может взять и другой турнир расписания"
                    >
                      <BadgeCheck className="size-3.5" aria-hidden />
                      1 прогноз в день
                    </span>
                  )}
                  <span className="text-[11px] font-medium text-zinc-500">
                    лидер по винрейту среди аналитиков с активным прогнозом
                  </span>
                </div>

                {/* Прогноз эксперта */}
                <button
                  type="button"
                  onClick={() => setBetOpen(true)}
                  aria-label={`Активный прогноз ${top.name}: ${bet.homeTeam} — ${bet.awayTeam}, ${bet.selection}. Открыть подробности`}
                  className="group/bet flex cursor-pointer flex-col gap-3 rounded-xl border border-zinc-200 bg-zinc-100/80 p-4 text-left transition-colors hover:border-amber-500/40 hover:bg-amber-500/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <SportChip sport={bet.sport} />
                    <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                      {bet.league}
                    </span>
                  </span>
                  <span className="text-lg leading-snug font-extrabold text-zinc-900 md:text-xl">
                    {bet.homeTeam} <span className="font-medium text-zinc-600">—</span> {bet.awayTeam}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-zinc-600">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarClock className="size-3.5" aria-hidden />
                      {fmtDateTime(bet.matchDate)}
                    </span>
                    {now !== null && !betStarted && (
                      <span className="font-mono font-bold text-zinc-800 tabular-nums">
                        {fmtCountdown(bet.matchDate, now)}
                      </span>
                    )}
                    {betStarted && bet.liveInfo && (
                      <LiveIndicator phase={bet.liveInfo.phase} score={bet.liveInfo.score} size="sm" />
                    )}
                    {betStarted && !bet.liveInfo && (
                      <span className="animate-pulse font-semibold text-amber-600">матч идёт…</span>
                    )}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">
                      {bet.market}
                    </span>
                    <span className="text-sm font-bold text-zinc-900">{bet.selection}</span>
                    <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-sm font-extrabold text-amber-600 tabular-nums">
                      {fmtOdds(bet.odds)}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-600">
                      <Wallet className="size-3.5" aria-hidden />
                      {bet.stake} {plural(bet.stake, ['юнит', 'юнита', 'юнитов'])}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600">
                      <Zap className="size-3.5" aria-hidden />
                      уверенность {bet.confidence}%
                    </span>
                    {bet.starLogic && (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-600"
                        title="Подробный разбор логики: тезис, факторы за и против, сценарий, риски и размер ставки"
                      >
                        <Brain className="size-3.5" aria-hidden />
                        логика разбора
                      </span>
                    )}
                  </span>
                  <span className="text-sm leading-relaxed text-zinc-600 line-clamp-3">
                    {bet.analysis}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600 transition-colors group-hover/bet:text-amber-500">
                    подробнее: {bet.starLogic ? 'логика разбора, ' : ''}линия рынка и калькулятор
                    <ChevronRight className="size-3.5 transition-transform duration-200 group-hover/bet:translate-x-0.5" aria-hidden />
                  </span>
                </button>
              </div>

              {/* Правая часть: карточка эксперта */}
              <div className="flex w-full shrink-0 flex-col gap-4 lg:w-72">
                <div className="flex items-center gap-4">
                  <ExpertAvatar name={top.name} />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="truncate text-lg font-bold text-zinc-900">{top.name}</p>
                    <p className="truncate text-xs text-zinc-600">{top.role}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <StatChip label="Winrate" value={fmtPct(top.winrate, 1)} accent="text-emerald-600" />
                  <StatChip
                    label="Прибыль"
                    value={`${fmtUnits(top.profit)} юн.`}
                    accent={top.profit > 0 ? 'text-emerald-600' : 'text-rose-600'}
                  />
                  <StatChip label="П / Пор" value={`${top.won} / ${top.lost}`} />
                  <StatChip
                    label="Ср. кэф"
                    value={fmtOdds(top.avgOdds)}
                    accent="text-amber-600"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setProfileOpen(true)}
                  className="mt-auto inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 text-sm font-bold text-amber-600 transition-all hover:border-amber-500/60 hover:bg-amber-500/20 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
                  aria-label={`Открыть профиль аналитика ${top.name}`}
                >
                  <TrendingUp className="size-4" aria-hidden />
                  Все прогнозы эксперта
                  <ChevronRight className="size-4" aria-hidden />
                </button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <TipsterProfileDialog tipsterId={profileOpen ? top.id : null} onOpenChange={setProfileOpen} />
      <BetDetailsDialog bet={betOpen ? bet : null} onOpenChange={setBetOpen} />
    </>
  )
}
