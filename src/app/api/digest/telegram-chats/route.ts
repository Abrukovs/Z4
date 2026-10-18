import { NextResponse } from 'next/server'
import { logErrorBg } from '@/lib/error-log'
import { getDigestSettings, listTelegramChats } from '@/lib/digest'

export const dynamic = 'force-dynamic'

/**
 * POST /api/digest/telegram-chats — «Найти чат»: по токену бота возвращает
 * чаты, которые писали боту (getUpdates). Пользователь отправляет боту
 * любое сообщение (или добавляет бота в группу) → чат появляется в списке.
 * Токен пустой → используется сохранённый в настройках (после «Сохранить»).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { token?: string } | null
    const provided = body?.token?.trim() ?? ''
    const token = provided || (await getDigestSettings()).telegramBotToken?.trim() || ''
    if (!token) {
      return NextResponse.json(
        { error: 'Сначала введите токен бота из @BotFather' },
        { status: 400 },
      )
    }
    const result = await listTelegramChats(token)
    if (!result.ok) {
      // 409 + code «webhook-active»: сторонний сервис перехватывает
      // сообщения бота — UI предложит отключить вебхук одной кнопкой
      return NextResponse.json(
        { error: result.error ?? 'Telegram не ответил', code: result.code },
        { status: result.code === 'webhook-active' ? 409 : 502 },
      )
    }
    const chats = result.chats ?? []
    if (chats.length === 0) {
      return NextResponse.json({
        chats: [],
        hint: 'Бот ещё не получал сообщений: напишите ему что-нибудь в Telegram (например, /start) и попробуйте снова',
      })
    }
    return NextResponse.json({ chats })
  } catch (error) {
    console.error('POST /api/digest/telegram-chats error:', error)
    logErrorBg('api', 'Не удалось получить список чатов бота', error)
    return NextResponse.json({ error: 'Не удалось получить список чатов' }, { status: 500 })
  }
}
