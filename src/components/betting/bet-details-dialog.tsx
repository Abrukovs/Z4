'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  Brain,
  Calculator,
  CalendarClock,
  CheckCircle2,
  CirclePlay,
  Copy,
  FileText,
  Gauge,
  GitBranch,
  Globe,
  Quote,
  Share2,
  ShieldAlert,
  Scale,
  Target,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SportChip } from '@/components/betting/sport-chip'
import { StatusBadge } from '@/components/betting/status-badge'
import { ConfidenceMeter } from '@/components/betting/confidence-meter'
import { TipsterChip } from '@/components/betting/tipster-chip'
import { RealBadge } from '@/components/betting/real-badge'
import { LiveIndicator } from '@/components/betting/live-indicator'
import { RemindToggle } from '@/components/betting/remind-toggle'
import { useNow } from '@/components/betting/use-now'
import { parseStarLogic } from '@/lib/star-logic'
import type { BetDto } from '@/lib/types'
import { betOutcome, fmtDateTime, fmtFromNow, fmtOdds, fmtUnits } from '@/lib/format'
import { cn } from '@/lib/utils'

/* ------------------ Строка статуса матча в диалоге ------------------ */
function MatchStatusLine({ bet }: { bet: BetDto }) {
  const now = useNow(30_000)
  const diff = now === null ? 1 : new Date(bet.matchDate).getTime() - now

  if (bet.status === 'pending') {
    if (diff <= 0) {
      // Живой счёт из расписания, если уже подгрузился
      if (bet.liveInfo) {
        return <LiveIndicator phase={bet.liveInfo.phase} score={bet.liveInfo.score} />
      }
      return (
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-600">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-amber-400" />
          </span>
          Матч идёт...
        </span>
      )
    }
    return (
      <span className="font-mono text-sm font-semibold text-emerald-600 tabular-nums">
        {now !== null ? fmtFromNow(bet.matchDate, now) : '—'}
      </span>
    )
  }

  const outcome = betOutcome(bet.status, bet.stake, bet.odds)
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <StatusBadge status={bet.status} />
      {bet.status !== 'void' && (
        <span
          className={cn(
            'font-mono text-sm font-bold tabular-nums',
            outcome > 0 ? 'text-emerald-600' : 'text-rose-600',
          )}
        >
          {fmtUnits(outcome)} юн.
        </span>
      )}
    </span>
  )
}

/* ------------------ Ячейка числа в сетке ------------------ */
function StatCell({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-zinc-200 bg-zinc-100 p-3">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-zinc-600 uppercase">
        {Icon && <Icon className="size-3.5" aria-hidden />}
        {label}
      </span>
      <div className="flex min-h-7 items-center">{value}</div>
    </div>
  )
}

/* ------------------ Панель «Примерная линия и ценность» ------------------ */

/** Детерминированный разброс примерных коэффициентов по матчy (0.02–0.08) */
function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function approxOddsRange(bet: BetDto): { min: number; max: number } {
  const delta = 0.02 + (hashStr(`${bet.homeTeam}|${bet.awayTeam}`) % 7) * 0.01
  return { min: Math.max(1.1, bet.odds - delta), max: bet.odds + delta }
}

/** Матожидание на 1 юнит: p·(k−1) − (1−p) */
function expectedValue(confidence: number, odds: number): number {
  const p = confidence / 100
  return p * (odds - 1) - (1 - p)
}

/** Справедливый кэф: 100 / уверенность — маржа = запас ценности */
function fairOdds(confidence: number): number {
  return 100 / confidence
}

