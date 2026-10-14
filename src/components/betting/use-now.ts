'use client'

import { useEffect, useState } from 'react'

/**
 * Живое «сейчас» для клиентских таймеров.
 * null до первого кадра (без рассинхронизации SSR → гидратация).
 */
export function useNow(intervalMs: number): number | null {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setNow(Date.now()))
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(timer)
    }
  }, [intervalMs])

  return now
}
