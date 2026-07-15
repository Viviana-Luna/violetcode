import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

type DistributionModule = typeof import('../src/distribution/update.js')

let distribution: DistributionModule
const temporaryPaths: string[] = []

beforeAll(async () => {
  ;(globalThis as unknown as { MACRO: Record<string, string> }).MACRO = {
    VERSION: '0.1.0-preview.1',
    BUILD_TIME: '',
    ISSUES_EXPLAINER: '',
    FEEDBACK_CHANNEL: '',
    PACKAGE_URL: 'violet-code',
    NATIVE_PACKAGE_URL: '',
    VERSION_CHANGELOG: '',
  }
  distribution = await import('../src/distribution/update.js')
})

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map(path => rm(path, { recursive: true, force: true }).catch(() => undefined)),
  )
})

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  temporaryPaths.push(directory)
  return directory
}

async function makeArchive(directory: string, assetName: string, version: string): Promise<Uint8Array> {
  const payload = join(directory, 'payload')
  await mkdir(payload)
  const executable = join(payload, 'violet')
  await writeFile(executable, `#!/usr/bin/env bash\necho 'v${version} (VioletCode)'\n`, 'utf8')
  await chmod(executable, 0o755)
  const archive = join(directory, assetName)
  const command = assetName.endsWith('.zip')
    ? Bun.spawnSync(['zip', '-q', archive, 'violet'], { cwd: payload })
    : Bun.spawnSync(['tar', '-czf', archive, '-C', payload, 'violet'])
  expect(command.exitCode).toBe(0)
  return new Uint8Array(await readFile(archive))
}

function releaseFetcher(release: object, files: Record<string, Uint8Array | string>): typeof fetch {
  return (async input => {
    const url = String(input)
    if (url.includes('/releases?')) {
      return Response.json(Array.isArray(release) ? release : [release])
    }
    const name = url.split('/').pop() ?? ''
    const body = files[name]
    return body === undefined ? new Response('未找到', { status: 404 }) : new Response(body)
  }) as typeof fetch
}

async function prepareInstallerMirror(directory: string): Promise<{
  apiBase: string
  downloadBase: string
  assetName: string
}> {
  const assetName = await distribution.selectAssetName()
  const archive = await makeArchive(directory, assetName, '0.1.0-preview.1')
  const checksum = createHash('sha256').update(archive).digest('hex')
  const tag = 'v0.1.0-preview.1'
  const mirror = join(directory, 'mirror')
  const apiDirectory = join(mirror, 'api')
  const downloadDirectory = join(mirror, 'downloads', tag)
  await mkdir(apiDirectory, { recursive: true })
  await mkdir(downloadDirectory, { recursive: true })
  await writeFile(
    join(apiDirectory, 'releases'),
    JSON.stringify([{ tag_name: tag, draft: false, prerelease: true, assets: [] }]),
    'utf8',
  )
  await Bun.write(join(downloadDirectory, assetName), archive)
  await writeFile(join(downloadDirectory, 'SHA256SUMS'), `${checksum}  ${assetName}\n`, 'utf8')
  return {
    apiBase: `file://${apiDirectory}`,
    downloadBase: `file://${join(mirror, 'downloads')}`,
    assetName,
  }
}

describe('GitHub Release 选择', () => {
  test('preview 选择最高语义版本并忽略草稿与稳定版', async () => {
    const releases = [
      { tag_name: 'v0.1.0-preview.2', draft: false, prerelease: true, assets: [] },
      { tag_name: 'v0.1.0', draft: false, prerelease: false, assets: [] },
      { tag_name: 'v0.1.0-preview.9', draft: true, prerelease: true, assets: [] },
      { tag_name: 'v0.1.0-preview.10', draft: false, prerelease: true, assets: [] },
    ]
    const selected = await distribution.resolveLatestRelease(
      'preview',
      releaseFetcher(releases, {}),
      'https://api.test',
    )
    expect(selected.tag_name).toBe('v0.1.0-preview.10')
  })

  test('stable 只接受非预发布的 latest Release', async () => {
    const selected = await distribution.resolveLatestRelease(
      'stable',
      (async input => {
        expect(String(input)).toEndWith('/releases/latest')
        return Response.json({
          tag_name: 'v0.1.0',
          draft: false,
          prerelease: false,
          assets: [],
        })
      }) as typeof fetch,
      'https://api.test',
    )
    expect(selected.tag_name).toBe('v0.1.0')
  })

  test('GitHub 404 与 403 返回明确错误', async () => {
    for (const status of [404, 403]) {
      await expect(
        distribution.resolveLatestRelease(
          'preview',
          (async () => new Response('失败', { status })) as typeof fetch,
          'https://api.test',
        ),
      ).rejects.toThrow(status === 403 ? '访问频率限制' : 'HTTP 404')
    }
  })

  test('平台映射包含 macOS、Linux ARM 和无 AVX2 baseline', async () => {
    expect(await distribution.selectAssetName('darwin', 'arm64')).toBe('violet-darwin-arm64.zip')
    expect(await distribution.selectAssetName('darwin', 'x64')).toBe('violet-darwin-x64.zip')
    expect(await distribution.selectAssetName('linux', 'arm64')).toBe('violet-linux-arm64.tar.gz')
    expect(await distribution.selectAssetName('linux', 'x64', false)).toBe('violet-linux-x64-baseline.tar.gz')
    expect(await distribution.selectAssetName('win32', 'x64')).toBe('violet-windows-x64.zip')
  })
})

