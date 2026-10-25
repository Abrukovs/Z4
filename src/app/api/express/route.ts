import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logErrorBg } from '@/lib/error-log'
import { mskStartOfDay } from '@/lib/format'
import { ensureFreshData, maintenanceTick } from '@/lib/seed'
import { collectLiveInfo } from '@/lib/real-bets'
import { computeExpressDays, finishedExpressDays } from '@/lib/express-history'

export const dynamic = 'force-dynamic'

const round2 = (v: number) => Math.round(v * 100) / 100

// Московские сутки (баг 25.10): было UTC-полночь — матчи 00:00–03:00 МСК
// прилипали к прошлому дню. Подробности — в mskStartOfDay (@/lib/format).
function startOfDay(d: Date): Date {
  return mskStartOfDay(d)
}

/**
 * «Экспресс дня» — виртуальная комбинация топ-пиков ленты.
 *
 * Вычисляется на лету из ЕЩЁ НЕ начавшихся real-прогнозов ленты «Сегодня»:
 *  - приоритет сегодняшним матчам (по убыванию уверенности), довыполнение из завтрашних;
 *  - общий коэффициент = произведение примерных кэфов (≈ честная пометка);
 *  - по мере расчёта матчей ноги выбывают — экспресс пересобирается сам.
 * В БД ничего не пишется: это иллюстрация комбинации, а не отслеживаемая ставка.
 *
 * Дополнительно возвращает history — прошедшие (рассчитанные) дни экспресса
 * с ногами и их исходами: видно, какие события зашли / не зашли в каждом
 * проигравшем экспрессе (единая логика с /api/stats).
 */
export async function GET() {
  try {
    await ensureFreshData()
    await maintenanceTick()

    const now = new Date()
    const start = startOfDay(now)
    const endOfToday = new Date(start.getTime() + 24 * 60 * 60 * 1000)
    const end = new Date(start.getTime() + 48 * 60 * 60 * 1000)

    // Кандидаты: pending real-прогнозы ленты (без ставки дня — она и так в hero)
    const candidates = await db.bet.findMany({
      where: {
        isRealMatch: true,
        status: 'pending',
        isBetOfDay: false,
        matchDate: { gte: start, lt: end },
      },
      include: { tipster: true },
      // Тай-брейк при равной уверенности — более ранний матч (единый
      // порядок ног с ретроспективой computeExpressDays и дайджестом)
      orderBy: [{ confidence: 'desc' }, { matchDate: 'asc' }],
    })

    // Ноги — pending real-прогнозы окна 48ч:
    // начавшиеся матчи ОСТАЮТСЯ в экспрессе (на ноге показывается live-фаза),
    // рассчитанные выбывают сами — их status уже не pending.
    // Раньше фильтр «старт позже, чем через 5 минут» прятал всю карточку,
    // как только матчи начинались (экспресс исчезал на время игр).
    const today = candidates.filter((b) => b.matchDate < endOfToday)
    const tomorrow = candidates.filter((b) => b.matchDate >= endOfToday)

    // Сначала лучшие по уверенности из «сегодня», затем довыбор из «завтра»
    const legs = [...today, ...tomorrow].slice(0, 3)

    // Прошедшие дни экспресса (без «в игре») — новее сверху, последние 6 дней.
    // Важно: считаются по той же формуле, что и живая карточка (топ-3 пика дня
    // по уверенности без ставки дня) — ретроспектива совпадает с тем, что
    // показывалось в эти дни.
    const allBets = await db.bet.findMany({
      where: { isRealMatch: true },
      include: { tipster: true },
      orderBy: [{ matchDate: 'desc' }, { createdAt: 'desc' }],
    })
    const history = finishedExpressDays(computeExpressDays(allBets).days, 6)

    if (legs.length < 2) {
      // Текущей комбинации нет (например, ночью) — но прошедшие экспрессы
      // остаются в карточке: история не должна исчезать вместе с ногами.
      return NextResponse.json({ express: null, history })
    }

    const totalOdds = round2(legs.reduce((p, b) => p * b.odds, 1))
    const avgConfidence = Math.round(legs.reduce((s, b) => s + b.confidence, 0) / legs.length)
    const stakeUnits = 10
    const payoutUnits = round2(stakeUnits * totalOdds)

    // Матч мог начаться между запросами — покажем live-фазу на ноге
    const liveMap = collectLiveInfo(legs)

    return NextResponse.json({
      express: {
        legs: legs.map((b) => ({
          id: b.id,
          sport: b.sport,
          league: b.league,
          homeTeam: b.homeTeam,
          awayTeam: b.awayTeam,
          matchDate: b.matchDate.toISOString(),
          selection: b.selection,
          odds: b.odds,
          confidence: b.confidence,
          liveInfo: liveMap[b.id] ?? null,
        })),
        totalOdds,
        avgConfidence,
        stakeUnits,
        payoutUnits,
      },
      history,
    })
  } catch (error) {
    console.error('GET /api/express error:', error)
    logErrorBg('api', 'Не удалось собрать «Экспресс дня»', error)
    return NextResponse.json({ error: 'Не удалось собрать экспресс дня' }, { status: 500 })
  }
}
