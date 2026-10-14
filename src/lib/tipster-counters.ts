import { db } from '@/lib/db'

/**
 * Пересчитывает счётчики побед/поражений аналитиков из фактических ставок.
 * Учитываются ТОЛЬКО прогнозы на реальные матчи (isRealMatch: true) —
 * виртуальные/демо-пики из статистики аналитиков исключены (Task 21).
 */
export async function recomputeTipsterCounters(): Promise<void> {
  const tipsters = await db.tipster.findMany({ select: { id: true } })
  for (const t of tipsters) {
    const wins = await db.bet.count({
      where: { tipsterId: t.id, status: 'won', isRealMatch: true },
    })
    const losses = await db.bet.count({
      where: { tipsterId: t.id, status: 'lost', isRealMatch: true },
    })
    await db.tipster.update({ where: { id: t.id }, data: { wins, losses } })
  }
}
