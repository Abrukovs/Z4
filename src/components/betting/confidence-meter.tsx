'use client'

import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { confidenceMeta } from '@/lib/format'

export function ConfidenceMeter({
  value,
  className,
  showLabel = true,
  barClassName = 'w-24',
}: {
  value: number
  className?: string
  showLabel?: boolean
  /** Ширина полосы прогресса (w-24 по умолчанию, w-full в модалке) */
  barClassName?: string
}) {
  const meta = confidenceMeta(value)
  const variant = value >= 80 ? 'high' : value >= 60 ? 'medium' : 'low'
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <Progress
        value={value}
        aria-label={`Уверенность ${value}%`}
        data-variant={variant}
        className={cn('confidence-bar h-1.5 bg-zinc-100', barClassName)}
      />
      {showLabel && (
        <span className={cn('text-xs font-semibold whitespace-nowrap', meta.className)}>
          {meta.label} · {value}%
        </span>
      )}
    </div>
  )
}
