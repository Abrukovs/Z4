import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureFreshData, maintenanceTick } from '@/lib/seed'
import { collectLiveInfo } from '@/lib/real-bets'
import { isSportKey } from '@/lib/types'

export const dynamic = 'force-dynamic'

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Позитивное целое из query-параметра (1+) с fallback */
function parsePositiveInt(value: string | null, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10)
  return Number.isFinite(n) && n >= 1 ? n : fallback
}

export async function GET(request: NextRequest) {
  try {
    await ensureFreshData()
    await maintenanceTick()

    const params = request.nextUrl.searchParams
    const tab = params.get('tab') === 'history' ? 'history' : 'today'
    const sport = params.get('sport')
    const status = params.get('status')

    // Источник прогнозов один — РЕАЛЬНЫЕ матчи из живого расписания.
    // Демо/виртуальные пики полностью удалены из системы (Task 21).
    const where: Record<string, unknown> = { isRealMatch: true }
    if (sport && isSportKey(sport)) where.sport = sport

    if (tab === 'today') {
      const start = startOfDay(new Date())
      // Только ожидающие прогнозы (рассчитанные переезжают в историю)
      where.isBetOfDay = false
      where.status = 'pending'
      where.matchDate = { gte: start }
      const bets = await db.bet.findMany({
        where,
        orderBy: { matchDate: 'asc' },
        include: { tipster: true },
      })
      // Начавшиеся матчи: живая фаза + текущий счёт из расписания
      const liveMap = collectLiveInfo(bets)
      return NextResponse.json({
        bets: bets.map((b) => ({ ...b, liveInfo: liveMap[b.id] ?? null })),
        realMode: true,
      })
    }

    // История: серверная пагинация (page 1-based, pageSize 12 по умолчанию, максимум 50)
    where.status = status && ['won', 'lost', 'void'].includes(status) ? status : { not: 'pending' }
    // Фильтр по аналитику: валидируем существование, чтобы не вернуть пустоту по опечатке
    const tipsterId = params.get('tipster')
    if (tipsterId) {
      const exists = await db.tipster.findUnique({ where: { id: tipsterId }, select: { id: true } })
      if (exists) where.tipsterId = tipsterId
    }

    const pageSize = Math.min(50, parsePositiveInt(params.get('pageSize'), 12))
    const total = await db.bet.count({ where })
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0
    // Данные смещаются между опросами (рассчитанные матчи переезжают в историю) —
    // зажимаем страницу в допустимом диапазоне
    const page = Math.min(parsePositiveInt(params.get('page'), 1), Math.max(totalPages, 1))

    const bets = await db.bet.findMany({
      where,
      orderBy: [{ matchDate: 'desc' }, { createdAt: 'desc' }],
      include: { tipster: true },
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
    return NextResponse.json({ bets, total, page, pageSize, totalPages })
  } catch (error) {
    console.error('GET /api/bets error:', error)
    return NextResponse.json({ error: 'Не удалось загрузить прогнозы' }, { status: 500 })
  }
}
