'use client'

import { useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Порог показа кнопки (глубина скролла) */
const SHOW_AFTER_PX = 1400

/**
 * Плавающая кнопка «Наверх»: появляется после ~1.5 экранов скролла.
 * Уважает prefers-reduced-motion (без smooth-скролла), не перекрывает
 * контент на мобильных (safe-area), прячется при открытом диалоге.
 */
export function ScrollToTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        setVisible(window.scrollY > SHOW_AFTER_PX)
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

  const scrollToTop = () => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
  }

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="Наверх — к началу страницы"
      title="Наверх"
      className={cn(
        'fixed right-4 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-40 grid size-11 place-items-center rounded-full border border-emerald-500/40 bg-white/90 text-emerald-600 shadow-[0_8px_24px_-8px_rgba(16,185,129,0.5)] backdrop-blur-md transition-all duration-300',
        'hover:border-emerald-400 hover:bg-zinc-100 hover:text-emerald-700 active:scale-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500',
        visible
          ? 'pointer-events-auto translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-4 opacity-0',
      )}
      tabIndex={visible ? 0 : -1}
    >
      <ArrowUp className="size-5" aria-hidden />
    </button>
  )
}
