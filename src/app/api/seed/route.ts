import { NextResponse } from 'next/server'
import { forceReseed } from '@/lib/seed'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    await forceReseed()
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('POST /api/seed error:', error)
    return NextResponse.json({ ok: false, error: 'Не удалось пересоздать данные' }, { status: 500 })
  }
}
