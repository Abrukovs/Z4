'use client'

import { Zap, ShieldAlert, Send, MessageCircle, Globe } from 'lucide-react'

const SOCIAL_ICONS = [
  { icon: Send, title: 'Telegram' },
  { icon: MessageCircle, title: 'Чат сообщества' },
  { icon: Globe, title: 'Блог аналитики' },
]

export function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="relative mt-auto bg-zinc-100">
      {/* Градиентная линия по верхней кромке */}
      <div aria-hidden className="gradient-line-h absolute inset-x-0 top-0 h-px" />
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] md:flex-row md:items-start md:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-emerald-500">
            <Zap className="size-5 text-zinc-950" aria-hidden />
          </span>
          <div className="flex flex-col">
            <span className="text-base font-extrabold text-zinc-900">
              Ставка <span className="text-emerald-600">Дня</span>
            </span>
            <span className="text-xs text-zinc-600">Прогнозы и аналитика — каждый день</span>
          </div>
        </div>

        <div
          role="note"
          className="flex max-w-md items-start gap-3 rounded-xl border border-zinc-200 bg-zinc-100 p-4"
        >
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
          <p className="text-xs leading-relaxed text-zinc-500">
            <span className="mr-1.5 inline-block rounded border border-rose-500/40 px-1.5 py-0.5 font-bold text-rose-600">
              18+
            </span>
            Информация для лиц 18+. Сайт не принимает ставки и носит информационный характер.
            Играйте ответственно.
          </p>
        </div>

        <div className="flex flex-col items-start gap-3 md:items-end">
          {/* Декоративные соцсетевые глифы (не ссылки — реальных адресов нет) */}
          <div aria-hidden className="flex items-center gap-2.5">
            {SOCIAL_ICONS.map(({ icon: Icon, title }) => (
              <span
                key={title}
                title={title}
                className="grid size-9 cursor-default place-items-center rounded-lg border border-zinc-200 bg-zinc-100 text-zinc-600 transition-colors hover:border-emerald-500/40 hover:text-emerald-600"
              >
                <Icon className="size-4" />
              </span>
            ))}
          </div>
          <p className="text-xs text-zinc-600">© {year} Ставка Дня</p>
        </div>
      </div>
    </footer>
  )
}
