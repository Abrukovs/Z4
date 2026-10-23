'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Archive,
  CalendarRange,
  Download,
  Loader2,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface ArchiveMeta {
  total: number
  firstDate: string | null
  lastDate: string | null
  updatedAt: string | null
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

/**
 * «История прогнозов» — карточка внизу вкладки «Статистика» (23.10).
 * Прошлые прогнозы больше не теряются при ночных сбросах сервера:
 * каждый пик навсегда хранится в вечном архиве (data/bet-history.json,
 * копия в GitHub). Кнопка скачивает ВСЮ историю файлом CSV —
 * открывается в Excel.
 */
export function HistoryExportCard() {
  const [meta, setMeta] = useState<ArchiveMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState(false)

  const loadMeta = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/bets/export?meta=1', { cache: 'no-store' })
      if (!r.ok) throw new Error('status ' + r.status)
      setMeta((await r.json()) as ArchiveMeta)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadMeta()
  }, [loadMeta])

  const download = async () => {
    setDownloading(true)
    try {
      const r = await fetch('/api/bets/export', { cache: 'no-store' })
      if (!r.ok) throw new Error('status ' + r.status)
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const date = new Date().toISOString().slice(0, 10)
      a.href = url
      a.download = `bet-history-${date}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      await loadMeta()
    } catch {
      setError(true)
    } finally {
      setDownloading(false)
    }
  }

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
            <Archive className="size-4" aria-hidden />
            История прогнозов — вечный архив
          </CardTitle>
          <p className="text-xs text-zinc-600">
            Каждый прогноз навсегда сохраняется в архив: сбои и перезагрузки
            сервера больше не стирают историю экспертов
          </p>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1.5 text-sm">
              {loading ? (
                <p className="flex items-center gap-2 text-zinc-500">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Читаю архив…
                </p>
              ) : error ? (
                <p className="flex items-center gap-2 text-rose-600">
                  <TriangleAlert className="size-4 shrink-0" aria-hidden />
                  Архив недоступен — обновите страницу
                </p>
              ) : (
                <>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                      {meta?.total ?? 0}{' '}
                      {plural(meta?.total ?? 0, ['прогноз', 'прогноза', 'прогнозов'])}
                    </span>
                    <span className="text-zinc-600">в архиве навсегда</span>
                  </p>
                  {meta?.firstDate && meta?.lastDate && (
                    <p className="flex items-center gap-1.5 text-xs text-zinc-600">
                      <CalendarRange className="size-3.5 shrink-0" aria-hidden />
                      {fmtDate(meta.firstDate)} — {fmtDate(meta.lastDate)}
                    </p>
                  )}
                </>
              )}
            </div>
            <Button
              onClick={download}
              disabled={downloading || loading || (meta?.total ?? 0) === 0}
              className="w-full gap-2 border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50 sm:w-auto"
              variant="outline"
              aria-label="Скачать историю прогнозов файлом CSV"
            >
              {downloading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Download className="size-4" aria-hidden />
              )}
              Скачать историю (CSV)
            </Button>
          </div>
          <p className="mt-3 text-[11px] text-zinc-500">
            Файл открывается в Excel: дата, эксперт, матч, коэффициент, итог.
            Если сбой оборвал расчёт матча — прогноз помечается «возврат»
            и не портит статистику.
          </p>
        </CardContent>
      </Card>
    </motion.div>
  )
}
