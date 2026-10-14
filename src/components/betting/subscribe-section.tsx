'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, CheckCircle2, Loader2, Mail, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SectionHeader } from '@/components/betting/section-header'
import type { SubscribeResponse } from '@/lib/types'

/** Ключ localStorage: факт подписки сохраняется между визитами */
const LS_KEY = 'stavka-dnya:subscribed'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const PERKS = [
  'Ставка дня каждое утро',
  'Уведомление о расчёте прогноза',
  'Итоги недели со статистикой',
]

export function SubscribeSection() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [subscribed, setSubscribed] = useState(false)

  // Восстановление состояния подписки при повторном визите
  useEffect(() => {
    try {
      if (localStorage.getItem(LS_KEY) === '1') setSubscribed(true)
    } catch {
      // localStorage недоступен — просто показываем форму
    }
  }, [])

  const markSubscribed = () => {
    setSubscribed(true)
    try {
      localStorage.setItem(LS_KEY, '1')
    } catch {
      // игнорируем недоступность localStorage
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = email.trim()
    if (!EMAIL_RE.test(value)) {
      toast.error('Введите корректный e-mail')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value }),
      })
      const data = (await res.json().catch(() => null)) as SubscribeResponse | null
      if (res.ok && data?.ok) {
        markSubscribed()
        toast.success('Подписка оформлена')
      } else if (data && data.ok === false && 'reason' in data && data.reason === 'duplicate') {
        markSubscribed()
        toast.warning('Этот e-mail уже подписан')
      } else {
        toast.error(
          data && data.ok === false && 'error' in data
            ? data.error
            : 'Не удалось оформить подписку',
        )
      }
    } catch {
      toast.error('Не удалось оформить подписку')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section
      id="subscribe"
      aria-labelledby="subscribe-title"
      className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-8 pb-14"
    >
      <SectionHeader
        eyebrow="Рассылка"
        title="Прогнозы — прямо в почту"
        subtext="Лучшие прогнозы дня, ставка дня и итоги недели — бесплатно и без спама"
        titleId="subscribe-title"
      />

      {/* Градиентная рамка + мягкое изумрудное свечение */}
      <div className="animate-fade-up rounded-[20px] bg-gradient-to-br from-emerald-500/60 via-zinc-200 to-zinc-200 p-[1.5px] shadow-[0_24px_70px_-36px_rgba(16,185,129,0.45)]">
        <div className="relative overflow-hidden rounded-[19px] bg-white">
          {/* Деликатное свечение фона */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_85%_20%,rgba(16,185,129,0.12),transparent_70%)]"
          />
          <div className="relative grid grid-cols-1 gap-8 p-6 md:grid-cols-2 md:p-8">
            {/* Левая колонка: преимущества */}
            <div className="flex flex-col justify-center gap-5">
              <span className="inline-flex size-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600">
                <Mail className="size-5" aria-hidden />
              </span>
              <ul className="flex flex-col gap-3">
                {PERKS.map((perk) => (
                  <li key={perk} className="flex items-center gap-2.5 text-sm text-zinc-700">
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-600">
                      <Check className="size-3" aria-hidden />
                    </span>
                    {perk}
                  </li>
                ))}
              </ul>
              <p className="text-xs leading-relaxed text-zinc-600">
                Письма приходят не чаще одного раза в день. Отписка — в один клик из любого письма.
              </p>
            </div>

            {/* Правая колонка: форма или подтверждение */}
            <div className="flex items-center">
              {subscribed ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3 }}
                  role="status"
                  className="flex w-full flex-col items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-6 py-10 text-center"
                >
                  <span className="grid size-14 place-items-center rounded-full bg-emerald-500/20 text-emerald-600">
                    <CheckCircle2 className="size-8" aria-hidden />
                  </span>
                  <p className="text-lg font-extrabold text-zinc-900">Вы подписаны!</p>
                  <p className="text-sm text-zinc-500">
                    Первое письмо придёт уже завтра утром
                  </p>
                </motion.div>
              ) : (
                <form onSubmit={handleSubmit} noValidate className="flex w-full flex-col gap-3">
                  <label htmlFor="subscribe-email" className="text-sm font-semibold text-zinc-700">
                    Ваш e-mail
                  </label>
                  <Input
                    id="subscribe-email"
                    type="email"
                    name="email"
                    autoComplete="email"
                    inputMode="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="например, ivan@mail.ru"
                    disabled={submitting}
                    aria-describedby="subscribe-privacy"
                    className="h-12 border-zinc-300 bg-zinc-100 text-zinc-900 placeholder:text-zinc-600 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/30"
                  />
                  <Button
                    type="submit"
                    size="lg"
                    disabled={submitting}
                    className="h-12 w-full bg-emerald-500 text-sm font-bold text-zinc-950 shadow-[0_10px_30px_-12px_rgba(16,185,129,0.55)] transition-all hover:bg-emerald-400 active:scale-[0.98] disabled:opacity-70"
                  >
                    {submitting ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Send className="size-4" aria-hidden />
                    )}
                    {submitting ? 'Оформляем...' : 'Подписаться'}
                  </Button>
                  <p id="subscribe-privacy" className="text-xs leading-relaxed text-zinc-600">
                    Нажимая «Подписаться», вы соглашаетесь получать письма. Отписаться можно в любой
                    момент.
                  </p>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
