import { getRealMatches } from '../src/lib/real-matches'
import { selectMatches } from '../src/lib/real-bets'
const data = await getRealMatches(true)
console.log('now:', new Date().toISOString(), '| schedule date:', data.date)
for (const s of ['football', 'tennis', 'hockey', 'basketball'] as const) {
  const up = (data.sports[s] ?? []).filter(m => m.status === 'upcoming')
  console.log(`\n${s}: ${up.length} upcoming`)
  for (const m of up.slice(0, 8)) {
    console.log(`   ${m.time} ${m.home.slice(0, 28)} — ${m.away.slice(0, 24)} | ${m.league.slice(0, 34)}`)
  }
}
const picks = selectMatches(data, Date.now(), new Set())
console.log('\n=== SELECTED', picks.length, '===')
for (const p of picks) {
  console.log(`   [${p.sport}] ${p.m.time} ${p.m.home.slice(0, 26)} — ${p.m.away.slice(0, 22)} | ${p.m.league.slice(0, 30)} | start in ${Math.round((p.start - Date.now()) / 60000)} min`)
}
