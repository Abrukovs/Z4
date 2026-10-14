'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  BellRing,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  MessageSquareText,
  MinusCircle,
  Search,
  Send,
  Star,
  Trophy,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { SectionHeader } from '@/components/betting/section-header'
import type {
  DigestExpressDto,
  DigestPickDto,
  DigestResponse,
  DigestSendResponse,
  DigestSettingsDto,
  TelegramChatsResponse,
} from '@/lib/types'
import { cn } from '@/lib/utils'

/** Часы отправки утреннего разбора (МСК) — варианты для селекта */
const HOUR_OPTIONS = [7, 8, 9, 10, 11, 12]

/** Название вида спорта для заголовков блоков (без имён экспертов) */
const SPORT_LABEL: Record<string, string> = {
  tennis: 'Теннис',
  football: 'Футбол',
  hockey: 'Хоккей',
  basketball: 'Баскетбол',
}

/** HTML Telegram → читаемый текст для предпросмотра */
function telegramPreview(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const STATUS_ICON = {
  won: { icon: CheckCircle2, cls: 'text-emerald-600', bg: 'bg-emerald-500/12' },
  lost: { icon: XCircle, cls: 'text-rose-600', bg: 'bg-rose-500/12' },
  void: { icon: MinusCircle, cls: 'text-zinc-500', bg: 'bg-zinc-500/12' },
  pending: { icon: Clock, cls: 'text-amber-600', bg: 'bg-amber-500/12' },
} as const

function fmtUnits(v: number): string {
  const sign = v > 0 ? '+' : v < 0 ? '−' : ''
  return `${sign}${Math.abs(v).toFixed(2)}`
}

function statusLabel(p: DigestPickDto): string {
  switch (p.status) {
    case 'won':
      return 'Зашло'
    case 'lost':
      return 'Не зашло'
    case 'void':
      return 'Возврат'
    default:
      return 'Ждёт расчёта'
  }
}

/* ------------------------------ строка прогноза ------------------------------ */

function PickRow({
  pick,
  accent,
  whyLabel,
}: {
  pick: DigestPickDto
  accent: 'bod' | 'star' | 'express'
  /** Подпись к разбору «почему» (по умолчанию — без подписи) */
  whyLabel?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const meta = STATUS_ICON[pick.status] ?? STATUS_ICON.pending
  const StatusIcon = meta.icon
  const AccentIcon = accent === 'bod' ? Trophy : accent === 'star' ? Star : Layers
  const why = pick.thesis ?? pick.analysis
  const whyLong = !!why && why.length > 130
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-24px' }}
      className="flex items-start gap-3 rounded-xl border border-zinc-100 bg-zinc-50/60 p-3.5 transition-colors hover:border-zinc-200"
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg',
          accent === 'bod'
            ? 'bg-emerald-500/12 text-emerald-600'
            : accent === 'star'
              ? 'bg-amber-500/12 text-amber-600'
              : 'bg-teal-500/12 text-teal-600',
        )}
      >
        <AccentIcon className="size-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-zinc-900">
          {pick.homeTeam} — {pick.awayTeam}
        </p>
        <p className="mt-0.5 truncate text-xs text-zinc-500">
          {pick.league} · {pick.selection} @{pick.odds.toFixed(2)}
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className={cn('inline-flex items-center gap-1 font-semibold', meta.cls)}>
            <StatusIcon className="size-3.5" aria-hidden />
            {statusLabel(pick)}
          </span>
          {pick.score && (
            <span className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 ring-1 ring-zinc-200">
              {pick.score}
            </span>
          )}
          {pick.status === 'won' && (
            <span className="rounded-md bg-emerald-500/12 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-700">
              {fmtUnits(pick.profit)} юн.
            </span>
          )}
        </p>
        {why && (
          <div className="mt-1.5">
            <p
              className={cn(
                'text-[11px] leading-snug text-zinc-500',
                !expanded && 'line-clamp-3',
              )}
              title={why}
            >
              {whyLabel && <span className="font-semibold text-zinc-600">{whyLabel}: </span>}
              {why}
            </p>
            {whyLong && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 inline-flex items-center gap-1 rounded text-[11px] font-semibold text-emerald-600 transition-colors hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
                aria-expanded={expanded}
              >
                <ChevronDown
                  className={cn('size-3 transition-transform', expanded && 'rotate-180')}
                  aria-hidden
                />
                {expanded ? 'Свернуть' : 'Полный разбор'}
              </button>
            )}
          </div>
        )}
      </div>
    </motion.li>
  )
}

