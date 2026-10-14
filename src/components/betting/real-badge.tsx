'use client'

import { BadgeCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Бейдж источника прогноза: «реальный матч» — прогноз построен на матче
 * из живого расписания (Спорт-Экспресс). Демо-прогнозов больше не существует:
 * сайт работает только с настоящими событиями (Task 21).
 */
export function RealBadge({
  size = 'sm',
  className,
}: {
  /** Оставлен для обратной совместимости вызовов — всегда реальный матч */
  isReal?: boolean
  size?: 'sm' | 'xs'
  className?: string
}) {
  return (
    <span
      title="Прогноз на реальный матч из живого расписания; коэффициент примерный"
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 font-bold text-emerald-600',
        size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-2 py-0.5 text-[11px]',
        className,
      )}
    >
      <BadgeCheck className={size === 'sm' ? 'size-3.5' : 'size-3'} aria-hidden />
      реальный матч
    </span>
  )
}
