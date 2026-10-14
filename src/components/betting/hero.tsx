'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Flame, Clock, Copy, CalendarClock, Wallet, Users, Quote, BookOpen, BadgeCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SportChip } from '@/components/betting/sport-chip'
import { StatusBadge } from '@/components/betting/status-badge'
import { TipsterChip } from '@/components/betting/tipster-chip'
import { RealBadge } from '@/components/betting/real-badge'
import { LiveIndicator } from '@/components/betting/live-indicator'
import { RemindToggle } from '@/components/betting/remind-toggle'
import { BetDetailsDialog } from '@/components/betting/bet-details-dialog'
import { useNow } from '@/components/betting/use-now'
import type { BetDto } from '@/lib/types'
import { betOutcome, fmtCountdown, fmtDateTime, fmtOdds, fmtFullDate, fmtUnits } from '@/lib/format'
import { MIN_BOD_ODDS } from '@/lib/bod-rules'
import { cn } from '@/lib/utils'

/* ---------------- Статус матча: отсчёт / идёт / итог ---------------- */
function MatchStatus({ bet }: { bet: BetDto }) {
  const now = useNow(1000)

  if (now === null) {
    return <span className="font-mono text-2xl text-zinc-700 tabular-nums">--:--:--</span>
  }

  const diff = new Date(bet.matchDate).getTime() - now

  if (bet.status === 'pending') {
    if (diff > 0) {
      // Завтрашняя ставка дня (вечерний набор) — помечаем явно
      const isTomorrow = new Date(bet.matchDate).toDateString() !== new Date(now).toDateString()
      return (
        <span className="inline-flex flex-wrap items-center gap-2">
          {isTomorrow && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-bold text-emerald-600">
              <CalendarClock className="size-3" aria-hidden />
              Завтра
            </span>
          )}
          <span className="font-mono text-2xl font-bold text-zinc-900 tabular-nums md:text-3xl">
            {fmtCountdown(bet.matchDate, now)}
          </span>
        </span>
      )
    }
    // Матч начался, счёт известен из живого расписания
    if (bet.liveInfo) {
      return (
        <span className="inline-flex flex-wrap items-center gap-3">
          <LiveIndicator phase={bet.liveInfo.phase} score={bet.liveInfo.score} size="lg" />
        </span>
      )
    }
    // Матч начался, но счёт ещё не подгрузился (до следующего опроса API)
    return (
      <span className="inline-flex animate-pulse items-center gap-2 text-amber-600">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-60" />
          <span className="relative inline-flex size-2.5 rounded-full bg-amber-400" />
        </span>
        <span className="text-sm font-bold tracking-wide uppercase">Матч идёт...</span>
      </span>
    )
  }

  // Матч рассчитан: показываем итог
  const outcome = betOutcome(bet.status, bet.stake, bet.odds)
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <StatusBadge status={bet.status} />
      {bet.status !== 'void' && (
        <span
          className={cn(
            'font-mono text-xl font-bold tabular-nums md:text-2xl',
            outcome > 0 ? 'text-emerald-600' : 'text-rose-600',
          )}
        >
          {fmtUnits(outcome)} юн.
        </span>
      )}
    </span>
  )
}

/* ------------------------------ Кольцо уверенности ------------------------- */
function ConfidenceRing({ value }: { value: number }) {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - value / 100)
  const stroke = value >= 80 ? '#10b981' : value >= 60 ? '#fbbf24' : '#fb7185'
  return (
    <div className="relative grid size-[132px] place-items-center">
      <svg viewBox="0 0 120 120" className="size-[132px] -rotate-90" aria-hidden>
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#e4e4e7" strokeWidth="10" />
        <motion.circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-extrabold text-zinc-900 tabular-nums">{value}%</span>
        <span className="text-[11px] font-medium tracking-wide text-zinc-600 uppercase">
          Уверенность
        </span>
      </div>
    </div>
  )
}

/* ---------------------------------- Hero ---------------------------------- */
interface HeroProps {
  bet: BetDto | null
  loading: boolean
  error: string | null
  /** Материал редакции по этому матчу (для кнопки «Читать разбор») */
  relatedArticle?: { title: string; readMinutes: number } | null
  /** Открыть разбор: прокручивает к ленте материалов и разворачивает статью */
  onReadAnalysis?: () => void
}

