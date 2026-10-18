import { NextResponse } from 'next/server'
import { logErrorBg } from '@/lib/error-log'
import {
  getDigestSettings,
  saveDigestSettings,
  sendDailyDigest,
  sendWelcomeOnce,
  moscowHourNow,
} from '@/lib/digest'

export const dynamic = 'force-dynamic'

/**
 * POST /api/digest/telegram-ingest — мгновенное управление рассылкой.
 *
 * Вызывается мини-сервисом «живого бота» (mini-services/telegram-bot,
 * long-poll getUpdates) в тот момент, когда владелец пишет боту /start
 * или /stop — раньше бот реагировал на сообщения только утром по cron
 * или при визите сайта, и «Старт» выглядел молчаливым. Действия:
 *   connect — сохранить чат, включить рассылку, прислать приветствие
 *             (один раз) и, если время уже пришло, сегодняшний разбор;
 *   enable  — включить рассылку;
 *   disable — выключить рассылку.
 *
 * Защита: сервис передаёт токен бота, сверяем с сохранённым на сервере —
 * без токена чужой запрос подключить/выключить ничего не может.
 */
const CHAT_ID_RE = /^-?[0-9]{3,}$/

interface IngestBody {
  token?: string
  action?: 'connect' | 'enable' | 'disable'
  chatId?: string
  chatTitle?: string
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as IngestBody | null
    if (!body?.token || !body.action || !body.chatId) {
      return NextResponse.json({ ok: false, error: 'bad-request' }, { status: 400 })
    }
    if (!/^(connect|enable|disable)$/.test(body.action)) {
      return NextResponse.json({ ok: false, error: 'unknown-action' }, { status: 400 })
    }
    if (!CHAT_ID_RE.test(body.chatId)) {
      return NextResponse.json({ ok: false, error: 'bad-chat-id' }, { status: 400 })
    }

    const settings = await getDigestSettings()
    const savedToken = settings.telegramBotToken?.trim()
    if (!savedToken || body.token.trim() !== savedToken) {
      return NextResponse.json({ ok: false, error: 'auth' }, { status: 401 })
    }

    if (body.action === 'disable') {
      await saveDigestSettings({ telegramEnabled: false })
      return NextResponse.json({ ok: true, action: 'disabled' })
    }

    if (body.action === 'enable') {
      await saveDigestSettings({ telegramEnabled: true })
      return NextResponse.json({ ok: true, action: 'enabled' })
    }

    // connect: сохранить чат, включить рассылку, приветствие — один раз
    await saveDigestSettings({
      telegramChatId: body.chatId,
      telegramChatTitle: body.chatTitle?.trim() || null,
      telegramEnabled: true,
    })
    const fresh = await getDigestSettings()
    const token = fresh.telegramBotToken!.trim()

    const welcomeSent = await sendWelcomeOnce(token, body.chatId, fresh.sendHour)

    // Если утро уже наступило, а разбор за вчера ещё не отправлен —
    // пришлём сразу, чтобы /start в 10:00 не ждал следующего дня
    let digestSent = false
    let digestReason: string | undefined
    if (fresh.telegramEnabled && moscowHourNow() >= fresh.sendHour) {
      const outcome = await sendDailyDigest(true)
      digestSent = outcome.sent
      digestReason = outcome.reason
    }

    return NextResponse.json({
      ok: true,
      action: 'connected',
      chatId: fresh.telegramChatId,
      chatTitle: fresh.telegramChatTitle,
      welcomeSent,
      digestSent,
      digestReason,
    })
  } catch (error) {
    console.error('POST /api/digest/telegram-ingest error:', error)
    logErrorBg('api', 'Сбой обработки входящего сообщения бота', error)
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 })
  }
}
