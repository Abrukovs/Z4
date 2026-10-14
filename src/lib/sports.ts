import {
  Goal,
  Volleyball,
  Snowflake,
  Dumbbell,
  type LucideIcon,
} from 'lucide-react'
import type { SportKey } from '@/lib/types'

export interface SportMeta {
  key: SportKey
  label: string // Russian label
  icon: LucideIcon
}

export const SPORTS: Record<SportKey, SportMeta> = {
  football: { key: 'football', label: 'Футбол', icon: Goal },
  tennis: { key: 'tennis', label: 'Теннис', icon: Volleyball },
  hockey: { key: 'hockey', label: 'Хоккей', icon: Snowflake },
  basketball: { key: 'basketball', label: 'Баскетбол', icon: Dumbbell },
}

export const SPORT_LIST: SportMeta[] = [
  SPORTS.football,
  SPORTS.tennis,
  SPORTS.hockey,
  SPORTS.basketball,
]

/** Акцентные цвета видов спорта (графики, иконки, полосы статистики) */
export const SPORT_COLORS: Record<string, string> = {
  football: '#10b981',
  tennis: '#f59e0b',
  hockey: '#14b8a5',
  basketball: '#f97316',
}

export function sportLabel(sport: string): string {
  return SPORTS[sport as SportKey]?.label ?? 'Другое'
}

export function sportIcon(sport: string): LucideIcon {
  return SPORTS[sport as SportKey]?.icon ?? Dumbbell
}
