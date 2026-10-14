'use client'

import { Fragment, useMemo, useState } from 'react'
import { CalendarDays, Inbox, Loader2, Sparkles, CalendarClock } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { SPORT_LIST } from '@/lib/sports'
import { BetCard } from '@/components/betting/bet-card'
import type { BetDto, SportKey } from '@/lib/types'
import { plural } from '@/lib/format'

/** Матч из завтрашнего расписания (вечерний набор) — календарный день отличается */
function isTomorrowBet(bet: BetDto): boolean {
  return new Date(bet.matchDate).toDateString() !== new Date().toDateString()
}

/** Разделитель «Завтра» — отделяет вечерний набор из завтрашнего расписания */
function TomorrowDivider({ count }: { count: number }) {
  return (
    <div
      role="separator"
      aria-label={`Прогнозы на завтра, ${count}`}
      className="flex items-center gap-3 pt-2"
    >
      <CalendarDays className="size-4 shrink-0 text-emerald-600" aria-hidden />
      <span className="text-xs font-bold tracking-widest text-emerald-600 uppercase">
        Завтра
      </span>
      <span className="text-xs font-medium whitespace-nowrap text-zinc-600">
        {count} {plural(count, ['прогноз', 'прогноза', 'прогнозов'])} из завтрашнего расписания
      </span>
      <div
        aria-hidden
        className="h-px flex-1 bg-gradient-to-r from-emerald-500/30 via-zinc-200 to-transparent"
      />
    </div>
  )
}

