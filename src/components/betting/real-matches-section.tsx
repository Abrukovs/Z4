'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarX2,
  ExternalLink,
  Inbox,
  RefreshCw,
  Satellite,
  Search,
  SearchX,
  X,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SectionHeader } from '@/components/betting/section-header'
import { SPORT_LIST, sportIcon } from '@/lib/sports'
import { fmtTime } from '@/lib/format'
import type {
  RealMatchDto,
  RealMatchStatus,
  RealMatchesResponse,
  SportKey,
} from '@/lib/types'
import { cn } from '@/lib/utils'

/** Автообновление расписания: серверный кэш 2 мин, поэтому частый опрос
 * дешёвый — держим live-счёты почти в реальном времени */
const REFRESH_INTERVAL_MS = 90 * 1000

type StatusFilter = 'all' | RealMatchStatus

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'upcoming', label: 'Предстоящие' },
  { key: 'live', label: 'Идут' },
  { key: 'finished', label: 'Завершённые' },
]

const STATUS_BADGE: Record<RealMatchStatus, { label: string; className: string }> = {
  upcoming: {
    label: 'Предстоит',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-600',
  },
  live: {
    label: 'Идёт',
    className: 'border-red-500/40 bg-red-500/10 text-red-600',
  },
  finished: {
    label: 'Завершён',
    className: 'border-zinc-300 bg-zinc-100 text-zinc-700',
  },
  canceled: {
    label: 'Отменён',
    className: 'border-zinc-200 bg-white text-zinc-600',
  },
}

function MatchRow({ match, href }: { match: RealMatchDto; href: string }) {
  const badge = STATUS_BADGE[match.status]
  const isLive = match.status === 'live'
  const badgeLabel = isLive && match.phase ? `${badge.label} · ${match.phase}` : badge.label
  const ariaLabel = `${match.home} — ${match.away}, ${match.league}, ${match.time} МСК, ${badgeLabel.toLowerCase()}${match.score ? `, счёт ${match.score}` : ''}`
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      className={cn(
        'flex min-h-[52px] items-center gap-3 border-b border-zinc-200 px-3 py-2.5 transition-colors last:border-b-0 focus-visible:bg-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-500 sm:gap-4 sm:px-4',
        // Живые матчи чуть подсвечены — глаз сразу находит игру со счётом
        isLive
          ? 'bg-amber-500/[0.04] hover:bg-amber-500/10'
          : 'hover:bg-white/70',
      )}
    >
      <span
        className={cn(
          'w-11 shrink-0 font-mono text-sm font-bold tabular-nums',
          isLive ? 'text-amber-600' : 'text-amber-600/90',
        )}
      >
        {match.time}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-semibold tracking-wider text-zinc-600 uppercase">
          {match.league}
        </span>
        <span className="block truncate text-sm font-semibold text-zinc-900">
          {match.home} — {match.away}
        </span>
      </span>
      {match.score && (
        <span
          className={cn(
            'shrink-0 font-mono text-sm font-bold tabular-nums',
            isLive ? 'text-amber-600' : 'text-zinc-900',
          )}
        >
          {match.score}
        </span>
      )}
      {isLive ? (
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold',
            badge.className,
          )}
        >
          <span className="relative flex size-1.5" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-red-400" />
          </span>
          {badgeLabel}
        </span>
      ) : (
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-bold',
            badge.className,
          )}
        >
          {badge.label}
        </span>
      )}
    </a>
  )
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-zinc-200 px-3 py-3.5 last:border-b-0 sm:gap-4 sm:px-4">
      <Skeleton className="h-4 w-11 shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-2.5 w-28" />
        <Skeleton className="h-4 w-44" />
      </div>
      <Skeleton className="h-6 w-20 shrink-0 rounded-full" />
    </div>
  )
}

/** День расписания: сегодня или завтра (ленивые запросы по переключению) */
type DayKey = 'today' | 'tomorrow'

const DAY_TABS: { key: DayKey; label: string }[] = [
  { key: 'today', label: 'Сегодня' },
  { key: 'tomorrow', label: 'Завтра' },
]

