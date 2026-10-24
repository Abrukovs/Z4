import { NextResponse } from 'next/server'
import { logErrorBg } from '@/lib/error-log'
import {
  autoDetectChat,
  buildDigest,
  buildTelegramHtml,
  getDigestSettings,
  getRecentDigestLogs,
  publicSettings,
  moscowHourNow,
  sendDailyDigest,
} from '@/lib/digest'
import type { BotHealthDto } from '@/lib/types'

export const dynamic = 'force-dynamic'

const BOT_SERVICE_HEALTH_URL = 'http://localhost:3033/health'

/** Живое состояние мини-сервиса бота (для статуса в разделе Telegram).
 *  Секретов не отдаём: только «жив/мёртв» и последняя ошибка опроса. */
async function fetchBotHealth(): Promise<BotHealthDto | null> {
  try {
    const r = await fetch(BOT_SERVICE_HEALTH_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    })
    if (!r.ok) return null
    const h = (await r.json()) as {
      ok?: boolean
      bot?: string | null
      hasToken?: boolean
      polling?: boolean
      lastError?: string | null
      lastPollAt?: string | null
    }
    return {
      online: !!h.ok,
      username: h.bot ?? null,
      hasToken: !!h.hasToken,
      polling: !!h.polling,
      lastError: h.lastError ?? null,
      lastPollAt: h.lastPollAt ?? null,
    }
  } catch {
    return null
  }
}

/**
 * GET /api/digest — данные рассылки: ЕДИНОЕ утреннее сообщение за вчера
 * (Task 50): итог дня + ПОЛНЫЙ разбор зашедших главных ставок («Ставка
 * дня», исходы «Экспресса дня», прогноз эксперта — целиком, без обрезки),
 * предпросмотр Telegram-сообщения, настройки (токен замаскирован) и журнал
 * отправок. Вечернего «Разбора после матча» больше нет — одно сообщение
 * в сутки утром.
 * Если токен есть, а чата ещё нет — заодно пробуем авто-подключение:
 * владелец мог нажать /start у бота.
 *
 * АВТОДОСЫЛКА (Task 49): пропущенное по расписанию сообщение (тик крона
 * не пришёл) догоняется визитом сайта — все проверки (окно, дедуп,
 * настройки) внутри отправщика, ошибки не ломают выдачу.
 */
export async function GET() {
  try {
    // Авто-подключение чата: /start у бота → чат, рассылка и приветствие
    // появятся сами; ошибки не ломают выдачу (просто попробуем позже)
    const current = await getDigestSettings()
    if (current.telegramBotToken?.trim() && !current.telegramChatId?.trim()) {
      try {
        await autoDetectChat(current.telegramBotToken.trim(), current.sendHour)
      } catch (e) {
        console.error('digest autoDetectChat error:', e)
      }
    }
    // Автодосылка пропущенного сообщения — fire-and-forget, не блокирует ответ
    void sendDailyDigest(true).catch((e) => console.error('digest catch-up error:', e))
    const [digest, settings, logs, bot] = await Promise.all([
      buildDigest(1),
      getDigestSettings(),
      getRecentDigestLogs(6),
      fetchBotHealth(),
    ])
    return NextResponse.json({
      digest: {
        dateKey: digest.dateKey,
        dateLabel: digest.dateLabel,
        betOfDay: digest.betOfDay,
        express: digest.express,
        star: digest.star,
        expertWins: digest.expertWins,
        otherWins: digest.otherWins,
        misses: digest.misses,
        summary: digest.summary,
      },
      /** Точный текст единого утреннего сообщения (с настройкой часа) */
      telegramHtml: buildTelegramHtml(digest, settings.sendHour),
      settings: publicSettings(settings),
      logs,
      /** Текущий час по МСК и час отправки — для подписи «ждём N:00» */
      moscowHour: moscowHourNow(),
      /** Живое состояние бота: зелёный свет или «токен отклонён» */
      bot,
    })
  } catch (error) {
    console.error('GET /api/digest error:', error)
    logErrorBg('api', 'Не удалось собрать данные Telegram-рассылки', error)
    return NextResponse.json({ error: 'Не удалось собрать данные рассылки' }, { status: 500 })
  }
}
