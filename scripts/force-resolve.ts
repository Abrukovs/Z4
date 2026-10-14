/**
 * Тестовый скрипт «виртуального времени» (Task 3).
 *
 * Сдвигает дату первого ожидающего прогноза на сегодня на час назад,
 * чтобы следующий запрос к /api/bets рассчитал его автоматически
 * (resolveDueBets) и прогноз переехал в историю с результатом.
 *
 * Запуск: bun scripts/force-resolve.ts
 */
import { db } from '../src/lib/db'

async function main() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)

  const bet = await db.bet.findFirst({
    where: {
      status: 'pending',
      isBetOfDay: false,
      matchDate: { gte: start, lt: end },
    },
    orderBy: { matchDate: 'asc' },
  })

  if (!bet) {
    console.log('NO_PENDING_TODAY_BET')
    return
  }

  // Час назад; если это выпадает на прошлые сутки — 10 минут назад (чтобы не путать окна)
  let target = new Date(now.getTime() - 60 * 60 * 1000)
  if (target < start) target = new Date(now.getTime() - 10 * 60 * 1000)

  await db.bet.update({
    where: { id: bet.id },
    data: { matchDate: target },
  })

  console.log(`SHIFTED id=${bet.id} "${bet.homeTeam} vs ${bet.awayTeam}" -> ${target.toISOString()}`)
  console.log('Now curl /api/bets?tab=today to trigger resolution.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => {
    void db.$disconnect()
  })
