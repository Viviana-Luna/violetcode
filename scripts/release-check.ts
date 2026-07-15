import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const allowDirty = Bun.argv.includes('--allow-dirty')
const skipAudit = Bun.argv.includes('--skip-audit')
const configDir = await mkdtemp(join(tmpdir(), 'violet-release-check-'))

type Check = {
  name: string
  command: string[]
  env?: Record<string, string>
}

const checks: Check[] = [
  ...(skipAudit ? [] : [{ name: '生产依赖安全审计', command: ['bun', 'audit', '--production'] }]),
  { name: '核心测试', command: ['bun', 'run', 'test:core'] },
  { name: '类型增量门禁', command: ['bun', 'run', 'typecheck'] },
  { name: 'Git 补丁格式', command: ['git', 'diff', '--check'] },
  {
    name: 'CLI 帮助',
    command: ['./violet', '--help'],
    env: { VIOLET_CONFIG_DIR: configDir },
  },
  {
    name: 'CLI 版本',
    command: ['./violet', '--version'],
    env: { VIOLET_CONFIG_DIR: configDir },
  },
]

async function runCheck(check: Check): Promise<void> {
  console.log(`\n==> ${check.name}`)
  const child = Bun.spawn(check.command, {
    cwd: root,
    env: { ...process.env, ...check.env },
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await child.exited
  if (exitCode !== 0) {
    throw new Error(`${check.name}失败，退出码 ${exitCode}`)
  }
}

try {
  if (!allowDirty) {
    const status = Bun.spawnSync(['git', 'status', '--porcelain', '--untracked-files=normal'], {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    if (status.exitCode !== 0 || status.stdout.toString().trim()) {
      throw new Error('工作区不是干净状态；正式发布检查拒绝继续。开发中可使用 release:check:working。')
    }
  }

  for (const check of checks) {
    await runCheck(check)
  }
  console.log('\n发布技术门禁全部通过。')
} finally {
  await rm(configDir, { recursive: true, force: true })
}
