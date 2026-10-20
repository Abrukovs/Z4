'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  CheckCircle2,
  ChevronDown,
  Loader2,
  OctagonAlert,
  RefreshCcw,
  ScrollText,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtDateTime, plural } from '@/lib/format'
import { cn } from '@/lib/utils'

interface ErrorLogItem {
  id: string
  level: 'error' | 'warn' | 'info'
  scope: string
  message: string
  context: string | null
  count: number
  firstSeenAt: string
  lastSeenAt: string
}

interface ErrorsResponse {
  items: ErrorLogItem[]
  total: number
  counters: { error: number; warn: number; info: number }
}

const LEVEL_META: Record<
  ErrorLogItem['level'],
  { icon: typeof OctagonAlert; label: string; iconCls: string; chipCls: string; rowCls: string }
> = {
  error: {
    icon: OctagonAlert,
    label: 'Ошибка',
    iconCls: 'text-red-600',
    chipCls: 'border-red-200 bg-red-50 text-red-700',
    rowCls: 'border-red-200/70 bg-red-50/40',
  },
  warn: {
    icon: TriangleAlert,
    label: 'Предупреждение',
    iconCls: 'text-amber-600',
    chipCls: 'border-amber-200 bg-amber-50 text-amber-700',
    rowCls: 'border-amber-200/70 bg-amber-50/40',
  },
  info: {
    icon: ScrollText,
    label: 'Событие',
    iconCls: 'text-zinc-500',
    chipCls: 'border-zinc-200 bg-zinc-100 text-zinc-600',
    rowCls: 'border-zinc-200 bg-zinc-50/60',
  },
}

/** Человекочитаемый контекст: JSON → «ключ: значение» построчно */
function formatContext(raw: string | null): { key: string; value: string }[] {
  if (!raw) return []
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    return Object.entries(obj)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => ({
        key: k,
        value: typeof v === 'object' ? JSON.stringify(v) : String(v),
      }))
      .slice(0, 12)
  } catch {
    return [{ key: 'детали', value: raw.slice(0, 400) }]
  }
}

const SCOPE_LABELS: Record<string, string> = {
  'real-bets': 'прогнозы',
  'real-matches': 'расписание',
  digest: 'рассылка',
  'odds-intel': 'линия рынка',
  api: 'сервер',
  'telegram-bot': 'бот',
}

function scopeLabel(scope: string): string {
  return SCOPE_LABELS[scope] ?? scope
}

/**
 * «Журнал ошибок» — карточка внизу вкладки «Статистика» (Task 54).
 * Показывает сбои и предупреждения всех модулей сайта (прогнозы, расписание,
 * рассылка, бот) с раскрытием деталей и возможностью очистить журнал.
 * Автообновление раз в 30 секунд.
 */
