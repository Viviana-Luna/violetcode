import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const allowDirty = Bun.argv.includes('--allow-dirty')
const skipAudit = Bun.argv.includes('--skip-audit')
const configDir = await mkdtemp(join(tmpdir(), 'violet-release-check-'))
const buildDir = await mkdtemp(join(tmpdir(), 'violet-release-build-'))
const nativeTarget = `bun-${process.platform}-${process.arch}`
const builtExecutable = join(buildDir, 'violet')

type Check = {
  name: string
  command: string[]
  env?: Record<string, string>
  expectedExitCode?: number
  stderrIncludes?: string
}

const checks: Check[] = [
  ...(skipAudit ? [] : [{ name: '生产依赖安全审计', command: ['bun', 'audit', '--production'] }]),
  { name: '敏感信息扫描', command: ['bun', 'run', 'security:sensitive'] },
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
  {
    name: '原生 standalone 构建',
    command: ['bun', 'run', 'build:release', '--', '--target', nativeTarget, '--outdir', buildDir],
  },
  {
    name: '发布二进制帮助',
    command: [builtExecutable, '--help'],
    env: { VIOLET_CONFIG_DIR: configDir },
  },
  {
    name: '发布二进制版本',
    command: [builtExecutable, '--version'],
    env: { VIOLET_CONFIG_DIR: configDir },
  },
  {
    name: '发布二进制更新入口',
    command: [builtExecutable, 'update', '--check', '--channel', 'invalid'],
    env: { VIOLET_CONFIG_DIR: configDir },
    expectedExitCode: 1,
    stderrIncludes: '不支持的更新频道：invalid',
  },
]

async function runCheck(check: Check): Promise<void> {
  console.log(`\n==> ${check.name}`)
  const captureOutput = check.stderrIncludes !== undefined
  const child = Bun.spawn(check.command, {
    cwd: root,
    env: { ...process.env, ...check.env },
    stdin: 'ignore',
    stdout: captureOutput ? 'pipe' : 'inherit',
    stderr: captureOutput ? 'pipe' : 'inherit',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    captureOutput ? new Response(child.stdout).text() : Promise.resolve(''),
    captureOutput ? new Response(child.stderr).text() : Promise.resolve(''),
  ])
  if (captureOutput) {
    if (stdout) process.stdout.write(stdout)
    if (stderr) process.stderr.write(stderr)
  }
  const expectedExitCode = check.expectedExitCode ?? 0
  if (exitCode !== expectedExitCode) {
    throw new Error(`${check.name}失败，预期退出码 ${expectedExitCode}，实际为 ${exitCode}`)
  }
  if (check.stderrIncludes && !stderr.includes(check.stderrIncludes)) {
    throw new Error(`${check.name}失败，标准错误缺少预期内容：${check.stderrIncludes}`)
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
  await rm(buildDir, { recursive: true, force: true })
}
