/**
 * Мини-сервис «Живой бот» (Task 43) — мгновенные ответы BetCompassBot.
 *
 * Проблема: до этого бот отвечал на /start только утром по cron (9:00 МСК)
 * или при визите сайта — со стороны выглядело, что «Старт» не работает.
 * Решение: этот сервис держит постоянное соединение с Telegram Bot API
 * (long-poll getUpdates) и отвечает на сообщения владельца СРАЗУ:
 *   /start, «старт», «привет» … — приветствие + статус рассылки;
 *   /help, «помощь»            — справка по командам;
 *   /stop, «стоп», «отписка»   — выключение утренней рассылки;
 *   «когда», «во сколько»      — расписание;
 *   любое другое сообщение     — короткий вежливый ответ.
 *
 * Подключение нового чата и вкл/выкл рассылки сервис делает через
 * основной сайт: POST http://localhost:3000/api/digest/telegram-ingest
 * (токен передаётся в теле — сайт сверяет его с сохранённым).
 * Все записи в БД выполняет только Next.js-приложение (один писатель),
 * сервис читает настройки из SQLite в режиме read-only.
 *
 * Порт 3033 (health: GET /, dry-run обработчика: POST /sim).
 * Перезапуск при сбое: cd mini-services/telegram-bot && bun run dev.
 */
import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PORT = Number(process.env.TG_BOT_PORT ?? 3033)
const MAIN_DB = process.env.MAIN_DB_PATH ?? join(import.meta.dir, '..', '..', 'db', 'custom.db')
const MAIN_APP = process.env.MAIN_APP_URL ?? 'http://localhost:3000'
const STATE_FILE = join(import.meta.dir, 'data', 'state.json')
/** Сообщения старше 5 минут не отвечаем (застрявшие в очереди до старта) */
const STALE_AFTER_MS = 5 * 60 * 1000
/** Как часто перечитывать настройки из БД (смена часа, вкл/выкл, токен) */
const SETTINGS_REFRESH_MS = 20_000

/* --------------------------- Настройки ---------------------------- */

interface BotSettings {
  token: string | null
  chatId: string | null
  chatTitle: string | null
  sendHour: number
  enabled: boolean
}

let settings: BotSettings = {
  token: null,
  chatId: null,
  chatTitle: null,
  sendHour: 9,
  enabled: false,
}

function readSettings(): BotSettings {
  try {
    const db = new Database(MAIN_DB, { readonly: true })
    try {
      const row = db
        .query(
          'SELECT telegramBotToken, telegramChatId, telegramChatTitle, sendHour, telegramEnabled FROM DigestSettings WHERE id = ?',
        )
        .get('main') as
        | {
            telegramBotToken: string | null
            telegramChatId: string | null
            telegramChatTitle: string | null
            sendHour: number | bigint
            telegramEnabled: number | bigint
          }
        | null
      if (!row) return settings
      return {
        token: row.telegramBotToken ? String(row.telegramBotToken) : null,
        chatId: row.telegramChatId ? String(row.telegramChatId) : null,
        chatTitle: row.telegramChatTitle ? String(row.telegramChatTitle) : null,
        sendHour: Number(row.sendHour) || 9,
        enabled: !!row.telegramEnabled,
      }
    } finally {
      db.close()
    }
  } catch (e) {
    // БД может быть на мгновение занята сайтом — просто оставим прежние
    console.error('[settings] read error:', (e as Error).message)
    return settings
  }
}

/* ------------------------- Состояние offset ------------------------ */

interface PersistedState {
  token: string | null
  lastUpdateId: number | null
}

function loadState(): PersistedState {
  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    if (typeof raw?.token === 'string' || raw?.token === null) {
      return { token: raw.token ?? null, lastUpdateId: raw.lastUpdateId ?? null }
    }
  } catch {
    /* первый запуск */
  }
  return { token: null, lastUpdateId: null }
}

function saveState(s: PersistedState) {
  try {
    if (!existsSync(join(STATE_FILE, '..'))) mkdirSync(join(STATE_FILE, '..'), { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify(s))
  } catch {
    /* не критично */
  }
}

/* --------------------------- Telegram API -------------------------- */

type TgResult<T> = { ok: true; result: T } | { ok: false; error: string; code?: 'webhook-active' }

async function tg<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<TgResult<T>> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal,
    })
    const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null
    if (res.ok && data?.ok && data.result !== undefined) return { ok: true, result: data.result }
    const desc = data?.description ?? `HTTP ${res.status}`
    if (desc.includes('webhook is active')) return { ok: false, error: desc, code: 'webhook-active' }
    return { ok: false, error: desc }
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError' ? 'timeout' : String(e)
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}

/* --------------------- Ответы и команды бота ----------------------- */

interface TgMessage {
  message_id: number
  from?: { first_name?: string }
  chat: { id: number; type: string; title?: string; first_name?: string; username?: string }
  date: number
  text?: string
}

interface DryResult {
  sends: string[]
  actions: string[]
}

function mskHourNow(): number {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).getUTCHours()
}

function cleanWord(s: string): string {
  return s.trim().replace(/[!.,?]+$/g, '')
}

