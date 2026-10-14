'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Activity, Award, BadgeCheck, ChevronRight, Clock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { SectionHeader } from '@/components/betting/section-header'
import { TipsterProfileDialog } from '@/components/betting/tipster-profile-dialog'
import { SPORTS } from '@/lib/sports'
import type { TipsterStatsDto } from '@/lib/types'
import { fmtOdds, fmtPct, fmtUnits, initials, plural } from '@/lib/format'
import { cn } from '@/lib/utils'

/* ------------------ Мини-стрип последних результатов ------------------ */
function LastResultsStrip({ results }: { results: TipsterStatsDto['lastResults'] }) {
  if (results.length === 0) return null
  const reversed = results.slice().reverse() // старые -> новые
  const won = results.filter((r) => r === 'won').length
  const lost = results.filter((r) => r === 'lost').length
  const voided = results.filter((r) => r === 'void').length
  const aria = `Последние результаты: ${won} ${plural(won, ['победа', 'победы', 'побед'])}, ${lost} ${plural(lost, ['поражение', 'поражения', 'поражений'])}${voided > 0 ? `, ${voided} ${plural(voided, ['возврат', 'возврата', 'возвратов'])}` : ''}`
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold tracking-wider text-zinc-600 uppercase">
        Последние {results.length} {plural(results.length, ['прогноз', 'прогноза', 'прогнозов'])}
      </span>
      <div className="flex h-8 items-end gap-1" role="img" aria-label={aria}>
        {reversed.map((r, i) => (
          <span
            key={i}
            title={r === 'won' ? 'Победа' : r === 'lost' ? 'Поражение' : 'Возврат'}
            aria-hidden
            className={cn(
              'w-1.5 rounded-[2px] transition-colors',
              r === 'won' ? 'h-8 bg-emerald-500' : r === 'lost' ? 'h-3.5 bg-rose-500' : 'h-2 bg-zinc-600',
            )}
          />
        ))}
      </div>
    </div>
  )
}

/* ------------------ Ячейка статистики ------------------ */
function StatCell({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-zinc-100 p-3">
      <span className="text-[10px] font-semibold tracking-wider text-zinc-600 uppercase">
        {label}
      </span>
      <span className={cn('font-mono text-base font-bold tabular-nums', accent ?? 'text-zinc-900')}>
        {value}
      </span>
    </div>
  )
}