function OddsValuePanel({ bet }: { bet: BetDto }) {
  const market = bet.marketOdds ?? null
  const { min, max } = approxOddsRange(bet)
  const ev = expectedValue(bet.confidence, bet.odds)
  const fair = fairOdds(bet.confidence)
  const evPct = ev * 100
  const edgePct = (bet.odds / fair - 1) * 100

  // Шкала охватывает и наш диапазон, и линию рынка
  const lo = Math.min(min - 0.04, market !== null ? market - 0.05 : Infinity)
  const hi = Math.max(max + 0.04, market !== null ? market + 0.05 : -Infinity)
  const pos = (v: number) =>
    `${Math.round(Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100)))}%`

  const verdict = bet.marketNote
    ? bet.marketNote
    : evPct >= 5
      ? 'Есть запас ценности: наш кэф заметно выше справедливого — на дистанции такой выбор плюсовой.'
      : evPct >= 0
        ? 'Кэф около справедливого: ценность минимальна, ставка ближе к нейтральной.'
        : 'Кэф ниже справедливого: по нашей уверенности линия тесновата — ставка на тонкой грани.'

  // Дельта нашего кэфа к линии рынка
  const delta = market !== null ? bet.odds - market : null

  return (
    <section
      aria-label="Примерная линия и ценность прогноза"
      className="flex flex-col gap-4 rounded-xl border border-amber-500/20 bg-gradient-to-b from-amber-500/[0.06] to-transparent p-4"
    >
      <h3 className="flex items-center gap-2 text-xs font-bold tracking-widest text-zinc-500 uppercase">
        <Scale className="size-3.5 text-amber-600" aria-hidden />
        Примерная линия и ценность
      </h3>

      {/* Линия рынка (web-search) */}
      {market !== null && (
        <div className="flex flex-col gap-2 rounded-xl border border-emerald-500/25 bg-gradient-to-b from-emerald-500/[0.06] to-transparent p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-zinc-600 uppercase">
              <Globe className="size-3.5 text-emerald-600" aria-hidden />
              Линия рынка
            </span>
            <span className="flex items-baseline gap-2">
              <span className="font-mono text-xl font-extrabold text-zinc-900 tabular-nums">
                {market.toFixed(2)}
              </span>
              {delta !== null && (
                <span
                  className={cn(
                    'font-mono text-xs font-bold tabular-nums',
                    delta >= 0 ? 'text-emerald-600' : 'text-rose-600',
                  )}
                >
                  {delta >= 0 ? '+' : ''}
                  {delta.toFixed(2)}
                </span>
              )}
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-zinc-600">
            {bet.marketSource ? (
              <>
                Кэф на наш выбор из открытых источников ({bet.marketSource}) — сверяйте с линией
                своего букмекера перед ставкой.
              </>
            ) : (
              'Кэф на наш выбор из открытых источников — сверяйте с линией своего букмекера.'
            )}
          </p>
        </div>
      )}

      {/* Диапазон линий с маркером нашей оценки */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-semibold tracking-wider text-zinc-600 uppercase">
            Диапазон линий
          </span>
          <span className="font-mono text-sm font-bold text-zinc-800 tabular-nums">
            ≈{min.toFixed(2)} — ≈{max.toFixed(2)}
          </span>
        </div>
        <div
          role="img"
          aria-label={`Разброс примерных коэффициентов от ${min.toFixed(2)} до ${max.toFixed(2)}, наша оценка ${fmtOdds(bet.odds)}${market !== null ? `, линия рынка ${market.toFixed(2)}` : ''}`}
          className="relative h-8"
        >
          {/* Дорожка */}
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-zinc-100" />
          {/* Зона диапазона */}
          <div
            aria-hidden
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-amber-500/50 to-amber-500/50"
            style={{ left: pos(min), width: `calc(${pos(max)} - ${pos(min)})` }}
          />
          {/* Наша оценка */}
          <div
            className="absolute top-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-amber-500 bg-white shadow-[0_0_12px_rgba(245,158,11,0.5)]"
            style={{ left: pos(bet.odds) }}
          >
            <div className="size-1.5 rounded-full bg-amber-400" />
          </div>
          {/* Линия рынка — ромб */}
          {market !== null && (
            <div
              className="absolute top-1/2 z-10 size-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-emerald-600 bg-white shadow-[0_0_10px_rgba(5,150,105,0.45)]"
              style={{ left: pos(market) }}
            />
          )}
          {/* Подписи краёв */}
          <span
            aria-hidden
            className="absolute top-6 -translate-x-1/2 font-mono text-[10px] text-zinc-600 tabular-nums"
            style={{ left: pos(min) }}
          >
            {min.toFixed(2)}
          </span>
          <span
            aria-hidden
            className="absolute top-6 -translate-x-1/2 font-mono text-[10px] text-zinc-600 tabular-nums"
            style={{ left: pos(max) }}
          >
            {max.toFixed(2)}
          </span>
        </div>
        <p className="text-[11px] leading-relaxed text-zinc-600">
          {market !== null ? (
            <>
              <span className="inline-block size-2 rounded-full border-2 border-amber-500 align-middle" />{' '}
              наша оценка ·{' '}
              <span className="inline-block size-2 rotate-45 border-2 border-emerald-600 align-middle" />{' '}
              линия рынка. Итоги считаются по нашей котировке.
            </>
          ) : (
            <>
              Оценка сервиса — не букмекерская линия: разные конторы дают кэф с разбросом
              ±{(bet.odds - min).toFixed(2)} от нашей оценки. Итоги считаются по нашей котировке.
            </>
          )}
        </p>
      </div>

      {/* Справедливый кэф и матожидание */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5 rounded-xl border border-zinc-200 bg-zinc-100 p-3">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-zinc-600 uppercase">
            <Gauge className="size-3.5" aria-hidden />
            Справедливый кэф
          </span>
          <div className="flex min-h-7 items-baseline gap-2">
            <span className="font-mono text-xl font-extrabold text-zinc-900 tabular-nums">
              {fair.toFixed(2)}
            </span>
            <span
              className={cn(
                'font-mono text-xs font-bold tabular-nums',
                edgePct >= 0 ? 'text-emerald-600' : 'text-rose-600',
              )}
            >
              {edgePct >= 0 ? '+' : ''}
              {edgePct.toFixed(1)}%
            </span>
          </div>
          <span className="text-[10px] text-zinc-600">100 / уверенность · запас над линией</span>
        </div>
        <div className="flex flex-col gap-1.5 rounded-xl border border-zinc-200 bg-zinc-100 p-3">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-zinc-600 uppercase">
            <TrendingUp className="size-3.5" aria-hidden />
            Матожидание (EV)
          </span>
          <div className="flex min-h-7 items-baseline gap-2">
            <span
              className={cn(
                'font-mono text-xl font-extrabold tabular-nums',
                ev >= 0 ? 'text-emerald-600' : 'text-rose-600',
              )}
            >
              {ev >= 0 ? '+' : ''}
              {evPct.toFixed(1)}%
            </span>
          </div>
          <span className="text-[10px] text-zinc-600">на 1 юнит ставки по нашей уверенности</span>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-zinc-700">{verdict}</p>
    </section>
  )
}

/* ------------------ Калькулятор выплаты ------------------ */

const QUICK_AMOUNTS = [500, 1000, 5000]

function fmtMoney(v: number): string {
  return v.toLocaleString('ru-RU', { maximumFractionDigits: 0 })
}

function PayoutCalculator({ bet }: { bet: BetDto }) {
  const [amount, setAmount] = useState<number>(1000)
  const safe = Number.isFinite(amount) && amount > 0 ? amount : 0
  const payout = safe * bet.odds
  const net = safe * (bet.odds - 1)

  return (
    <section
      aria-label="Калькулятор выплаты"
      className="flex flex-col gap-3 rounded-xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/[0.05] to-transparent p-4"
    >
      <h3 className="flex items-center gap-2 text-xs font-bold tracking-widest text-zinc-500 uppercase">
        <Calculator className="size-3.5 text-emerald-600" aria-hidden />
        Калькулятор выплаты
      </h3>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-100 px-3 py-2 focus-within:border-emerald-500/40">
          <span className="shrink-0 text-xs font-semibold text-zinc-600 uppercase">Сумма</span>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            value={amount}
            onChange={(e) => {
              const n = Number(e.target.value)
              setAmount(Number.isFinite(n) ? n : 0)
            }}
            aria-label="Сумма ставки в рублях"
            className="h-8 border-0 bg-transparent p-0 font-mono text-base font-bold text-zinc-900 tabular-nums shadow-none focus-visible:ring-0"
          />
          <span className="shrink-0 font-mono text-sm font-bold text-amber-600">₽</span>
        </label>
        <div role="group" aria-label="Быстрая сумма" className="flex shrink-0 gap-1.5">
          {QUICK_AMOUNTS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAmount(a)}
              aria-pressed={amount === a}
              className={cn(
                'h-9 cursor-pointer rounded-lg border px-3 font-mono text-xs font-bold tabular-nums transition-all active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500',
                amount === a
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-600'
                  : 'border-zinc-300 bg-zinc-100 text-zinc-500 hover:border-zinc-600 hover:text-zinc-800',
              )}
            >
              {fmtMoney(a)} ₽
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-zinc-100 p-3">
          <span className="text-[11px] font-semibold tracking-wider text-zinc-600 uppercase">
            Выплата
          </span>
          <span className="font-mono text-xl font-extrabold text-zinc-900 tabular-nums">
            {fmtMoney(payout)} <span className="text-xs text-zinc-600">₽</span>
          </span>
        </div>
        <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-zinc-100 p-3">
          <span className="text-[11px] font-semibold tracking-wider text-zinc-600 uppercase">
            Чистая прибыль
          </span>
          <span className="font-mono text-xl font-extrabold text-emerald-600 tabular-nums">
            +{fmtMoney(net)} <span className="text-xs text-zinc-600">₽</span>
          </span>
        </div>
      </div>

      {bet.isRealMatch && (
        <p className="text-[11px] leading-relaxed text-zinc-600">
          Расчёт по примерному коэффициенту {bet.isRealMatch ? '≈' : ''}
          {fmtOdds(bet.odds)} — реальная выплата зависит от линии букмекера на момент ставки.
        </p>
      )}
    </section>
  )
}

/* ------------------ Разбор логики «звезды» (Task 37) ------------------ */

/** Развёрнутый разбор логики эксперта-звезды: тезис, факторы за/против,
 *  сценарий победы, риск, отказ от альтернативы и размер ставки. */
function StarLogicSection({
  logic,
  expertName,
}: {
  logic: NonNullable<ReturnType<typeof parseStarLogic>>
  expertName?: string | null
}) {
  // Имя эксперта в именительном падеже (авто-склонение ненадёжно) —
  // используем формат «подпись: значение», который читается естественно
  const nameLabel = (expertName ?? '').trim()
  const proCount = logic.factors.filter((f) => f.side === 'pro').length
  const conCount = logic.factors.length - proCount

  const rows = [
    {
      icon: CirclePlay,
      label: 'Сценарий победы',
      text: logic.scenario,
      iconClass: 'text-emerald-600',
    },
    {
      icon: ShieldAlert,
      label: 'Главный риск',
      text: logic.risks,
      iconClass: 'text-amber-600',
    },
    {
      icon: GitBranch,
      label: 'Почему не альтернатива',
      text: logic.alternative,
      iconClass: 'text-zinc-600',
    },
    {
      icon: Wallet,
      label: 'Размер ставки',
      text: logic.stakeLogic,
      iconClass: 'text-amber-600',
    },
  ].filter((r) => r.text.length > 0)

  return (
    <section
      aria-label="Подробный разбор логики эксперта"
      className="flex flex-col gap-4 rounded-xl border border-amber-500/25 bg-gradient-to-b from-amber-500/[0.07] to-transparent p-4"
    >
      <h3 className="flex flex-wrap items-center gap-2 text-xs font-bold tracking-widest text-zinc-500 uppercase">
        <Brain className="size-3.5 text-amber-600" aria-hidden />
        {nameLabel ? `Логика разбора: ${nameLabel}` : 'Логика разбора эксперта'}
        <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 tabular-nums">
          <CheckCircle2 className="size-3" aria-hidden />
          {proCount} за
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600 tabular-nums">
          <AlertTriangle className="size-3" aria-hidden />
          {conCount} против
        </span>
      </h3>

      {/* Главный тезис выбора */}
      <p className="rounded-xl border border-amber-500/30 bg-amber-500/[0.08] p-3 text-sm leading-relaxed font-semibold text-zinc-800">
        {logic.thesis}
      </p>

      {/* Ключевые факторы: за и против */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold tracking-wider text-zinc-600 uppercase">
          Ключевые факторы
        </span>
        {logic.factors.map((f, i) => (
          <div
            key={i}
            className={cn(
              'flex gap-2.5 rounded-xl border p-3',
              f.side === 'con'
                ? 'border-amber-500/25 bg-amber-500/[0.04]'
                : 'border-zinc-200 bg-zinc-100/70',
            )}
          >
            {f.side === 'con' ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            ) : (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
            )}
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs font-bold text-zinc-900">{f.title}</span>
              <span className="text-xs leading-relaxed text-zinc-600">{f.detail}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Сценарий, риск, альтернатива, размер ставки */}
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex gap-2.5 rounded-xl border border-zinc-200 bg-zinc-100/70 p-3"
          >
            <r.icon className={cn('mt-0.5 size-4 shrink-0', r.iconClass)} aria-hidden />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[11px] font-semibold tracking-wider text-zinc-600 uppercase">
                {r.label}
              </span>
              <span className="text-xs leading-relaxed text-zinc-700">{r.text}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ------------------ Диалог ------------------ */
export function BetDetailsDialog({
  bet,
  onOpenChange,
}: {
  bet: BetDto | null
  onOpenChange: (open: boolean) => void
}) {
  const open = bet !== null
  const canShare =
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function'

  const handleShare = async (b: BetDto) => {
    const shortSelection = b.selection.split(' — ')[0]
    const text = [
      `«Ставка Дня»: ${b.homeTeam} vs ${b.awayTeam}`,
      `${b.market}: ${shortSelection} @ ${b.isRealMatch ? '≈' : ''}${fmtOdds(b.odds)}`,
      `Уверенность: ${b.confidence}% · ставка ${b.stake} юн.`,
      b.tipster ? `Аналитик: ${b.tipster.name}` : null,
    ]
      .filter(Boolean)
      .join('\n')

    if (canShare) {
      try {
        await navigator.share({ title: 'Ставка Дня — прогноз', text })
        return
      } catch (e) {
        // Отмена пользователем — молча; остальные ошибки — фолбэк на буфер
        if (e instanceof DOMException && e.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Прогноз скопирован', { description: text })
    } catch {
      toast.error('Не удалось скопировать прогноз')
    }
  }

  if (!bet) {
    return <Dialog open={false} onOpenChange={onOpenChange} />
  }

  const pending = bet.status === 'pending'
  const outcome = betOutcome(bet.status, bet.stake, bet.odds)
  const potential = bet.stake * (bet.odds - 1)
  const starLogic = parseStarLogic(bet.starLogic)
  const noteBorder =
    bet.status === 'won'
      ? 'border-emerald-500/60'
      : bet.status === 'lost'
        ? 'border-rose-500/60'
        : 'border-zinc-600'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Мобильные: полноэкранный bottom-sheet; md+: центрированное окно */}
      <DialogContent
        className="dark-scrollbar bg-white! top-auto! right-0! bottom-0! left-0! translate-x-0! translate-y-0! max-h-[92dvh]! max-w-full! gap-0! overflow-y-auto! rounded-t-2xl! rounded-b-none! border-zinc-200! p-0! md:top-[50%]! md:bottom-auto! md:left-1/2! md:right-auto! md:w-[min(720px,calc(100vw-4rem))]! md:translate-x-[-50%]! md:translate-y-[-50%]! md:max-h-[85vh]! md:rounded-2xl!"
      >
        <div className="flex flex-col gap-5 p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:p-6">
          {/* Заголовок: спорт, лига, статус; матч; дата/время */}
          <DialogHeader className="gap-3">
            <div className="flex flex-wrap items-center gap-2 pr-10">
              <SportChip sport={bet.sport} />
              <span className="text-xs font-semibold tracking-wide text-zinc-600 uppercase">
                {bet.league}
              </span>
              <RealBadge isReal={!!bet.isRealMatch} size="xs" />
              <span className="ml-auto">
                <StatusBadge status={bet.status} />
              </span>
            </div>
            <DialogTitle className="text-2xl leading-tight font-extrabold text-zinc-900">
              {bet.homeTeam} <span className="font-medium text-zinc-600">vs</span> {bet.awayTeam}
            </DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-zinc-500">
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="size-4 text-zinc-600" aria-hidden />
                {fmtDateTime(bet.matchDate)}
              </span>
              <MatchStatusLine bet={bet} />
            </DialogDescription>
          </DialogHeader>

          {/* Рынок и выбор */}
          <div className="rounded-xl border border-zinc-200 bg-zinc-100 p-4">
            <p className="text-xs font-semibold tracking-wider text-zinc-600 uppercase">
              {bet.market}
            </p>
            <p className="mt-1 flex items-center gap-2 text-base font-bold text-zinc-900">
              <Target className="size-4 shrink-0 text-emerald-600" aria-hidden />
              {bet.selection}
            </p>
          </div>

          {/* Ключевые числа */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCell
              label={bet.isRealMatch ? 'Коэффициент (примерный)' : 'Коэффициент'}
              icon={TrendingUp}
              value={
                <span className="font-mono text-2xl font-extrabold text-amber-600 tabular-nums">
                  {bet.isRealMatch ? '≈' : ''}
                  {fmtOdds(bet.odds)}
                </span>
              }
            />
            <StatCell
              label="Ставка"
              icon={Wallet}
              value={
                <span className="font-mono text-2xl font-extrabold text-zinc-900 tabular-nums">
                  {bet.stake}
                  <span className="ml-1 text-sm font-semibold text-zinc-600">юн.</span>
                </span>
              }
            />
            <StatCell
              label="Уверенность"
              icon={Target}
              value={<ConfidenceMeter value={bet.confidence} barClassName="w-full" />}
            />
            {pending ? (
              <StatCell
                label="Потен. профит"
                icon={TrendingUp}
                value={
                  <span className="font-mono text-2xl font-extrabold text-emerald-600 tabular-nums">
                    +{potential.toFixed(2)}
                    <span className="ml-1 text-sm font-semibold text-zinc-600">юн.</span>
                  </span>
                }
              />
            ) : (
              <StatCell
                label="Итог"
                icon={TrendingUp}
                value={
                  bet.status === 'void' ? (
                    <span className="font-mono text-2xl font-extrabold text-zinc-500 tabular-nums">
                      0.00
                      <span className="ml-1 text-sm font-semibold text-zinc-600">юн.</span>
                    </span>
                  ) : (
                    <span
                      className={cn(
                        'font-mono text-2xl font-extrabold tabular-nums',
                        outcome > 0 ? 'text-emerald-600' : 'text-rose-600',
                      )}
                    >
                      {fmtUnits(outcome)}
                      <span className="ml-1 text-sm font-semibold text-zinc-600">юн.</span>
                    </span>
                  )
                }
              />
            )}
          </div>

          {/* Разбор логики «звезды»: тезис, факторы за/против, сценарий,
              риски, альтернатива и размер ставки (Task 37) */}
          {starLogic && (
            <StarLogicSection logic={starLogic} expertName={bet.tipster?.name} />
          )}

          {/* Примерная линия и ценность: диапазон кэфов, справедливый кэф, EV */}
          {pending && bet.isRealMatch && <OddsValuePanel bet={bet} />}

          {/* Калькулятор выплаты: своя сумма → выплата и чистая прибыль */}
          {pending && <PayoutCalculator bet={bet} />}

          {/* Разбор аналитика */}
          <div className="flex flex-col gap-3">
            <h3 className="flex items-center gap-2 text-xs font-bold tracking-widest text-zinc-500 uppercase">
              <FileText className="size-3.5 text-emerald-600" aria-hidden />
              Разбор аналитика
            </h3>
            <p className="text-sm leading-relaxed text-zinc-700">{bet.analysis}</p>
            {bet.tipster && (
              <div className="flex w-fit items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-100 px-3 py-2.5">
                <TipsterChip tipster={bet.tipster} />
              </div>
            )}
          </div>

          {/* Комментарий по результату (только для рассчитанных) */}
          {bet.resultNote && bet.status !== 'pending' && (
            <blockquote
              className={cn(
                'rounded-r-lg border-l-2 bg-zinc-100 py-3 pl-4 pr-3 text-sm leading-relaxed text-zinc-500 italic',
                noteBorder,
              )}
            >
              <Quote className="mb-1 size-3.5 text-zinc-600" aria-hidden />
              {bet.resultNote}
            </blockquote>
          )}

          {/* CTA: напоминание о матче + нативный share на мобильных, копирование — фолбэк */}
          {pending && <RemindToggle bet={bet} variant="button" />}
          <Button
            type="button"
            size="lg"
            onClick={() => handleShare(bet)}
            className="h-12 w-full bg-emerald-500 text-sm font-bold text-zinc-950 shadow-[0_10px_30px_-12px_rgba(16,185,129,0.55)] transition-all hover:bg-emerald-400 active:scale-[0.98]"
          >
            {canShare ? (
              <Share2 className="size-4" aria-hidden />
            ) : (
              <Copy className="size-4" aria-hidden />
            )}
            {canShare ? 'Поделиться прогнозом' : 'Скопировать прогноз'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
