import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ImageResponse } from 'next/og'
import { db } from '@/lib/db'

export const alt = 'Ставка дня — прогноз на реальный матч с примерным коэффициентом'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const dynamic = 'force-dynamic'

/** Модульный кэш шрифтов (Inter, cyrillic+latin, TTF) */
let fontsCache: { data: Buffer; weight: 400 | 700 }[] | null = null
async function loadFonts() {
  if (!fontsCache) {
    const [regular, bold] = await Promise.all([
      readFile(path.join(process.cwd(), 'src/app/fonts/inter-400.ttf')),
      readFile(path.join(process.cwd(), 'src/app/fonts/inter-700.ttf')),
    ])
    fontsCache = [
      { data: regular, weight: 400 },
      { data: bold, weight: 700 },
    ]
  }
  return fontsCache.map((f) => ({ name: 'Inter', data: f.data, weight: f.weight, style: 'normal' as const }))
}

const MSK = 'Europe/Moscow'

/** Статистика для чипов (winrate/ROI по решённым прогнозам) */
async function loadStats() {
  const decided = await db.bet.findMany({
    where: { status: { in: ['won', 'lost'] } },
    select: { odds: true, stake: true, status: true },
  })
  const won = decided.filter((b) => b.status === 'won').length
  const staked = decided.reduce((s, b) => s + b.stake, 0)
  const profit = decided.reduce((s, b) => s + (b.status === 'won' ? b.stake * (b.odds - 1) : -b.stake), 0)
  return {
    winrate: decided.length ? Math.round((won / decided.length) * 1000) / 10 : null,
    roi: staked > 0 ? Math.round((profit / staked) * 1000) / 10 : null,
  }
}

type OgBet = {
  homeTeam: string
  awayTeam: string
  league: string
  selection: string
  odds: number
  confidence: number
  status: string
  matchDate: Date
} | null