/* ------------------------------- Секция ------------------------------- */
export function TipstersSection({
  tipsters,
  loading,
  error,
}: {
  tipsters: TipsterStatsDto[]
  loading: boolean
  error: string | null
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const cardKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setSelectedId(id)
    }
  }

  return (
    <section
      id="tipsters"
      aria-labelledby="tipsters-title"
      className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-8 pb-14"
    >
      <SectionHeader
        eyebrow="Команда"
        title="Наши аналитики"
        subtext="Профильные эксперты с проверенной статистикой — победы, прибыль и средний коэффициент считаются по фактическим результатам прогнозов. Нажмите на карточку, чтобы посмотреть ленту прогнозов"
        titleId="tipsters-title"
      />

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Загрузка аналитиков">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-2xl bg-zinc-200/70" />
          ))}
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-center text-sm text-rose-300"
        >
          Не удалось загрузить аналитиков: {error}
        </div>
      ) : tipsters.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-100 p-10 text-center text-sm text-zinc-500">
          Данные об аналитиках появятся в ближайшее время
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tipsters.map((t, i) => {
            const isTop = i === 0 && t.profit > 0
            const sportMeta = t.sport ? SPORTS[t.sport] : null
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.45, delay: i * 0.08 }}
                whileHover={{ y: -4 }}
                className="min-w-0"
              >
                <Card
                  role="button"
                  tabIndex={0}
                  aria-haspopup="dialog"
                  aria-label={`Профиль аналитика ${t.name}: открыть прогнозы`}
                  onClick={() => setSelectedId(t.id)}
                  onKeyDown={(e) => cardKeyDown(e, t.id)}
                  className="group h-full cursor-pointer border-zinc-200 bg-white/70 transition-all duration-200 hover:border-emerald-500/40 hover:shadow-[0_12px_36px_-16px_rgba(16,185,129,0.35)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
                >
                  <CardContent className="flex h-full flex-col gap-5 p-5 md:p-6">
                    {/* Аватар, имя, роль */}
                    <div className="relative flex items-center gap-4">
                      <span
                        aria-hidden
                        className="grid size-16 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#10b981,#52525b)] p-[2.5px]"
                      >
                        <span className="grid size-full place-items-center rounded-full bg-zinc-100 text-lg font-extrabold text-emerald-600">
                          {initials(t.name)}
                        </span>
                      </span>
                      {/* Отступ справа — только для карточки с бейджем «В топе» */}
                      <div
                        className={cn(
                          'flex min-w-0 flex-1 flex-col gap-0.5',
                          isTop && 'pr-16',
                        )}
                      >
                        <p className="truncate text-lg font-bold text-zinc-900">{t.name}</p>
                        <p className="flex min-w-0 items-center gap-1.5 text-xs text-zinc-600">
                          <span className="truncate">{t.role}</span>
                        </p>
                        {sportMeta && (
                          <span className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                            <sportMeta.icon className="size-3" aria-hidden />
                            {sportMeta.label}
                          </span>
                        )}
                        {/* Звезда тенниса: редакционный формат (Task 34→37) */}
                        {t.sport === 'tennis' && (
                          <span
                            className="inline-flex w-fit items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600"
                            title="Ровно один прогноз в день; приоритет — топ-турниры, но может быть взят любой турнир расписания"
                          >
                            <BadgeCheck className="size-3" aria-hidden />
                            1 прогноз в день · с полным разбором логики
                          </span>
                        )}
                        <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-zinc-500">
                          <Activity className="size-3.5 text-zinc-600" aria-hidden />
                          {t.totalBets}{' '}
                          {plural(t.totalBets, ['прогноз', 'прогноза', 'прогнозов'])}
                          <span className="inline-flex items-center gap-1">
                            <Clock className="size-3.5 text-zinc-600" aria-hidden />
                            {t.pending} в игре
                          </span>
                        </p>
                      </div>
                      {isTop && (
                        <Badge className="absolute top-0 right-0 border-amber-500/40 bg-amber-500/10 text-[11px] font-bold text-amber-600">
                          <Award className="size-3" aria-hidden />
                          В топе
                        </Badge>
                      )}
                    </div>

                    {/* Сетка статистики */}
                    <div className="grid grid-cols-2 gap-3">
                      <StatCell
                        label="Winrate"
                        value={fmtPct(t.winrate, 1)}
                        accent={t.winrate >= 50 ? 'text-emerald-600' : 'text-zinc-900'}
                      />
                      <StatCell
                        label="Прибыль"
                        value={`${fmtUnits(t.profit)} юн.`}
                        accent={
                          t.profit > 0 ? 'text-emerald-600' : t.profit < 0 ? 'text-rose-600' : 'text-zinc-500'
                        }
                      />
                      <StatCell
                        label="Победы / поражения"
                        value={`${t.won} / ${t.lost}${t.voided > 0 ? ` · ${t.voided} возвр.` : ''}`}
                      />
                      <StatCell label="Ср. коэф." value={fmtOdds(t.avgOdds)} accent="text-amber-600" />
                    </div>

                    {/* Последние результаты */}
                    <LastResultsStrip results={t.lastResults} />

                    {/* Подсказка: карточка открывает профиль */}
                    <span className="mt-auto inline-flex items-center gap-1.5 border-t border-zinc-200 pt-3 text-xs font-semibold text-emerald-600 transition-colors group-hover:text-emerald-600">
                      Смотреть прогнозы
                      <ChevronRight
                        className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </span>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </div>
      )}

      <TipsterProfileDialog
        tipsterId={selectedId}
        onOpenChange={(o) => !o && setSelectedId(null)}
      />
    </section>
  )
}
