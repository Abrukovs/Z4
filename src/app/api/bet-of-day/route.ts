import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureFreshData, maintenanceTick } from '@/lib/seed'
import { collectLiveInfo, rotateBetOfDay } from '@/lib/real-bets'
import { refreshMarketIntel } from '@/lib/odds-intel'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await ensureFreshData()
    await maintenanceTick()

    // Ротация с правилом редакции: активная «Ставка дня» обязана проходить
    // порог кэфа ≥ 1.50 (наш и рыночный) — низкий кэф или потерянный флаг
    // немедленно продвигаются лучшей подходящей заменой (экспорт из real-bets)
    await rotateBetOfDay()

    // Фон: линия рынка (web-search) — не ждём, придёт следующим 60с-поллингом
    refreshMarketIntel()

    const start = new Date()
    start.setHours(0, 0, 0, 0)
    // Окно 48ч: днём — сегодняшняя ставка дня, вечером/ночью — завтрашняя
    // (promoteBestRealBet продвигает завтрашний матч, когда сегодняшние исчерпаны)
    const end = new Date(start.getTime() + 48 * 60 * 60 * 1000)

    // Активная РЕАЛЬНАЯ ставка дня: матч из живого расписания.
    //    Демо-пики (придуманные матчи) здесь не допускаются принципиально —
    //    «главной ставкой» может быть только существующий матч.
    //    (Ротация с проверкой кэфа ≥ 1.50 выполнена выше — low-odds сюда
    //    уже не попадут, если в окне есть хоть одна подходящая замена.)
    let bet = await db.bet.findFirst({
      where: {
        isBetOfDay: true,
        status: 'pending',
        isRealMatch: true,
        matchDate: { gte: start, lt: end },
      },
      include: { tipster: true },
      orderBy: { matchDate: 'asc' },
    })

    // Самый конец дня: последняя рассчитанная реальная ставка дня — hero
    // показывает итог матча
    if (!bet) {
      bet = await db.bet.findFirst({
        where: { isBetOfDay: true, isRealMatch: true, status: { not: 'pending' } },
        include: { tipster: true },
        orderBy: { matchDate: 'desc' },
      })
    }

    // Ставка дня на начавшемся матче: живая фаза + текущий счёт
    const liveInfo = bet ? collectLiveInfo([bet])[bet.id] ?? null : null
    return NextResponse.json({ bet: bet ? { ...bet, liveInfo } : null })
  } catch (error) {
    console.error('GET /api/bet-of-day error:', error)
    return NextResponse.json({ error: 'Не удалось загрузить ставку дня' }, { status: 500 })
  }
}
