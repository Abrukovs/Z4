import type { StarLogic, StarLogicFactor } from '@/lib/types'

/**
 * Клиентский парсер «логики звезды» (Task 37): поле Bet.starLogic приходит
 * из API сырой JSON-строкой (в БД оно лежит в колонке Bet.starLogic).
 * Здесь безопасно валидируем структуру — любой мусор → null, секция
 * просто не рендерится.
 */

const str = (v: unknown, max: number): string =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, max) : ''

const factor = (v: unknown): StarLogicFactor | null => {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const title = str(o.title, 90)
  const detail = str(o.detail, 450)
  if (!title || !detail) return null
  return { title, detail, side: o.side === 'con' ? 'con' : 'pro' }
}

/** Безопасный разбор JSON-логики; невалидное → null */
export function parseStarLogic(raw?: string | null): StarLogic | null {
  if (!raw) return null
  try {
    const o: unknown = JSON.parse(raw)
    if (!o || typeof o !== 'object') return null
    const obj = o as Record<string, unknown>
    const thesis = str(obj.thesis, 400)
    if (!thesis) return null
    const factors = Array.isArray(obj.factors)
      ? obj.factors.map(factor).filter((f): f is StarLogicFactor => f !== null).slice(0, 6)
      : []
    if (factors.length === 0) return null
    return {
      thesis,
      factors,
      scenario: str(obj.scenario, 600),
      risks: str(obj.risks, 600),
      alternative: str(obj.alternative, 600),
      stakeLogic: str(obj.stakeLogic, 600),
    }
  } catch {
    return null
  }
}
