'use client'

import { Goal, Volleyball, Snowflake, Dumbbell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { sportLabel } from '@/lib/sports'

/** Статичный глиф вида спорта (без динамического создания компонента) */
export function SportGlyph({
  sport,
  className,
}: {
  sport: string
  className?: string
}) {
  switch (sport) {
    case 'football':
      return <Goal className={className} aria-hidden />
    case 'tennis':
      return <Volleyball className={className} aria-hidden />
    case 'hockey':
      return <Snowflake className={className} aria-hidden />
    case 'basketball':
      return <Dumbbell className={className} aria-hidden />
    default:
      return <Dumbbell className={className} aria-hidden />
  }
}

export function SportChip({ sport, className }: { sport: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-zinc-300/60 bg-zinc-200/70 px-2.5 py-1 text-xs font-medium text-zinc-700',
        className,
      )}
    >
      <SportGlyph sport={sport} className="size-3.5 text-emerald-600" />
      {sportLabel(sport)}
    </span>
  )
}
