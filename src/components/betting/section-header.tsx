'use client'

import { cn } from '@/lib/utils'

/**
 * Единый паттерн заголовков секций:
 * маленький eyebrow (изумруд, uppercase, tracking-widest) → крупный заголовок → muted-подпись.
 * Декоративная деталь: тонкая вертикальная градиентная черта слева от eyebrow.
 */
export function SectionHeader({
  eyebrow,
  title,
  subtext,
  titleId,
  align = 'start',
}: {
  eyebrow: string
  title: string
  subtext?: string
  titleId?: string
  align?: 'start' | 'center'
}) {
  return (
    <div
      className={cn(
        'mb-6 flex flex-col gap-1.5',
        align === 'center' ? 'items-center text-center' : 'items-start',
      )}
    >
      <span className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="h-3.5 w-1 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600 shadow-[0_0_8px_-1px_rgba(16,185,129,0.8)]"
        />
        <span className="text-xs font-bold tracking-[0.25em] text-emerald-600 uppercase">
          {eyebrow}
        </span>
      </span>
      <h2
        id={titleId}
        className="text-2xl font-extrabold tracking-tight text-zinc-900 md:text-3xl"
      >
        {title}
      </h2>
      {subtext && <p className="max-w-2xl text-sm text-zinc-500">{subtext}</p>}
    </div>
  )
}
