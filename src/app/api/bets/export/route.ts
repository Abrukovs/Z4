import { NextRequest, NextResponse } from 'next/server'
import { logErrorBg } from '@/lib/error-log'
import { buildBetsCsv, getArchiveStats } from '@/lib/bet-history'

export const dynamic = 'force-dynamic'

/**
 * Выгрузка всей истории прогнозов (просьба владельца 23.10:
 * «если память заполнена, скажите — я хотя бы скачаю»).
 *
 * GET /api/bets/export          → CSV-файл (Excel-совместимо: ; и BOM)
 * GET /api/bets/export?meta=1   → JSON: сколько записей в вечном архиве
 */
export async function GET(request: NextRequest) {
  try {
    // Метаданные для карточки на вкладке «Статистика»
    if (request.nextUrl.searchParams.get('meta')) {
      const stats = await getArchiveStats()
      return NextResponse.json(stats)
    }

    const csv = await buildBetsCsv()
    const date = new Date().toISOString().slice(0, 10)
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="bet-history-${date}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('GET /api/bets/export error:', error)
    logErrorBg('api', 'Не удалось выгрузить историю прогнозов в CSV', error)
    return NextResponse.json({ error: 'Не удалось выгрузить историю' }, { status: 500 })
  }
}