export function Hero({ bet, loading, error, relatedArticle, onReadAnalysis }: HeroProps) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const handleCopy = async (b: BetDto) => {
    const shortSelection = b.selection.split(' — ')[0]
    const text = `${b.homeTeam} vs ${b.awayTeam} — ${shortSelection} @ ${fmtOdds(b.odds)}, Ставка дня`
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Прогноз скопирован', { description: text })
    } catch {
      toast.error('Не удалось скопировать прогноз')
    }
  }

  return (
    <section
      id="bet-of-day"
      aria-labelledby="bet-of-day-title"
      className="relative scroll-mt-24 overflow-hidden"
    >
      {/* Декор: анимированное изумрудное свечение + точечная сетка */}
      <div
        aria-hidden
        className="animate-hero-glow pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_60%_50%_at_50%_-10%,rgba(16,185,129,0.18),transparent_70%)]"
      />
      <div aria-hidden className="hero-dot-grid pointer-events-none absolute inset-0" />

      <div className="relative mx-auto max-w-6xl px-4 pt-10 pb-6 md:pt-16">
        {/* Входная анимация — CSS (SSR-безопасно): контент виден до гидрации JS */}
        <div className="animate-fade-up flex flex-col gap-4">
          <div className="flex flex-col items-center gap-2 md:items-start">
            <span className="text-xs font-bold tracking-[0.25em] text-emerald-600 uppercase">
              Ежедневный экспертный выбор
            </span>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-4 py-1.5 text-sm font-semibold text-amber-600">
                <Flame className="size-4" aria-hidden />
                Ставка дня{bet ? ` — ${fmtFullDate(bet.matchDate)}` : ''}
              </span>
              {bet && <RealBadge isReal={!!bet.isRealMatch} size="xs" />}
            </div>
          </div>

          <h1 id="bet-of-day-title" className="sr-only">
            Ставка дня — лучший прогноз на сегодня
          </h1>

          {loading ? (
            <div className="rounded-2xl border border-zinc-200 bg-white/70 p-6 md:p-8">
              <div className="flex flex-col gap-6 md:flex-row md:justify-between">
                <div className="w-full space-y-4">
                  <Skeleton className="h-5 w-40 bg-zinc-100" />
                  <Skeleton className="h-11 w-3/4 bg-zinc-100" />
                  <Skeleton className="h-8 w-52 bg-zinc-100" />
                  <Skeleton className="h-4 w-2/3 bg-zinc-100" />
                  <Skeleton className="h-20 w-full bg-zinc-100" />
                </div>
                <div className="flex w-full flex-col items-center gap-6 md:w-64">
                  <Skeleton className="size-[132px] rounded-full bg-zinc-100" />
                  <Skeleton className="h-14 w-full bg-zinc-100" />
                </div>
              </div>
            </div>
          ) : error ? (
            <div
              role="alert"
              className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-center text-sm text-rose-300"
            >
              Не удалось загрузить ставку дня: {error}
            </div>
          ) : !bet ? (
            <div className="rounded-2xl border border-zinc-200 bg-white/70 p-8 text-center text-zinc-500">
              На сегодня ставка дня ещё не выбрана. Загляните позже!
            </div>
          ) : (
            <motion.article
              whileHover={{ y: -3 }}
              transition={{ type: 'spring', stiffness: 300, damping: 24 }}
              className="relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-white/80 shadow-[0_24px_70px_-32px_rgba(16,185,129,0.4)] ring-1 ring-emerald-500/10 backdrop-blur-sm"
            >
              {/* Градиентная линия по верхней кромке */}
              <div aria-hidden className="gradient-line-h absolute inset-x-0 top-0 h-px" />
              <div
                aria-hidden
                className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-emerald-500/10 blur-3xl"
              />
              <div className="relative flex flex-col gap-8 p-6 md:p-8 lg:flex-row lg:justify-between">
                {/* Левая часть: матч и разбор */}
                <div className="flex max-w-2xl flex-col gap-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <SportChip sport={bet.sport} />
                    <span className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">
                      {bet.league}
                    </span>
                  </div>

                  <p className="text-3xl leading-tight font-extrabold text-zinc-900 md:text-4xl">
                    {bet.homeTeam}{' '}
                    <span className="font-medium text-zinc-600">vs</span> {bet.awayTeam}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-zinc-500">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarClock className="size-4 text-zinc-600" aria-hidden />
                      {fmtDateTime(bet.matchDate)}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      {bet.status === 'pending' && <Clock className="size-4 text-zinc-600" aria-hidden />}
                      <MatchStatus bet={bet} />
                    </span>
                  </div>

                  <div className="rounded-xl border border-zinc-200 bg-zinc-100 p-4">
                    <p className="text-xs font-semibold tracking-wider text-zinc-600 uppercase">
                      {bet.market}
                    </p>
                    <p className="mt-1 text-lg font-bold text-zinc-900">{bet.selection}</p>
                  </div>

                  <p className="text-sm leading-relaxed text-zinc-700">{bet.analysis}</p>

                  {bet.resultNote && (
                    <blockquote className="rounded-r-lg border-l-2 border-emerald-500/60 bg-zinc-100 py-2.5 pl-4 pr-3 text-sm text-zinc-500 italic">
                      <Quote className="mb-1 size-3.5 text-zinc-600" aria-hidden />
                      {bet.resultNote}
                    </blockquote>
                  )}

                  <div className="flex flex-wrap items-center gap-4">
                    {bet.tipster && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-zinc-600">
                        <Users className="size-3.5" aria-hidden />
                        <TipsterChip tipster={bet.tipster} />
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                      <Wallet className="size-3.5 text-zinc-600" aria-hidden />
                      Ставка: <span className="font-bold text-amber-600">{bet.stake} юнитов</span>
                    </span>
                  </div>

                  {/* Связка с редакционным разбором этого матча */}
                  {relatedArticle && onReadAnalysis && (
                    <button
                      type="button"
                      onClick={onReadAnalysis}
                      aria-label={`Читать редакционный разбор матча: ${relatedArticle.title}`}
                      className="group inline-flex w-fit cursor-pointer items-center gap-2.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm font-bold text-emerald-600 transition-all hover:border-emerald-500/60 hover:bg-emerald-500/20 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
                    >
                      <BookOpen className="size-4 shrink-0" aria-hidden />
                      Читать разбор матча
                      <span className="rounded-full border border-emerald-500/30 bg-white/60 px-2 py-0.5 text-[11px] font-semibold text-emerald-600/80 tabular-nums group-hover:text-emerald-600">
                        {relatedArticle.readMinutes} мин
                      </span>
                    </button>
                  )}
                </div>

                {/* Правая часть: коэффициент, уверенность, CTA */}
                <div className="flex flex-row items-center justify-between gap-6 lg:w-72 lg:flex-col lg:items-stretch">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-xs font-semibold tracking-wider text-zinc-600 uppercase">
                      Коэффициент
                    </span>
                    <span className="shimmer-odds font-mono text-5xl font-extrabold tabular-nums md:text-6xl">
                      {fmtOdds(bet.odds)}
                    </span>
                    {bet.isRealMatch ? (
                      <button
                        type="button"
                        onClick={() => setDetailsOpen(true)}
                        className="cursor-pointer text-[11px] font-bold text-emerald-600 underline-offset-2 transition-colors hover:text-emerald-500 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
                        title="Подробности прогноза: линия рынка, калькулятор выплаты"
                      >
                        примерный · линия рынка и подробнее →
                      </button>
                    ) : (
                      <span className="text-[11px] font-medium text-zinc-600">
                        подробнее в карточке прогноза
                      </span>
                    )}
                    {/* Правила редакции: в «Ставку дня» — только события со
                        средним кэфом не ниже 1.50 (29.09) и известные лиги
                        (03.10): топ-чемпионаты, турниры сборных и разрешённые
                        вторые дивизионы (Чемпионшип, Сегунда, Серия B, Лига 2,
                        Бундеслига-2, Элитсерия и т.п.). Низшие дивизионы —
                        только в ленте прогнозов, не в главной ставке */}
                    {bet.odds >= MIN_BOD_ODDS && (
                      <span
                        className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-600"
                        title="Правила редакции: в «Ставку дня» попадают события со средним кэфом не ниже 1.50 из известных турниров — топ-лиги, турниры сборных и разрешённые вторые дивизионы (Первая лига РФ, Чемпионшип, Сегунда, Серия B, Лига 2, Бундеслига-2, Элитсерия, Вейккауслиига, Лига 1 Румынии, Бразилия, Аргентина и т.д.). Низшие дивизионы остаются в ленте прогнозов"
                      >
                        <BadgeCheck className="size-3 shrink-0" aria-hidden />
                        правила: кэф от 1.50 · известные лиги
                      </span>
                    )}
                  </div>

                  <ConfidenceRing value={bet.confidence} />

                  <RemindToggle bet={bet} variant="button" />

                  <Button
                    type="button"
                    size="lg"
                    onClick={() => handleCopy(bet)}
                    className="h-12 bg-emerald-500 text-sm font-bold text-zinc-950 shadow-[0_10px_30px_-12px_rgba(16,185,129,0.55)] transition-all hover:bg-emerald-400 active:scale-[0.98]"
                  >
                    <Copy className="size-4" aria-hidden />
                    Скопировать прогноз
                  </Button>
                </div>
              </div>
            </motion.article>
          )}
        </div>
      </div>

      {/* Диалог подробностей ставки дня: линия рынка, калькулятор, разбор.
          Открыт только по клику (detailsOpen) — раньше bet передавался
          безусловно и диалог висел открытым на каждой загрузке. */}
      <BetDetailsDialog bet={detailsOpen ? bet : null} onOpenChange={setDetailsOpen} />
    </section>
  )
}
