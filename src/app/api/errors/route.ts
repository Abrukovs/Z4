import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logErrorBg, logError, logWarn, logInfo, type ErrorLogLevel } from '@/lib/error-log'

export const dynamic = 'force-dynamic'

/**
 * Журнал ошибок сайта (Task 54).
 *
 *  GET    /api/errors?limit=50 — последние записи + счётчики по уровням
 *  DELETE /api/errors          — очистить журнал (кнопка в UI)
 *  POST   /api/errors          — отчёт от внутренних сервисов (мини-сервис
 *                                Telegram-бота шлёт свои сбои сюда; запись
 *                                валидируется, длина ограничена)
 */

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

function parseLimit(raw: string | null): number {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT
}

export async function GET(request: NextRequest) {
  try {
    const limit = parseLimit(request.nextUrl.searchParams.get('limit'))
    const [items, total, errorCount, warnCount, infoCount] = await Promise.all([
      db.errorLog.findMany({ orderBy: { lastSeenAt: 'desc' }, take: limit }),
      db.errorLog.count(),
      db.errorLog.count({ where: { level: 'error' } }),
      db.errorLog.count({ where: { level: 'warn' } }),
      db.errorLog.count({ where: { level: 'info' } }),
    ])
    return NextResponse.json({
      items: items.map((e) => ({
        id: e.id,
        level: e.level,
        scope: e.scope,
        message: e.message,
        context: e.context,
        count: e.count,
        firstSeenAt: e.firstSeenAt.toISOString(),
        lastSeenAt: e.lastSeenAt.toISOString(),
      })),
      total,
      counters: { error: errorCount, warn: warnCount, info: infoCount },
    })
  } catch (error) {
    console.error('GET /api/errors error:', error)
    logErrorBg('api', 'Не удалось прочитать журнал ошибок', error)
    return NextResponse.json({ error: 'Не удалось загрузить журнал ошибок' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const removed = await db.errorLog.deleteMany({})
    return NextResponse.json({ ok: true, removed: removed.count })
  } catch (error) {
    console.error('DELETE /api/errors error:', error)
    logErrorBg('api', 'Не удалось очистить журнал ошибок', error)
    return NextResponse.json({ ok: false, error: 'Не удалось очистить журнал' }, { status: 500 })
  }
}

/** POST — отчёт от внутренних сервисов (telegram-bot и др.) */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      level?: string
      scope?: string
      message?: string
      context?: unknown
    } | null

    const level: ErrorLogLevel =
      body?.level === 'error' || body?.level === 'warn' || body?.level === 'info' ? body.level : 'error'
    const scope = typeof body?.scope === 'string' ? body.scope.slice(0, 60) : 'external'
    const message = typeof body?.message === 'string' ? body.message.slice(0, 500) : ''

    if (!message.trim()) {
      return NextResponse.json({ ok: false, error: 'empty message' }, { status: 400 })
    }

    if (level === 'error') {
      await logError(scope, message, undefined, body?.context as Record<string, unknown> | undefined)
    } else if (level === 'info') {
      await logInfo(scope, message, body?.context)
    } else {
      await logWarn(scope, message, body?.context)
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('POST /api/errors error:', error)
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 })
  }
}
