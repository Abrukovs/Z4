/**
 * Локальные напоминания о начале матчей (localStorage, без бэкенда).
 *
 * Хранение: stavka-dnya:reminders → ReminderEntry[]
 * Синхронизация: кастомное событие 'stavka-dnya:reminders-changed' (вкладка)
 * + нативное 'storage' (между вкладками).
 */

export interface ReminderEntry {
  /** id прогноза (Bet.id) */
  id: string
  home: string
  away: string
  league: string
  matchAt: number
  selection: string
  odds: number
  /** Время фактической отправки уведомления (epoch ms) */
  notifiedAt?: number
}

const STORAGE_KEY = 'stavka-dnya:reminders'
export const REMINDERS_EVENT = 'stavka-dnya:reminders-changed'

/** За сколько до старта присылать напоминание */
export const NOTIFY_LEAD_MS = 10 * 60_000
/** После старта напоминание уже не присылаем (не будим спящего) */
export const NOTIFY_LATE_MS = 2 * 60_000
/** Совсем старые записи вычищаем: матч закончился ~3+ часа назад */
const EXPIRE_AFTER_MS = 4 * 60 * 60_000

const isBrowser = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'

export function loadReminders(): ReminderEntry[] {
  if (!isBrowser) return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is ReminderEntry =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as ReminderEntry).id === 'string' &&
        typeof (e as ReminderEntry).matchAt === 'number',
    )
  } catch {
    return []
  }
}

export function saveReminders(list: ReminderEntry[]): void {
  if (!isBrowser) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
    window.dispatchEvent(new CustomEvent(REMINDERS_EVENT))
  } catch {
    // localStorage недоступен (приватный режим) — молча работаем без персиста
  }
}

export function isReminderSet(id: string): boolean {
  return loadReminders().some((r) => r.id === id)
}

export function addReminder(entry: Omit<ReminderEntry, 'notifiedAt'>): void {
  const list = loadReminders().filter((r) => r.id !== entry.id)
  list.push(entry)
  saveReminders(list)
}

export function removeReminder(id: string): void {
  saveReminders(loadReminders().filter((r) => r.id !== id))
}

/** Пометить отправленным (чтобы не дублировать уведомление) */
export function markNotified(id: string, at: number = Date.now()): void {
  saveReminders(loadReminders().map((r) => (r.id === id ? { ...r, notifiedAt: at } : r)))
}

/** Записи, для которых пора отправить напоминание */
export function dueReminders(now: number): ReminderEntry[] {
  return loadReminders().filter(
    (r) =>
      r.notifiedAt === undefined &&
      now >= r.matchAt - NOTIFY_LEAD_MS &&
      now <= r.matchAt + NOTIFY_LATE_MS,
  )
}

/** Вычистить протухшие записи; true — если список изменился */
export function pruneReminders(now: number): boolean {
  const list = loadReminders()
  const alive = list.filter((r) => r.matchAt + EXPIRE_AFTER_MS > now)
  if (alive.length !== list.length) {
    saveReminders(alive)
    return true
  }
  return false
}

/* ------------------------- Разрешение браузера ------------------------- */

export type RemindPermission = 'granted' | 'denied' | 'default' | 'unsupported'

export function notificationPermission(): RemindPermission {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission as RemindPermission
}

/** Запросить разрешение (только по действию пользователя); безопасен без Notification */
export async function requestNotificationPermission(): Promise<RemindPermission> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission as RemindPermission
  try {
    const result = await Notification.requestPermission()
    return result as RemindPermission
  } catch {
    return 'denied'
  }
}
