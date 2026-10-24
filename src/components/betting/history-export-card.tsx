'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Archive,
  CalendarRange,
  Download,
  Loader2,
  RefreshCcw,
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

interface RetroSettleResponse {
  ok: boolean
  processed: number
  settled: number
  stayed: number
  lines: string[]
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
 *
 * 24.10: кнопка «Рассчитать возвраты» — досчитывает восстановленные из
 * архива возвраты по реальным счётам (расписание той даты → веб-поиск),
 * чтобы у экспертов было честное «зашло/мимо», а не «возврат».
 */
export function HistoryExportCard() {
  const [meta, setMeta] = useState<ArchiveMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState(false)

  const [settling, setSettling] = useState(false)
  const [settleResult, setSettleResult] = useState<RetroSettleResponse | null>(null)
  const [settleError, setSettleError] = useState(false)

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

  const settleReturns = async () => {
    setSettling(true)
    setSettleError(false)
    try {
      const r = await fetch('/api/bets/retro-settle', { method: 'POST' })
      if (!r.ok) throw new Error('status ' + r.status)
      const payload = (await r.json()) as RetroSettleResponse
      setSettleResult(payload)
      await loadMeta()
    } catch {
      setSettleError(true)
    } finally {
      setSettling(false)
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
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <Button
                onClick={settleReturns}
                disabled={settling || loading}
                className="w-full gap-2 border-emerald-200 bg-emerald-50/80 text-emerald-800 hover:bg-emerald-100 sm:w-auto"
                variant="outline"
                aria-label="Рассчитать возвраты по реальным счётам матчей"
              >
                {settling ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <RefreshCcw className="size-4" aria-hidden />
                )}
                Рассчитать возвраты
              </Button>
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
          </div>

          {/* Итог ретро-расчёта: что рассчитано, что осталось возвратом */}
          {settleError && (
            <p className="mt-3 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
              Не удалось рассчитать возвраты — попробуйте ещё раз через минуту
            </p>
          )}
          {settleResult && (
            <div className="mt-3 rounded-xl border border-emerald-200/70 bg-emerald-500/[0.05] p-3.5">
              <p className="text-sm font-semibold text-zinc-800">
                {settleResult.processed === 0
                  ? 'Возвратов из архива не найдено — рассчитывать нечего ✅'
                  : `Рассчитано по реальным счётам: ${settleResult.settled} из ${settleResult.processed}${settleResult.stayed > 0 ? ` · остались возвратами: ${settleResult.stayed}` : ''}`}
              </p>
              {settleResult.lines.length > 0 && (
                <ul className="mt-2 max-h-44 flex flex-col gap-1 overflow-y-auto text-xs leading-relaxed text-zinc-600">
                  {settleResult.lines.map((line, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span aria-hidden className="mt-0.5 shrink-0 text-zinc-400">•</span>
                      <span className="min-w-0">{line}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <p className="mt-3 text-[11px] text-zinc-500">
            «Рассчитать возвраты» — если сбой оборвал расчёт матча и прогноз
            помечался «возврат», кнопка найдёт реальный счёт и поставит честное
            «зашло» или «мимо». Файл CSV открывается в Excel: дата, эксперт,
            матч, коэффициент, итог.
          </p>
        </CardContent>
      </Card>
    </motion.div>
  )
}
