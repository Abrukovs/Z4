'use client'

import { cn } from '@/lib/utils'

/**
 * Живой индикатор матча: пульсирующая точка + фаза («1-й тайм», «перерыв»)
 * + текущий счёт из реального расписания.
 *
 * size: xs — компактно в шапке карточки; sm — строка в диалоге;
 * lg — крупно в hero-блоке ставки дня.
 */
export function LiveIndicator({
  phase,
  score,
  size = 'sm',
  className,
}: {
  phase: string
  score?: string | null
  size?: 'xs' | 'sm' | 'lg'
  className?: string
}) {
  const dotSize = size === 'xs' ? 'size-1.5' : size === 'lg' ? 'size-2.5' : 'size-2'
  const phaseCls =
    size === 'xs' ? 'text-[11px]' : size === 'lg' ? 'text-sm font-bold' : 'text-xs font-bold'
  const scoreCls =
    size === 'xs'
      ? 'text-xs font-bold'
      : size === 'lg'
        ? 'font-mono text-2xl font-extrabold'
        : 'font-mono text-base font-bold'

  return (
    <span
      className={cn('inline-flex items-center gap-2 text-amber-600', className)}
      aria-live="polite"
      aria-label={`Матч идёт: ${phase}${score ? `, счёт ${score}` : ''}`}
    >
      <span className={cn('relative flex shrink-0', dotSize)}>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-60" />
        <span className={cn('relative inline-flex rounded-full bg-amber-400', dotSize)} />
      </span>
      <span className={cn('tracking-wide uppercase', phaseCls)}>{phase}</span>
      {score ? (
        <span className={cn('tabular-nums', scoreCls)}>{score}</span>
      ) : null}
    </span>
  )
}