/* ------------------------------ итог экспресса ------------------------------ */

function ExpressVerdict({ express }: { express: DigestExpressDto }) {
  const wonLegs = express.legs.filter((l) => l.status === 'won')
  const label =
    express.status === 'won' ? 'Экспресс зашёл' : `Зашло ${wonLegs.length} из ${express.legs.length}`
  return (
    <div className="mt-2.5 rounded-xl border border-zinc-100 bg-zinc-50/60 p-3.5">
      <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-emerald-600">
        <CheckCircle2 className="size-4" aria-hidden />
        {label}
      </p>
      <p className="mt-1.5 text-[11px] leading-snug text-zinc-500">
        Отбор: топ-{express.legs.length} прогноза дня по уверенности (
        {express.confidences.join('%, ')}%) — без «Ставки дня»
      </p>
    </div>
  )
}

/* -------------------------------- секция -------------------------------- */

export function DigestSection() {
  const [data, setData] = useState<DigestResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // форма настроек
  const [token, setToken] = useState('')
  const [chatId, setChatId] = useState('')
  const [chatTitle, setChatTitle] = useState('')
  const [sendHour, setSendHour] = useState(9)
  const [autoEnabled, setAutoEnabled] = useState(false)
  const [showToken, setShowToken] = useState(false)

  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [finding, setFinding] = useState(false)
  const [chats, setChats] = useState<TelegramChatsResponse['chats'] | null>(null)
  const [chatsHint, setChatsHint] = useState<string | null>(null)
  const [chatsOpen, setChatsOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  const autoTriedRef = useRef(false)

  const applySettings = useCallback((s: DigestSettingsDto) => {
    setChatId(s.telegramChatId ?? '')
    setChatTitle(s.telegramChatTitle ?? '')
    setSendHour(s.sendHour)
    setAutoEnabled(s.telegramEnabled)
    setToken('') // сохранённый токен не таскаем в форму — только новый
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/digest', { cache: 'no-store' })
      if (!res.ok) throw new Error(`Ошибка ${res.status}`)
      const payload = (await res.json()) as DigestResponse
      setData(payload)
      setLoadError(null)
      applySettings(payload.settings)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [applySettings])

  useEffect(() => {
    void load()
  }, [load])

  // Автоотправка: первый визит после часа отправки + контроль каждые 10
  // минут. Сервер сам решает («too-early» / «already-sent» /
  // «not-configured»). Сообщение ОДНО — утром.
  const autoSend = useCallback(
    async (silent: boolean) => {
      try {
        const res = await fetch('/api/digest/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auto: true }),
        })
        const payload = (await res.json().catch(() => null)) as DigestSendResponse | null
        if (payload?.sent) {
          toast.success('Утренний разбор отправлен в Telegram', {
            description: payload.digestDateLabel
              ? `Итог и разбор за ${payload.digestDateLabel} — проверьте ваш чат`
              : undefined,
          })
          void load()
          return true
        }
        if (!silent && payload?.reason === 'error') {
          toast.error('Не удалось отправить разбор', { description: payload.error })
        }
      } catch {
        /* авто-режим молчит — повторим через 10 минут */
      }
      return false
    },
    [load],
  )

  useEffect(() => {
    // не спамим на маунте, если рассылка не настроена
    if (!data?.settings.telegramEnabled || !data.settings.hasToken) return
    if (autoTriedRef.current) return
    autoTriedRef.current = true
    void autoSend(true)
  }, [data, autoSend])

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return
      if (!data?.settings.telegramEnabled || !data.settings.hasToken) return
      void autoSend(true)
    }, 10 * 60 * 1000)
    return () => clearInterval(timer)
  }, [data, autoSend])

  /* ------------------------------ действия ------------------------------ */

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const patch: Record<string, unknown> = {
        telegramChatId: chatId.trim(),
        telegramChatTitle: chatTitle.trim() || null,
        sendHour,
        telegramEnabled: autoEnabled,
      }
      // токен отправляем только если ввели новый (старый не затираем пустым)
      if (token.trim() !== '') patch.telegramBotToken = token.trim()

      const res = await fetch('/api/digest/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const payload = (await res.json().catch(() => null)) as
        | { settings?: DigestSettingsDto; error?: string }
        | null
      if (!res.ok || !payload?.settings) {
        throw new Error(payload?.error ?? `Ошибка ${res.status}`)
      }
      applySettings(payload.settings)
      setToken('')
      toast.success('Настройки сохранены', {
        description: payload.settings.telegramEnabled
          ? `Каждое утро в ${sendHour}:00 МСК — итог и полный разбор зашедших`
          : 'Автоотправка выключена — «Отправить сейчас» работает',
      })
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }, [chatId, chatTitle, sendHour, autoEnabled, token, applySettings, load])

  /** Отключить сторонний вебхук бота (кнопка в тосте об ошибке «Найти чат») */
  const handleDisableWebhook = useCallback(async () => {
    try {
      const res = await fetch('/api/digest/telegram-webhook', { method: 'DELETE' })
      const payload = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error ?? `Ошибка ${res.status}`)
      }
      toast.success('Сторонний вебхук отключён', {
        description: 'Теперь напишите боту /start в Telegram — и снова нажмите «Найти чат»',
        duration: 10000,
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось отключить вебхук')
    }
  }, [])

  const handleFindChats = useCallback(async () => {
    setFinding(true)
    try {
      const res = await fetch('/api/digest/telegram-chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      })
      const payload = (await res.json().catch(() => null)) as TelegramChatsResponse | null
      // Сторонний сервис (вебхук) перехватывает сообщения бота — предлагаем
      // отключить его прямо из тоста, одним нажатием
      if (payload?.code === 'webhook-active') {
        toast.error('У бота активен сторонний вебхук', {
          description:
            'Он перехватывает сообщения бота, поэтому сайт не видит чаты. Можно отключить вебхук — бот снова будет получать сообщения напрямую.',
          action: { label: 'Отключить', onClick: () => void handleDisableWebhook() },
          duration: 15000,
        })
        return
      }
      if (!res.ok) throw new Error(payload?.error ?? `Ошибка ${res.status}`)
      if (!payload.chats || payload.chats.length === 0) {
        toast.info('Бот пока без сообщений', {
          description: payload.hint ?? 'Напишите боту /start в Telegram и нажмите «Найти чат» снова',
          duration: 8000,
        })
        return
      }
      setChats(payload.chats)
      setChatsHint(null)
      setChatsOpen(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Telegram не ответил')
    } finally {
      setFinding(false)
    }
  }, [token, handleDisableWebhook])

  const handleSendNow = useCallback(async () => {
    setSending(true)
    try {
      const res = await fetch('/api/digest/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto: false }),
      })
      const payload = (await res.json().catch(() => null)) as DigestSendResponse | null
      if (!res.ok || !payload) throw new Error(`Ошибка ${res.status}`)
      if (payload.sent) {
        toast.success('Утренний разбор отправлен в Telegram', {
          description: payload.digestDateLabel
            ? `Итог и разбор за ${payload.digestDateLabel} — проверьте ваш чат`
            : undefined,
        })
        void load()
      } else if (payload.reason === 'not-configured') {
        toast.warning('Сначала настройте бота', {
          description: 'Токен + chat id — и нажмите «Сохранить»',
        })
      } else if (payload.reason === 'no-data') {
        toast.info('За вчера нечего разбирать', {
          description: 'Прогнозов на вчерашний день не было',
        })
      } else {
        throw new Error(payload.error ?? 'Не удалось отправить')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось отправить')
    } finally {
      setSending(false)
    }
  }, [load])

  const pickChats = useMemo(() => {
    const s = data?.settings
    return (
      chats?.map((c) => ({
        ...c,
        selected: s?.telegramChatId === c.id,
      })) ?? []
    )
  }, [chats, data])

  const digest = data?.digest
  const summary = digest?.summary
  const plainPreview = data ? telegramPreview(data.telegramHtml) : ''
  // Показываем только зашедшее — зеркально Telegram-сообщению (формат
  // Task 42/46/50: разбор проигравших не рассылаем, без имён экспертов)
  const wonBod = digest?.betOfDay.filter((p) => p.status === 'won') ?? []
  const expressWonLegs = digest?.express?.legs.filter((l) => l.status === 'won') ?? []
  // эксперт мог попасть в топ-3 экспресса — не дублируем его карточку
  const expressLegIds = new Set(expressWonLegs.map((l) => l.id))
  const wonStarPicks =
    digest?.star?.picks.filter((p) => p.status === 'won' && !expressLegIds.has(p.id)) ?? []
  const hasWins = wonBod.length > 0 || expressWonLegs.length > 0 || wonStarPicks.length > 0
  const starSportLabel = digest?.star
    ? (SPORT_LABEL[digest.star.sport] ?? digest.star.sport)
    : null

  const configured =
    !!data?.settings.hasToken && !!data?.settings.telegramChatId && !!data?.settings.telegramEnabled

  return (
    <section
      id="digest"
      aria-labelledby="digest-title"
      className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-8 pb-14"
    >
      <SectionHeader
        eyebrow="Уведомления"
        title="Telegram-рассылка: утром — итог и полный разбор"
        subtext="Одно сообщение в сутки — как вы просили, чат не перегружаем. Каждое утро: сводка вчерашнего дня «сколько зашло / мимо», затем полный разбор зашедших главных ставок — «Ставка дня» со счётом и всей аргументацией, зашедшие исходы «Экспресса дня» с разбором каждой ноги и прогноз эксперта целиком. Проигравшие не разбираем — фокус на зашедшем"
        titleId="digest-title"
      />

      <div className="animate-fade-up rounded-[20px] bg-gradient-to-br from-emerald-500/60 via-zinc-200 to-zinc-200 p-[1.5px] shadow-[0_24px_70px_-36px_rgba(16,185,129,0.45)]">
        <div className="relative overflow-hidden rounded-[19px] bg-white">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_15%_10%,rgba(16,185,129,0.1),transparent_70%)]"
          />

          <div className="relative grid gap-6 p-5 sm:p-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:p-7">
            {/* ---------------- УТРЕННИЙ РАЗБОР (вчера, полная ширина) ---------------- */}
            {!loading && !loadError && data && (
              <div className="flex flex-col gap-4 rounded-2xl border border-emerald-200/70 bg-emerald-500/[0.04] p-4 sm:p-5 lg:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-base font-bold text-zinc-900">
                    <MessageSquareText className="size-4.5 text-emerald-600" aria-hidden />
                    Утренний разбор · {digest ? digest.dateLabel : 'вчера'}
                  </h3>
                  {configured ? (
                    <Badge className="gap-1.5 border-emerald-500/30 bg-emerald-500/12 text-emerald-700 hover:bg-emerald-500/12">
                      <Send className="size-3" aria-hidden />
                      придёт в {data.settings.sendHour}:00 МСК
                    </Badge>
                  ) : (
                    <Badge className="gap-1.5 border-zinc-300 bg-zinc-500/10 text-zinc-600 hover:bg-zinc-500/10">
                      <Clock className="size-3" aria-hidden />
                      настроите бота — пойдёт сам
                    </Badge>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-zinc-500">
                  Одно сообщение за вчерашний день: сначала сводка «сколько зашло · мимо», затем
                  полный разбор зашедших главных ставок — «Ставка дня» со счётом и всей
                  аргументацией, зашедшие исходы «Экспресса дня» с разбором «почему» у каждой
                  ноги и прогноз эксперта целиком. Если текст длиннее лимита Telegram — придёт
                  несколькими частями. Проигравшие и прочая лента не разбираются.
                </p>

                <div className="grid gap-4 lg:grid-cols-[1.12fr_0.88fr]">
                  {/* зашедшие ставки накануне */}
                  <div className="flex flex-col gap-3">
                    {wonBod.length > 0 && (
                      <div>
                        <p className="mb-2 text-xs font-bold tracking-[0.18em] text-emerald-600 uppercase">
                          Ставка дня — зашла
                        </p>
                        <ul className="flex flex-col gap-2.5">
                          {wonBod.map((p) => (
                            <PickRow key={p.id} pick={p} accent="bod" whyLabel="Разбор ставки" />
                          ))}
                        </ul>
                      </div>
                    )}

                    {digest?.express && expressWonLegs.length > 0 && (
                      <div>
                        <p className="mb-2 text-xs font-bold tracking-[0.18em] text-teal-600 uppercase">
                          Экспресс дня · кэф {digest.express.totalOdds.toFixed(2)}
                        </p>
                        <ul className="flex flex-col gap-2.5">
                          {expressWonLegs.map((p) => (
                            <PickRow key={p.id} pick={p} accent="express" whyLabel="Разбор" />
                          ))}
                        </ul>
                        <ExpressVerdict express={digest.express} />
                      </div>
                    )}

                    {wonStarPicks.length > 0 && starSportLabel && (
                      <div>
                        <p className="mb-2 text-xs font-bold tracking-[0.18em] text-amber-600 uppercase">
                          {starSportLabel} — зашло
                        </p>
                        <ul className="flex flex-col gap-2.5">
                          {wonStarPicks.map((p) => (
                            <PickRow key={p.id} pick={p} accent="star" whyLabel="Разбор ставки" />
                          ))}
                        </ul>
                      </div>
                    )}

                    {!hasWins && (
                      <p className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 p-4 text-sm text-zinc-500">
                        {digest && digest.summary.total > 0
                          ? 'Накануне из главных ставок не зашло ничего — в сообщении придёт короткая строка без разборов.'
                          : 'Вчера прогнозов не было — разбор не придёт.'}
                      </p>
                    )}
                  </div>

                  {/* сводка дня + что разбираем + предпросмотр */}
                  <div className="flex flex-col gap-3">
                    {summary && summary.total > 0 && (
                      <div className="rounded-xl border border-zinc-100 bg-white p-3.5">
                        <p className="text-xs font-bold tracking-[0.18em] text-zinc-400 uppercase">
                          Сводка дня
                        </p>
                        <div className="mt-2.5 grid grid-cols-4 gap-2">
                          <div>
                            <p className="text-lg font-extrabold text-emerald-600">{summary.won}</p>
                            <p className="text-[11px] font-medium text-zinc-500">зашло</p>
                          </div>
                          <div>
                            <p className="text-lg font-extrabold text-rose-600">{summary.lost}</p>
                            <p className="text-[11px] font-medium text-zinc-500">не зашло</p>
                          </div>
                          <div>
                            <p className="text-lg font-extrabold text-zinc-700">{summary.void}</p>
                            <p className="text-[11px] font-medium text-zinc-500">возврат</p>
                          </div>
                          <div>
                            <p
                              className={cn(
                                'text-lg font-extrabold',
                                summary.profit >= 0 ? 'text-emerald-600' : 'text-rose-600',
                              )}
                            >
                              {fmtUnits(summary.profit)}
                            </p>
                            <p className="text-[11px] font-medium text-zinc-500">юн. за день</p>
                          </div>
                        </div>
                        {summary.pending > 0 && (
                          <p className="mt-2.5 flex items-center gap-1.5 text-xs text-amber-600">
                            <Clock className="size-3.5" aria-hidden />
                            Ещё в игре: {summary.pending} — попадут в разбор после расчёта
                          </p>
                        )}
                      </div>
                    )}

                    <div className="rounded-xl border border-zinc-100 bg-white p-3.5">
                      <p className="text-xs font-bold tracking-[0.18em] text-zinc-400 uppercase">
                        Что разбираем
                      </p>
                      <ul className="mt-2.5 flex flex-col gap-2 text-xs text-zinc-600">
                        <li className="flex items-center gap-2">
                          <BellRing className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
                          Сводка дня — «N зашло · M мимо» и юниты
                        </li>
                        <li className="flex items-center gap-2">
                          <Trophy className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
                          «Ставка дня» — если зашла: счёт и разбор
                        </li>
                        <li className="flex items-center gap-2">
                          <Layers className="size-3.5 shrink-0 text-teal-600" aria-hidden />
                          Зашедшие исходы «Экспресса дня»
                        </li>
                        <li className="flex items-center gap-2">
                          <Star className="size-3.5 shrink-0 text-amber-600" aria-hidden />
                          Прогноз эксперта — если зашёл
                        </li>
                        <li className="flex items-center gap-2 text-zinc-400">
                          <MinusCircle className="size-3.5 shrink-0" aria-hidden />
                          Проигравшие — не разбираем
                        </li>
                      </ul>
                    </div>

                    {/* Предпросмотр сообщения */}
                    <div className="rounded-xl border border-zinc-100">
                      <button
                        type="button"
                        onClick={() => setPreviewOpen((v) => !v)}
                        aria-expanded={previewOpen}
                        className="flex w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-left text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50"
                      >
                        <span className="flex items-center gap-2">
                          <Bot className="size-4 text-emerald-600" aria-hidden />
                          Как придёт сообщение
                        </span>
                        <ChevronRight
                          className={cn(
                            'size-4 shrink-0 text-zinc-400 transition-transform',
                            previewOpen && 'rotate-90',
                          )}
                          aria-hidden
                        />
                      </button>
                      {previewOpen && plainPreview && (
                        <div className="border-t border-zinc-100 p-4">
                          <pre className="max-h-72 overflow-y-auto rounded-lg bg-zinc-950 p-4 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-zinc-100">
                            {plainPreview}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ---------------- ЛЕВАЯ КОЛОНКА: расписание ---------------- */}
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-base font-bold text-zinc-900">
                  <BellRing className="size-4.5 text-emerald-600" aria-hidden />
                  Одно сообщение в сутки
                </h3>
                {configured ? (
                  <Badge className="gap-1.5 border-emerald-500/30 bg-emerald-500/12 text-emerald-700 hover:bg-emerald-500/12">
                    <BellRing className="size-3" aria-hidden />
                    каждое утро в {data?.settings.sendHour}:00
                  </Badge>
                ) : (
                  <Badge className="gap-1.5 border-amber-500/30 bg-amber-500/12 text-amber-700 hover:bg-amber-500/12">
                    <Clock className="size-3" aria-hidden />
                    Настроите бота — пойдёт сама
                  </Badge>
                )}
              </div>

              {loading ? (
                <div className="space-y-3" aria-busy="true">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-16 animate-pulse rounded-xl bg-zinc-100" />
                  ))}
                </div>
              ) : loadError ? (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
                >
                  {loadError}
                </div>
              ) : (
                <div className="rounded-xl border border-zinc-100 bg-zinc-50/60 p-4">
                  <p className="text-xs leading-relaxed text-zinc-600">
                    Утром бот присылает{' '}
                    <span className="font-semibold text-zinc-800">одно сообщение</span> за
                    вчерашний день: сначала сводка «сколько зашло / мимо», затем полный разбор
                    каждого зашедшего исхода. Вечерних сообщений больше нет — канал не
                    перегружается. Пропущенное по расписанию сообщение догоняется автоматически
                    при первом визите сайта (дедуп в журнале — дважды не придёт).
                  </p>
                  <ul className="mt-3 flex flex-col gap-2 text-xs text-zinc-600">
                    <li className="flex items-center gap-2">
                      <BellRing className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
                      Сводка дня — «N зашло · M мимо», юниты
                    </li>
                    <li className="flex items-center gap-2">
                      <Trophy className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
                      «Ставка дня» — если зашла: счёт и разбор
                    </li>
                    <li className="flex items-center gap-2">
                      <Layers className="size-3.5 shrink-0 text-teal-600" aria-hidden />
                      Зашедшие исходы «Экспресса дня»
                    </li>
                    <li className="flex items-center gap-2">
                      <Star className="size-3.5 shrink-0 text-amber-600" aria-hidden />
                      Прогноз эксперта — если зашёл
                    </li>
                    <li className="flex items-center gap-2 text-zinc-400">
                      <MinusCircle className="size-3.5 shrink-0" aria-hidden />
                      Проигравшие — не разбираем
                    </li>
                  </ul>
                </div>
              )}

              {/* журнал отправок */}
              {data && data.logs.length > 0 && (
                <div className="rounded-xl border border-zinc-100 bg-zinc-50/60 p-4">
                  <p className="mb-2 text-xs font-bold tracking-[0.18em] text-zinc-400 uppercase">
                    История отправок
                  </p>
                  <ul className="max-h-40 space-y-1.5 overflow-y-auto pr-1 text-xs">
                    {data.logs.map((l) => (
                      <li key={l.id} className="flex items-center gap-2 text-zinc-600">
                        {l.success ? (
                          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
                        ) : (
                          <XCircle className="size-3.5 shrink-0 text-rose-500" aria-hidden />
                        )}
                        <span className="font-medium">{l.digestDate}</span>
                        <span className="text-zinc-400">
                          {l.channel === 'telegram'
                            ? 'разбор, авто'
                            : l.channel === 'telegram-manual'
                              ? 'разбор, вручную'
                              : l.channel === 'telegram-results'
                                ? 'после матча, авто (архив)'
                                : l.channel === 'telegram-results-manual'
                                  ? 'после матча, вручную (архив)'
                                  : l.channel === 'telegram-prematch' ||
                                      l.channel === 'telegram-prematch-manual'
                                    ? 'до матча (архив)'
                                    : l.channel === 'welcome'
                                      ? 'подключение'
                                      : l.channel === 'service-note'
                                        ? 'сервисное'
                                        : 'вручную'}
                        </span>
                        {!l.success && l.error && (
                          <span className="truncate text-rose-500" title={l.error}>
                            {l.error}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* ---------------- ПРАВАЯ КОЛОНКА: настройка ---------------- */}
            <div className="flex flex-col gap-4 rounded-xl border border-zinc-100 bg-zinc-50/60 p-4 sm:p-5">
              <h3 className="flex items-center gap-2 text-base font-bold text-zinc-900">
                <Bot className="size-4.5 text-emerald-600" aria-hidden />
                Настройка бота — 3 шага
              </h3>
              <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                Бот на связи и отвечает мгновенно
              </p>

              <ol className="flex flex-col gap-2.5 text-sm text-zinc-600">
                <li className="flex gap-2.5">
                  <span className="grid size-5.5 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-[11px] font-bold text-emerald-700">
                    1
                  </span>
                  <span>
                    Бот создаётся в Telegram у{' '}
                    <span className="font-semibold text-zinc-800">@BotFather</span> (команда{' '}
                    <span className="font-mono text-xs">/newbot</span>)
                    {data?.settings.hasToken && (
                      <span className="font-semibold text-emerald-700"> — токен уже сохранён ✓</span>
                    )}
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="grid size-5.5 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-[11px] font-bold text-emerald-700">
                    2
                  </span>
                  <span>
                    Откройте своего бота в Telegram и нажмите{' '}
                    <span className="font-semibold text-zinc-800">START</span>
                    <span className="text-emerald-700"> — бот ответит сразу</span>
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="grid size-5.5 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-[11px] font-bold text-emerald-700">
                    3
                  </span>
                  <span>
                    Готово: рассылка включится сама, чат подключится мгновенно. Бот понимает
                    команды{' '}
                    <span className="font-mono text-[11px] text-zinc-600">/start · /help · /stop</span>
                  </span>
                </li>
              </ol>

              {data?.settings.hasToken && !data?.settings.telegramChatId && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-500/5 p-3.5 text-xs leading-relaxed text-emerald-800">
                  <p className="font-semibold">Остался один шаг — нажать START у бота</p>
                  <p className="mt-1">
                    Токен уже у нас. Откройте бота в Telegram и нажмите «START» — бот сразу
                    ответит приветствием и подключит рассылку. Если он молчит больше минуты —
                    проверьте токен или напишите мне в чат.
                  </p>
                </div>
              )}

              <div className="flex flex-col gap-3.5">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="digest-token" className="text-xs font-semibold text-zinc-700">
                    Токен бота
                    {data?.settings.hasToken && (
                      <span className="ml-1.5 font-mono text-[10px] font-normal text-zinc-400">
                        сохранён: {data.settings.tokenPreview}
                      </span>
                    )}
                  </Label>
                  <div className="relative">
                    <Input
                      id="digest-token"
                      type={showToken ? 'text' : 'password'}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder={
                        data?.settings.hasToken
                          ? 'новый токен (оставьте пустым — используем сохранённый)'
                          : '123456789:AAE…'
                      }
                      autoComplete="off"
                      spellCheck={false}
                      className="pr-10 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken((v) => !v)}
                      aria-label={showToken ? 'Скрыть токен' : 'Показать токен'}
                      className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
                    >
                      {showToken ? (
                        <EyeOff className="size-4" aria-hidden />
                      ) : (
                        <Eye className="size-4" aria-hidden />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label
                    htmlFor="digest-chat"
                    className="flex items-center justify-between gap-2 text-xs font-semibold text-zinc-700"
                  >
                    <span>Chat ID {chatTitle && <span className="font-normal text-zinc-400">· {chatTitle}</span>}</span>
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="digest-chat"
                      value={chatId}
                      onChange={(e) => {
                        setChatId(e.target.value)
                        setChatTitle('')
                      }}
                      placeholder="123456789"
                      inputMode="numeric"
                      autoComplete="off"
                      className="font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleFindChats()}
                      disabled={finding || (!token.trim() && !data?.settings.hasToken)}
                      className="h-10 shrink-0 gap-1.5"
                    >
                      {finding ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <Search className="size-4" aria-hidden />
                      )}
                      <span className="hidden sm:inline">Найти чат</span>
                      <span className="sm:hidden">Чат</span>
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="digest-hour" className="text-xs font-semibold text-zinc-700">
                      Время отправки (МСК)
                    </Label>
                    <Select value={String(sendHour)} onValueChange={(v) => setSendHour(Number(v))}>
                      <SelectTrigger id="digest-hour" className="h-10 w-[130px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {HOUR_OPTIONS.map((h) => (
                          <SelectItem key={h} value={String(h)}>
                            {String(h).padStart(2, '0')}:00
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5">
                    <Switch
                      checked={autoEnabled}
                      onCheckedChange={setAutoEnabled}
                      aria-label="Автоотправка каждое утро"
                    />
                    <span className="text-xs font-semibold text-zinc-700">
                      Автоотправка
                      <span className="block font-normal text-zinc-400">каждое утро</span>
                    </span>
                  </label>
                </div>

                <div className="flex flex-wrap gap-2.5 pt-1">
                  <Button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={saving}
                    className="gap-1.5"
                  >
                    {saving ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <CheckCircle2 className="size-4" aria-hidden />
                    )}
                    Сохранить
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleSendNow()}
                    disabled={sending}
                    className="gap-1.5"
                  >
                    {sending ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Send className="size-4" aria-hidden />
                    )}
                    Отправить разбор сейчас
                  </Button>
                </div>
              </div>

              <p className="text-[11px] leading-relaxed text-zinc-400">
                Токен хранится только на сервере и наружу не отдаётся. Почтовая отправка из этой
                среды недоступна (исходящий SMTP закрыт) — Telegram работает по HTTPS и уже
                подключён.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Диалог выбора чата */}
      <Dialog open={chatsOpen} onOpenChange={setChatsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Выберите чат для разбора</DialogTitle>
          </DialogHeader>
          {chatsHint && <p className="text-sm text-zinc-500">{chatsHint}</p>}
          <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {pickChats.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    setChatId(c.id)
                    setChatTitle(c.title)
                    setChatsOpen(false)
                    toast.success('Чат выбран', {
                      description: `${c.title} · ${c.id} — не забудьте «Сохранить»`,
                    })
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-xl border p-3.5 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-500/5',
                    c.selected ? 'border-emerald-400 bg-emerald-500/8' : 'border-zinc-200',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-zinc-900">
                      {c.title}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {c.type === 'private' ? 'личный чат' : c.type} · {c.id}
                    </span>
                  </span>
                  {c.selected && (
                    <Badge className="shrink-0 border-emerald-500/30 bg-emerald-500/12 text-emerald-700 hover:bg-emerald-500/12">
                      текущий
                    </Badge>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </section>
  )
}
