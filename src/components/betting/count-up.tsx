'use client'

import { useEffect, useRef, useState } from 'react'
import { animate } from 'framer-motion'

/**
 * Плавный счётчик: анимирует число от 0 до value при появлении в зоне видимости.
 * formatter управляет отображением (знак, проценты, юниты).
 *
 * Дополнительно к IntersectionObserver:
 * - страховка 1,5 с: если наблюдатель не сработал (экзотический браузер,
 *   режим печати) — значение показывается сразу, KPI не остаётся нулём;
 * - при обновлении value после первой анимации (опрос каждые 60 с) счётчик
 *   плавно переходит к новому значению, а не зависает на старом.
 */
export function CountUp({
  value,
  duration = 0.9,
  formatter,
  className,
}: {
  value: number
  duration?: number
  formatter?: (v: number) => string
  className?: string
}) {
  const fmt = formatter ?? ((v: number) => Math.round(v).toString())
  const [display, setDisplay] = useState(() => fmt(0))
  const ref = useRef<HTMLSpanElement>(null)
  const controlsRef = useRef<ReturnType<typeof animate> | null>(null)
  const started = useRef(false)
  const current = useRef(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const run = (from: number, to: number, dur: number) => {
      controlsRef.current?.stop()
      current.current = to
      controlsRef.current = animate(from, to, {
        duration: dur,
        ease: 'easeOut',
        onUpdate: (v) => setDisplay(fmt(v)),
      })
    }

    // Значение обновилось после первой анимации — плавный переход, не зависаем
    if (started.current) {
      run(current.current, value, Math.min(duration, 0.6))
      return
    }

    const begin = () => {
      if (started.current) return
      started.current = true
      clearTimeout(fallbackTimer)
      run(0, value, duration)
    }

    // Страховка: наблюдатель не сработал — показываем значение принудительно
    const fallbackTimer = setTimeout(begin, 1500)

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) begin()
      },
      { threshold: 0.3 },
    )
    observer.observe(el)

    return () => {
      clearTimeout(fallbackTimer)
      observer.disconnect()
      controlsRef.current?.stop()
    }
  }, [value, duration])

  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  )
}
