import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const exec = promisify(execFile)
const PROJECT_DIR = process.cwd()

/** Защита от частых повторных вызовов (кнопку можно нажать раз в 20 секунд) */
let lastCallAt = 0
const COOLDOWN_MS = 20_000

export async function POST() {
  try {
    // Коммиты, ждущие отправки (до пуша)
    const before = await exec('git', ['rev-list', '--count', 'origin/main..main'], {
      cwd: PROJECT_DIR,
      timeout: 15_000,
    })
      .then(({ stdout }) => Number(stdout.trim()) || 0)
      .catch(() => 0)

    const now = Date.now()
    if (now - lastCallAt < COOLDOWN_MS) {
      return NextResponse.json(
        {
          ok: false,
          pushed: 0,
          reason: 'cooldown',
          message: 'Кнопка уже нажималась — подождите пару секунд.',
        },
        { status: 429 },
      )
    }
    lastCallAt = now

    // Ручной режим: коммит + немедленный пуш (троттлинг «раз в день» обходим)
    const { stdout, stderr } = await exec(
      'bash',
      ['.zscripts/git-sync.sh', 'push', 'Ручная выгрузка — кнопка «Сохранить на GitHub»'],
      { cwd: PROJECT_DIR, timeout: 120_000, maxBuffer: 1024 * 1024 },
    )

    // Сколько реально ушло
    const after = await exec('git', ['rev-list', '--count', 'origin/main..main'], {
      cwd: PROJECT_DIR,
      timeout: 15_000,
    })
      .then(({ stdout }) => Number(stdout.trim()) || 0)
      .catch(() => 0)

    const pushed = Math.max(0, before - after)
    const nothingToPush = /Изменений нет/.test(stdout)

    return NextResponse.json({
      ok: true,
      pushed,
      ahead: after,
      message: pushed
        ? `Готово: ${pushed} ${pushed === 1 ? 'коммит' : pushed < 5 ? 'коммита' : 'коммитов'} отправлено в GitHub.`
        : nothingToPush
          ? 'Изменений нет — в GitHub уже всё актуально.'
          : 'Пуш выполнен.',
      log: (stderr || stdout).trim().split('\n').slice(-4).join('\n'),
    })
  } catch (error) {
    console.error('POST /api/github/push error:', error)
    return NextResponse.json(
      {
        ok: false,
        pushed: 0,
        message: 'Не удалось отправить в GitHub. Попробуйте позже или сообщите ассистенту.',
      },
      { status: 500 },
    )
  }
}
