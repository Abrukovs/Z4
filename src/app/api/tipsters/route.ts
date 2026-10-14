import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureFreshData, maintenanceTick } from '@/lib/seed'
import { collectLiveInfo } from '@/lib/real-bets'

export const dynamic = 'force-dynamic'

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** Минимальные поля ставки, нужные для подсчёта статистики аналитика */
interface TipsterWithBets {
  id: string
  name: string
  role: string
  sport: string | null
  avatarUrl: string | null
  bets: { status: string; odds: number; stake: number; matchDate: Date }[]
}

/** Статистика считается из фактических ставок (счётчикам модели не доверяем) */
function computeStats(t: TipsterWithBets) {
  const total = t.bets.length
  const won = t.bets.filter((b) => b.status === 'won').length
  const lost = t.bets.filter((b) => b.status === 'lost').length
  const voided = t.bets.filter((b) => b.status === 'void').length
  const pending = t.bets.filter((b) => b.status === 'pending').length
  const decided = t.bets.filter((b) => b.status === 'won' || b.status === 'lost')
  const profit = round2(
    decided.reduce((acc, b) => {
      if (b.status === 'won') return acc + b.stake * (b.odds - 1)
      return acc - b.stake
    }, 0),
  )
  const avgOdds =
    decided.length > 0
      ? round2(decided.reduce((acc, b) => acc + b.odds, 0) / decided.length)
      : 0
  const lastResults = t.bets
    .filter((b) => b.status !== 'pending')
    .slice(0, 15)
    .map((b) => b.status as 'won' | 'lost' | 'void')

  return {
    id: t.id,
    name: t.name,
    role: t.role,
    sport: t.sport,
    avatarUrl: t.avatarUrl,
    wins: won,
    losses: lost,
    totalBets: total,
    won,
    lost,
    voided,
    winrate: decided.length > 0 ? round2((won / decided.length) * 100) : 0,
    profit,
    avgOdds,
    pending,
    lastResults,
  }
}

export async function GET(request: NextRequest) {
  try {
    await ensureFreshData()
    await maintenanceTick()

    const id = request.nextUrl.searchParams.get('id')

    // Профиль одного аналитика: статистика + последние 30 прогнозов (рассчитанные и активные)
    if (id) {
      const tipster = await db.tipster.findUnique({
        where: { id },
        include: {
          bets: {
            where: { isRealMatch: true },
            orderBy: { matchDate: 'desc' },
            select: { status: true, odds: true, stake: true, matchDate: true },
          },
        },
      })
      if (!tipster) {
        return NextResponse.json({ error: 'Аналитик не найден' }, { status: 404 })
      }
      const bets = await db.bet.findMany({
        where: { tipsterId: id, isRealMatch: true },
        orderBy: [{ matchDate: 'desc' }, { createdAt: 'desc' }],
        take: 30,
        include: { tipster: true },
      })
      return NextResponse.json({ tipster: computeStats(tipster), bets })
    }

    const tipsters = await db.tipster.findMany({
      include: {
        bets: {
          where: { isRealMatch: true },
          orderBy: { matchDate: 'desc' },
          select: { status: true, odds: true, stake: true, matchDate: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    // Активный прогноз каждого эксперта: ближайший pending real-пик.
    // Ставку дня исключаем — она уже подсвечена в hero. Начавшийся матч
    // (до 3 часов назад) остаётся «активным»: у него есть live-фаза.
    const activeBets = await db.bet.findMany({
      where: {
        status: 'pending',
        isRealMatch: true,
        isBetOfDay: false,
        matchDate: { gte: new Date(Date.now() - 3 * 60 * 60 * 1000) },
      },
      orderBy: { matchDate: 'asc' },
    })
    const liveMap = collectLiveInfo(activeBets)
    const activeByTipster = new Map<string, (typeof activeBets)[number]>()
    for (const b of activeBets) {
      if (b.tipsterId && !activeByTipster.has(b.tipsterId)) activeByTipster.set(b.tipsterId, b)
    }

    const result = tipsters.map((t) => {
      const stats = computeStats(t)
      const b = activeByTipster.get(t.id)
      return {
        ...stats,
        activeBet: b
          ? {
              id: b.id,
              sport: b.sport,
              league: b.league,
              homeTeam: b.homeTeam,
              awayTeam: b.awayTeam,
              matchDate: b.matchDate,
              market: b.market,
              selection: b.selection,
              odds: b.odds,
              stake: b.stake,
              confidence: b.confidence,
              analysis: b.analysis,
              status: b.status,
              resultNote: b.resultNote,
              isRealMatch: b.isRealMatch,
              starLogic: b.starLogic ?? null,
              liveInfo: liveMap[b.id] ?? null,
              isBetOfDay: b.isBetOfDay,
              tipsterId: b.tipsterId,
              tipster: {
                id: t.id,
                name: t.name,
                role: t.role,
                sport: t.sport,
                avatarUrl: t.avatarUrl,
                wins: t.wins,
                losses: t.losses,
              },
            }
          : null,
      }
    })
    result.sort((a, b) => b.profit - a.profit)
    return NextResponse.json({ tipsters: result })
  } catch (error) {
    console.error('GET /api/tipsters error:', error)
    return NextResponse.json({ error: 'Не удалось загрузить аналитиков' }, { status: 500 })
  }
}