export function RealMatchesSection() {
  const [day, setDay] = useState<DayKey>('today')
  const [dataByDay, setDataByDay] = useState<Partial<Record<DayKey, RealMatchesResponse>>>({})
  const [loadingDay, setLoadingDay] = useState<DayKey | null>('today')
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const [sport, setSport] = useState<SportKey>('football')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')

  const load = useCallback(async (targetDay: DayKey, force = false) => {
    setLoadingDay(targetDay)
    try {
      const qs = new URLSearchParams()
      if (force) qs.set('force', '1')
      if (targetDay === 'tomorrow') qs.set('date', 'tomorrow')
      const res = await fetch(`/api/real-matches${qs.size ? `?${qs.toString()}` : ''}`, {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`Ошибка ${res.status}`)
      const body = (await res.json()) as RealMatchesResponse
      if (!body.ok) throw new Error('Источник недоступен')
      setDataByDay((prev) => ({ ...prev, [targetDay]: body }))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить расписание')
    } finally {
      setLoadingDay(null)
    }
  }, [])

  useEffect(() => {
    void load('today')
  }, [load])

  // Автообновление активного дня (кэш на сервере — запрос дешёвый)
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void load(day)
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [load, day])

  const switchDay = useCallback(
    (d: DayKey) => {
      if (d === day) return
      setDay(d)
      setStatusFilter('all')
      setQuery('')
      if (!dataByDay[d]) void load(d)
    },
    [day, dataByDay, load],
  )

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    await load(day, true)
    setRefreshing(false)
  }, [load, day])

  const data = dataByDay[day] ?? null
  const loading = loadingDay === day
  const matches = useMemo(() => data?.sports[sport] ?? [], [data, sport])

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: matches.length,
      upcoming: 0,
      live: 0,
      finished: 0,
      canceled: 0,
    }
    for (const m of matches) c[m.status] += 1
    return c
  }, [matches])

  const filtered = useMemo(() => {
    const byStatus = statusFilter === 'all' ? matches : matches.filter((m) => m.status === statusFilter)
    const q = query.trim().toLowerCase()
    if (!q) return byStatus
    return byStatus.filter(
      (m) =>
        m.home.toLowerCase().includes(q) ||
        m.away.toLowerCase().includes(q) ||
        m.league.toLowerCase().includes(q),
    )
  }, [matches, statusFilter, query])

  const sourceUrl = data?.source.urls[sport] ?? 'https://www.sport-express.net/'
  // fetchedAt — UTC-мгновенье; подпись «(МСК)» обязана показывать московское время
  // (fmtTime форматирует в Europe/Moscow независимо от TZ браузера)
  const updatedAt = data ? fmtTime(data.fetchedAt) : null

  return (
    <section
      id="real-matches"
      aria-label="Реальное расписание матчей"
      className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-6"
    >
      <SectionHeader
        eyebrow="Живое расписание"
        title={day === 'tomorrow' ? 'Завтра в спорте — настоящие матчи' : 'Сегодня в спорте — настоящие матчи'}
        subtext="Реальное расписание по данным матч-центра «Спорт-Экспресс». Время московское, нажмите на матч, чтобы открыть источник."
      />

      <div className="animate-fade-up-sm overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100">
        {/* Шапка блока: источник + день + обновление */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-100 px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-500">
            <Satellite className="size-4 text-emerald-600" aria-hidden />
            <span className="hidden sm:inline">Источник:</span>
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-zinc-800 underline decoration-zinc-700 underline-offset-2 transition-colors hover:text-emerald-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
            >
              sport-express.net
              <ExternalLink className="size-3" aria-hidden />
            </a>
            {updatedAt && (
              <span className="text-zinc-600">· обновлено в {updatedAt} (МСК)</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Переключатель дня: Сегодня / Завтра */}
            <div
              role="tablist"
              aria-label="День расписания"
              className="inline-flex rounded-lg border border-zinc-200 bg-zinc-100 p-0.5"
            >
              {DAY_TABS.map((d) => {
                const isActive = day === d.key
                const isLazy = !dataByDay[d.key] && loadingDay === d.key
                return (
                  <button
                    key={d.key}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => switchDay(d.key)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-all active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500',
                      isActive
                        ? 'bg-emerald-500/15 text-emerald-600 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.35)]'
                        : 'text-zinc-500 hover:text-zinc-800',
                    )}
                  >
                    {d.label}
                    {isLazy && (
                      <span
                        aria-hidden
                        className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-400"
                      />
                    )}
                  </button>
                )
              })}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing || loading}
              aria-label="Обновить расписание"
              className="h-9 border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 active:scale-[0.97]"
            >
              <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} aria-hidden />
              Обновить
            </Button>
          </div>
        </div>

        {/* Фильтры: вид спорта + статус */}
        <div
          role="tablist"
          aria-label="Вид спорта"
          className="flex items-center gap-1.5 overflow-x-auto border-b border-zinc-200 px-3 py-2.5 sm:px-4 dark-scrollbar"
        >
          {SPORT_LIST.map((meta) => {
            const isActive = sport === meta.key
            const count = data ? (data.sports[meta.key]?.length ?? 0) : null
            return (
              <button
                key={meta.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setSport(meta.key)}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition-all active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500',
                  isActive
                    ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-600'
                    : 'border-zinc-300/80 bg-white text-zinc-500 hover:border-zinc-600 hover:text-zinc-800',
                )}
              >
                <meta.icon className="size-4" aria-hidden />
                {meta.label}
                {count === null ? (
                  /* первый заход: данных ещё нет — пульсирующая точка вместо «0»,
                     чтобы «0» не выглядело как «матчей нет» */
                  <span aria-hidden className="inline-block size-1.5 animate-pulse rounded-full bg-zinc-400" />
                ) : (
                  <span className="font-mono text-[11px] tabular-nums opacity-70">{count}</span>
                )}
              </button>
            )
          })}
        </div>
        <div
          role="tablist"
          aria-label="Статус матча"
          className="flex items-center gap-1.5 overflow-x-auto px-3 py-2.5 sm:px-4 dark-scrollbar"
        >
          {STATUS_FILTERS.map((f) => {
            const isActive = statusFilter === f.key
            const count = data ? (f.key === 'all' ? counts.all : counts[f.key as RealMatchStatus]) : null
            return (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setStatusFilter(f.key)}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500',
                  isActive
                    ? 'bg-zinc-100 text-zinc-900'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-700',
                )}
              >
                {f.label}
                {count === null ? (
                  <span aria-hidden className="inline-block size-1.5 animate-pulse rounded-full bg-zinc-400" />
                ) : (
                  <span className="font-mono tabular-nums opacity-60">{count}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Строка поиска: сотни событий — находим нужную команду за секунду */}
        <div className="flex items-center gap-2.5 border-b border-zinc-200 px-3 py-2.5 sm:px-4">
          <label htmlFor="schedule-search" className="sr-only">
            Поиск по расписанию: команда, игрок или лига
          </label>
          <Search className="size-4 shrink-0 text-zinc-600" aria-hidden />
          <input
            id="schedule-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск: команда, игрок или лига…"
            autoComplete="off"
            className="h-9 w-full min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-100 px-3 text-sm text-zinc-900 placeholder:text-zinc-600 transition-colors focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="font-mono text-xs font-bold text-emerald-600 tabular-nums" aria-live="polite">
                {filtered.length}
              </span>
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Очистить поиск"
                className="grid size-6 place-items-center rounded-md text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </span>
          )}
        </div>

        {/* Список матчей */}
        <div className="max-h-[540px] overflow-y-auto dark-scrollbar" role="list">
          {loading ? (
            <>
              {Array.from({ length: 7 }).map((_, i) => (
                <RowSkeleton key={i} />
              ))}
            </>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <span className="grid size-12 place-items-center rounded-full border border-red-500/30 bg-red-500/10">
                <AlertTriangle className="size-6 text-red-600" aria-hidden />
              </span>
              <p className="text-sm font-semibold text-zinc-800">
                Не удалось загрузить расписание
              </p>
              <p className="max-w-sm text-xs text-zinc-600">{error}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void load(day, true)}
                className="border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900"
              >
                <RefreshCw className="size-4" aria-hidden />
                Повторить
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <span className="grid size-12 place-items-center rounded-full border border-zinc-300 bg-zinc-200/70">
                {query.trim() ? (
                  <SearchX className="size-6 text-zinc-500" aria-hidden />
                ) : statusFilter === 'all' ? (
                  <Inbox className="size-6 text-zinc-500" aria-hidden />
                ) : (
                  <CalendarX2 className="size-6 text-zinc-500" aria-hidden />
                )}
              </span>
              <p className="text-sm font-semibold text-zinc-800">
                {query.trim()
                  ? 'Ничего не найдено'
                  : statusFilter === 'all'
                    ? 'Матчей в расписании нет'
                    : 'Матчей с этим статусом нет'}
              </p>
              <p className="text-xs text-zinc-600">
                {query.trim()
                  ? `По запросу «${query.trim()}» совпадений нет — проверьте раскладку или сократите запрос`
                  : statusFilter === 'all'
                    ? 'Источник не вернул расписание на сегодня — попробуйте обновить'
                    : 'Попробуйте другой фильтр или обновите расписание'}
              </p>
            </div>
          ) : (
            filtered.map((m, idx) => (
              <MatchRow key={`${m.league}|${m.time}|${m.home}|${idx}`} match={m} href={sourceUrl} />
            ))
          )}
        </div>
      </div>
    </section>
  )
}
