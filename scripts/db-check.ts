import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const group = await db.bet.groupBy({ by: ['status', 'isRealMatch'], _count: true })
console.log(JSON.stringify(group, null, 1))
const total = await db.bet.count()
console.log('total bets:', total)
await db.$disconnect()
