/**
 * Временные завтрашние прогнозы для E2E-проверки UI (Task 11).
 *
 * Вставляет 3 real-прогноза на завтрашние матчи (те же пары, что выберет
 * авто-генератор вечером) — проверить чипы «Завтра», разделитель ленты и
 * панель «Примерная линия и ценность». CLEAN=1 — удалить вставленные.
 *
 * Запуск:  bun scripts/e2e-tomorrow-ui.ts
 *          CLEAN=1 bun scripts/e2e-tomorrow-ui.ts
 */
import { db } from '../src/lib/db'
import { mskTomorrowDateStr } from '../src/lib/real-matches'

const MARKER = 'E2E-TOMORROW-UI'

async function main() {
  if (process.env.CLEAN === '1') {
    const removed = await db.bet.deleteMany({ where: { resultNote: { startsWith: MARKER } } })
    console.log(`[e2e] удалено временных: ${removed.count}`)
    return
  }

  // Убираем возможные остатки прошлого прогона
  await db.bet.deleteMany({ where: { resultNote: { startsWith: MARKER } } })

  const date = mskTomorrowDateStr() // дд-ММ-гггг
  const [dd, mm, yyyy] = date.split('-').map(Number)
  const at = (hh: number, mi: number) =>
    new Date(Date.UTC(yyyy, mm - 1, dd, hh, mi) - 3 * 3600_000) // МСК → UTC

  const tipsters = await db.tipster.findMany({ select: { id: true, sport: true } })
  const pick = (sport: string) => {
    const s = tipsters.filter((t) => t.sport === sport)
    return (s.length > 0 ? s : tipsters)[0].id
  }

  const rows = [
    {
      sport: 'football',
      league: 'Россия. Премьер-лига',
      homeTeam: 'Крылья Советов',
      awayTeam: 'Краснодар',
      matchDate: at(14, 0),
      market: 'Исход матча (1X2)',
      selection: 'П2 — победа гостей',
      odds: 1.72,
      stake: 6,
      confidence: 71,
      analysis:
        'Краснодар по составу и текущей форме заметно сильнее: команда стабильно набирает очки на выезде и создаёт много моментов. Крылья в родных стенах агрессивны, но расточительны в обороне — фаворит должен дожать.',
    },
    {
      sport: 'hockey',
      league: 'Лига чемпионов. Групповой этап',
      homeTeam: 'Таппара',
      awayTeam: 'Кельн',
      matchDate: at(17, 0),
      market: 'Тотал шайб',
      selection: 'ТБ 5.5 — тотал больше 5.5 шайб',
      odds: 1.84,
      stake: 4,
      confidence: 63,
      analysis:
        'Обе команды играют в атакующий хоккей: Таппара дома добавляет в темпе, Кельн не садится в оборону. Очные встречи европейских топ-клубов традиционно результативные — ждём не меньше шести шайб.',
    },
    {
      sport: 'tennis',
      league: 'US Open',
      homeTeam: 'Иржи Легечка (Чехия, 18)',
      awayTeam: 'Стефанос Циципас (Греция)',
      matchDate: at(21, 0),
      market: 'Победа в матче',
      selection: 'П1 — победа Иржи Легечка',
      odds: 1.94,
      stake: 3,
      confidence: 59,
      analysis:
        'Легечка сейчас на пике формы: мощная подача и агрессивный базовый лайн давят соперников. Циципас после серии тяжёлых матчей выглядит не так стабильно, особенно на приёме — шанс молодого чеха реально есть.',
    },
  ]

  for (const r of rows) {
    await db.bet.create({
      data: {
        ...r,
        status: 'pending',
        resultNote: MARKER, // маркер для очистки; после расчёта перезапишется
        isRealMatch: true,
        isBetOfDay: false,
        tipsterId: pick(r.sport),
      },
    })
  }
  console.log(`[e2e] вставлено ${rows.length} завтрашних прогнозов (${date})`)
}

main()
  .catch((e) => {
    console.error('[e2e] ошибка:', e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect?.())