function greeting(name: string, hour: number, enabled: boolean): string {
  return [
    `👋 Привет${name}! Бот «Ставка Дня» на связи.`,
    '',
    enabled
      ? `✅ Рассылка включена: каждое утро в ${hour}:00 МСК — одно сообщение за вчера: итог дня и полный разбор зашедших ставок.`
      : '🔕 Рассылка сейчас выключена — напишите /start ещё раз, чтобы включить.',
    '',
    '/help — что я умею',
  ].join('\n')
}

function helpText(hour: number): string {
  return [
    'ℹ️ <b>Что умеет бот «Ставка Дня»</b>',
    '',
    '• /start — включить рассылку и проверить подключение',
    '• /stop — выключить рассылку',
    '• /help — эта справка',
    '',
    `Одно сообщение в сутки — утром в ${hour}:00 МСК: итог вчерашнего дня (сколько зашло / мимо) и полный разбор зашедших главных ставок — «Ставка дня», исходы «Экспресса дня» и прогноз эксперта.`,
    'Проигравшие и остальные матчи не разбираем — фокус на зашедшем.',
  ].join('\n')
}

function whenText(hour: number): string {
  return [
    `⏰ Одно сообщение в сутки — утром в ${hour}:00 МСК: итог за вчера и полный разбор зашедших ставок («Ставка дня», исходы «Экспресса дня», прогноз эксперта).`,
    `Сейчас ${mskHourNow()}:00 МСК.`,
  ].join('\n')
}

function fallbackText(hour: number): string {
  return [
    'Принял 🙂 Я рассылающий бот «Ставки Дня» — болтать не умею, зато по делу отвечаю.',
    '',
    `Каждое утро в ${hour}:00 МСК — одно сообщение: итог за вчера и полный разбор зашедших ставок.`,
    '/help — что я умею',
  ].join('\n')
}