describe.skipIf(process.platform === 'win32')('二进制原子更新', () => {
  test('--check 只查询版本，不下载资产', async () => {
    let requests = 0
    const release = {
      tag_name: 'v0.1.0-preview.2',
      draft: false,
      prerelease: true,
      assets: [],
    }
    await distribution.runBinaryUpdate(
      { check: true, channel: 'preview' },
      {
        bundled: true,
        apiUrl: 'https://api.test',
        fetcher: (async input => {
          requests++
          expect(String(input)).toContain('/releases?')
          return Response.json([release])
        }) as typeof fetch,
      },
    )
    expect(requests).toBe(1)
  })

  test('校验并替换当前二进制', async () => {
    const directory = await temporaryDirectory('violet-update-success-')
    const assetName = 'violet-linux-x64.tar.gz'
    const archive = await makeArchive(directory, assetName, '0.1.0-preview.2')
    const checksum = createHash('sha256').update(archive).digest('hex')
    const current = join(directory, 'violet')
    await writeFile(current, "#!/usr/bin/env bash\necho 'v0.1.0-preview.1 (VioletCode)'\n", 'utf8')
    await chmod(current, 0o755)
    const release = {
      tag_name: 'v0.1.0-preview.2',
      draft: false,
      prerelease: true,
      assets: [
        { name: assetName, browser_download_url: `https://download.test/${assetName}` },
        { name: 'SHA256SUMS', browser_download_url: 'https://download.test/SHA256SUMS' },
      ],
    }
    const previousConfig = process.env.VIOLET_CONFIG_DIR
    process.env.VIOLET_CONFIG_DIR = join(directory, 'config')
    try {
      await distribution.runBinaryUpdate(
        { channel: 'preview' },
        {
          bundled: true,
          executablePath: current,
          assetName,
          apiUrl: 'https://api.test',
          fetcher: releaseFetcher(release, {
            [assetName]: archive,
            SHA256SUMS: `${checksum}  ${assetName}\n`,
          }),
        },
      )
    } finally {
      if (previousConfig === undefined) delete process.env.VIOLET_CONFIG_DIR
      else process.env.VIOLET_CONFIG_DIR = previousConfig
    }
    const version = Bun.spawnSync([current, '--version'])
    expect(version.exitCode).toBe(0)
    expect(version.stdout.toString().trim()).toBe('v0.1.0-preview.2 (VioletCode)')
  })

  test('哈希不一致时保留旧二进制', async () => {
    const directory = await temporaryDirectory('violet-update-checksum-')
    const assetName = 'violet-linux-x64.tar.gz'
    const archive = await makeArchive(directory, assetName, '0.1.0-preview.2')
    const current = join(directory, 'violet')
    const original = "#!/usr/bin/env bash\necho 'v0.1.0-preview.1 (VioletCode)'\n"
    await writeFile(current, original, 'utf8')
    await chmod(current, 0o755)
    const release = {
      tag_name: 'v0.1.0-preview.2',
      draft: false,
      prerelease: true,
      assets: [
        { name: assetName, browser_download_url: `https://download.test/${assetName}` },
        { name: 'SHA256SUMS', browser_download_url: 'https://download.test/SHA256SUMS' },
      ],
    }
    await expect(
      distribution.runBinaryUpdate(
        { channel: 'preview' },
        {
          bundled: true,
          executablePath: current,
          assetName,
          apiUrl: 'https://api.test',
          fetcher: releaseFetcher(release, {
            [assetName]: archive,
            SHA256SUMS: `${'0'.repeat(64)}  ${assetName}\n`,
          }),
        },
      ),
    ).rejects.toThrow('SHA-256 校验失败')
    expect(await readFile(current, 'utf8')).toBe(original)
  })

  test('候选二进制版本验证失败时保留旧二进制', async () => {
    const directory = await temporaryDirectory('violet-update-version-')
    const assetName = 'violet-linux-x64.tar.gz'
    const archive = await makeArchive(directory, assetName, '0.1.0-preview.99')
    const checksum = createHash('sha256').update(archive).digest('hex')
    const current = join(directory, 'violet')
    const original = "#!/usr/bin/env bash\necho 'v0.1.0-preview.1 (VioletCode)'\n"
    await writeFile(current, original, 'utf8')
    await chmod(current, 0o755)
    const release = {
      tag_name: 'v0.1.0-preview.2',
      draft: false,
      prerelease: true,
      assets: [
        { name: assetName, browser_download_url: `https://download.test/${assetName}` },
        { name: 'SHA256SUMS', browser_download_url: 'https://download.test/SHA256SUMS' },
      ],
    }
    await expect(
      distribution.runBinaryUpdate(
        { channel: 'preview' },
        {
          bundled: true,
          executablePath: current,
          assetName,
          apiUrl: 'https://api.test',
          fetcher: releaseFetcher(release, {
            [assetName]: archive,
            SHA256SUMS: `${checksum}  ${assetName}\n`,
          }),
        },
      ),
    ).rejects.toThrow('新二进制版本验证失败')
    expect(await readFile(current, 'utf8')).toBe(original)
  })

  test('已有更新锁时拒绝替换并保留旧二进制', async () => {
    const directory = await temporaryDirectory('violet-update-lock-')
    const assetName = 'violet-linux-x64.tar.gz'
    const archive = await makeArchive(directory, assetName, '0.1.0-preview.2')
    const checksum = createHash('sha256').update(archive).digest('hex')
    const current = join(directory, 'violet')
    const original = "#!/usr/bin/env bash\necho 'v0.1.0-preview.1 (VioletCode)'\n"
    await writeFile(current, original, 'utf8')
    await chmod(current, 0o755)
    const configDirectory = join(directory, 'config')
    await mkdir(configDirectory)
    await writeFile(join(configDirectory, 'update.lock'), `${process.pid}\n`, 'utf8')
    const previousConfig = process.env.VIOLET_CONFIG_DIR
    process.env.VIOLET_CONFIG_DIR = configDirectory
    const release = {
      tag_name: 'v0.1.0-preview.2',
      draft: false,
      prerelease: true,
      assets: [
        { name: assetName, browser_download_url: `https://download.test/${assetName}` },
        { name: 'SHA256SUMS', browser_download_url: 'https://download.test/SHA256SUMS' },
      ],
    }
    try {
      await expect(
        distribution.runBinaryUpdate(
          { channel: 'preview' },
          {
            bundled: true,
            executablePath: current,
            assetName,
            apiUrl: 'https://api.test',
            fetcher: releaseFetcher(release, {
              [assetName]: archive,
              SHA256SUMS: `${checksum}  ${assetName}\n`,
            }),
          },
        ),
      ).rejects.toThrow('另一个 VioletCode 更新进程仍在运行')
    } finally {
      if (previousConfig === undefined) delete process.env.VIOLET_CONFIG_DIR
      else process.env.VIOLET_CONFIG_DIR = previousConfig
    }
    expect(await readFile(current, 'utf8')).toBe(original)
  })

  test('下载中断后清理临时目录并保留旧二进制', async () => {
    const directory = await temporaryDirectory('violet-update-interrupt-')
    const assetName = 'violet-linux-x64.tar.gz'
    const current = join(directory, 'violet')
    const original = "#!/usr/bin/env bash\necho 'v0.1.0-preview.1 (VioletCode)'\n"
    await writeFile(current, original, 'utf8')
    await chmod(current, 0o755)
    const release = {
      tag_name: 'v0.1.0-preview.2',
      draft: false,
      prerelease: true,
      assets: [
        { name: assetName, browser_download_url: `https://download.test/${assetName}` },
        { name: 'SHA256SUMS', browser_download_url: 'https://download.test/SHA256SUMS' },
      ],
    }
    const fetcher = (async input => {
      const url = String(input)
      if (url.includes('/releases?')) return Response.json([release])
      if (url.endsWith(assetName)) throw new DOMException('下载中断', 'AbortError')
      return new Response(`${'0'.repeat(64)}  ${assetName}\n`)
    }) as typeof fetch
    await expect(
      distribution.runBinaryUpdate(
        { channel: 'preview' },
        { bundled: true, executablePath: current, assetName, apiUrl: 'https://api.test', fetcher },
      ),
    ).rejects.toThrow('下载中断')
    expect(await readFile(current, 'utf8')).toBe(original)
    expect((await readdir(directory)).some(name => name.startsWith('.violet-update-'))).toBe(false)
  })
})

