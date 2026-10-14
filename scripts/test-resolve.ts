import { PrismaClient } from '@prisma/client'
import { resolveRealBets, evaluateRealBet, parseScore } from '../src/lib/real-bets'
const db = new PrismaClient()

// 1) Юнит-тесты оценщика
console.log('parseScore "3:4" hockey:', JSON.stringify(parseScore('3:4', 'hockey')))
console.log('parseScore "6-4 4-6 7-6 6-7 6-3" tennis:', JSON.stringify(parseScore('6-4 4-6 7-6 6-7 6-3', 'tennis')))
console.log('eval TB 5.5 on 3:4:', JSON.stringify(evaluateRealBet({ sport: 'hockey', market: 'Тотал шайб', selection: 'ТБ 5.5 — тотал больше 5.5 шайб' }, '3:4')))
console.log('eval П1 on 70:54:', JSON.stringify(evaluateRealBet({ sport: 'basketball', market: 'Исход матча', selection: 'П1 — победа хозяев' }, '70:54')))
console.log('eval П1 on 2:2:', JSON.stringify(evaluateRealBet({ sport: 'football', market: 'Исход матча (1X2)', selection: 'П1 — победа хозяев' }, '2:2')))
console.log('eval ничья on 2:2:', JSON.stringify(evaluateRealBet({ sport: 'football', market: 'Исход матча (1X2)', selection: 'Ничья (Х)' }, '2:2')))
console.log('eval П1 tennis 6-4 4-6 7-6 6-7 6-3:', JSON.stringify(evaluateRealBet({ sport: 'tennis', market: 'Победа в матче', selection: 'П1 — победа первого игрока' }, '6-4 4-6 7-6 6-7 6-3')))

// 2) Интеграционный тест: вставляем pending real-ставки на ЗАВЕРШЁННЫЕ матчи
const today = new Date()
const past = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 13, 30)
const b1 = await db.bet.create({ data: {
  sport: 'hockey', league: 'Olimpbet ВХЛ', homeTeam: 'Южный Урал', awayTeam: 'Горняк',
  matchDate: past, market: 'Тотал шайб', selection: 'ТБ 5.5 — тотал больше 5.5 шайб',
  odds: 1.86, stake: 5, confidence: 64, analysis: 'тест', status: 'pending', isRealMatch: true,
}})
const b2 = await db.bet.create({ data: {
  sport: 'basketball', league: 'ЧМ (Ж)', homeTeam: 'Австралия', awayTeam: 'Пуэрто-Рико',
  matchDate: past, market: 'Исход матча', selection: 'П1 — победа хозяев',
  odds: 1.55, stake: 4, confidence: 70, analysis: 'тест', status: 'pending', isRealMatch: true,
}})
console.log('\ninserted test bets:', b1.id.slice(-6), b2.id.slice(-6))

// 3) Запускаем расчёт
await resolveRealBets()

const r1 = await db.bet.findUnique({ where: { id: b1.id } })
const r2 = await db.bet.findUnique({ where: { id: b2.id } })
console.log('\nhockey TB5.5 (3:4 → 7 шайб):', r1?.status, '|', r1?.resultNote)
console.log('basketball П1 (70:54):', r2?.status, '|', r2?.resultNote)
await db.$disconnect()