export default async function OpengraphImage() {
  const fonts = await loadFonts()

  const [bet, stats] = await Promise.all([
    (async () => {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      const end = new Date(start.getTime() + 48 * 60 * 60 * 1000)
      let b = await db.bet.findFirst({
        where: { isBetOfDay: true, status: 'pending', matchDate: { gte: start, lt: end } },
        orderBy: { matchDate: 'asc' },
      })
      if (!b) {
        b = await db.bet.findFirst({
          where: { isBetOfDay: true, status: { not: 'pending' } },
          orderBy: { matchDate: 'desc' },
        })
      }
      return (b ?? null) as OgBet
    })(),
    loadStats(),
  ])

  const dateLabel = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    timeZone: MSK,
  }).format(new Date())

  const matchLabel = bet ? `${bet.homeTeam} — ${bet.awayTeam}` : null
  const matchFont = matchLabel && matchLabel.length > 26 ? 52 : 64

  const timeLabel = bet
    ? new Intl.DateTimeFormat('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: MSK,
      }).format(bet.matchDate)
    : null

  const chips: string[] = []
  if (stats.winrate !== null) chips.push(`WINRATE ${stats.winrate}%`)
  if (stats.roi !== null) chips.push(`ROI ${stats.roi > 0 ? '+' : ''}${stats.roi}%`)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#f8fafc',
          backgroundImage: 'linear-gradient(160deg, #ffffff 0%, #f8fafc 45%, #ecfdf5 100%)',
          padding: '56px 64px',
          fontFamily: 'Inter',
        }}
      >
        {/* Декоративное свечение */}
        <div
          style={{
            position: 'absolute',
            top: -180,
            right: -120,
            width: 560,
            height: 560,
            borderRadius: 9999,
            backgroundColor: 'rgba(16,185,129,0.10)',
            display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: -220,
            left: -140,
            width: 480,
            height: 480,
            borderRadius: 9999,
            backgroundColor: 'rgba(245,158,11,0.05)',
            display: 'flex',
          }}
        />

        {/* Шапка: лого + дата */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                backgroundColor: '#10b981',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ fontSize: 24, fontWeight: 700, color: '#ffffff', letterSpacing: '1px' }}>СД</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 30, fontWeight: 700, color: '#18181b', letterSpacing: '2px' }}>
                СТАВКА ДНЯ
              </span>
              <span style={{ fontSize: 17, color: '#71717a', letterSpacing: '3px' }}>
                ПРОГНОЗЫ НА РЕАЛЬНЫЕ МАТЧИ
              </span>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              paddingLeft: 22,
              paddingRight: 22,
              paddingTop: 10,
              paddingBottom: 10,
              borderRadius: 9999,
              backgroundColor: 'rgba(255,255,255,0.9)',
              borderWidth: 1,
              borderColor: '#e4e4e7',
            }}
          >
            <span style={{ fontSize: 20, color: '#52525b', letterSpacing: '1px' }}>{dateLabel.toUpperCase()}</span>
          </div>
        </div>

        {/* Основной блок */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 44,
            flex: 1,
          }}
        >
          {/* Левая колонка: матч */}
          <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 760, gap: 14 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <div style={{ width: 34, height: 4, borderRadius: 9999, backgroundColor: '#10b981', display: 'flex' }} />
              <span style={{ fontSize: 21, fontWeight: 700, color: '#059669', letterSpacing: '5px' }}>
                {bet ? (bet.status === 'pending' ? `СТАВКА ДНЯ · ${timeLabel} МСК` : 'СТАВКА ДНЯ · ИТОГ') : 'СТАВКА ДНЯ'}
              </span>
            </div>
            <span style={{ fontSize: matchFont, fontWeight: 700, color: '#18181b', lineHeight: 1.15 }}>
              {matchLabel ?? 'Прогнозы на спорт с живой аналитикой'}
            </span>
            <span style={{ fontSize: 24, color: '#52525b', display: 'flex' }}>
              {bet ? bet.league : 'Футбол · Теннис · Хоккей · Баскетбол'}
            </span>
            {bet ? (
              <div
                style={{
                  display: 'flex',
                  alignSelf: 'flex-start',
                  paddingLeft: 20,
                  paddingRight: 20,
                  paddingTop: 12,
                  paddingBottom: 12,
                  borderRadius: 14,
                  backgroundColor: 'rgba(255,255,255,0.92)',
                  borderWidth: 1,
                  borderColor: '#e4e4e7',
                  maxWidth: 720,
                }}
              >
                <span style={{ fontSize: 25, color: '#3f3f46' }}>{bet.selection}</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 25, color: '#3f3f46' }}>
                  Примерные коэффициенты, live-счёты и честная статистика
                </span>
                <span style={{ fontSize: 25, color: '#3f3f46' }}>Итоги — по настоящим результатам матчей</span>
              </div>
            )}
          </div>

          {/* Правая колонка: коэффициент */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              width: 300,
              paddingTop: 30,
              paddingBottom: 30,
              borderRadius: 24,
              backgroundColor: 'rgba(255,255,255,0.95)',
              borderWidth: 1,
              borderColor: 'rgba(245,158,11,0.45)',
            }}
          >
            <span style={{ fontSize: 18, color: '#52525b', letterSpacing: '3px' }}>
              {bet ? 'ПРИМЕРНЫЙ КЭФ' : 'КАЖДЫЙ ДЕНЬ'}
            </span>
            <span style={{ fontSize: 84, fontWeight: 700, color: '#d97706', marginTop: 6 }}>
              {bet ? `≈${bet.odds.toFixed(2)}` : 'НОВЫЙ'}
            </span>
            {bet ? (
              <div
                style={{
                  display: 'flex',
                  marginTop: 10,
                  paddingLeft: 18,
                  paddingRight: 18,
                  paddingTop: 8,
                  paddingBottom: 8,
                  borderRadius: 9999,
                  backgroundColor: 'rgba(16,185,129,0.14)',
                }}
              >
                <span style={{ fontSize: 20, fontWeight: 700, color: '#047857' }}>
                  Уверенность {bet.confidence}%
                </span>
              </div>
            ) : (
              <span style={{ fontSize: 20, color: '#059669', marginTop: 10 }}>свежий прогноз дня</span>
            )}
          </div>
        </div>

        {/* Низ: чипы статистики + дисклеймер */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: 28,
          }}
        >
          <div style={{ display: 'flex', gap: 12 }}>
            {chips.map((c) => (
              <div
                key={c}
                style={{
                  display: 'flex',
                  paddingLeft: 18,
                  paddingRight: 18,
                  paddingTop: 10,
                  paddingBottom: 10,
                  borderRadius: 9999,
                  backgroundColor: 'rgba(16,185,129,0.10)',
                  borderWidth: 1,
                  borderColor: 'rgba(16,185,129,0.30)',
                }}
              >
                <span style={{ fontSize: 20, fontWeight: 700, color: '#047857', letterSpacing: '1px' }}>{c}</span>
              </div>
            ))}
            <div
              style={{
                display: 'flex',
                paddingLeft: 18,
                paddingRight: 18,
                paddingTop: 10,
                paddingBottom: 10,
                borderRadius: 9999,
                backgroundColor: 'rgba(245,158,11,0.08)',
                borderWidth: 1,
                borderColor: 'rgba(245,158,11,0.25)',
              }}
            >
              <span style={{ fontSize: 20, fontWeight: 700, color: '#b45309', letterSpacing: '1px' }}>LIVE-СЧЁТЫ</span>
            </div>
          </div>
          <span style={{ fontSize: 18, color: '#52525b' }}>18+ · коэффициенты не являются линией букмекера</span>
        </div>
      </div>
    ),
    { ...size, fonts },
  )
}
