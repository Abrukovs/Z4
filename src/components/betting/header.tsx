'use client'

import { BellRing, Zap, TrendingUp, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useReminders } from '@/components/betting/use-reminders'
import { cn } from '@/lib/utils'
import { fmtPct } from '@/lib/format'

export type NavDestination =
  | 'today'
  | 'matches'
  | 'history'
  | 'tipsters'
  | 'articles'
  | 'stats'
  | 'how'
  | 'subscribe'
  | 'digest'

interface HeaderProps {
  winrate: number | null
  onNavigate: (dest: NavDestination) => void
  onRefresh: () => void
  refreshing: boolean
}

interface NavItem {
  dest: NavDestination
  label: string
  /** Показывать только на широких экранах (чтобы шапка не переполнялась) */
  wide?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { dest: 'today', label: 'Прогнозы' },
  { dest: 'matches', label: 'Расписание' },
  { dest: 'history', label: 'История' },
  { dest: 'tipsters', label: 'Аналитики' },
  { dest: 'articles', label: 'Разборы' },
  { dest: 'stats', label: 'Статистика' },
  { dest: 'how', label: 'Как работает', wide: true },
  { dest: 'digest', label: 'Telegram', wide: true },
  { dest: 'subscribe', label: 'Подписка', wide: true },
]

export function Header({ winrate, onNavigate, onRefresh, refreshing }: HeaderProps) {
  const { count } = useReminders()
  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
        <a
          href="#bet-of-day"
          className="group flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-500"
          aria-label="Ставка Дня — на главную"
        >
          <span className="grid size-9 place-items-center rounded-xl bg-emerald-500 shadow-[0_6px_20px_-8px_rgba(16,185,129,0.55)] transition-all duration-300 group-hover:scale-105 group-hover:shadow-[0_8px_28px_-8px_rgba(16,185,129,0.65)]">
            <Zap className="size-5 text-zinc-950 transition-transform duration-300 group-hover:rotate-12" aria-hidden />
          </span>
          <span className="text-lg font-extrabold tracking-tight text-zinc-900 transition-colors group-hover:text-white">
            Ставка <span className="text-emerald-600">Дня</span>
          </span>
        </a>

        {/* Десктопная навигация: flex-1 + min-w-0 + внутренняя прокрутка —
            узкие окна не выталкивают правые контролы (winrate/обновление) за экран */}
        <nav
          aria-label="Основная навигация"
          className="dark-scrollbar hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto md:flex"
        >
          {NAV_ITEMS.map((item) => (
            <button
              key={item.dest}
              type="button"
              onClick={() => onNavigate(item.dest)}
              className={cn(
                'shrink-0 rounded-lg px-4 py-2 text-sm font-medium whitespace-nowrap text-zinc-500 transition-all hover:bg-zinc-200/70 hover:text-zinc-900 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500',
                // Второстепенные якоря появляются только на широких экранах
                item.wide && 'hidden xl:inline-flex',
              )}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          {count > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-600"
              title={`Напоминаний включено: ${count} — сработают за 10 минут до начала матчей`}
            >
              <BellRing className="size-3.5 animate-pulse" aria-hidden />
              <span className="tabular-nums">{count}</span>
              <span className="sr-only">активных напоминаний</span>
            </span>
          )}
          {winrate !== null && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-600"
              title="Процент выигравших прогнозов"
            >
              <TrendingUp className="size-3.5" aria-hidden />
              Winrate {fmtPct(winrate)}
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Обновить прогнозы на реальные матчи"
            title="Обновить прогнозы на реальные матчи"
            className="size-9 border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 active:scale-[0.97]"
          >
            <RotateCcw className={cn('size-4', refreshing && 'animate-spin')} aria-hidden />
          </Button>
        </div>
      </div>

      {/* Компактная навигация для мобильных (только ключевые разделы) */}
      <nav
        aria-label="Мобильная навигация"
        className="dark-scrollbar flex items-center justify-center gap-1 overflow-x-auto border-t border-zinc-200 py-1 md:hidden"
      >
        {NAV_ITEMS.filter((item) => !item.wide).map((item) => (
          <button
            key={item.dest}
            type="button"
            onClick={() => onNavigate(item.dest)}
            className="shrink-0 rounded-lg px-3 py-2.5 text-[13px] font-medium text-zinc-500 transition-all hover:bg-zinc-200/70 hover:text-zinc-900 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
          >
            {item.label}
          </button>
        ))}
      </nav>
    </header>
  )
}
