import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const exec = promisify(execFile)
const PROJECT_DIR = process.cwd()

/** Убирает токен из URL remote'а — наружу отдаём только безопасную ссылку */
function sanitizeRemote(url: string): string {
  return url.replace(/\/\/[^@/\s]+@/, '//').replace(/\.git$/, '')
}

export async function GET() {
  try {
    // Последний отправленный коммит (по локальному указателю origin/main)
    const { stdout: lastLog } = await exec(
      'git',
      ['log', '-1', '--format=%cI|%s', 'origin/main'],
      { cwd: PROJECT_DIR, timeout: 15_000 },
    ).catch(() => ({ stdout: '' }))

    // Коммиты, ждущие отправки
    const { stdout: aheadOut } = await exec(
      'git',
      ['rev-list', '--count', 'origin/main..main'],
      { cwd: PROJECT_DIR, timeout: 15_000 },
    ).catch(() => ({ stdout: '0' }))

    // Незакоммиченные изменения в рабочей копии
    const { stdout: dirtyOut } = await exec(
      'git',
      ['status', '--porcelain'],
      { cwd: PROJECT_DIR, timeout: 15_000 },
    ).catch(() => ({ stdout: '' }))

    // Ссылка на репозиторий (без токена)
    const { stdout: remoteUrl } = await exec(
      'git',
      ['remote', 'get-url', 'origin'],
      { cwd: PROJECT_DIR, timeout: 15_000 },
    ).catch(() => ({ stdout: '' }))

    const [lastPushAt = '', lastPushMessage = ''] = lastLog.trim().split('|')
    const ahead = Number(aheadOut.trim()) || 0
    const dirty = dirtyOut.trim() ? dirtyOut.trim().split('\n').length : 0

    return NextResponse.json({
      ok: true,
      repo: remoteUrl.trim() ? sanitizeRemote(remoteUrl.trim()) : 'github.com/Abrukovs/Z4',
      branch: 'main',
      lastPushAt: lastPushAt || null,
      lastPushMessage: lastPushMessage || null,
      ahead,
      dirty,
    })
  } catch (error) {
    console.error('GET /api/github/status error:', error)
    return NextResponse.json(
      { ok: false, error: 'Не удалось получить состояние репозитория' },
      { status: 500 },
    )
  }
}
