import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const n = await db.bet.deleteMany({ where: { isRealMatch: true } })
console.log('deleted real bets:', n.count)
await db.bet.updateMany({ where: { isBetOfDay: true }, data: { isBetOfDay: false } })
console.log('cleared bet-of-day flags')
await db.$disconnect()
