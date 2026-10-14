'use client'

/**
 * Кнопка-колокольчик «Напомнить о матче»: локальное напоминание
 * за 10 минут до старта (браузерное уведомление + toast на сайте).
 * Скрывает себя для рассчитанных/уже начавшихся матчей.
 */

import { Bell, BellRing } from 'lucide-react'
import { useReminders } from '@/components/betting/use-reminders'
import { useNow } from '@/components/betting/use-now'
import type { BetDto } from '@/lib/types'
import { cn } from '@/lib/utils'

export function RemindToggle({
  bet,
  variant = 'icon',
  className,
}: {
  bet: BetDto
  variant?: 'icon' | 'button'
  className?: string
}) {
  const { isSet, toggle } = useReminders()
  const now = useNow(60_000)

  // Показываем только для будущих pending-матчей
  const pending = bet.status === 'pending'
  const startsInFuture =
    now === null || new Date(bet.matchDate).getTime() > now
  if (!pending || !startsInFuture) return null

  const active = isSet(bet.id)

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    void toggle(bet)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Не отдаём Enter/Space родительской карточке (она открывает диалог)
    e.stopPropagation()
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      void toggle(bet)
    }
  }

  const title = active
    ? 'Напоминание включено — нажмите, чтобы убрать'
    : 'Напомнить за 10 минут до начала матча'

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-pressed={active}
        aria-label={active ? `Убрать напоминание: ${bet.homeTeam} — ${bet.awayTeam}` : `Напомнить о матче: ${bet.homeTeam} — ${bet.awayTeam}`}
        title={title}
        className={cn(
          'grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border transition-all active:scale-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500',
          active
            ? 'border-amber-500/60 bg-amber-500/15 text-amber-600 shadow-[0_4px_14px_-6px_rgba(245,158,11,0.55)]'
            : 'border-zinc-300 bg-white/80 text-zinc-500 hover:border-amber-500/40 hover:text-amber-600',
          className,
        )}
      >
        {active ? (
          <BellRing className="size-4 animate-pulse" aria-hidden />
        ) : (
          <Bell className="size-4" aria-hidden />
        )}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-pressed={active}
      title={title}
      className={cn(
        'inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border text-sm font-bold transition-all active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500',
        active
          ? 'border-amber-500/60 bg-amber-500/15 text-amber-600 hover:bg-amber-500/25'
          : 'border-zinc-300 bg-zinc-100 text-zinc-800 hover:border-amber-500/40 hover:text-amber-600',
        className,
      )}
    >
      {active ? (
        <>
          <BellRing className="size-4 animate-pulse" aria-hidden />
          Напоминание включено
        </>
      ) : (
        <>
          <Bell className="size-4" aria-hidden />
          Напомнить о матче
        </>
      )}
    </button>
  )
}
