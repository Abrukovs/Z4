'use client'

import { cn } from '@/lib/utils'
import { STATUS_META } from '@/lib/format'
import type { BetStatus } from '@/lib/types'

export function StatusBadge({
  status,
  className,
}: {
  status: BetStatus | (string & {})
  className?: string
}) {
  const meta =
    (STATUS_META as Record<string, (typeof STATUS_META)[BetStatus]>)[status] ??
    STATUS_META.pending
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        meta.className,
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', meta.dot)} aria-hidden />
      {meta.label}
    </span>
  )
}