export function TodayList({
  bets,
  loading,
  error,
  realMode = false,
  onReload,
}: {
  bets: BetDto[]
  loading: boolean
  error: string | null
  /** true — лента строится на реальных матчах (генерация через LLM может занять время) */
  realMode?: boolean
  onReload?: () => void
}) {
  const [sport, setSport] = useState<SportKey | 'all'>('all')
  const [seeding, setSeeding] = useState(false)

  const handleGenerate = async () => {
    setSeeding(true)
    try {
      const res = await fetch('/api/real-bets/seed', { method: 'POST' })
      const body = (await res.json().catch(() => null)) as { ok?: boolean; added?: number } | null
      if (!res.ok || !body?.ok) throw new Error()
      if (body.added && body.added > 0) {
        toast.success(`Подобрано прогнозов: ${body.added}`, {
          description: 'Прогнозы на реальные матчи из живого расписания',
        })
      } else {
        toast.info('Новые прогнозы не потребовались', {
          description: 'Все подходящие реальные матчи уже покрыты прогнозами',
        })
      }
      onReload?.()
    } catch {
      toast.error('Не удалось подобрать прогнозы', {
        description: 'Расписание недоступно — попробуйте ещё раз через минуту',
      })
    } finally {
      setSeeding(false)
    }
  }

  const filtered = useMemo(() => {
    const sorted = [...bets].sort((a, b) => a.matchDate.localeCompare(b.matchDate))
    return sport === 'all' ? sorted : sorted.filter((b) => b.sport === sport)
  }, [bets, sport])

  // Счётчики для чипов фильтра — считаем по несортированной ленте
  const sportCounts = useMemo(() => {
    const c: Record<SportKey | 'all', number> = { all: bets.length, football: 0, tennis: 0, hockey: 0, basketball: 0 }
    for (const b of bets) c[b.sport] = (c[b.sport] ?? 0) + 1
    return c
  }, [bets])

  // «Ближайший матч»: первый предстоящий прогноз в текущем фильтре
  const nearestId = useMemo(() => {
    const nowMs = Date.now()
    return filtered.find((b) => new Date(b.matchDate).getTime() > nowMs)?.id ?? null
  }, [filtered])

  return (
    <div className="flex flex-col gap-4">
      {/* Фильтр по виду спорта */}
      <div role="group" aria-label="Фильтр по виду спорта" className="flex flex-wrap gap-2">
        <FilterChip
          active={sport === 'all'}
          onClick={() => setSport('all')}
          label="Все"
          count={!loading ? sportCounts.all : undefined}
        />
        {SPORT_LIST.map((s) => (
          <FilterChip
            key={s.key}
            active={sport === s.key}
            onClick={() => setSport(s.key)}
            label={s.label}
            icon={s.icon}
            count={!loading ? sportCounts[s.key] : undefined}
          />
        ))}
      </div>

      {loading ? (
        <div className="flex flex-col gap-4" aria-label="Загрузка прогнозов">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl bg-zinc-200/70" />
          ))}
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-center text-sm text-rose-300"
        >
          Не удалось загрузить прогнозы: {error}
        </div>
      ) : filtered.length === 0 ? (
        realMode ? (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-emerald-500/30 bg-emerald-500/5 p-10 text-center md:p-12">
            <span className="relative grid size-14 place-items-center rounded-full border border-emerald-500/40 bg-emerald-500/10">
              <Sparkles className="size-7 text-emerald-600" aria-hidden />
              <span className="absolute -top-1 -right-1 flex size-3.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex size-3.5 rounded-full bg-emerald-400" />
              </span>
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-base font-semibold text-zinc-900">
                Подбираем прогнозы на реальные матчи
              </p>
              <p className="max-w-md text-sm text-zinc-500">
                Аналитика изучает живое расписание — прогнозы появятся здесь автоматически
                через минуту. Можно ускорить вручную.
              </p>
            </div>
            <Button
              type="button"
              onClick={handleGenerate}
              disabled={seeding}
              className="h-11 gap-2 bg-emerald-500 text-sm font-bold text-zinc-950 shadow-[0_8px_24px_-10px_rgba(16,185,129,0.5)] transition-all hover:bg-emerald-400 active:scale-[0.98]"
            >
              {seeding ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="size-4" aria-hidden />
              )}
              {seeding ? 'Подбираем...' : 'Подобрать прогнозы сейчас'}
            </Button>
            <a
              href="#real-matches"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600/80 underline-offset-4 transition-colors hover:text-emerald-600 hover:underline"
            >
              <CalendarClock className="size-3.5" aria-hidden />
              Смотреть сегодняшнее расписание матчей
            </a>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-200 bg-zinc-100 p-12 text-center">
            <span className="grid size-14 place-items-center rounded-full border border-zinc-300/60 bg-zinc-200/70">
              <Inbox className="size-7 text-zinc-500" aria-hidden />
            </span>
            <p className="text-base font-semibold text-zinc-800">На сегодня прогнозов больше нет</p>
            <p className="max-w-sm text-sm text-zinc-600">
              Новые прогнозы появляются каждый день — загляните завтра
            </p>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-4">
          {(() => {
            const tomorrowCount = filtered.filter(isTomorrowBet).length
            return filtered.map((bet, i) => {
              const tomorrow = isTomorrowBet(bet)
              const firstTomorrow = tomorrow && (i === 0 || !isTomorrowBet(filtered[i - 1]))
              return (
                <Fragment key={bet.id}>
                  {firstTomorrow && <TomorrowDivider count={tomorrowCount} />}
                  <BetCard bet={bet} index={i} isNearest={bet.id === nearestId} />
                </Fragment>
              )
            })
          })()}
        </div>
      )}
    </div>
  )
}

export function FilterChip({
  label,
  active,
  onClick,
  icon: Icon,
  count,
}: {
  label: string
  active: boolean
  onClick: () => void
  icon?: React.ComponentType<{ className?: string }>
  /** Количество прогнозов в категории (не показывается при загрузке) */
  count?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-all active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500',
        active
          ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-600'
          : 'border-zinc-200 bg-zinc-100 text-zinc-500 hover:border-zinc-300 hover:text-zinc-800',
      )}
    >
      {Icon && <Icon className="size-4" aria-hidden />}
      {label}
      {typeof count === 'number' && (
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums',
            active ? 'bg-emerald-500/20 text-emerald-700' : 'bg-zinc-100 text-zinc-600',
          )}
          aria-hidden
        >
          {count}
        </span>
      )}
    </button>
  )
}
