import { NextResponse } from 'next/server'
import { deleteTelegramWebhook, getDigestSettings } from '@/lib/digest'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/digest/telegram-webhook — снять с бота сторонний вебхук.
 *
 * Если бот был подключён к сторонней платформе (например, конструктору
 * ботов), её вебхук перехватывает входящие сообщения — сайт не может
 * увидеть чаты через getUpdates («Найти чат»). Исходящая отправка
 * (sendMessage) работает и с вебхуком. Действие идемпотентно: если
 * вебхука нет — просто ok. Токен берём из сохранённых настроек.
 */
export async function DELETE() {
  try {
    const token = (await getDigestSettings()).telegramBotToken?.trim()
    if (!token) {
      return NextResponse.json(
        { error: 'Сначала сохраните токен бота в настройках рассылки' },
        { status: 400 },
      )
    }
    const result = await deleteTelegramWebhook(token)
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? 'Telegram не ответил' },
        { status: 502 },
      )
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/digest/telegram-webhook error:', error)
    return NextResponse.json({ error: 'Не удалось отключить вебхук' }, { status: 500 })
  }
}
