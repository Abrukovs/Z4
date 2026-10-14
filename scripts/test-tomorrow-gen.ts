/**
 * Dry-run проверки «прогнозов на завтра» (Task 11).
 *
 * НЕ пишет в БД. Показывает, какие матчи были бы выбраны генератором
 * из завтрашнего расписания при исчерпании сегодняшнего пула:
 * 1) Грузит завтрашнее расписание (тот же парсер, что и на сайте).
 * 2) Читает существующие real-прогнозы (исключение дублей пар).
 * 3) selectMatches() — тот же отбор, что использует generateRealBets.
 *
 * SIM=1 — полная симуляция с созданием завтрашних прогнозов через
 * forceGenerateRealBets (после временного сокрытия сегодняшних pending),
 * проверкой API/UI и полным восстановлением состояния.
 *
 * Запуск: bun scripts/test-tomorrow-gen.ts
 */
import { db } from '../src/lib/db'
import { getRealMatches, mskTomorrowDateStr, mskDateStr } from '../src/lib/real-matches'
import { selectMatches } from '../src/lib/real-bets'

const BASE = 'http://localhost:3000'

function startOfLocalDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

async function main() {
  const tomorrow = mskTomorrowDateStr()
  const today = mskDateStr()
  console.log(`[dry-run] сегодня ${today}, завтра ${tomorrow}`)

  const data = await getRealMatches(false, tomorrow)
  const counts = Object.entries(data.sports).map(([k, v]) => `${k}:${(v as unknown[]).length}`)
  console.log(`[dry-run] завтрашнее расписание: ${counts.join(', ')}`)

  const start = startOfLocalDay()
  const existing = await db.bet.findMany({
    where: { isRealMatch: true, matchDate: { gte: start } },
    select: { homeTeam: true, awayTeam: true, status: true },
  })
  const used = new Set(existing.map((b) => `${b.homeTeam}|${b.awayTeam}`))
  const pendingReal = existing.filter((b) => b.status === 'pending').length
  console.log(`[dry-run] pending сегодня: ${pendingReal}, занятых пар: ${used.size}`)

  const selected = selectMatches(data, Date.now(), used)
  console.log(`[dry-run] выбрано бы матчей: ${selected.length}`)
  for (const sm of selected) {
    console.log(
      `  · ${sm.sport} | ${sm.m.league} | ${sm.m.time} МСК | ${sm.m.home} — ${sm.m.away}`,
    )
  }

  if (process.env.SIM !== '1') {
    console.log('[dry-run] готово (SIM=1 для полной симуляции)')
    return
  }

  /* ---------------- Полная симуляция «тонкой ленты» ---------------- */
  console.log('\n[sim] полная симуляция: временно скрываем сегодняшние pending')

  const todayPending = await db.bet.findMany({
    where: { isRealMatch: true, status: 'pending', matchDate: { gte: start, lt: new Date(start.getTime() + 24 * 3600_000) } },
    select: { id: true },
  })
  // Прячем в void с QA-маркером (restore вернёт статус)
  for (const b of todayPending) {
    await db.bet.update({
      where: { id: b.id },
      data: { status: 'void', resultNote: 'QA-SIM-TMP' },
    })
  }
  console.log(`[sim] скрыто сегодняшних pending: ${todayPending.length}`)

  try {
    const res = await fetch(`${BASE}/api/real-bets/seed`, { method: 'POST' })
    const body = (await res.json()) as { ok?: boolean; added?: number }
    console.log(`[sim] force-генерация: ok=${body.ok}, добавлено=${body.added}`)

    const feed = await fetch(`${BASE}/api/bets?tab=today`)
    const feedBody = (await feed.json()) as { bets: Array<{ homeTeam: string; awayTeam: string; matchDate: string }> }
    const tomorrowBets = feedBody.bets.filter(
      (b) => new Date(b.matchDate).toDateString() !== new Date().toDateString(),
    )
    console.log(`[sim] лента: всего ${feedBody.bets.length}, завтрашних ${tomorrowBets.length}`)
    for (const b of tomorrowBets.slice(0, 10)) {
      console.log(`  · [завтра] ${b.homeTeam} — ${b.awayTeam} @ ${b.matchDate}`)
    }

    const bod = await fetch(`${BASE}/api/bet-of-day`)
    const bodBody = (await bod.json()) as { bet: { homeTeam: string; awayTeam: string; matchDate: string; status: string } | null }
    if (bodBody.bet) {
      console.log(
        `[sim] ставка дня: ${bodBody.bet.homeTeam} — ${bodBody.bet.awayTeam} (${bodBody.bet.status}) @ ${bodBody.bet.matchDate}`,
      )
    }

    // Чистим созданные завтрашние прогнозы (QA-артефакт) — вечером их создаст авто-тик
    const created = await db.bet.findMany({
      where: { isRealMatch: true, matchDate: { gte: new Date(start.getTime() + 24 * 3600_000) } },
      select: { id: true },
    })
    if (created.length > 0) {
      await db.bet.deleteMany({ where: { id: { in: created.map((c) => c.id) } } })
      console.log(`[sim] удалено QA-созданных завтрашних прогнозов: ${created.length}`)
    }
  } finally {
    // Восстанавливаем статусы сегодняшних прогнозов
    for (const b of todayPending) {
      await db.bet.update({
        where: { id: b.id },
        data: { status: 'pending', resultNote: null },
      })
    }
    console.log(`[sim] восстановлено сегодняшних pending: ${todayPending.length}`)

    // Ставку дня возвращаем лучшему сегодняшнему
    const res2 = await fetch(`${BASE}/api/real-bets/seed`, { method: 'POST' })
    void res2
    const pendingCount = await db.bet.count({ where: { isRealMatch: true, status: 'pending' } })
    console.log(`[sim] итоговое состояние: pending real = ${pendingCount}`)
  }
}

main()
  .catch((e) => {
    console.error('[sim] ошибка:', e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect?.())
