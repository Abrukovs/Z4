'use client'

import { useCallback, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  CalendarDays,
  ClipboardList,
  Newspaper,
  Share2,
  Check,
  Timer,
  Eye,
  User2,
  BookOpen,
  RefreshCw,
  ChevronDown,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { SectionHeader } from '@/components/betting/section-header'
import { SPORT_LIST } from '@/lib/sports'
import { fmtFullDate, fmtTime, initials } from '@/lib/format'
import type { ArticleCategory, ArticleDto, ArticlesResponse } from '@/lib/types'
import { cn } from '@/lib/utils'

/* ---------- Категория → иконка + цветовой акцент ---------- */

const CATEGORY_META: Record<ArticleCategory, { icon: typeof Eye; chip: string; bar: string; label: string }> = {
  'Разбор матча': {
    icon: Eye,
    chip: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600',
    bar: 'from-emerald-400 to-emerald-600',
    label: 'Разбор матча',
  },
  'Итоги дня': {
    icon: ClipboardList,
    chip: 'border-zinc-600/60 bg-zinc-200/70 text-zinc-700',
    bar: 'from-zinc-400 to-zinc-600',
    label: 'Итоги дня',
  },
  'Взгляд на завтра': {
    icon: CalendarDays,
    chip: 'border-amber-500/40 bg-amber-500/10 text-amber-600',
    bar: 'from-amber-400 to-amber-600',
    label: 'Взгляд на завтра',
  },
}

function categoryMeta(category: ArticleCategory) {
  return CATEGORY_META[category] ?? CATEGORY_META['Разбор матча']
}

/* ---------- Карточка материала ---------- */

/** Материал дописывался после публикации (новые расчёты в «Итогах дня») */
function wasUpdated(a: ArticleDto): boolean {
  if (!a.updatedAt) return false
  const delta = new Date(a.updatedAt).getTime() - new Date(a.publishedAt).getTime()
  return delta > 5 * 60 * 1000
}

function ArticleCard({ article, onOpen, index }: { article: ArticleDto; onOpen: () => void; index: number }) {
  const meta = categoryMeta(article.category)
  const sport = SPORT_LIST.find((s) => s.key === article.sport)
  const updated = wasUpdated(article)

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.08, 0.24), ease: 'easeOut' }}
    >
      <button
        type="button"
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
        aria-label={`Читать материал: ${article.title}`}
        className="group relative flex h-full w-full cursor-pointer flex-col gap-3 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 p-4 text-left transition-all duration-200 hover:border-zinc-300 hover:bg-white/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 active:scale-[0.99] sm:p-5"
      >
        {/* Верхняя градиентная кромка категории */}
        <span
          aria-hidden
          className={cn('absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r opacity-70', meta.bar)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold',
              meta.chip,
            )}
          >
            <meta.icon className="size-3.5" aria-hidden />
            {meta.label}
          </span>
          {sport && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-500"
              title={sport.label}
            >
              <sport.icon className="size-3.5" aria-hidden />
              {sport.label}
            </span>
          )}
          {updated && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600/90"
              title={`Материал дополнен после новых расчётов: ${fmtTime(article.updatedAt as string)}`}
            >
              <RefreshCw className="size-3" aria-hidden />
              Обновлено {fmtTime(article.updatedAt as string)}
            </span>
          )}
        </div>

        <h3 className="text-base leading-snug font-bold text-zinc-900 transition-colors group-hover:text-emerald-600 sm:text-lg">
          {article.title}
        </h3>

        <p className="line-clamp-3 text-sm leading-relaxed text-zinc-500">{article.excerpt}</p>

        {article.matchRef && (
          <p className="mt-auto flex items-center gap-1.5 truncate text-xs font-semibold text-zinc-600">
            <BookOpen className="size-3.5 shrink-0 text-zinc-600" aria-hidden />
            {article.matchRef}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-zinc-200 pt-3">
          <span className="flex min-w-0 items-center gap-2">
            {article.author ? (
              <>
                <span
                  aria-hidden
                  className="grid size-7 shrink-0 place-items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-[10px] font-bold text-emerald-600"
                >
                  {initials(article.author.name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-zinc-800">
                    {article.author.name}
                  </span>
                  <span className="block truncate text-[11px] text-zinc-600">{article.author.role}</span>
                </span>
              </>
            ) : (
              <>
                <span
                  aria-hidden
                  className="grid size-7 shrink-0 place-items-center rounded-full border border-zinc-300 bg-zinc-100 text-[10px] text-zinc-500"
                >
                  <User2 className="size-3.5" />
                </span>
                <span className="text-xs font-semibold text-zinc-700">Редакция «Ставки Дня»</span>
              </>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-zinc-600">
            <Timer className="size-3.5" aria-hidden />
            {article.readMinutes} мин
          </span>
        </div>
      </button>
    </motion.article>
  )
}

function CardSkeleton() {
  return (
    <div className="flex h-full flex-col gap-3 rounded-2xl border border-zinc-200 bg-zinc-100 p-4 sm:p-5">
      <div className="flex gap-2">
        <Skeleton className="h-6 w-28 rounded-full" />
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
      <Skeleton className="h-5 w-11/12" />
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <div className="mt-auto flex items-center justify-between border-t border-zinc-200 pt-3">
        <Skeleton className="size-7 rounded-full" />
        <Skeleton className="h-4 w-12" />
      </div>
    </div>
  )
}

/* ---------- Диалог полного материала ---------- */

function ArticleDialog({ article, open, onOpenChange }: { article: ArticleDto | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const paragraphs = article ? article.content.split('\n\n').filter((p) => p.trim().length > 0) : []
  const meta = article ? categoryMeta(article.category) : null
  const [shared, setShared] = useState(false)
  const [progress, setProgress] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Прогресс чтения: % прокрутки тела диалога (rAF-троттл)
  const onBodyScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const max = el.scrollHeight - el.clientHeight
    setProgress(max > 0 ? Math.min(100, Math.round((el.scrollTop / max) * 100)) : 0)
  }, [])

  // Сброс прогресса/шаринга при смене материала или закрытии —
  // канонический паттерн «adjust state during render» (без эффекта)
  const identity = `${open ? 'open' : 'closed'}:${article?.id ?? 'none'}`
  const [prevIdentity, setPrevIdentity] = useState(identity)
  if (prevIdentity !== identity) {
    setPrevIdentity(identity)
    setProgress(0)
    setShared(false)
  }

  const handleShare = async () => {
    if (!article) return
    const text = `«${article.title}» — Ставка Дня\n${article.excerpt}\n${article.readMinutes} мин чтения\n18+`
    try {
      if (navigator.share) {
        await navigator.share({ title: article.title, text })
      } else {
        await navigator.clipboard.writeText(`${text}\n${window.location.origin}`)
        toast.success('Материал скопирован в буфер обмена')
      }
      setShared(true)
      setTimeout(() => setShared(false), 2500)
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      toast.error('Не удалось поделиться материалом')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {article && meta && (
        <DialogContent
          ref={scrollRef}
          onScroll={onBodyScroll}
          className="dark-scrollbar bg-white! top-auto! right-0! bottom-0! left-0! translate-x-0! translate-y-0! max-h-[92dvh]! max-w-full! gap-0! overflow-y-auto! rounded-t-2xl! rounded-b-none! border-zinc-200! p-0! md:top-[50%]! md:bottom-auto! md:left-1/2! md:right-auto! md:w-[min(680px,calc(100vw-4rem))]! md:translate-x-[-50%]! md:translate-y-[-50%]! md:max-h-[85vh]! md:rounded-2xl!"
        >
          {/* Полоса прогресса чтения: фон + заполнение цветом категории */}
          <div className="sticky top-0 z-10 h-1 w-full bg-zinc-100" aria-hidden>
            <div
              className={cn('h-full bg-gradient-to-r transition-[width] duration-150 ease-out', meta.bar)}
              style={{ width: `${progress}%` }}
            />
          </div>
          <DialogHeader className="space-y-3! gap-3 border-b border-zinc-200 px-4 pt-4 pb-5 text-left sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold',
                  meta.chip,
                )}
              >
                <meta.icon className="size-3.5" aria-hidden />
                {meta.label}
              </span>
              <span className="text-[11px] font-semibold text-zinc-600">
                {fmtFullDate(article.publishedAt)}
              </span>
              <span className="flex items-center gap-1 text-[11px] font-semibold text-zinc-600">
                <Timer className="size-3.5" aria-hidden />
                {article.readMinutes} мин чтения
              </span>
              {wasUpdated(article) && article.updatedAt && (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600/90">
                  <RefreshCw className="size-3" aria-hidden />
                  обновлено в {fmtTime(article.updatedAt)}
                </span>
              )}
            </div>
            <DialogTitle className="text-left! text-xl leading-snug font-extrabold tracking-tight text-zinc-900 sm:text-2xl">
              {article.title}
            </DialogTitle>
            <DialogDescription className="text-left! text-sm leading-relaxed text-zinc-500">
              {article.excerpt}
            </DialogDescription>
            {article.author && (
              <div className="flex items-center gap-2.5 pt-1">
                <span
                  aria-hidden
                  className="grid size-9 place-items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-xs font-bold text-emerald-600"
                >
                  {initials(article.author.name)}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-zinc-900">{article.author.name}</span>
                  <span className="block text-xs text-zinc-600">{article.author.role}</span>
                </span>
              </div>
            )}
          </DialogHeader>

          <div className="space-y-4 px-4 py-5 sm:px-6">
            {paragraphs.map((p, i) => (
              <p
                key={i}
                className={cn(
                  'text-sm leading-relaxed',
                  i === 0 ? 'font-medium text-zinc-800' : 'text-zinc-700',
                  'first-letter:font-semibold',
                )}
              >
                {p}
              </p>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-zinc-200 bg-zinc-100 px-4 py-3 text-[11px] font-semibold text-zinc-600 sm:px-6">
            <span className="flex items-center gap-1.5">
              <Newspaper className="size-3.5 text-emerald-600/70" aria-hidden />
              {article.matchRef ? `Материал к матчу: ${article.matchRef}` : 'Материал редакции «Ставка Дня»'}
            </span>
            <span className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleShare}
                aria-label="Поделиться материалом"
                className={cn(
                  'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[11px] font-bold transition-all active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500',
                  shared
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                    : 'border-zinc-300 bg-white text-zinc-700 hover:border-emerald-500/40 hover:text-emerald-600',
                )}
              >
                {shared ? (
                  <Check className="size-3.5" aria-hidden />
                ) : (
                  <Share2 className="size-3.5" aria-hidden />
                )}
                {shared ? 'Скопировано' : 'Поделиться'}
              </button>
              <span aria-hidden>18+</span>
            </span>
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}

/* ---------- Секция ---------- */

const PAGE_REVEAL_STEP = 12

/** Внешний сигнал «открыть статью» (кнопка «Читать разбор» в hero) */
export interface PendingArticle {
  article: ArticleDto
  /** Инкрементится на каждый клик — повторное открытие той же статьи */
  token: number
}

export function ArticlesSection({
  articles,
  total = 0,
  loading,
  pending = null,
}: {
  articles: ArticleDto[]
  /** Всего материалов в архиве — по нему решаем, показывать ли «Показать ещё» */
  total?: number
  loading: boolean
  /** Открыть материал извне (hero → разбор ставки дня) */
  pending?: PendingArticle | null
}) {
  const [active, setActive] = useState<ArticleDto | null>(null)
  const [open, setOpen] = useState(false)

  // Внешний сигнал: открытие статьи из hero. Паттерн «adjust state during
  // render» — без эффекта, повторные клики по token тоже срабатывают.
  const pendingToken = pending?.token ?? 0
  const [prevToken, setPrevToken] = useState(pendingToken)
  if (pendingToken !== prevToken && pending) {
    setPrevToken(pendingToken)
    setActive(pending.article)
    setOpen(true)
  }

  // Архив: расширенный список (подгружается по кнопке)
  const [archive, setArchive] = useState<ArticleDto[] | null>(null)
  const [archiveLoading, setArchiveLoading] = useState(false)

  const shown = archive ?? articles.slice(0, 6)
  const archiveTotal = Math.max(total, shown.length)
  const hasMore = !loading && !archive && archiveTotal > articles.length

  const openArticle = (a: ArticleDto) => {
    setActive(a)
    setOpen(true)
  }

  const loadArchive = async () => {
    if (archiveLoading) return
    setArchiveLoading(true)
    try {
      const res = await fetch(`/api/articles?limit=${PAGE_REVEAL_STEP}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`Ошибка ${res.status}`)
      const json = (await res.json()) as ArticlesResponse
      setArchive(json.articles)
    } catch {
      toast.error('Не удалось загрузить архив разборов')
    } finally {
      setArchiveLoading(false)
    }
  }

  // Пока грузимся — показываем скелетоны; после — пустую секцию прячем
  if (!loading && articles.length === 0) return null

  return (
    <section
      id="articles"
      aria-label="Разборы и редакционные материалы"
      className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-6"
    >
      <SectionHeader
        eyebrow="Редакция"
        title="Разборы и аналитика"
        subtext="Материалы редакции по реальным матчам: за чем наблюдать в ключевых встречах, честные итоги расчётных дней и взгляд на завтрашнюю программу"
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)
          : shown.map((a, i) => (
              <ArticleCard key={a.id} article={a} index={i} onOpen={() => openArticle(a)} />
            ))}
      </div>

      {hasMore && (
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={() => void loadArchive()}
            disabled={archiveLoading}
            aria-live="polite"
            className="group inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-zinc-200 bg-zinc-100 px-5 text-sm font-bold text-zinc-700 transition-all hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-600 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:cursor-wait disabled:opacity-60"
          >
            {archiveLoading ? (
              <>
                <RefreshCw className="size-4 animate-spin" aria-hidden />
                Загружаем архив…
              </>
            ) : (
              <>
                Показать все материалы
                <span className="rounded-full border border-zinc-300 bg-zinc-100 px-2 py-0.5 text-[11px] tabular-nums text-zinc-500 group-hover:border-emerald-500/40 group-hover:text-emerald-600">
                  {archiveTotal}
                </span>
                <ChevronDown className="size-4 transition-transform group-hover:translate-y-0.5" aria-hidden />
              </>
            )}
          </button>
        </div>
      )}

      <ArticleDialog article={active} open={open} onOpenChange={setOpen} />
    </section>
  )
}
