'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type PageToken = number | 'ellipsis-l' | 'ellipsis-r'

/**
 * Список номеров страниц с эллипсисами: 1 … 4 5 6 … 12.
 * Первая и последняя страницы видны всегда.
 */
export function pageList(page: number, totalPages: number): PageToken[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const tokens: PageToken[] = [1]
  const left = Math.max(2, page - 1)
  const right = Math.min(totalPages - 1, page + 1)
  if (left > 2) tokens.push('ellipsis-l')
  for (let p = left; p <= right; p++) tokens.push(p)
  if (right < totalPages - 1) tokens.push('ellipsis-r')
  tokens.push(totalPages)
  return tokens
}

/** Пагинация истории: «Назад» / номера страниц / «Вперёд» */
export function HistoryPagination({
  page,
  totalPages,
  onChange,
}: {
  page: number
  totalPages: number
  onChange: (page: number) => void
}) {
  if (totalPages <= 1) return null
  const tokens = pageList(page, totalPages)

  return (
    <nav aria-label="Пагинация истории прогнозов" className="flex flex-wrap items-center justify-between gap-3 pt-1">
      <span aria-live="polite" className="sr-only">
        Страница {page} из {totalPages}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
        aria-label="Предыдущая страница"
        className="h-10 gap-1.5 border-zinc-200 bg-zinc-100 text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Назад
      </Button>

      <ul className="flex flex-wrap items-center justify-center gap-1">
        {tokens.map((token, i) =>
          typeof token === 'number' ? (
            <li key={`${token}-${i}`}>
              <button
                type="button"
                onClick={() => onChange(token)}
                aria-label={`Страница ${token}`}
                aria-current={token === page ? 'page' : undefined}
                className={cn(
                  'grid size-10 place-items-center rounded-lg border font-mono text-sm font-bold tabular-nums transition-all active:scale-[0.95] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500',
                  token === page
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-600'
                    : 'border-zinc-200 bg-zinc-100 text-zinc-500 hover:border-zinc-300 hover:text-zinc-900',
                )}
              >
                {token}
              </button>
            </li>
          ) : (
            <li key={`${token}-${i}`} aria-hidden className="grid size-10 place-items-center">
              <span className="text-sm tracking-widest text-zinc-600">…</span>
            </li>
          ),
        )}
      </ul>

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={page === totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="Следующая страница"
        className="h-10 gap-1.5 border-zinc-200 bg-zinc-100 text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
      >
        Вперёд
        <ChevronRight className="size-4" aria-hidden />
      </Button>
    </nav>
  )
}
