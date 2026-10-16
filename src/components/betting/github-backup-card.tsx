'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  CheckCircle2,
  ExternalLink,
  Github,
  Loader2,
  RefreshCcw,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface GitHubStatus {
  ok: boolean
  repo?: string
  branch?: string
  lastPushAt?: string | null
  lastPushMessage?: string | null
  ahead?: number
  dirty?: number
}

type PushState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; text: string }
  | { kind: 'info'; text: string }
  | { kind: 'error'; text: string }

function formatPushTime(iso?: string | null): string {
  if (!iso) return 'ещё не было'
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return `сегодня в ${time}`
  const date = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  return `${date} в ${time}`
}

/**
 * «Резервная копия на GitHub» — карточка внизу вкладки «Статистика».
 * Показывает состояние репозитория и позволяет владельцу вручную
 * отправить изменения в GitHub (авто-пуш работает раз в сутки).
 */
export function GitHubBackupCard() {
  const [status, setStatus] = useState<GitHubStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [pushState, setPushState] = useState<PushState>({ kind: 'idle' })

  const loadStatus = useCallback(async () => {
    setStatusLoading(true)
    try {
      const r = await fetch('/api/github/status', { cache: 'no-store' })
      const data = (await r.json()) as GitHubStatus
      setStatus(data)
    } catch {
      setStatus({ ok: false })
    } finally {
      setStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const push = async () => {
    setPushState({ kind: 'loading' })
    try {
      const r = await fetch('/api/github/push', { method: 'POST' })
      const data = (await r.json()) as { ok: boolean; pushed: number; message?: string }
      if (data.ok) {
        setPushState({
          kind: data.pushed > 0 ? 'ok' : 'info',
          text: data.message ?? 'Готово.',
        })
      } else {
        setPushState({ kind: 'error', text: data.message ?? 'Не получилось.' })
      }
      await loadStatus()
    } catch {
      setPushState({ kind: 'error', text: 'Сеть недоступна — попробуйте позже.' })
    } finally {
      setTimeout(() => setPushState({ kind: 'idle' }), 5000)
    }
  }

  const ahead = status?.ahead ?? 0
  const repoUrl = status?.repo?.startsWith('http') ? status.repo : `https://${status?.repo ?? 'github.com/Abrukovs/Z4'}`

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.45, delay: 0.1 }}
    >
      <Card className="border-zinc-200 bg-white/70">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide text-zinc-700 uppercase">
            <Github className="size-4" aria-hidden />
            Резервная копия на GitHub
          </CardTitle>
          <p className="text-xs text-zinc-600">
            Код сайта автоматически сохраняется в репозиторий раз в сутки; сюда
            можно отправить изменения вручную
          </p>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1.5 text-sm">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <a
                  href={repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:text-emerald-800 hover:underline"
                >
                  {status?.repo?.replace('https://', '') ?? 'github.com/Abrukovs/Z4'}
                  <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                </a>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                  ветка {status?.branch ?? 'main'}
                </span>
              </div>
              <p className="text-zinc-600">
                Последняя отправка:{' '}
                <span className="font-medium text-zinc-800">
                  {statusLoading
                    ? '…'
                    : status?.ok
                      ? formatPushTime(status.lastPushAt)
                      : 'неизвестно'}
                </span>
              </p>
              {status?.ok && ahead > 0 && (
                <p className="flex items-center gap-1.5 text-xs text-amber-700">
                  <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                  Ждут отправки: {ahead}{' '}
                  {ahead === 1 ? 'коммит' : ahead < 5 ? 'коммита' : 'коммитов'} — нажмите кнопку
                </p>
              )}
              {pushState.kind !== 'idle' && (
                <p
                  className={cn(
                    'flex items-center gap-1.5 text-xs font-medium',
                    pushState.kind === 'ok' && 'text-emerald-700',
                    pushState.kind === 'info' && 'text-zinc-600',
                    pushState.kind === 'error' && 'text-red-700',
                    pushState.kind === 'loading' && 'text-zinc-600',
                  )}
                  role="status"
                >
                  {pushState.kind === 'loading' && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                  {pushState.kind === 'ok' && <CheckCircle2 className="size-3.5" aria-hidden />}
                  {pushState.kind === 'error' && <TriangleAlert className="size-3.5" aria-hidden />}
                  {pushState.kind === 'loading' ? 'Отправляем…' : pushState.text}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={push}
                disabled={pushState.kind === 'loading'}
                className="gap-2 border-zinc-300"
                aria-label="Отправить изменения в GitHub"
              >
                {pushState.kind === 'loading' ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <RefreshCcw className="size-4" aria-hidden />
                )}
                Сохранить на GitHub
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}
