import { db } from '@/lib/db'

/**
 * Журнал ошибок и предупреждений сайта (Task 54).
 *
 * Зачем: раньше все ошибки уходили только в консоль dev-сервера, которую
 * владелец не видит («Ошибки пишете в Журнал ошибок? Не загрузилась ставка
 * от Марии» — diagnose занял час, потому что система молчала). Теперь ключевые
 * сбои и деградации пишутся в БД и показываются на вкладке «Статистика».
 *
 * Свойства:
 *  - запись НИКОГДА не роняет вызывающий код (внутренний try/catch);
 *  - дедуп: одинаковые level+scope+message в течение 10 минут схлопываются
 *    в одну запись (растёт счётчик count) — фоновые тики каждые 30 секунд
 *    не заспамят журнал сотнями одинаковых строк;
 *  - ротация: храним последние ~200 записей (журнал для человека, не для аудита);
 *  - защита от рекурсии: сбой самой записи в журнал не логируется.
 */

export type ErrorLogLevel = 'error' | 'warn' | 'info'

const DEDUP_WINDOW_MS = 10 * 60 * 1000
const KEEP_RECENT = 200
const MAX_MESSAGE = 500
const MAX_CONTEXT = 4000

/** Флаг защиты от рекурсии: ошибка внутри логгера не пишет саму себя */
let logging = false

async function write(
  level: ErrorLogLevel,
  scope: string,
  message: string,
  context?: unknown,
): Promise<void> {
  if (logging) return
  logging = true
  try {
    const msg = String(message).slice(0, MAX_MESSAGE)
    let ctx: string | null = null
    if (context !== undefined && context !== null) {
      try {
        ctx =
          typeof context === 'string'
            ? context.slice(0, MAX_CONTEXT)
            : JSON.stringify(context, replacer).slice(0, MAX_CONTEXT)
      } catch {
        ctx = String(context).slice(0, MAX_CONTEXT)
      }
    }

    // Дедуп: свежая запись с тем же ключом — увеличиваем счётчик
    const dup = await db.errorLog.findFirst({
      where: {
        level,
        scope,
        message: msg,
        lastSeenAt: { gte: new Date(Date.now() - DEDUP_WINDOW_MS) },
      },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, context: true },
    })
    if (dup) {
      await db.errorLog.update({
        where: { id: dup.id },
        data: {
          count: { increment: 1 },
          lastSeenAt: new Date(),
          context: ctx ?? dup.context,
        },
      })
      return
    }

    await db.errorLog.create({
      data: { level, scope, message: msg, context: ctx },
    })

    // Ротация: oldest-exceeds-KEEP_RECENT удаляем
    const total = await db.errorLog.count()
    if (total > KEEP_RECENT) {
      const excess = await db.errorLog.findMany({
        orderBy: { lastSeenAt: 'asc' },
        take: total - KEEP_RECENT,
        select: { id: true },
      })
      if (excess.length > 0) {
        await db.errorLog.deleteMany({ where: { id: { in: excess.map((e) => e.id) } } })
      }
    }
  } catch {
    // Журнал ошибок не должен ломать сайт — молча
  } finally {
    logging = false
  }
}

/** JSON.stringify с обрезкой слишком длинных строк (стеки, HTML) */
function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && value.length > 600) {
    return value.slice(0, 600) + '…'
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack?.slice(0, 600) }
  }
  return value
}

function errContext(e: unknown, extra?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    stack: e instanceof Error ? e.stack?.split('\n').slice(0, 6).join('\n') : undefined,
  }
  if (extra) Object.assign(out, extra)
  return out
}

/** Ошибка (сбой, требует внимания): публика-фrase, детали — в контекст */
export async function logError(
  scope: string,
  message: string,
  error?: unknown,
  extra?: Record<string, unknown>,
): Promise<void> {
  await write('error', scope, message, error !== undefined || extra ? errContext(error, extra) : undefined)
}

/** Предупреждение (деградация, сайт работает): напр. «звезда без прогноза» */
export async function logWarn(
  scope: string,
  message: string,
  context?: unknown,
): Promise<void> {
  await write('warn', scope, message, context)
}

/** Информационная запись (событие, не проблема) */
export async function logInfo(
  scope: string,
  message: string,
  context?: unknown,
): Promise<void> {
  await write('info', scope, message, context)
}

/**
 * void-обёртка для «выстрелил и забыл» в фоновых задачах
 * (не ждём записи в журнал, ошибка записи молча глотается).
 */
export function logErrorBg(
  scope: string,
  message: string,
  error?: unknown,
  extra?: Record<string, unknown>,
): void {
  void logError(scope, message, error, extra).catch(() => {})
}

export function logWarnBg(scope: string, message: string, context?: unknown): void {
  void logWarn(scope, message, context).catch(() => {})
}

export function logInfoBg(scope: string, message: string, context?: unknown): void {
  void logInfo(scope, message, context).catch(() => {})
}
