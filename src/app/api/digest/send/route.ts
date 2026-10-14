import { NextResponse } from 'next/server'
import { sendDailyDigest } from '@/lib/digest'

export const dynamic = 'force-dynamic'

/**
 * POST /api/digest/send — отправить ЕДИНОЕ утреннее сообщение в Telegram
 * (Task 50: итог вчерашнего дня + полный разбор зашедших — «Ставка дня»,
 * исходы «Экспресса дня», прогноз эксперта). Вечернего сообщения больше
 * нет — по просьбе владельца «разбор нужен только 1 — утром».
 *  { auto: true }  — вызов расписанием/страницей: шлёт только после часа
 *                    отправки (sendHour по МСК) и если за этот день ещё
 *                    не отправлено;
 *  { auto: false } — вручную (кнопка «Отправить сейчас»): без проверок.
 * kind в теле игнорируется (раньше поддерживал 'results' — канал удалён).
 * Ответ всегда 200 (кроме сбоев сервера) — «мягкие» причины в поле reason.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      auto?: boolean
      kind?: string
    }
    const outcome = await sendDailyDigest(body.auto === true)
    return NextResponse.json({ ...outcome, kind: 'morning' })
  } catch (error) {
    console.error('POST /api/digest/send error:', error)
    return NextResponse.json(
      { sent: false, reason: 'error', error: 'Сбой сервера при отправке' },
      { status: 500 },
    )
  }
}
