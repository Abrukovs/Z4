import { NextResponse } from 'next/server'
import { logErrorBg } from '@/lib/error-log'
import { forceGenerateRealBets } from '@/lib/real-bets'

export const dynamic = 'force-dynamic'

/**
 * POST /api/real-bets/seed — принудительная генерация прогнозов на РЕАЛЬНЫЕ
 * матчи из живого расписания (LLM-аналитика + эвристика fallback).
 * Ручной триггер из UI (кнопка «Подобрать прогнозы»); авто-режим работает
 * через maintenanceTick → ensureRealBets.
 */
export async function POST() {
  try {
    const added = await forceGenerateRealBets()
    return NextResponse.json({ ok: true, added })
  } catch (e) {
    console.error('POST /api/real-bets/seed error:', e)
    logErrorBg('api', 'Не удалось сгенерировать прогнозы на реальные матчи', e)
    return NextResponse.json(
      { ok: false, error: 'Не удалось сгенерировать прогнозы на реальные матчи' },
      { status: 500 },
    )
  }
}
