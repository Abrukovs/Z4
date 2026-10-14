'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Radio } from 'lucide-react'
import { SPORTS } from '@/lib/sports'
import type { RealMatchDto, RealMatchesResponse, SportKey } from '@/lib/types'
import { cn } from '@/lib/utils'
import { plural } from '@/lib/format'

/** Частота опроса: серверный кэш расписания 2 мин — тикер дешёвый */
const TICKER_INTERVAL_MS = 90 * 1000

interface TickerItem {
  sport: SportKey
  match: RealMatchDto
}

/**
 * LiveTicker — компактная полоса текущих live-матчей дня.
 * Опрашивает /api/real-matches независимо (кэш на сервере делает это дешёвым),
 * показывает все идущие матчи со счётом; клик — прокрутка к расписанию.
 * Скрывается целиком, когда live-матчей нет.
 */
export function LiveTicker() {
  const [items, setItems] = useState<TickerItem[] | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/real-matches', { cache: 'no-store' })
      if (!res.ok) return
      const body = (await res.json()) as RealMatchesResponse
      if (!body.ok) return
      const live: TickerItem[] = []
      for (const [sport, matches] of Object.entries(body.sports) as [SportKey, RealMatchDto[]][]) {
        for (const match of matches) {
          if (match.status === 'live') live.push({ sport, match })
        }
      }
      // Сортировка: сначала матчи со счётом, стабильный порядок по времени старта
      live.sort((a, b) => (a.match.score ? 0 : 1) - (b.match.score ? 0 : 1))
      setItems(live)
      setUpdatedAt(new Date())
    } catch {
      // Тихо: тикер не критичен
    }
  }, [])

  useEffect(() => {
    // setState здесь строго после await (fetch) — каскадного синхронного ре-рендера
    // в эффекте нет; правило ложно-положительно на каноничном fetch-паттерне.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    const timer = setInterval(() => {
      if (!document.hidden) void load()
    }, TICKER_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [load])

  // Пока не загрузились или live-матчей нет — полосу не показываем (нет CLS)
  if (!items || items.length === 0) return null

  const scrollToSchedule = () => {
    document.getElementById('real-matches')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      aria-label="Идущие матчи — live-счёты"
      className="mx-auto w-full max-w-6xl px-4 pt-2"
    >
      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100">
        <div className="flex items-stretch">
          {/* Фиксированная «голова» полосы: пульс + LIVE + счётчик */}
          <button
            type="button"
            onClick={scrollToSchedule}
            aria-label={`Идут ${items.length} ${plural(items.length, ['матч', 'матча', 'матчей'])} — открыть расписание`}
            title="Открыть расписание"
            className="flex shrink-0 cursor-pointer items-center gap-2.5 border-r border-zinc-200 bg-gradient-to-r from-red-500/10 to-transparent px-4 py-3 transition-colors hover:bg-red-500/10 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-red-400"
          >
            <span className="relative flex size-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-red-500" />
            </span>
            <span className="text-xs font-black tracking-widest text-red-600 uppercase">
              Live
            </span>
            <span className="font-mono text-xs font-bold text-zinc-700 tabular-nums">
              {items.length}
            </span>
          </button>

          {/* Лента матчей: горизонтальный скролл */}
          <div
            role="list"
            aria-label="Live-матчи со счётом"
            className="dark-scrollbar flex flex-1 items-stretch gap-0 overflow-x-auto"
          >
            {items.map(({ sport, match }) => {
              const Icon = SPORTS[sport]?.icon
              return (
                <button
                  key={`${sport}|${match.time}|${match.home}|${match.away}`}
                  type="button"
                  role="listitem"
                  onClick={scrollToSchedule}
                  title={`${match.home} — ${match.away}, ${match.league}`}
                  className="group flex shrink-0 cursor-pointer items-center gap-2 border-r border-zinc-200 px-3.5 py-3 transition-colors last:border-r-0 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-emerald-500"
                >
                  {Icon && <Icon className="size-3.5 shrink-0 text-zinc-600 transition-colors group-hover:text-emerald-600" aria-hidden />}
                  <span className="flex min-w-0 flex-col items-start leading-tight">
                    <span className="max-w-[180px] truncate text-xs font-semibold whitespace-nowrap text-zinc-800 sm:max-w-[220px]">
                      {match.home} — {match.away}
                    </span>
                    <span className="max-w-[180px] truncate text-[10px] whitespace-nowrap text-zinc-600 sm:max-w-[220px]">
                      {match.phase ?? match.league}
                    </span>
                  </span>
                  {match.score && (
                    <span className="shrink-0 font-mono text-sm font-black text-amber-600 tabular-nums group-hover:text-amber-200">
                      {match.score}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Хвост: время обновления */}
          <span className="hidden shrink-0 items-center border-l border-zinc-200 px-3 text-[10px] font-semibold whitespace-nowrap text-zinc-600 md:flex">
            {updatedAt
              ? `обновлено ${new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(updatedAt)}`
              : null}
          </span>
        </div>
      </div>
    </motion.section>
  )
}
