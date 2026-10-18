import { NextResponse } from 'next/server'
import { logErrorBg } from '@/lib/error-log'
import {
  getDigestSettings,
  publicSettings,
  saveDigestSettings,
  validateSettingsPatch,
} from '@/lib/digest'

export const dynamic = 'force-dynamic'

/**
 * PUT /api/digest/settings — сохранить настройки рассылки:
 * токен бота, chat id, час отправки (МСК), вкл/выкл автоотправку.
 * Токен валидируется по формату BotFather и никогда не возвращается наружу.
 */
export async function PUT(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) {
      return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
    }

    const patch: Record<string, unknown> = {}
    for (const key of [
      'telegramEnabled',
      'telegramBotToken',
      'telegramChatId',
      'telegramChatTitle',
      'sendHour',
    ] as const) {
      if (key in body) patch[key] = body[key]
    }

    const validationError = validateSettingsPatch(patch)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    // Включить автоотправку можно только при заполненном токене и чате
    if (patch.telegramEnabled === true) {
      const current = await getDigestSettings()
      const token = (patch.telegramBotToken ?? current.telegramBotToken ?? '').trim()
      const chatId = (patch.telegramChatId ?? current.telegramChatId ?? '').trim()
      if (!token || !chatId) {
        return NextResponse.json(
          { error: 'Сначала укажите токен бота и chat id' },
          { status: 400 },
        )
      }
    }

    const saved = await saveDigestSettings(patch)
    return NextResponse.json({ settings: publicSettings(saved) })
  } catch (error) {
    console.error('PUT /api/digest/settings error:', error)
    logErrorBg('api', 'Не удалось сохранить настройки Telegram-рассылки', error)
    return NextResponse.json({ error: 'Не удалось сохранить настройки' }, { status: 500 })
  }
}
