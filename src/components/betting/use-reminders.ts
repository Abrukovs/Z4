'use client'

/**
 * React-обёртка над локальным хранилищем напоминаний:
 * подписка на изменения через useSyncExternalStore (вкладка + storage между вкладками),
 * проверка состояния и переключение с запросом разрешения браузера.
 */

import { useCallback, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import {
  addReminder,
  loadReminders,
  REMINDERS_EVENT,
  removeReminder,
  requestNotificationPermission,
} from '@/lib/reminders'
import type { BetDto } from '@/lib/types'

/* --- Кэш снапшота id-шников: стабильная ссылка между рендерами --- */
const EMPTY_IDS: ReadonlySet<string> = new Set<string>()
let cachedRaw: string | null = undefined // undefined → ещё не читали
let cachedIds: ReadonlySet<string> = EMPTY_IDS

function readRaw(): string | null {
  try {
    return window.localStorage.getItem('stavka-dnya:reminders')
  } catch {
    return null
  }
}

function getIdsSnapshot(): ReadonlySet<string> {
  const raw = readRaw()
  if (raw !== cachedRaw) {
    cachedRaw = raw
    if (!raw) {
      cachedIds = EMPTY_IDS
    } else {
      try {
        const parsed: unknown = JSON.parse(raw)
        cachedIds = Array.isArray(parsed)
          ? new Set(parsed.map((e) => (e as { id?: string })?.id).filter((id): id is string => typeof id === 'string'))
          : EMPTY_IDS
      } catch {
        cachedIds = EMPTY_IDS
      }
    }
  }
  return cachedIds
}

function getServerSnapshot(): ReadonlySet<string> {
  return EMPTY_IDS
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(REMINDERS_EVENT, callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(REMINDERS_EVENT, callback)
    window.removeEventListener('storage', callback)
  }
}

export function useReminders() {
  const ids = useSyncExternalStore(subscribe, getIdsSnapshot, getServerSnapshot)

  const isSet = useCallback((id: string) => ids.has(id), [ids])

  const toggle = useCallback(async (bet: BetDto): Promise<boolean> => {
    const already = loadReminders().some((r) => r.id === bet.id)
    if (already) {
      removeReminder(bet.id)
      toast.success('Напоминание убрано', {
        description: `${bet.homeTeam} — ${bet.awayTeam}`,
      })
      return false
    }

    addReminder({
      id: bet.id,
      home: bet.homeTeam,
      away: bet.awayTeam,
      league: bet.league,
      matchAt: new Date(bet.matchDate).getTime(),
      selection: bet.selection,
      odds: bet.odds,
    })

    // Разрешение спрашиваем только по клику пользователя
    const perm = await requestNotificationPermission()

    if (perm === 'granted') {
      toast.success('Напомним за 10 минут до старта', {
        description: `${bet.homeTeam} — ${bet.awayTeam} · уведомим в браузере и на сайте`,
      })
    } else if (perm === 'denied') {
      toast.warning('Напоминание включено — только на сайте', {
        description:
          'Браузерные уведомления заблокированы: напоминание появится во вкладке, пока она открыта',
      })
    } else {
      toast.success('Напомним за 10 минут до старта', {
        description: `${bet.homeTeam} — ${bet.awayTeam} · напомним во вкладке сайта`,
      })
    }
    return true
  }, [])

  return { isSet, toggle, count: ids.size }
}
