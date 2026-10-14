import { NextResponse } from 'next/server'
import { getRealMatches, getRealMatchesStaleOrDisk, resolveDayParam } from '@/lib/real-matches'

export const dynamic = 'force-dynamic'

/**
 * GET /api/real-matches — реальное расписание матчей
 * (по данным матч-центра «Спорт-Экспресс», время МСК).
 * ?date=tomorrow — расписание на завтра (по умолчанию — сегодня).
 * ?force=1 — обойти серверный кэш (ручное обновление в интерфейсе).
 *
 * Stale-while-revalidate + дисковый кэш: протухший или дисковый снимок
 * отдаётся МГНОВЕННО, обновление идёт в фоне — расписание никогда не
 * «пустеет» на ~12 секунд парсинга и не сбрасывается при перезапуске
 * сервера. Блокируем запрос только при полностью холодном кэше (самый
 * первый визит) и при ручном force=1.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const force = params.get('force') === '1'
  const date = resolveDayParam(params.get('date'))
  try {
    if (!force) {
      const stale = await getRealMatchesStaleOrDisk(date)
      if (stale) {
        return NextResponse.json({ ok: true, ...stale })
      }
    }
    const data = await getRealMatches(force, date)
    return NextResponse.json({ ok: true, ...data })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Не удалось загрузить расписание'
    return NextResponse.json({ ok: false, error: message }, { status: 502 })
  }
}
