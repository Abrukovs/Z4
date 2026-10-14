'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, History, BarChart3 } from 'lucide-react'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Header, type NavDestination } from '@/components/betting/header'
import { Hero } from '@/components/betting/hero'
import { TopExpertPick } from '@/components/betting/top-expert-pick'
import { StatsStrip } from '@/components/betting/stats-strip'
import { RealMatchesSection } from '@/components/betting/real-matches-section'
import { LiveTicker } from '@/components/betting/live-ticker'
import { SectionHeader } from '@/components/betting/section-header'
import { TodayList } from '@/components/betting/today-list'
import { ExpressCard } from '@/components/betting/express-card'
import { HistoryView } from '@/components/betting/history-view'
import { StatsView, DEFAULT_STATS_FILTERS } from '@/components/betting/stats-view'
import { TipstersSection } from '@/components/betting/tipsters-section'
import { ArticlesSection, type PendingArticle } from '@/components/betting/articles-section'
import { HowItWorksSection } from '@/components/betting/how-it-works-section'
import { FaqSection } from '@/components/betting/faq-section'
import { SubscribeSection } from '@/components/betting/subscribe-section'
import { DigestSection } from '@/components/betting/digest-section'
import { Footer } from '@/components/betting/footer'
import { ReminderScheduler } from '@/components/betting/reminder-scheduler'
import { ScrollToTop } from '@/components/betting/scroll-to-top'
import type {
  BetDto,
  BetsResponse,
  BetOfDayResponse,
  ExpressDayStat,
  ExpressResponse,
  StatsFilterState,
  StatsResponse,
  TipsterStatsDto,
  TipstersResponse,
  ArticlesResponse,
  ArticleDto,
} from '@/lib/types'

/** Интервал автообновления данных (результаты появляются «вживую») */
const POLL_INTERVAL_MS = 60_000

