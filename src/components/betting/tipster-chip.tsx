'use client'

import { cn } from '@/lib/utils'
import { initials } from '@/lib/format'
import type { TipsterDto } from '@/lib/types'

const AVATAR_COLORS = [
  'bg-emerald-500/20 text-emerald-600 border-emerald-500/40',
  'bg-amber-500/20 text-amber-600 border-amber-500/40',
  'bg-teal-500/20 text-teal-700 border-teal-500/40',
]

function colorFor(name: string): string {
  const sum = [...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return AVATAR_COLORS[sum % AVATAR_COLORS.length]
}

export function TipsterChip({
  tipster,
  className,
  compact = false,
}: {
  tipster?: TipsterDto | null
  className?: string
  compact?: boolean
}) {
  if (!tipster) return null
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        aria-hidden
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-full border text-[11px] font-bold',
          colorFor(tipster.name),
        )}
      >
        {initials(tipster.name)}
      </span>
      {!compact && (
        <span className="flex flex-col leading-tight">
          <span className="text-xs font-semibold text-zinc-800">{tipster.name}</span>
          <span className="text-[10px] text-zinc-600">{tipster.role}</span>
        </span>
      )}
      {compact && (
        <span className="sr-only">
          {tipster.name}, {tipster.role}
        </span>
      )}
    </span>
  )
}
