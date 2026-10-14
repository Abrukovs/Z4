import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const EMAIL_MESSAGE = 'Введите корректный e-mail'

const SubscribeSchema = z.object({
  // trim + lowercase до валидации, чтобы « User@Mail.RU » тоже проходил
  email: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.email(EMAIL_MESSAGE),
  ),
})

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: EMAIL_MESSAGE }, { status: 400 })
  }

  const parsed = SubscribeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: EMAIL_MESSAGE }, { status: 400 })
  }

  try {
    const email = parsed.data.email
    const existing = await db.subscriber.findUnique({ where: { email } })
    if (existing) {
      // Дубликат — не ошибка: пользователь уже подписан
      return NextResponse.json({ ok: false, reason: 'duplicate' })
    }
    await db.subscriber.create({ data: { email, source: 'site' } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    // Гонка двух параллельных подписок на один e-mail (unique-ограничение)
    if ((error as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ ok: false, reason: 'duplicate' })
    }
    console.error('POST /api/subscribe error:', error)
    return NextResponse.json({ ok: false, error: 'Не удалось оформить подписку' }, { status: 500 })
  }
}
