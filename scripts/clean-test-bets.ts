import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const n = await db.bet.deleteMany({ where: { analysis: 'тест', isRealMatch: true } })
console.log('cleaned test bets:', n.count)
await db.$disconnect()
