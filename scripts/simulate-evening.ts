/**
 * Симуляция «пустого вечера» (Task 8).
 *
 * Воспроизводит жалобу «прогнозов нет, матч дня — херня»:
 * 1) Сдвигает ВСЕ сегодняшние pending-матчи (включая ставку дня) на час назад —
 *    как будто наступил поздний вечер и все матчи завершились.
 * 2) Ждёт 35 c (общий троттл maintenanceTick — 30 c).
 * 3) GET /api/bets?tab=today — старые прогнозы рассчитаны и ушли в историю,
 *    но лента НЕ пустая: ensureUpcomingBets добавил ≥4 НОВЫХ предстоящих.
 * 4) GET /api/bet-of-day — ставка дня продвинута (promoteBetOfDay):
 *    НОВЫЙ pending-матч с живым отсчётом, а не рассчитанный «вчерашний».
 * 5) Восстановление свежего состояния: POST /api/seed.
 *
 * Запуск: bun scripts/simulate-evening.ts
 * KEEP_STATE=1 bun scripts/simulate-evening.ts — не восстанавливать данные
 * (для ручной проверки страницы в браузере; потом POST /api/seed руками).
 */
import { db } from '../src/lib/db'

const BASE = 'http://localhost:3000'

interface ApiBet {
  id: string
  homeTeam: string
  awayTeam: string
  matchDate: string
  status: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)

  const before = (await (
    await fetch(`${BASE}/api/bets?tab=today`)
  ).json()) as { bets: ApiBet[] }
  const bodBefore = (await (await fetch(`${BASE}/api/bet-of-day`)).json()) as { bet: ApiBet | null }
  console.log('=== ДО симуляции ===')
  console.log(
    `today tab: ${before.bets.length} прогнозов; ставка дня: ${bodBefore.bet?.homeTeam} — ${bodBefore.bet?.awayTeam} (${bodBefore.bet?.status})`,
  )

  // 1) Все сегодняшние pending — на час назад («поздний вечер»)
  const pending = await db.bet.findMany({
    where: { status: 'pending', matchDate: { gte: start, lt: end } },
  })
  if (pending.length === 0) {
    console.log('NO_PENDING_TODAY_BETS')
    return
  }
  const oldIds = new Set(pending.map((b) => b.id))
  const target = new Date(now.getTime() - 60 * 60 * 1000)
  for (const b of pending) {
    await db.bet.update({ where: { id: b.id }, data: { matchDate: target } })
  }
  console.log(`\nСдвинуто ${pending.length} pending-матчей на ${target.toISOString()}`)

  // 2) Ждём окончания троттла maintenanceTick (30 c)
  console.log('Ожидание 35 c (троттл обслуживания)...')
  await sleep(35_000)

  // 3) Лента «Сегодня»: старые рассчитаны, появились новые предстоящие
  const today = (await (await fetch(`${BASE}/api/bets?tab=today`)).json()) as { bets: ApiBet[] }
  const upcoming = today.bets.filter((b) => new Date(b.matchDate).getTime() > now.getTime())
  const oldStill = today.bets.filter((b) => oldIds.has(b.id))
  console.log('\n=== ПОСЛЕ симуляции ===')
  console.log(
    `today tab: ${today.bets.length} прогнозов; из них НОВЫХ предстоящих: ${upcoming.length}; старых осталось: ${oldStill.length}`,
  )
  today.bets.forEach((b) =>
    console.log(`  ${b.matchDate}  ${b.homeTeam} — ${b.awayTeam}  [${b.status}]${oldIds.has(b.id) ? ' (СТАРЫЙ)' : ' (новый)'}`),
  )

  // 4) Ставка дня: должна быть НОВАЯ, pending (promoteBetOfDay).
  //    Продвинутая ставка исключается из ленты «Сегодня» (isBetOfDay) —
  //    поэтому считаем её в общем числе новых предстоящих.
  const bod = (await (await fetch(`${BASE}/api/bet-of-day`)).json()) as { bet: ApiBet | null }
  console.log(
    `ставка дня: ${bod.bet?.homeTeam} — ${bod.bet?.awayTeam} | ${bod.bet?.status} | ${bod.bet?.matchDate}`,
  )

  const bodIsNewPending =
    bod.bet?.status === 'pending' && !!bod.bet && !oldIds.has(bod.bet.id)
  const totalNewUpcoming = upcoming.length + (bodIsNewPending ? 1 : 0)
  const passed =
    totalNewUpcoming >= 4 && upcoming.length > 0 && oldStill.length === 0 && bodIsNewPending
  console.log(
    `\nНовых предстоящих всего (лента + продвинутая ставка дня): ${totalNewUpcoming} (лента: ${upcoming.length})`,
  )
  console.log(passed ? '\nSIMULATION PASSED' : '\nSIMULATION FAILED')

  // 5) Восстановление
  if (process.env.KEEP_STATE === '1') {
    console.log('KEEP_STATE=1 — данные НЕ восстановлены (восстановите: curl -X POST /api/seed)')
  } else {
    const res = await fetch(`${BASE}/api/seed`, { method: 'POST' })
    const body = (await res.json()) as { ok?: boolean }
    console.log(`Восстановление POST /api/seed: ${JSON.stringify(body)}`)
  }

  process.exitCode = passed ? 0 : 1
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => {
    void db.$disconnect()
  })