describe.skipIf(process.platform === 'win32')('Shell 安装器', () => {
  test('从 preview 频道下载、校验并安装到指定目录', async () => {
    const directory = await temporaryDirectory('violet-installer-')
    const binDirectory = join(directory, 'bin')
    await mkdir(binDirectory)
    const mirror = await prepareInstallerMirror(directory)

    const child = Bun.spawn(['bash', 'install.sh', '--channel', 'preview', '--bin-dir', binDirectory], {
      cwd: join(import.meta.dir, '..'),
      env: {
        ...process.env,
        HOME: directory,
        VIOLET_GITHUB_API_BASE: mirror.apiBase,
        VIOLET_GITHUB_DOWNLOAD_BASE: mirror.downloadBase,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(exitCode).toBe(0)
    expect(stderr).toBe('')
    expect(stdout).toContain('已安装')
    const installed = Bun.spawnSync([join(binDirectory, 'violet'), '--version'])
    expect(installed.stdout.toString().trim()).toBe('v0.1.0-preview.1 (VioletCode)')
  })

  test('拒绝覆盖安装目录中的普通用户文件', async () => {
    const directory = await temporaryDirectory('violet-installer-conflict-')
    const binDirectory = join(directory, 'bin')
    await mkdir(binDirectory)
    const target = join(binDirectory, 'violet')
    const original = '用户自己的文件\n'
    await writeFile(target, original, 'utf8')
    await chmod(target, 0o755)
    const mirror = await prepareInstallerMirror(directory)
    const child = Bun.spawn(['bash', 'install.sh', '--channel', 'preview', '--bin-dir', binDirectory], {
      cwd: join(import.meta.dir, '..'),
      env: {
        ...process.env,
        HOME: directory,
        VIOLET_GITHUB_API_BASE: mirror.apiBase,
        VIOLET_GITHUB_DOWNLOAD_BASE: mirror.downloadBase,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stderr, exitCode] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(exitCode).toBe(1)
    expect(stderr).toContain('不是 VioletCode，拒绝覆盖')
    expect(await readFile(target, 'utf8')).toBe(original)
  })
})

function createWindowsZip(exePath: string, archivePath: string): void {
  const systemTar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  const tarBin = existsSync(systemTar) ? systemTar : 'tar'
  const result = Bun.spawnSync(
    [tarBin, '-a', '-c', '-f', archivePath, '-C', dirname(exePath), basename(exePath)],
    { stdout: 'inherit', stderr: 'inherit' },
  )
  if (result.exitCode !== 0) throw new Error('创建测试 zip 失败。')
}

describe.skipIf(process.platform !== 'win32')('Windows 二进制更新', () => {
  async function compileVersionExe(directory: string, version: string): Promise<string> {
    const src = join(directory, `src-${version}.ts`)
    await writeFile(
      src,
      `if (process.argv[2] === '--version') console.log('v${version} (VioletCode)')`,
      'utf8',
    )
    const out = join(directory, `violet-${version}.exe`)
    const build = await Bun.build({
      entrypoints: [src],
      compile: { target: 'bun-windows-x64', outfile: out },
    })
    expect(build.success).toBe(true)
    return out
  }

  test('校验并替换当前 exe', async () => {
    const directory = await temporaryDirectory('violet-win-update-')
    const current = join(directory, 'violet.exe')
    await rename(await compileVersionExe(directory, '0.1.0-preview.1'), current)

    const payload = join(directory, 'payload')
    await mkdir(payload, { recursive: true })
    await rename(await compileVersionExe(directory, '0.1.0-preview.2'), join(payload, 'violet.exe'))

    const archive = join(directory, 'violet-windows-x64.zip')
    createWindowsZip(join(payload, 'violet.exe'), archive)
    const archiveBytes = await readFile(archive)
    const checksum = createHash('sha256').update(archiveBytes).digest('hex')

    const release = {
      tag_name: 'v0.1.0-preview.2',
      draft: false,
      prerelease: true,
      assets: [
        { name: 'violet-windows-x64.zip', browser_download_url: 'https://download.test/violet-windows-x64.zip' },
        { name: 'SHA256SUMS', browser_download_url: 'https://download.test/SHA256SUMS' },
      ],
    }
    const previousConfig = process.env.VIOLET_CONFIG_DIR
    process.env.VIOLET_CONFIG_DIR = join(directory, 'config')
    try {
      await distribution.runBinaryUpdate(
        { channel: 'preview' },
        {
          bundled: true,
          executablePath: current,
          assetName: 'violet-windows-x64.zip',
          apiUrl: 'https://api.test',
          fetcher: releaseFetcher(release, {
            'violet-windows-x64.zip': archiveBytes,
            SHA256SUMS: `${checksum}  violet-windows-x64.zip\n`,
          }),
        },
      )
    } finally {
      if (previousConfig === undefined) delete process.env.VIOLET_CONFIG_DIR
      else process.env.VIOLET_CONFIG_DIR = previousConfig
    }
    const version = Bun.spawnSync([current, '--version'])
    expect(version.exitCode).toBe(0)
    expect(version.stdout.toString().trim()).toBe('v0.1.0-preview.2 (VioletCode)')
  }, 120000)
})

describe.skipIf(process.platform !== 'win32')('PowerShell 安装器', () => {
  async function prepareWindowsMirror(directory: string): Promise<{ apiBase: string; downloadBase: string }> {
    const assetName = 'violet-windows-x64.zip'
    const src = join(directory, 'version.ts')
    await writeFile(
      src,
      "if (process.argv[2] === '--version') console.log('v0.1.0-preview.1 (VioletCode)')",
      'utf8',
    )
    const payload = join(directory, 'payload')
    await mkdir(payload, { recursive: true })
    const exe = join(payload, 'violet.exe')
    const build = await Bun.build({ entrypoints: [src], compile: { target: 'bun-windows-x64', outfile: exe } })
    expect(build.success).toBe(true)
    const archive = join(directory, assetName)
    createWindowsZip(exe, archive)
    const archiveBytes = await readFile(archive)
    const checksum = createHash('sha256').update(archiveBytes).digest('hex')
    const tag = 'v0.1.0-preview.1'
    const mirror = join(directory, 'mirror')
    const apiDir = join(mirror, 'api')
    const dlDir = join(mirror, 'downloads', tag)
    await mkdir(apiDir, { recursive: true })
    await mkdir(dlDir, { recursive: true })
    await writeFile(
      join(apiDir, 'releases'),
      JSON.stringify([{ tag_name: tag, draft: false, prerelease: true, assets: [] }]),
      'utf8',
    )
    await Bun.write(join(dlDir, assetName), archiveBytes)
    await writeFile(join(dlDir, 'SHA256SUMS'), `${checksum}  ${assetName}\n`, 'utf8')
    return mirror
  }

  function serveMirror(mirrorDir: string): { apiBase: string; downloadBase: string; stop: () => void } {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        const filePath = join(mirrorDir, ...url.pathname.split('/').filter(Boolean))
        const file = Bun.file(filePath)
        if (!file.exists()) return new Response('not found', { status: 404 })
        // GitHub API 返回 application/json；PS 5.1 的 IWR 据 content-type 决定 .Content 是字符串还是字节，
        // 必须显式声明，否则 ConvertFrom-Json 会把字节逐个当 JSON 数字解析。
        const headers = url.pathname.startsWith('/api/') ? { 'content-type': 'application/json' } : {}
        return new Response(file, { headers })
      },
    })
    const base = `http://localhost:${server.port}`
    return { apiBase: `${base}/api`, downloadBase: `${base}/downloads`, stop: () => server.stop() }
  }

  test('从 preview 频道下载、校验并安装到指定目录', async () => {
    const directory = await temporaryDirectory('violet-ps1-')
    const binDir = join(directory, 'bin')
    const mirrorDir = await prepareWindowsMirror(directory)
    const server = serveMirror(mirrorDir)
    try {
      const child = Bun.spawn(
        [
          'powershell.exe',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          join(import.meta.dir, '..', 'install.ps1'),
          '-Channel',
          'preview',
          '-BinDir',
          binDir,
        ],
        {
          cwd: join(import.meta.dir, '..'),
          env: {
            ...process.env,
            VIOLET_GITHUB_API_BASE: server.apiBase,
            VIOLET_GITHUB_DOWNLOAD_BASE: server.downloadBase,
            VIOLET_INSTALL_SKIP_PATH: '1',
          },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(exitCode).toBe(0)
      expect(stderr).toBe('')
      expect(stdout).toContain('已安装')
      const installed = Bun.spawnSync([join(binDir, 'violet.exe'), '--version'])
      expect(installed.stdout.toString().trim()).toBe('v0.1.0-preview.1 (VioletCode)')
    } finally {
      server.stop()
    }
  }, 120000)
})
