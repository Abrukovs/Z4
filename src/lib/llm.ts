import ZAI from 'z-ai-web-dev-sdk'

/**
 * Слой LLM-обогащения редакционного контента.
 *
 * Правила устойчивости:
 *  - любой сбой (нет токена, таймаут, пустой ответ) → null, вызывающий
 *    код обязан использовать шаблонный текст (офлайн-режим);
 *  - клиент кэшируется; при ошибке кэш сбрасывается и следующий вызов
 *    попробует пересоздать (сервис может «ожить»);
 *  - только серверное использование (API-роуты и генераторы контента).
 */

const LLM_TIMEOUT_MS = 30_000
const MIN_VALID_LENGTH = 120

type ZaiClient = Awaited<ReturnType<typeof ZAI.create>>
let cached: ZaiClient | null = null

async function getClient(): Promise<ZaiClient> {
  if (!cached) cached = await ZAI.create()
  return cached
}

export interface LlmOptions {
  system: string
  user: string
  maxTokens?: number
  temperature?: number
}

/** Завершение текста моделью; null — сервис недоступен (офлайн-фолбэк) */
export async function llmComplete(opts: LlmOptions): Promise<string | null> {
  try {
    const zai = await getClient()
    const request = zai.chat.completions.create({
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      maxTokens: opts.maxTokens ?? 1000,
      temperature: opts.temperature ?? 0.7,
    })
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('LLM timeout')), LLM_TIMEOUT_MS)
    })
    const res = await Promise.race([request, timeout])
    const text = res.choices?.[0]?.message?.content?.trim()
    if (!text || text.length < MIN_VALID_LENGTH) return null
    return text
  } catch {
    cached = null // пересоздадим клиент при следующей попытке
    return null
  }
}

/** Разбивка ответа на непустые абзацы; null — если структура негодна */
export function llmParagraphs(text: string, min = 3): string[] | null {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 40 && !p.startsWith('#'))
  return paragraphs.length >= min ? paragraphs : null
}

/** Признак иноязычного сбоя генерации: CJK-иероглифы или латинское слово внутри русской фразы */
export function hasForeignGlitch(text: string): boolean {
  if (/[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(text)) return true
  // «подарить plenty голов» — латинское слово в русском окружении
  if (/[а-яА-ЯёЁ][\s,«"]+[A-Za-z]{4,}[\s,.!?;"»]/.test(text)) return true
  // «Крылья,尽管 агрессивны» — иероглиф после кириллической запятой
  if (/[а-яА-ЯёЁ][,.:;!?][^\sA-Za-z0-9]/.test(text)) return true
  return false
}

/** Вызов с валидацией и одним ретраем (более низкая температура); null — фолбэк */
export async function llmText(
  opts: LlmOptions,
  validate?: (text: string) => boolean,
): Promise<string | null> {
  const first = await llmComplete(opts)
  if (first && validate && !validate(first)) {
    const second = await llmComplete({ ...opts, temperature: 0.3 })
    return second && (!validate || validate(second)) ? second : null
  }
  return first
}

/** Системный промпт редакции «Ставка Дня» (общий тон для всех материалов) */
export const EDITOR_SYSTEM_PROMPT = `Ты — спортивный редактор русскоязычного сайта прогнозов «Ставка Дня».
Пишешь честные и живые редакционные материалы: без воды, без кликбейта, без обещаний гарантированного выигрыша.
Пиши СТРОГО на русском языке: не вставляй иностранные слова и англицизмы.
Используй ТОЛЬКО предоставленные в задании данные: не выдумывай статистику, счёты, историю встреч, травмы, составы и котировки. Конкретных чисел и фактов о командах, которых нет в данных, не добавляй.
Русский язык, обращение к читателю на «вы». Тон экспертный и спокойный, с уважением к риску.
Коэффициенты называть «примерными» и напоминать сверяться с линией букмекера.
Уместно деликатное напоминание 18+ и «играйте ответственно». Не используй markdown-разметку.`
