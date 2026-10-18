import { NextRequest, NextResponse } from 'next/server'
import { logErrorBg } from '@/lib/error-log'
import { countArticles, ensureFreshArticles, listArticles } from '@/lib/articles'
import { ensureFreshData, maintenanceTick } from '@/lib/seed'

export const dynamic = 'force-dynamic'

/**
 * GET /api/articles?limit=6 — последние редакционные материалы.
 * Перед выдачей — мягкая генерация и ПОДДЕРЖАНИЕ: движок обновляет
 * «Итоги дня» при новых расчётах и не дублирует разборы матчей.
 */
export async function GET(req: NextRequest) {
  try {
    const rawLimit = Number(req.nextUrl.searchParams.get('limit') ?? '6')
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 24) : 6

    await ensureFreshData()
    await maintenanceTick()
    await ensureFreshArticles()

    const [articles, total] = await Promise.all([listArticles(limit), countArticles()])

    return NextResponse.json({
      articles: articles.map((a) => ({
        id: a.id,
        slug: a.slug,
        title: a.title,
        excerpt: a.excerpt,
        content: a.content,
        category: a.category,
        sport: a.sport,
        matchRef: a.matchRef,
        readMinutes: a.readMinutes,
        publishedAt: a.publishedAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
        author: a.author
          ? {
              id: a.author.id,
              name: a.author.name,
              role: a.author.role,
              sport: a.author.sport,
            }
          : null,
      })),
      total,
    })
  } catch (error) {
    console.error('GET /api/articles error:', error)
    logErrorBg('api', 'Не удалось загрузить статью-разборы', error)
    return NextResponse.json({ error: 'Не удалось загрузить разборы' }, { status: 500 })
  }
}