async function ingest(
  token: string,
  action: 'connect' | 'enable' | 'disable',
  chatId: number,
  chatTitle: string,
): Promise<{ ok: boolean }> {
  try {
    const res = await fetch(`${MAIN_APP}/api/digest/telegram-ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action, chatId: String(chatId), chatTitle }),
    })
    const data = (await res.json().catch(() => null)) as { ok?: boolean } | null
    return { ok: res.ok && !!data?.ok }
  } catch (e) {
    console.error('[ingest] error:', (e as Error).message)
    return { ok: false }
  }
}

/**
 * Обработка одного сообщения. dry=true — прогон без реальных отправок
 * (для самопроверки через POST /sim): собирает ответы и действия.
 */
async function handleMessage(m: TgMessage, dry = false): Promise<DryResult | null> {
  const dryResult: DryResult = { sends: [], actions: [] }
  const send = async (html: string) => {
    if (dry) {
      dryResult.sends.push(html)
      return true
    }
    const token = settings.token
    if (!token) return false
    const r = await tg(token, 'sendMessage', {
      chat_id: m.chat.id,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    })
    if (!r.ok) console.error('[send] failed:', r.error)
    return r.ok
  }
  const act = async (action: 'connect' | 'enable' | 'disable') => {
    const title = m.chat.title ?? m.chat.first_name ?? m.chat.username ?? `Чат ${m.chat.id}`
    if (dry) {
      dryResult.actions.push(action)
      return { ok: true }
    }
    const token = settings.token
    if (!token) return { ok: false }
    const r = await ingest(token, action, m.chat.id, title)
    if (r.ok) settings = readSettings() // мгновенно подхватить новое состояние
    return r
  }

  const text = (m.text ?? '').trim()
  const low = text.toLowerCase()
  const word = cleanWord(low)
  const name = m.from?.first_name ? `, ${m.from.first_name}` : ''
  const hour = settings.sendHour
  const isOwner = settings.chatId === String(m.chat.id)

  const isStart =
    low.startsWith('/start') ||
    ['старт', 'start', 'начать', 'привет', 'hello', 'hi', 'ку', 'здравствуйте', 'доброе утро', 'добрый день'].includes(word)
  const isHelp =
    low.startsWith('/help') ||
    ['помощь', 'help', 'справка', 'что ты умеешь'].includes(word) ||
    word === '?'
  const isStop =
    low.startsWith('/stop') ||
    ['стоп', 'stop', 'отписаться', 'отписка', 'выключить', 'выключи', 'отключить'].includes(word)
  const isWhen = /когда|во сколько|расписание|в котором часу/.test(low)

  if (isStart) {
    if (!settings.chatId) {
      // первый /start: подключаем чат (сайт сохранит его и включит рассылку)
      const r = await act('connect')
      await send(
        r.ok && settings.chatId === String(m.chat.id)
          ? greeting(name, hour, settings.enabled)
          : '😔 Не получилось подключить рассылку прямо сейчас. Попробуйте ещё раз чуть позже — или нажмите «Отправить разбор сейчас» на сайте.',
      )
    } else if (isOwner) {
      if (!settings.enabled) await act('enable')
      await send(greeting(name, hour, settings.enabled))
    } else {
      await send('👋 Привет! Этот бот ведёт личную рассылку прогнозов «Ставка Дня» и уже подключён к чату владельца.')
    }
  } else if (isHelp) {
    await send(helpText(hour))
  } else if (isStop) {
    if (isOwner) {
      await act('disable')
      await send('🔕 Рассылка выключена.\n\nВключить снова — /start.')
    } else {
      await send('Этой командой может пользоваться только владелец бота 🙂')
    }
  } else if (isWhen) {
    await send(whenText(hour))
  } else {
    await send(fallbackText(hour))
  }

  return dry ? dryResult : null
}

/* --------------------------- Long-poll ----------------------------- */

const stats = {
  startedAt: new Date().toISOString(),
  handled: 0,
  skippedStale: 0,
  lastPollAt: null as string | null,
  lastError: null as string | null,
  polling: false,
}
let botInfo: { id: number; username?: string; first_name?: string } | null = null

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let state: PersistedState = loadState()

async function pollLoop() {
  console.log(`[bot] poll loop started`)
  while (true) {
    const token = settings.token
    if (!token) {
      stats.polling = false
      // Багфикс: если токена нет, цикл раньше «засыпал» навсегда, не перечитывая
      // настройки из БД (бот оставался мёртвым, даже когда пользователь всё
      // настроил). Теперь каждые 20с перечитываем DigestSettings — сервис
      // сам оживает, как только в БД появляется токен.
      settings = readSettings()
      await sleep(SETTINGS_REFRESH_MS)
      continue
    }
    // сменили токен бота — offset старого не имеет смысла
    if (state.token !== token) {
      state = { token, lastUpdateId: null }
      saveState(state)
    }
    const body: Record<string, unknown> = { timeout: 25, allowed_updates: ['message'] }
    if (state.lastUpdateId) body.offset = state.lastUpdateId + 1
    stats.polling = true
    const r = await tg<unknown[]>(token, 'getUpdates', body, 35_000)
    stats.lastPollAt = new Date().toISOString()
    if (!r.ok) {
      stats.lastError = r.error
      console.error('[poll] error:', r.error, r.code ?? '')
      await sleep(r.code === 'webhook-active' ? 60_000 : 5_000)
      settings = readSettings()
      continue
    }
    stats.lastError = null
    for (const u of r.result as { update_id: number; message?: TgMessage }[]) {
      state = { token, lastUpdateId: u.update_id }
      saveState(state)
      const m = u.message
      if (!m?.text) continue
      const stale = m.date * 1000 < Date.now() - STALE_AFTER_MS
      if (stale) {
        stats.skippedStale++
        console.log(`[skip stale] «${m.text.slice(0, 40)}» от ${m.chat.id}`)
        continue
      }
      console.log(`[msg] «${m.text.slice(0, 40)}» от чата ${m.chat.id}`)
      try {
        await handleMessage(m)
        stats.handled++
      } catch (e) {
        console.error('[handle] error:', e)
      }
    }
    // периодически подхватываем изменения настроек (час, вкл/выкл, токен)
    settings = readSettings()
  }
}

/* --------------------- HTTP: health + dry-run ---------------------- */

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return json({
        ok: true,
        service: 'telegram-bot',
        port: PORT,
        bot: botInfo ? { username: botInfo.username, name: botInfo.first_name } : null,
        hasToken: !!settings.token,
        connectedChat: settings.chatId,
        chatTitle: settings.chatTitle,
        enabled: settings.enabled,
        sendHour: settings.sendHour,
        polling: stats.polling,
        handled: stats.handled,
        skippedStale: stats.skippedStale,
        lastPollAt: stats.lastPollAt,
        lastError: stats.lastError,
        uptimeSec: Math.round((Date.now() - Date.parse(stats.startedAt)) / 1000),
      })
    }
    // POST /sim — сухой прогон обработчика (ничего реально не отправляем)
    if (req.method === 'POST' && url.pathname === '/sim') {
      const body = (await req.json().catch(() => ({}))) as {
        text?: string
        chatId?: number
        name?: string
      }
      const m: TgMessage = {
        message_id: 0,
        from: { first_name: body.name ?? 'Тест' },
        chat: {
          id: Number(body.chatId ?? settings.chatId ?? 0),
          type: 'private',
          first_name: body.name ?? 'Тест',
        },
        date: Math.floor(Date.now() / 1000),
        text: String(body.text ?? '/start'),
      }
      const result = await handleMessage(m, true)
      return json({ ok: true, input: m.text, result })
    }
    return new Response('Not found', { status: 404 })
  },
})

/* ------------------------------ Старт ------------------------------ */

settings = readSettings()
if (settings.token) {
  tg<{ id: number; username?: string; first_name?: string }>(settings.token, 'getMe')
    .then((r) => {
      if (r.ok) {
        botInfo = r.result
        console.log(`[bot] connected as @${botInfo.username}`)
      } else {
        console.error('[bot] getMe failed:', r.error)
      }
    })
    .catch(() => {})
}
console.log(`[bot] service up on :${PORT}, token: ${settings.token ? 'yes' : 'no'}, chat: ${settings.chatId ?? '—'}`)
pollLoop()