export default function Page() {
  const [betOfDay, setBetOfDay] = useState<BetDto | null>(null)
  const [bodLoading, setBodLoading] = useState(true)
  const [bodError, setBodError] = useState<string | null>(null)

  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState<string | null>(null)

  // Фильтры статистики (03.10): вид спорта · исход · категория · эксперт.
  // Глобальная статистика (stats) всегда без фильтров — её видят шапка и
  // полоса KPI; при активных фильтрах отдельно грузится выборка.
  const [statsFilters, setStatsFilters] = useState<StatsFilterState>(DEFAULT_STATS_FILTERS)
  const [statsFiltered, setStatsFiltered] = useState<StatsResponse | null>(null)
  const [statsFiltersLoading, setStatsFiltersLoading] = useState(false)
  const statsFiltersActive =
    statsFilters.sport !== 'all' ||
    statsFilters.outcome !== 'all' ||
    statsFilters.category !== 'all' ||
    statsFilters.expert !== 'all'

  const [todayBets, setTodayBets] = useState<BetDto[]>([])
  const [todayLoading, setTodayLoading] = useState(true)
  const [todayError, setTodayError] = useState<string | null>(null)
  const [realMode, setRealMode] = useState(false)

  const [express, setExpress] = useState<ExpressResponse['express']>(null)
  const [expressHistory, setExpressHistory] = useState<ExpressDayStat[]>([])
  const [expressLoading, setExpressLoading] = useState(true)

  const [tipsters, setTipsters] = useState<TipsterStatsDto[]>([])
  const [tipstersLoading, setTipstersLoading] = useState(true)
  const [tipstersError, setTipstersError] = useState<string | null>(null)

  const [articles, setArticles] = useState<ArticleDto[]>([])
  const [articlesTotal, setArticlesTotal] = useState(0)
  const [articlesLoading, setArticlesLoading] = useState(true)

  /** Внешний сигнал «открыть разбор» для ArticlesSection (из hero) */
  const [pendingArticle, setPendingArticle] = useState<PendingArticle | null>(null)

  // Тик данных: инкрементится на каждую загрузку (mount / poll / пересев).
  // История (со своей пагинацией) перезагружается по этому тику молча.
  const [dataTick, setDataTick] = useState(0)

  const [tab, setTab] = useState<string>('today')
  const [refreshing, setRefreshing] = useState(false)

  const loadAll = useCallback(async (silent = false) => {
    setDataTick((t) => t + 1)

    const safeJson = async <T,>(url: string): Promise<T> => {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Ошибка ${res.status}`)
      }
      return (await res.json()) as T
    }

    if (!silent) {
      setBodLoading(true)
      setStatsLoading(true)
      setTodayLoading(true)
      setTipstersLoading(true)
      setBodError(null)
      setStatsError(null)
      setTodayError(null)
      setTipstersError(null)
    }

    void safeJson<BetOfDayResponse>('/api/bet-of-day')
      .then((data) => setBetOfDay(data.bet))
      .catch((e: Error) => setBodError(e.message))
      .finally(() => setBodLoading(false))

    void safeJson<StatsResponse>('/api/stats')
      .then((data) => setStats(data))
      .catch((e: Error) => setStatsError(e.message))
      .finally(() => setStatsLoading(false))

    void safeJson<BetsResponse>('/api/bets?tab=today')
      .then((data) => {
        setTodayBets(data.bets)
        setRealMode(!!data.realMode)
      })
      .catch((e: Error) => setTodayError(e.message))
      .finally(() => setTodayLoading(false))

    void safeJson<TipstersResponse>('/api/tipsters')
      .then((data) => setTipsters(data.tipsters))
      .catch((e: Error) => setTipstersError(e.message))
      .finally(() => setTipstersLoading(false))

    // Экспресс дня пересобирается на лету + прошедшие дни с исходами ног —
    // ошибки не прерываем (карточка опциональна)
    void safeJson<ExpressResponse>('/api/express')
      .then((data) => {
        setExpress(data.express)
        setExpressHistory(data.history ?? [])
      })
      .catch(() => {
        setExpress(null)
        setExpressHistory([])
      })
      .finally(() => setExpressLoading(false))

    // Разборы: генерируются на лету из real-прогнозов — ошибки не критичны
    void safeJson<ArticlesResponse>('/api/articles')
      .then((data) => {
        setArticles(data.articles)
        setArticlesTotal(data.total ?? data.articles.length)
      })
      .catch(() => setArticles([]))
      .finally(() => setArticlesLoading(false))
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  // Автообновление каждые 60 с: рассчитанные матчи переезжают в историю без перезагрузки.
  // Пауза, когда вкладка скрыта (document.hidden).
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return
      void loadAll(true)
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [loadAll])

  // Фильтрованная статистика: грузится при активных фильтрах (и обновляется
  // на каждый тик данных — новые расчёты сразу попадают в выборку).
  // Без фильтров показываем глобальную статистику — лишних запросов нет.
  useEffect(() => {
    if (!statsFiltersActive) {
      setStatsFiltered(null)
      return
    }
    const qs = new URLSearchParams({
      sport: statsFilters.sport,
      outcome: statsFilters.outcome,
      category: statsFilters.category,
      expert: statsFilters.expert,
    }).toString()
    let cancelled = false
    setStatsFiltersLoading(true)
    void fetch(`/api/stats?${qs}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Ошибка ${res.status}`)
        return (await res.json()) as StatsResponse
      })
      .then((data) => {
        if (!cancelled) setStatsFiltered(data)
      })
      .catch(() => {
        /* молча: панель продолжает показывать прошлую выборку */
      })
      .finally(() => {
        if (!cancelled) setStatsFiltersLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [statsFilters, statsFiltersActive, dataTick])

  // Реальный режим + пустая лента: генерация прогнозов идёт в фоне —
  // подтягиваем результат чаще (каждые 10 с, до 12 попыток ≈ 2 минуты)
  useEffect(() => {
    if (!realMode || todayLoading || todayBets.length > 0) return
    let attempts = 0
    const timer = setInterval(() => {
      if (document.hidden) return
      if (attempts >= 12 || todayBets.length > 0) {
        clearInterval(timer)
        return
      }
      attempts++
      void loadAll(true)
    }, 10_000)
    return () => clearInterval(timer)
  }, [realMode, todayLoading, todayBets.length, loadAll])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/seed', { method: 'POST' })
      if (!res.ok) throw new Error(`Ошибка ${res.status}`)
      await loadAll()
      toast.success('Данные обновлены', {
        description: 'Свежая статистика и прогнозы на сегодня',
      })
    } catch {
      toast.error('Не удалось обновить данные')
    } finally {
      setRefreshing(false)
    }
  }, [loadAll])

  const handleNavigate = useCallback((dest: NavDestination) => {
    if (
      dest === 'tipsters' ||
      dest === 'articles' ||
      dest === 'how' ||
      dest === 'subscribe' ||
      dest === 'matches' ||
      dest === 'digest'
    ) {
      const id =
        dest === 'tipsters'
          ? 'tipsters'
          : dest === 'articles'
            ? 'articles'
            : dest === 'how'
              ? 'how-it-works'
              : dest === 'matches'
                ? 'real-matches'
                : dest === 'digest'
                  ? 'digest'
                  : 'subscribe'
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
      return
    }
    setTab(dest)
    requestAnimationFrame(() => {
      document.getElementById('predictions')?.scrollIntoView({ behavior: 'smooth' })
    })
  }, [])

  // Связка «Ставка дня → разбор редакции»: статья «Разбор матча» по этим командам
  const bodArticle = useMemo(() => {
    if (!betOfDay || articles.length === 0) return null
    const norm = (s: string) =>
      s
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[^a-zа-я0-9]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    const home = norm(betOfDay.homeTeam)
    const away = norm(betOfDay.awayTeam)
    if (!home || !away) return null
    return (
      articles.find((a) => {
        if (a.category !== 'Разбор матча' || !a.matchRef) return false
        const ref = norm(a.matchRef)
        return ref.includes(home) && ref.includes(away)
      }) ?? null
    )
  }, [betOfDay, articles])

  // Кнопка в hero: прокручиваем к ленте материалов и разворачиваем разбор
  const handleReadAnalysis = useCallback(() => {
    document.getElementById('articles')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (bodArticle) {
      setPendingArticle((p) => ({
        article: bodArticle,
        token: (p?.token ?? 0) + 1,
      }))
    }
  }, [bodArticle])

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 text-zinc-900">
      <ReminderScheduler />
      <Header
        winrate={stats && !statsLoading && !statsError ? stats.winrate : null}
        onNavigate={handleNavigate}
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />

      <main className="relative flex-1">
        <Hero
          bet={betOfDay}
          loading={bodLoading}
          error={bodError}
          relatedArticle={bodArticle}
          onReadAnalysis={bodArticle ? handleReadAnalysis : undefined}
        />

        {/* Топ-эксперт сайта с его активным прогнозом — сразу под «Ставкой дня» */}
        <TopExpertPick tipsters={tipsters} loading={tipstersLoading} variant="hero" />

        <StatsStrip stats={stats} loading={statsLoading} error={statsError} />

        <LiveTicker />

        <RealMatchesSection />

        <section
          id="predictions"
          aria-label="Прогнозы и статистика"
          className="relative mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-6 pb-14"
        >
          {/* Декор: едва заметная сетка, затухающая к низу */}
          <div
            aria-hidden
            className="tabs-grid-bg pointer-events-none absolute inset-x-4 -top-6 h-[560px] md:inset-x-6"
          />
          <div className="relative">
            <SectionHeader
              eyebrow="Лента"
              title="Прогнозы и результаты"
              subtext="Все прогнозы — на реальные матчи из живого расписания; коэффициенты примерные, итоги считаются по настоящим счётам"
            />
            <Tabs value={tab} onValueChange={setTab} className="gap-6">
              <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-xl border border-zinc-200 bg-white/70 p-1.5 sm:w-fit">
                <TabsTrigger
                  value="today"
                  className="h-11 gap-2 px-4 text-sm data-[state=active]:bg-zinc-100 data-[state=active]:text-zinc-900"
                >
                  <CalendarDays className="size-4" aria-hidden />
                  Прогнозы на сегодня
                </TabsTrigger>
                <TabsTrigger
                  value="history"
                  className="h-11 gap-2 px-4 text-sm data-[state=active]:bg-zinc-100 data-[state=active]:text-zinc-900"
                >
                  <History className="size-4" aria-hidden />
                  История
                </TabsTrigger>
                <TabsTrigger
                  value="stats"
                  className="h-11 gap-2 px-4 text-sm data-[state=active]:bg-zinc-100 data-[state=active]:text-zinc-900"
                >
                  <BarChart3 className="size-4" aria-hidden />
                  Статистика
                </TabsTrigger>
              </TabsList>

              <TabsContent value="today">
                <div className="animate-fade-up-sm">
                  {!expressLoading && (express || expressHistory.length > 0) ? (
                    <div className="mb-4">
                      <ExpressCard express={express} history={expressHistory} />
                      {/* Компактная подсветка топ-эксперта — под «Экспрессом дня» */}
                      <TopExpertPick tipsters={tipsters} loading={tipstersLoading} variant="express" />
                    </div>
                  ) : null}
                  <TodayList
                    bets={todayBets}
                    loading={todayLoading}
                    error={todayError}
                    realMode={realMode}
                    onReload={() => void loadAll(true)}
                  />
                </div>
              </TabsContent>

              <TabsContent value="history">
                <div className="animate-fade-up-sm">
                  <HistoryView reloadToken={dataTick} tipsters={tipsters} />
                </div>
              </TabsContent>

              <TabsContent value="stats">
                <div className="animate-fade-up-sm">
                  <StatsView
                    stats={statsFiltered ?? stats}
                    loading={statsLoading}
                    error={statsError}
                    filters={statsFilters}
                    onFiltersChange={setStatsFilters}
                    filtersLoading={statsFiltersLoading}
                    globalTotal={stats?.totals.total ?? null}
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </section>

        <TipstersSection tipsters={tipsters} loading={tipstersLoading} error={tipstersError} />

        <ArticlesSection
          articles={articles}
          total={articlesTotal}
          loading={articlesLoading}
          pending={pendingArticle}
        />

        <HowItWorksSection />

        <FaqSection />

        <SubscribeSection />

        {/* Утренний разбор в Telegram: итоги «Ставки дня» и топ-эксперта за вчера */}
        <DigestSection />
      </main>

      <Footer />

      <ScrollToTop />
    </div>
  )
}
