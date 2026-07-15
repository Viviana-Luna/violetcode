import { afterEach, describe, expect, test } from 'bun:test'
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const temporaryPaths: string[] = []

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  temporaryPaths.push(directory)
  return directory
}

async function run(command: string[], cwd = root, env: Record<string, string> = {}) {
  const child = Bun.spawn(command, {
    cwd,
    env: { ...process.env, ...env },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill()
  }, 10_000)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { stdout, stderr, exitCode, timedOut }
  } finally {
    clearTimeout(timeout)
  }
}

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('源码安装与更新生命周期', () => {
  test('安装命令创建可解析回源码启动器的符号链接', async () => {
    const directory = await temporaryDirectory('violet-install-')
    const binDirectory = join(directory, 'bin')
    const result = await run(['bash', 'scripts/install-source.sh'], root, {
      HOME: directory,
      VIOLET_INSTALL_BIN_DIR: binDirectory,
      VIOLET_INSTALL_SKIP_DEPENDENCIES: '1',
    })

    expect(result.exitCode).toBe(0)
    const launcher = join(binDirectory, 'violet')
    expect((await lstat(launcher)).isSymbolicLink()).toBe(true)
    expect(await readlink(launcher)).toBe(join(root, 'violet'))
  })

  test('安装命令不会覆盖同名普通文件', async () => {
    const directory = await temporaryDirectory('violet-install-conflict-')
    const binDirectory = join(directory, 'bin')
    await mkdir(binDirectory, { recursive: true })
    await writeFile(join(binDirectory, 'violet'), '用户文件', 'utf8')

    const result = await run(['bash', 'scripts/install-source.sh'], root, {
      HOME: directory,
      VIOLET_INSTALL_BIN_DIR: binDirectory,
      VIOLET_INSTALL_SKIP_DEPENDENCIES: '1',
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('未覆盖该文件')
    expect(await readFile(join(binDirectory, 'violet'), 'utf8')).toBe('用户文件')
  })

  test('更新检查验证干净分支与 origin，不访问网络', async () => {
    const directory = await temporaryDirectory('violet-update-')
    const scriptsDirectory = join(directory, 'scripts')
    await mkdir(scriptsDirectory, { recursive: true })
    await writeFile(
      join(scriptsDirectory, 'update-source.sh'),
      await readFile(join(root, 'scripts/update-source.sh'), 'utf8'),
      'utf8',
    )

    for (const command of [
      ['git', 'init', '-b', 'main'],
      ['git', 'config', 'user.name', 'VioletCode 测试'],
      ['git', 'config', 'user.email', 'test@violetcode.invalid'],
      ['git', 'remote', 'add', 'origin', 'https://example.invalid/violetcode.git'],
      ['git', 'add', '.'],
      ['git', 'commit', '-m', '测试：初始化临时仓库'],
    ]) {
      const result = await run(command, directory)
      expect(result.exitCode).toBe(0)
    }

    const result = await run(['bash', 'scripts/update-source.sh', '--check'], directory)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('更新前检查通过')

    await writeFile(join(directory, '未提交.txt'), '本地修改', 'utf8')
    const dirtyResult = await run(['bash', 'scripts/update-source.sh', '--check'], directory)
    expect(dirtyResult.exitCode).toBe(1)
    expect(dirtyResult.stderr).toContain('工作区存在未提交修改')
  })

  test('版本输出使用完整语义化版本号', async () => {
    const directory = await temporaryDirectory('violet-version-')
    const result = await run(['./violet', '--version'], root, {
      HOME: directory,
      VIOLET_CONFIG_DIR: join(directory, 'config'),
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('v0.1.0-preview.2 (VioletCode)')
  })

  test('公开启动路径不挂载旧安装自检或自动更新器', async () => {
    const [repl, notifications, setup, housekeeping, cleanup, status, handlers, releaseBuilder] =
      await Promise.all([
        readFile(join(root, 'src/screens/REPL.tsx'), 'utf8'),
        readFile(join(root, 'src/components/PromptInput/Notifications.tsx'), 'utf8'),
        readFile(join(root, 'src/setup.ts'), 'utf8'),
        readFile(join(root, 'src/utils/backgroundHousekeeping.ts'), 'utf8'),
        readFile(join(root, 'src/utils/cleanup.ts'), 'utf8'),
        readFile(join(root, 'src/utils/status.tsx'), 'utf8'),
        readFile(join(root, 'src/cli/handlers/util.tsx'), 'utf8'),
        readFile(join(root, 'scripts/build-release.ts'), 'utf8'),
      ])

    expect(repl).not.toContain('useInstallMessages')
    expect(notifications).not.toContain("import { AutoUpdaterWrapper }")
    expect(setup).not.toContain('lockCurrentVersion')
    expect(housekeeping).not.toContain('cleanupOldVersions')
    expect(cleanup).not.toContain("from './nativeInstaller/index.js'")
    expect(status).not.toContain('checkInstall')
    expect(handlers).not.toContain('installHandler')
    expect(releaseBuilder).toContain('旧 Claude 安装或自动更新能力仍可达')
  })

  test('顶层帮助标题使用简体中文', async () => {
    const directory = await temporaryDirectory('violet-help-')
    const result = await run(['./violet', '--help'], root, {
      HOME: directory,
      VIOLET_CONFIG_DIR: join(directory, 'config'),
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('用法： violet')
    expect(result.stdout).toContain('参数：')
    expect(result.stdout).toContain('选项：')
    expect(result.stdout).toContain('命令：')
    expect(result.stdout).not.toContain('Usage:')
  })

  test('无凭据的非交互显式模型会报告错误并退出', async () => {
    const directory = await temporaryDirectory('violet-missing-provider-')
    const result = await run(
      [
        './violet',
        '-p',
        '--model',
        'volcengineArk/ark-code-latest',
        '仅用于启动校验，不应发送请求',
      ],
      root,
      {
        HOME: directory,
        VIOLET_CONFIG_DIR: join(directory, 'config'),
        DEEPSEEK_API_KEY: '',
        VOLCENGINE_ARK_API_KEY: '',
      },
    )

    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('VioletCode 启动失败')
    expect(result.stderr).toContain('请先运行 /connect')
  })
})
