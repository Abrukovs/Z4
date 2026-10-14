'use client'

import { useEffect, useState } from 'react'
import {
  Activity,
  Award,
  BadgeCheck,
  Clock,
  SearchX,
  Target,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/betting/status-badge'
import { BetDetailsDialog } from '@/components/betting/bet-details-dialog'
import type { BetDto, TipsterProfileResponse } from '@/lib/types'
import { betOutcome, fmtOdds, fmtPct, fmtShortDate, fmtTime, fmtUnits, initials, plural } from '@/lib/format'
import { cn } from '@/lib/utils'

/* ------------------ Ячейка статистики в профиле ------------------ */
function StatCell({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string
  value: string
  icon: LucideIcon
  accent?: string
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-zinc-200 bg-zinc-100 p-3">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-zinc-600 uppercase">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </span>
      <span className={cn('font-mono text-lg font-bold tabular-nums', accent ?? 'text-zinc-900')}>
        {value}
      </span>
    </div>
  )
}

/* ------------------ Компактная строка прогноза ------------------ */
function BetRow({ bet, onOpen }: { bet: BetDto; onOpen: () => void }) {
  const outcome = betOutcome(bet.status, bet.stake, bet.odds)
  const pending = bet.status === 'pending'
  return (
    <button
      type="button"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      aria-label={`Открыть подробности: ${bet.homeTeam} — ${bet.awayTeam}`}
      className="flex w-full cursor-pointer flex-col gap-1.5 rounded-xl border border-zinc-200 bg-zinc-100 p-3 text-left transition-all duration-200 hover:border-emerald-500/40 hover:bg-zinc-100 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-zinc-600 tabular-nums">
          {fmtShortDate(bet.matchDate)}, {fmtTime(bet.matchDate)} · {bet.league}
        </span>
        <StatusBadge status={bet.status} />
      </span>
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold text-zinc-900">
          {bet.homeTeam} — {bet.awayTeam}
        </span>
        <span className="font-mono text-sm font-bold text-amber-600 tabular-nums">
          {fmtOdds(bet.odds)}
        </span>
      </span>
      <span className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-zinc-600">{bet.selection}</span>
        <span
          className={cn(
            'font-mono font-bold tabular-nums whitespace-nowrap',
            pending
              ? 'text-zinc-600'
              : outcome > 0
                ? 'text-emerald-600'
                : outcome < 0
                  ? 'text-rose-600'
                  : 'text-zinc-600',
          )}
        >
          {pending ? '—' : `${fmtUnits(outcome)} юн.`}
        </span>
      </span>
    </button>
  )
}

/* ------------------------------- Диалог ------------------------------- */
export function TipsterProfileDialog({
  tipsterId,
  onOpenChange,
}: {
  tipsterId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const open = tipsterId !== null
  const [profile, setProfile] = useState<TipsterProfileResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedBet, setSelectedBet] = useState<BetDto | null>(null)

  // Загрузка профиля при открытии
  useEffect(() => {
    if (!tipsterId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setProfile(null)
    setSelectedBet(null)
    ;(async () => {
      try {
        const res = await fetch(`/api/tipsters?id=${encodeURIComponent(tipsterId)}`, {
          cache: 'no-store',
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(body?.error ?? `Ошибка ${res.status}`)
        }
        const json = (await res.json()) as TipsterProfileResponse
        if (!cancelled) setProfile(json)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tipsterId])

  if (!tipsterId) {
    return <Dialog open={false} onOpenChange={onOpenChange} />
  }

  const t = profile?.tipster

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Мобильные: полноэкранный bottom-sheet; md+: центрированное окно */}
      <DialogContent className="dark-scrollbar bg-white! top-auto! right-0! bottom-0! left-0! translate-x-0! translate-y-0! max-h-[92dvh]! max-w-full! gap-0! overflow-y-auto! rounded-t-2xl! rounded-b-none! border-zinc-200! p-0! md:top-[50%]! md:bottom-auto! md:left-1/2! md:right-auto! md:w-[min(640px,calc(100vw-4rem))]! md:translate-x-[-50%]! md:translate-y-[-50%]! md:max-h-[85vh]! md:rounded-2xl!">
        <div className="flex flex-col gap-5 p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:p-6">
          {/* Заголовок: аватар, имя, роль */}
          <DialogHeader className="gap-3">
            <div className="flex items-center gap-4 pr-10">
              <span
                aria-hidden
                className="grid size-16 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#10b981,#52525b)] p-[2.5px]"
              >
                {loading ? (
                  <Skeleton className="size-full rounded-full bg-zinc-100" />
                ) : (
                  <span className="grid size-full place-items-center rounded-full bg-zinc-100 text-lg font-extrabold text-emerald-600">
                    {t ? initials(t.name) : '—'}
                  </span>
                )}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <DialogTitle className="truncate text-xl leading-tight font-extrabold text-zinc-900 md:text-2xl">
                  {t?.name ?? (loading ? 'Загрузка...' : 'Аналитик')}
                </DialogTitle>
                <DialogDescription className="text-sm text-zinc-600">
                  {t?.role ?? (loading ? 'Профиль аналитика' : 'Профиль аналитика')}
                </DialogDescription>
                {t && (
                  <p className="mt-0.5 inline-flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                    <span className="inline-flex items-center gap-1.5">
                      <Activity className="size-3.5 text-zinc-600" aria-hidden />
                      {t.totalBets}{' '}
                      {plural(t.totalBets, ['прогноз', 'прогноза', 'прогнозов'])}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="size-3.5 text-zinc-600" aria-hidden />
                      {t.pending} в игре
                    </span>
                  </p>
                )}
                {/* Звезда тенниса: редакционный формат (Task 34→37) */}
                {t?.sport === 'tennis' && (
                  <p
                    className="mt-1.5 inline-flex w-fit items-center gap-1.5 rounded-full border border-amber-500/35 bg-amber-500/[0.07] px-2.5 py-1 text-[11px] font-semibold text-amber-600"
                    title="Ровно один прогноз в день: приоритет у топ-турниров, но при их отсутствии Мария может взять и другой турнир расписания"
                  >
                    <BadgeCheck className="size-3.5 shrink-0" aria-hidden />
                    Формат звезды: 1 прогноз в день с полным разбором логики —
                    приоритет топ-турниры, но возможен любой из расписания
                  </p>
                )}
              </div>
            </div>
          </DialogHeader>

          {loading ? (
            <div className="flex flex-col gap-3" aria-label="Загрузка профиля аналитика">
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-[76px] rounded-xl bg-zinc-200/70" />
                ))}
              </div>
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-[76px] rounded-xl bg-zinc-200/70" />
              ))}
            </div>
          ) : error ? (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-center text-sm text-rose-300"
            >
              Не удалось загрузить профиль: {error}
            </div>
          ) : t && profile ? (
            <>
              {/* Сетка статистики */}
              <div className="grid grid-cols-2 gap-3">
                <StatCell
                  label="Winrate"
                  icon={TrendingUp}
                  value={fmtPct(t.winrate, 1)}
                  accent={t.winrate >= 50 ? 'text-emerald-600' : 'text-zinc-900'}
                />
                <StatCell
                  label="Прибыль"
                  icon={TrendingUp}
                  value={`${fmtUnits(t.profit)} юн.`}
                  accent={
                    t.profit > 0
                      ? 'text-emerald-600'
                      : t.profit < 0
                        ? 'text-rose-600'
                        : 'text-zinc-500'
                  }
                />
                <StatCell
                  label="Победы / поражения"
                  icon={Target}
                  value={`${t.won} / ${t.lost}${t.voided > 0 ? ` · ${t.voided} возвр.` : ''}`}
                />
                <StatCell label="Ср. коэф." icon={Wallet} value={fmtOdds(t.avgOdds)} accent="text-amber-600" />
              </div>

              {/* Последние прогнозы */}
              <div className="flex flex-col gap-3">
                <h3 className="flex items-center gap-2 text-xs font-bold tracking-widest text-zinc-500 uppercase">
                  <Award className="size-3.5 text-emerald-600" aria-hidden />
                  Последние {profile.bets.length}{' '}
                  {plural(profile.bets.length, ['прогноз', 'прогноза', 'прогнозов'])}
                </h3>
                {profile.bets.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-200 bg-zinc-100 p-8 text-center">
                    <span className="grid size-12 place-items-center rounded-full border border-zinc-300/60 bg-zinc-200/70">
                      <SearchX className="size-6 text-zinc-500" aria-hidden />
                    </span>
                    <p className="text-sm text-zinc-500">
                      У аналитика пока нет опубликованных прогнозов
                    </p>
                  </div>
                ) : (
                  <div className="dark-scrollbar flex max-h-[42vh] flex-col gap-2 overflow-y-auto pr-1">
                    {profile.bets.map((bet) => (
                      <BetRow key={bet.id} bet={bet} onOpen={() => setSelectedBet(bet)} />
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-zinc-600">
                  Нажмите на прогноз, чтобы открыть подробности
                </p>
              </div>
            </>
          ) : null}
        </div>
      </DialogContent>

      {/* Вложенная модалка деталей прогноза */}
      <BetDetailsDialog bet={selectedBet} onOpenChange={(o) => !o && setSelectedBet(null)} />
    </Dialog>
  )
}
