'use client'

/**
 * Глобальный планировщик напоминаний: монтируется один раз рядом с корнем страницы.
 * Каждые 15 секунд проверяет локальные напоминания и:
 *  - за 10 минут до старта матча шлёт браузерное уведомление + in-app toast;
 *  - вычищает записи матчей, завершившихся несколько часов назад.
 * Работает только в открытой вкладке — честно и без бэкенда.
 */

import { useEffect } from 'react'
import { toast } from 'sonner'
import {
  dueReminders,
  markNotified,
  pruneReminders,
  REMINDERS_EVENT,
  type ReminderEntry,
} from '@/lib/reminders'
import { fmtOdds } from '@/lib/format'

function minutesLeft(matchAt: number, now: number): number {
  return Math.max(0, Math.round((matchAt - now) / 60_000))
}

function fireBrowserNotification(entry: ReminderEntry, mins: number): void {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted') return
  try {
    const n = new Notification(`⚽ ${entry.home} — ${entry.away}`, {
      tag: `stavka-dnya-${entry.id}`,
      icon: '/og-image.png',
      body:
        mins > 0
          ? `Начало через ${mins} мин · Прогноз: ${entry.selection} (кэф ${fmtOdds(entry.odds)})`
          : `Матч уже начался · Прогноз: ${entry.selection} (кэф ${fmtOdds(entry.odds)})`,
    })
    // Клик по уведомлению — фокус на вкладку с прогнозом
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch {
    // Конструктор Notification может кидать (Android WebView) — in-app toast остаётся
  }
}

function fireInAppToast(entry: ReminderEntry, mins: number): void {
  const title =
    mins > 0 ? `${entry.home} — ${entry.away}: начало через ${mins} мин` : `${entry.home} — ${entry.away}: матч начался`
  toast.message('⏰ Напоминание о прогнозе', {
    description: `${title} · ${entry.selection} (кэф ${fmtOdds(entry.odds)})`,
    duration: 15_000,
  })
}

export function ReminderScheduler() {
  useEffect(() => {
    const tick = () => {
      const now = Date.now()
      let changed = pruneReminders(now)
      const due = dueReminders(now)
      for (const entry of due) {
        const mins = minutesLeft(entry.matchAt, now)
        fireBrowserNotification(entry, mins)
        // In-app toast — только когда вкладка видима (иначе дубли при возврате)
        if (!document.hidden) fireInAppToast(entry, mins)
        markNotified(entry.id, now)
        changed = true
      }
      if (changed) window.dispatchEvent(new CustomEvent(REMINDERS_EVENT))
    }

    tick()
    const timer = setInterval(tick, 15_000)
    return () => clearInterval(timer)
  }, [])

  return null
}
