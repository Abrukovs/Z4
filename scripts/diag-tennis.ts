// Диагностика: как лежат строки теннисных пар в HTML
const res = await fetch('https://www.sport-express.net/live/tennis/04-09-2026', {
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
})
const html = await res.text()
function normalizeLine(l: string): string {
  return l.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\u00a0/g, ' ').trim()
}
const lines = html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]*>/g, '\n')
  .split('\n').map(normalizeLine).filter(Boolean)
// найдём индекс строки с «Раджив Рам» и покажем окружение
const idx = lines.findIndex(l => l.includes('Раджив Рам'))
if (idx >= 0) {
  console.log('=== CONTEXT around Раджив Рам (idx', idx, ') ===')
  for (let i = Math.max(0, idx - 8); i < Math.min(lines.length, idx + 12); i++) {
    console.log(`${i}: "${lines[i]}"`)
  }
}
