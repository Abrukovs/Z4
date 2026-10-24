import { NextResponse } from 'next/server'
import { logErrorBg } from '@/lib/error-log'
import { retroSettleRestoredVoids } from '@/lib/real-bets'

export const dynamic = 'force-dynamic'

/**
 * Ретро-расчёт «возвратов» по реальным счётам (просьба владельца 24.10:
 * «многовато возвратов у экспертов — рассчитайте, пожалуйста»).
 *
 * Ночной сброс сервера обрывал авто-расчёт, и восстановленные из вечного
 * архива прогнозы становились честными возвратами. Здесь мы возвращаемся
 * к ним и досчитываем: страница расписания за ту дату → запасной веб-поиск.
 * Трогаются ТОЛЬКО возвраты с пометкой «Восстановлено из вечного архива».
 */
export async function POST() {
  try {
    const result = await retroSettleRestoredVoids(true)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('POST /api/bets/retro-settle error:', error)
    logErrorBg('api', 'Не удалось рассчитать возвраты по реальным счётам', error)
    return NextResponse.json({ ok: false, error: 'Ошибка ретро-расчёта возвратов' }, { status: 500 })
  }
}
