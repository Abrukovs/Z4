'use client'

import { BarChart3, Filter, ShieldCheck, type LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { SectionHeader } from '@/components/betting/section-header'

interface StepDef {
  num: string
  title: string
  text: string
  icon: LucideIcon
}

const STEPS: StepDef[] = [
  {
    num: '01',
    title: 'Анализ',
    text: 'Изучаем статистику, форму команд, травмы и составы — десятки факторов перед каждым матчем, а не только таблицу турнира.',
    icon: BarChart3,
  },
  {
    num: '02',
    title: 'Отбор',
    text: 'Фильтруем 20+ матчей в день и оставляем один лучший прогноз — «Ставку дня» с наибольшим перевесом над коэффициентом.',
    icon: Filter,
  },
  {
    num: '03',
    title: 'Контроль',
    text: 'Играем фиксированной ставкой и ведём ответственный банкролл-менеджмент. Никакого «догона» и авантюр на весь банк.',
    icon: ShieldCheck,
  },
]

export function HowItWorksSection() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-title"
      className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-8 pb-14"
    >
      <SectionHeader
        eyebrow="Методология"
        title="Как мы работаем"
        subtext="Три шага, через которые проходит каждый прогноз — от сбора данных до контроля банка"
        titleId="how-it-works-title"
      />

      <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <li
            key={step.num}
            className="animate-fade-up min-w-0 transition-transform duration-200 hover:-translate-y-1"
            style={{ animationDelay: `${i * 0.08}s` }}
          >
            <Card className="h-full border-zinc-200 bg-white/70 transition-colors hover:border-emerald-500/30">
              <CardContent className="flex h-full flex-col gap-4 p-5 md:p-6">
                <div className="flex items-start justify-between gap-3">
                  {/* Контурная цифра шага */}
                  <span
                    aria-hidden
                    className="outline-numeral font-mono text-5xl leading-none font-black tabular-nums select-none"
                  >
                    {step.num}
                  </span>
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600">
                    <step.icon className="size-5" aria-hidden />
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-lg font-bold text-zinc-900">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-zinc-500">{step.text}</p>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>
    </section>
  )
}