export function ErrorLogCard() {
  const [data, setData] = useState<ErrorsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [clearing, setClearing] = useState(false)

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true)
    try {
      const r = await fetch('/api/errors?limit=60', { cache: 'no-store' })
      if (r.ok) setData((await r.json()) as ErrorsResponse)
    } catch {
      /* сеть моргнула — покажем прошлые данные */
    } finally {
      if (showSpinner) setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(true)
    const t = setInterval(() => load(false), 30_000)
    return () => clearInterval(t)
  }, [load])

  const clear = async () => {
    setClearing(true)
    try {
      await fetch('/api/errors', { method: 'DELETE' })
      await load(true)
    } catch {
      /* не критично */
    } finally {
      setClearing(false)
    }
  }

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const items = data?.items ?? []
  const counters = data?.counters ?? { error: 0, warn: 0, info: 0 }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.45, delay: 0.12 }}
    >
      <Card className="border-zinc-200 bg-white/70">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-semibold tracking-wide text-zinc-700 uppercase">
            <ScrollText className="size-4" aria-hidden />
            Журнал ошибок
            {counters.error > 0 && (
              <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700">
                {counters.error} {plural(counters.error, ['ошибка', 'ошибки', 'ошибок'])}
              </span>
            )}
            {counters.warn > 0 && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">
                {counters.warn}{' '}
                {counters.warn === 1 ? 'предупреждение' : plural(counters.warn, ['предупреждения', 'предупреждений', 'предупреждений'])}
              </span>
            )}
            {counters.error === 0 && counters.warn === 0 && !loading && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
                <CheckCircle2 className="size-3" aria-hidden />
                всё чисто
              </span>
            )}
          </CardTitle>
          <p className="text-xs text-zinc-600">
            Сбои прогнозов, расписания, рассылки и бота — с причинами. Здесь видно, почему
            какая-то ставка не загрузилась (например, теннисная сетка ещё не опубликована)
          </p>
        </CardHeader>
        <CardContent className="pt-2">
          {/* Кнопки */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-zinc-500">
              {loading && !data
                ? 'загружаем…'
                : `записей: ${data?.total ?? 0} · обновляется каждые 30 сек`}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => load(true)}
                disabled={loading}
                className="gap-2 border-zinc-300"
                aria-label="Обновить журнал ошибок"
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <RefreshCcw className="size-4" aria-hidden />
                )}
                Обновить
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={clear}
                disabled={clearing || items.length === 0}
                className="gap-2 border-zinc-300 text-red-700 hover:bg-red-50"
                aria-label="Очистить журнал ошибок"
              >
                {clearing ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="size-4" aria-hidden />
                )}
                Очистить
              </Button>
            </div>
          </div>

          {/* Список записей */}
          {loading && !data ? (
            <div className="space-y-2" aria-label="Загрузка журнала ошибок">
              <Skeleton className="h-12 rounded-lg bg-zinc-200/70" />
              <Skeleton className="h-12 rounded-lg bg-zinc-200/70" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-emerald-200/70 bg-emerald-50/50 px-4 py-6 text-center">
              <CheckCircle2 className="size-8 text-emerald-500" aria-hidden />
              <p className="text-sm font-semibold text-emerald-800">Ошибок нет — сайт работает чисто</p>
              <p className="text-xs text-emerald-700/80">
                Все модули (прогнозы, расписание, рассылка, бот) работают штатно
              </p>
            </div>
          ) : (
            <ul
              className="dark-scrollbar max-h-96 space-y-2 overflow-y-auto pr-1"
              role="log"
              aria-label="Список ошибок и предупреждений"
            >
              {items.map((item) => {
                const meta = LEVEL_META[item.level] ?? LEVEL_META.info
                const Icon = meta.icon
                const isOpen = expanded.has(item.id)
                const details = formatContext(item.context)
                return (
                  <li key={item.id}>
                    <div
                      className={cn(
                        'rounded-xl border px-3 py-2.5 transition-colors',
                        meta.rowCls,
                        details.length > 0 && 'cursor-pointer hover:border-zinc-300',
                      )}
                      role={details.length > 0 ? 'button' : undefined}
                      tabIndex={details.length > 0 ? 0 : undefined}
                      aria-expanded={details.length > 0 ? isOpen : undefined}
                      aria-label={`${meta.label}: ${item.message}`}
                      onClick={() => details.length > 0 && toggle(item.id)}
                      onKeyDown={(e) => {
                        if (details.length > 0 && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault()
                          toggle(item.id)
                        }
                      }}
                    >
                      <div className="flex items-start gap-2.5">
                        <Icon className={cn('mt-0.5 size-4 shrink-0', meta.iconCls)} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span
                              className={cn(
                                'rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase',
                                meta.chipCls,
                              )}
                            >
                              {meta.label}
                            </span>
                            <span className="rounded-full bg-zinc-200/70 px-2 py-0.5 text-[10px] font-semibold text-zinc-600">
                              {scopeLabel(item.scope)}
                            </span>
                            {item.count > 1 && (
                              <span
                                className="text-[10px] font-bold text-zinc-500"
                                title={`Первое появление: ${fmtDateTime(item.firstSeenAt)}`}
                              >
                                ×{item.count}
                              </span>
                            )}
                            <span className="ml-auto shrink-0 font-mono text-[11px] text-zinc-500 tabular-nums">
                              {fmtDateTime(item.lastSeenAt)}
                            </span>
                          </div>
                          <p className="mt-1 text-sm leading-snug font-medium text-zinc-800">
                            {item.message}
                          </p>
                          {isOpen && details.length > 0 && (
                            <dl className="mt-2 space-y-1 rounded-lg bg-white/70 px-2.5 py-2 text-xs">
                              {details.map((d) => (
                                <div key={d.key} className="flex gap-2">
                                  <dt className="shrink-0 font-mono font-semibold text-zinc-500">
                                    {d.key}:
                                  </dt>
                                  <dd className="min-w-0 break-words text-zinc-700">{d.value}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                        </div>
                        {details.length > 0 && (
                          <ChevronDown
                            className={cn(
                              'mt-0.5 size-4 shrink-0 text-zinc-400 transition-transform duration-200',
                              isOpen && 'rotate-180',
                            )}
                            aria-hidden
                          />
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
