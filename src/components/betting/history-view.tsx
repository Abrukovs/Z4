'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Inbox, Maximize2, SearchX, BadgeCheck } from 'lucide-react'
import { StatusBadge } from '@/components/betting/status-badge'
import { BetDetailsDialog } from '@/components/betting/bet-details-dialog'
import { FilterChip } from '@/components/betting/today-list'
import { HistoryPagination } from '@/components/betting/history-pagination'
import { SPORT_LIST } from '@/lib/sports'
import type { BetDto, BetStatus, HistoryBetsResponse, SportKey, TipsterStatsDto } from '@/lib/types'
import { betOutcome, fmtOdds, fmtShortDate, fmtTime, fmtUnits, plural } from '@/lib/format'
import { cn } from '@/lib/utils'

type StatusFilter = 'all' | BetStatus

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Все статусы' },
  { value: 'won', label: 'Выигрыш' },
  { value: 'lost', label: 'Проигрыш' },
  { value: 'void', label: 'Возврат' },
]

const PAGE_SIZE = 12

export function HistoryView({
  reloadToken,
  tipsters = [],
}: {
  reloadToken: number
  tipsters?: TipsterStatsDto[]
}) {
  const [sport, setSport] = useState<SportKey | 'all'>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [tipster, setTipster] = useState<string>('all')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<HistoryBetsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<BetDto | null>(null)

  // Пользователь сменил страницу/фильтр → показать скелетон (poll-обновления — молча)
  const userActionRef = useRef(false)
  // Следующий перезапрос должен быть молчаливым (зажим страницы после смещения данных)
  const silentNextRef = useRef(false)
  const lastTokenRef = useRef<number | null>(null)
  const reqSeqRef = useRef(0)

  const listTopRef = useRef<HTMLDivElement>(null)
  const desktopScrollRef = useRef<HTMLDivElement>(null)
  const mobileScrollRef = useRef<HTMLDivElement>(null)

  // Загрузка страницы истории: при монтировании, смене фильтров/страницы и на каждый poll-тик.
  // poll-тик и зажим страницы обновляют данные молча (без скелетонов).
  useEffect(() => {
    const tokenChanged = lastTokenRef.current !== null && lastTokenRef.current !== reloadToken
    lastTokenRef.current = reloadToken
    const silent = !userActionRef.current && (tokenChanged || silentNextRef.current)
    userActionRef.current = false
    silentNextRef.current = false

    if (!silent) setLoading(true)
    const seq = ++reqSeqRef.current
    let cancelled = false

    const url =
      `/api/bets?tab=history&page=${page}&pageSize=${PAGE_SIZE}` +
      (sport !== 'all' ? `&sport=${sport}` : '') +
      (status !== 'all' ? `&status=${status}` : '') +
      (tipster !== 'all' ? `&tipster=${tipster}` : '')

    const load = async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(body?.error ?? `Ошибка ${res.status}`)
        }
        const json = (await res.json()) as HistoryBetsResponse
        if (cancelled || seq !== reqSeqRef.current) return
        setData(json)
        setError(null)
        // Рассчитанные матчи переезжают в историю и total смещается:
        // если страница вышла за диапазон — молча зажимаем её к последней
        if (json.totalPages > 0 && page > json.totalPages) {
          silentNextRef.current = true
          setPage(json.totalPages)
        }
      } catch (e) {
        if (cancelled || seq !== reqSeqRef.current) return
        setError((e as Error).message)
      } finally {
        if (!cancelled && seq === reqSeqRef.current) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [sport, status, tipster, page, reloadToken])

  const goToPage = (p: number) => {
    if (p === page || p < 1 || (data && data.totalPages > 0 && p > data.totalPages)) return
    userActionRef.current = true
    // К началу списка: сброс внутренней прокрутки + плавный скролл к контейнеру
    desktopScrollRef.current?.scrollTo({ top: 0 })
    mobileScrollRef.current?.scrollTo({ top: 0 })
    listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setPage(p)
  }

  const changeSport = (s: SportKey | 'all') => {
    userActionRef.current = true
    setSport(s)
    if (page !== 1) setPage(1)
  }

  const changeStatus = (v: string) => {
    userActionRef.current = true
    setStatus(v as StatusFilter)
    if (page !== 1) setPage(1)
  }

  const changeTipster = (v: string) => {
    userActionRef.current = true
    setTipster(v)
    if (page !== 1) setPage(1)
  }

  const rowKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const bet = data?.bets.find((b) => b.id === (e.currentTarget as HTMLElement).dataset.betId)
      if (bet) setSelected(bet)
    }
  }

  const bets = data?.bets ?? []
  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? 0
  const pageSize = data?.pageSize ?? PAGE_SIZE
  const current = data?.page ?? 1
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1
  const to = Math.min(current * pageSize, total)

  return (
    <div className="flex flex-col gap-4">
      <div ref={listTopRef} className="scroll-mt-28" />

      {/* Фильтры */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Фильтр по виду спорта" className="flex flex-wrap gap-2">
          <FilterChip active={sport === 'all'} onClick={() => changeSport('all')} label="Все" />
          {SPORT_LIST.map((s) => (
            <FilterChip
              key={s.key}
              active={sport === s.key}
              onClick={() => changeSport(s.key)}
              label={s.label}
              icon={s.icon}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div aria-label="Фильтр по статусу">
            <Select value={status} onValueChange={changeStatus}>
              <SelectTrigger
                aria-label="Статус прогноза"
                className="h-11 border-zinc-200 bg-zinc-100 text-zinc-700"
              >
                <SelectValue placeholder="Статус" />
              </SelectTrigger>
              <SelectContent className="border-zinc-200 bg-white text-zinc-800">
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    className="focus:bg-zinc-100 focus:text-zinc-900"
                  >
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {tipsters.length > 0 && (
            <div aria-label="Фильтр по аналитику">
              <Select value={tipster} onValueChange={changeTipster}>
                <SelectTrigger
                  aria-label="Аналитик"
                  className="h-11 max-w-[190px] border-zinc-200 bg-zinc-100 text-zinc-700"
                >
                  <SelectValue placeholder="Аналитик" />
                </SelectTrigger>
                <SelectContent className="max-h-72 border-zinc-200 bg-white text-zinc-800">
                  <SelectItem value="all" className="focus:bg-zinc-100 focus:text-zinc-900">
                    Все аналитики
                  </SelectItem>
                  {tipsters.map((t) => (
                    <SelectItem
                      key={t.id}
                      value={t.id}
                      className="focus:bg-zinc-100 focus:text-zinc-900"
                    >
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2" aria-label="Загрузка истории" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg bg-zinc-200/70" />
          ))}
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-center text-sm text-rose-300"
        >
          Не удалось загрузить историю: {error}
        </div>
      ) : total === 0 ? (
        /* Пустое состояние: иконка в тонированном круге + заголовок + подпись */
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-200 bg-zinc-100 p-12 text-center">
          <span className="grid size-14 place-items-center rounded-full border border-zinc-300/60 bg-zinc-200/70">
            <SearchX className="size-7 text-zinc-500" aria-hidden />
          </span>
          <p className="text-base font-semibold text-zinc-800">Прогнозов не найдено</p>
          <p className="max-w-sm text-sm text-zinc-600">
            По выбранным фильтрам нет ни одного завершённого прогноза — попробуйте сбросить фильтры
          </p>
        </div>
      ) : (
        <>
          {/* Таблица: md+ */}
          <div
            ref={desktopScrollRef}
            className="dark-scrollbar hidden max-h-[560px] overflow-y-auto rounded-xl border border-zinc-200 md:block"
          >
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-white">
                <TableRow className="border-zinc-200 hover:bg-transparent">
                  <TableHead className="text-zinc-500">Дата</TableHead>
                  <TableHead className="text-zinc-500">Матч</TableHead>
                  <TableHead className="text-zinc-500">Прогноз</TableHead>
                  <TableHead className="text-zinc-500">Коэф.</TableHead>
                  <TableHead className="text-zinc-500">Ставка</TableHead>
                  <TableHead className="text-zinc-500">Статус</TableHead>
                  <TableHead className="text-right text-zinc-500">Итог, юн.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bets.map((bet) => {
                  const outcome = betOutcome(bet.status, bet.stake, bet.odds)
                  return (
                    <TableRow
                      key={bet.id}
                      data-bet-id={bet.id}
                      tabIndex={0}
                      title={bet.resultNote ?? 'Открыть подробности прогноза'}
                      aria-label={`Открыть подробности: ${bet.homeTeam} — ${bet.awayTeam}`}
                      onClick={() => setSelected(bet)}
                      onKeyDown={rowKeyDown}
                      className="group cursor-pointer border-zinc-200 even:bg-zinc-100 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-emerald-500"
                    >
                      <TableCell className="whitespace-nowrap text-zinc-500">
                        <span className="block text-xs">{fmtShortDate(bet.matchDate)}</span>
                        <span className="block font-mono text-xs text-zinc-600 tabular-nums">
                          {fmtTime(bet.matchDate)}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        <span className="flex items-center gap-1.5">
                          <BadgeCheck
                            className="size-3.5 shrink-0 text-emerald-600"
                            aria-label="Реальный матч"
                          />
                          <span className="block truncate text-sm font-semibold text-zinc-900">
                            {bet.homeTeam} — {bet.awayTeam}
                          </span>
                          <Maximize2
                            className="size-3 shrink-0 text-zinc-600 transition-colors group-hover:text-emerald-600 md:opacity-0 md:group-hover:opacity-100"
                            aria-hidden
                          />
                        </span>
                        <span className="block text-xs text-zinc-600">{bet.league}</span>
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        <span className="block truncate text-sm text-zinc-800">
                          {bet.selection}
                        </span>
                        <span className="block text-xs text-zinc-600">{bet.market}</span>
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold text-amber-600 tabular-nums">
                        {fmtOdds(bet.odds)}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-zinc-700 tabular-nums">
                        {bet.stake}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={bet.status} />
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right font-mono text-sm font-bold tabular-nums',
                          outcome > 0
                            ? 'text-emerald-600'
                            : outcome < 0
                              ? 'text-rose-600'
                              : 'text-zinc-600',
                        )}
                      >
                        {fmtUnits(outcome)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {/* Карточки: мобильные */}
          <div
            ref={mobileScrollRef}
            className="dark-scrollbar flex max-h-[560px] flex-col gap-3 overflow-y-auto md:hidden"
            aria-label="История прогнозов"
          >
            {bets.map((bet) => {
              const outcome = betOutcome(bet.status, bet.stake, bet.odds)
              return (
                <div
                  key={bet.id}
                  data-bet-id={bet.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Открыть подробности: ${bet.homeTeam} — ${bet.awayTeam}`}
                  onClick={() => setSelected(bet)}
                  onKeyDown={rowKeyDown}
                  data-sport={bet.sport}
                  className="bet-sport-accent flex cursor-pointer flex-col gap-2 rounded-xl border border-zinc-200 bg-white/70 p-4 transition-all duration-200 active:scale-[0.99] hover:border-emerald-500/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-600">
                      <BadgeCheck className="size-3.5 text-emerald-600" aria-label="Реальный матч" />
                      {fmtShortDate(bet.matchDate)}, {fmtTime(bet.matchDate)} · {bet.league}
                    </span>
                    <StatusBadge status={bet.status} />
                  </div>
                  <p className="text-sm font-bold text-zinc-900">
                    {bet.homeTeam} — {bet.awayTeam}
                  </p>
                  <p className="text-sm text-zinc-700">
                    <span className="text-zinc-600">{bet.market}:</span> {bet.selection}
                  </p>
                  <div className="flex items-center justify-between border-t border-zinc-200 pt-2 text-xs">
                    <span className="font-mono font-bold text-amber-600 tabular-nums">
                      {fmtOdds(bet.odds)}
                    </span>
                    <span className="font-mono text-zinc-500 tabular-nums">
                      Ставка: {bet.stake} юн.
                    </span>
                    <span
                      className={cn(
                        'font-mono font-bold tabular-nums',
                        outcome > 0
                          ? 'text-emerald-600'
                          : outcome < 0
                            ? 'text-rose-600'
                            : 'text-zinc-600',
                      )}
                    >
                      {fmtUnits(outcome)} юн.
                    </span>
                  </div>
                  {bet.resultNote && (
                    <p className="text-xs text-zinc-600 italic">{bet.resultNote}</p>
                  )}
                </div>
              )
            })}
          </div>

          {/* Счётчик и пагинация */}
          <div className="flex flex-col gap-3">
            <p className="text-center text-xs text-zinc-600 tabular-nums" aria-live="polite">
              Показано {from}–{to} из {total}{' '}
              {plural(total, ['прогноза', 'прогнозов', 'прогнозов'])} · клик по прогнозу открывает разбор
            </p>
            <HistoryPagination page={data?.page ?? 1} totalPages={totalPages} onChange={goToPage} />
          </div>
        </>
      )}

      <BetDetailsDialog bet={selected} onOpenChange={(o) => !o && setSelected(null)} />
    </div>
  )
}
