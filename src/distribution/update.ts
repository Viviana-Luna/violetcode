import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { isInBundledMode } from '../utils/bundledMode.js'
import { order } from '../utils/semver.js'

export type UpdateChannel = 'stable' | 'preview'

export type UpdateOptions = {
  check?: boolean
  channel?: string
}

type ReleaseAsset = {
  name: string
  browser_download_url: string
}

type Release = {
  tag_name: string
  draft: boolean
  prerelease: boolean
  assets: ReleaseAsset[]
}

const repository = 'Viviana-Luna/violetcode'
const apiBase = `https://api.github.com/repos/${repository}`

function normalizeVersion(tag: string): string {
  return tag.startsWith('v') ? tag.slice(1) : tag
}

function isVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)
}

function defaultChannel(): UpdateChannel {
  return MACRO.VERSION.includes('-') ? 'preview' : 'stable'
}

async function fetchJson<T>(url: string, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `violet/${MACRO.VERSION}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) {
    const suffix = response.status === 403 ? '，可能已触发 GitHub API 访问频率限制' : ''
    throw new Error(`GitHub Release 请求失败：HTTP ${response.status}${suffix}`)
  }
  return (await response.json()) as T
}

export async function resolveLatestRelease(
  channel: UpdateChannel,
  fetcher: typeof fetch = fetch,
  baseUrl = apiBase,
): Promise<Release> {
  if (channel === 'stable') {
    const release = await fetchJson<Release>(`${baseUrl}/releases/latest`, fetcher)
    if (release.draft || release.prerelease) {
      throw new Error('GitHub latest Release 不是可用的稳定版本。')
    }
    return release
  }

  const releases = await fetchJson<Release[]>(`${baseUrl}/releases?per_page=30`, fetcher)
  const candidates = releases.filter(release => {
    const version = normalizeVersion(release.tag_name)
    return !release.draft && release.prerelease && isVersion(version)
  })
  candidates.sort((left, right) => order(normalizeVersion(right.tag_name), normalizeVersion(left.tag_name)))
  const release = candidates[0]
  if (!release) throw new Error('没有找到可用的 VioletCode 预览版本。')
  return release
}

async function linuxHasAvx2(): Promise<boolean> {
  try {
    return /(^|\s)avx2(\s|$)/m.test(await readFile('/proc/cpuinfo', 'utf8'))
  } catch {
    return false
  }
}

export async function selectAssetName(
  platform = process.platform,
  architecture = process.arch,
  hasAvx2?: boolean,
): Promise<string> {
  if (platform === 'darwin' && architecture === 'arm64') return 'violet-darwin-arm64.zip'
  if (platform === 'darwin' && architecture === 'x64') return 'violet-darwin-x64.zip'
  if (platform === 'linux' && architecture === 'arm64') return 'violet-linux-arm64.tar.gz'
  if (platform === 'linux' && architecture === 'x64') {
    const avx2 = hasAvx2 ?? (await linuxHasAvx2())
    return avx2 ? 'violet-linux-x64.tar.gz' : 'violet-linux-x64-baseline.tar.gz'
  }
  throw new Error(`当前平台没有 VioletCode 发布包：${platform}/${architecture}`)
}

async function download(url: string, destination: string, fetcher: typeof fetch): Promise<void> {
  const response = await fetcher(url, {
    headers: { 'User-Agent': `violet/${MACRO.VERSION}` },
    redirect: 'follow',
  })
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`)
  await Bun.write(destination, await response.arrayBuffer())
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  hash.update(await readFile(path))
  return hash.digest('hex')
}

function expectedChecksum(contents: string, assetName: string): string {
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/)
    if (match?.[2] === assetName) return match[1].toLowerCase()
  }
  throw new Error(`SHA256SUMS 中没有 ${assetName}。`)
}

async function extractArchive(archive: string, directory: string): Promise<string> {
  const command = archive.endsWith('.zip')
    ? ['unzip', '-q', archive, '-d', directory]
    : ['tar', '-xzf', archive, '-C', directory]
  const extraction = Bun.spawnSync(command, { stdout: 'inherit', stderr: 'inherit' })
  if (extraction.exitCode !== 0) throw new Error('发布包解压失败。')
  const executable = join(directory, 'violet')
  await chmod(executable, 0o755)
  return executable
}

async function verifyExecutable(path: string, version: string): Promise<void> {
  const child = Bun.spawnSync([path, '--version'], { stdout: 'pipe', stderr: 'pipe' })
  const stdout = child.stdout.toString().trim()
  if (child.exitCode !== 0 || stdout !== `v${version} (VioletCode)`) {
    throw new Error(`新二进制版本验证失败：${stdout || child.stderr.toString().trim() || '无输出'}`)
  }
}

async function processExists(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function acquireLock(path: string): Promise<Awaited<ReturnType<typeof open>>> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, 'wx', 0o600)
      await writeFile(handle, `${process.pid}\n`, 'utf8')
      return handle
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const pid = Number.parseInt((await readFile(path, 'utf8').catch(() => '')).trim(), 10)
      if (Number.isSafeInteger(pid) && pid > 0 && (await processExists(pid))) {
        throw new Error(`另一个 VioletCode 更新进程仍在运行（PID ${pid}）。`)
      }
      await unlink(path).catch(() => undefined)
    }
  }
  throw new Error('无法取得 VioletCode 更新锁。')
}

export async function runBinaryUpdate(
  options: UpdateOptions,
  dependencies: {
    fetcher?: typeof fetch
    apiUrl?: string
    assetName?: string
    executablePath?: string
    bundled?: boolean
  } = {},
): Promise<void> {
  if (!(dependencies.bundled ?? isInBundledMode())) {
    throw new Error('当前是源码开发版，请通过仓库根目录的 ./violet update 更新。')
  }

  const requestedChannel = options.channel ?? defaultChannel()
  if (requestedChannel !== 'stable' && requestedChannel !== 'preview') {
    throw new Error(`不支持的更新频道：${requestedChannel}`)
  }
  const channel: UpdateChannel = requestedChannel

  const fetcher = dependencies.fetcher ?? fetch
  const release = await resolveLatestRelease(channel, fetcher, dependencies.apiUrl ?? apiBase)
  const latestVersion = normalizeVersion(release.tag_name)
  if (!isVersion(latestVersion)) throw new Error(`Release 标签不是有效版本：${release.tag_name}`)

  const comparison = order(latestVersion, MACRO.VERSION)
  if (comparison <= 0) {
    process.stdout.write(`VioletCode 已是当前频道最新版本：v${MACRO.VERSION}\n`)
    return
  }
  process.stdout.write(`发现新版本：v${MACRO.VERSION} → v${latestVersion}\n`)
  if (options.check) return

  const assetName = dependencies.assetName ?? (await selectAssetName())
  const asset = release.assets.find(candidate => candidate.name === assetName)
  const checksums = release.assets.find(candidate => candidate.name === 'SHA256SUMS')
  if (!asset || !checksums) throw new Error(`Release 缺少 ${assetName} 或 SHA256SUMS。`)

  const executablePath = dependencies.executablePath
    ? await realpath(dependencies.executablePath)
    : await realpath(process.execPath)
  if (basename(executablePath).toLowerCase().startsWith('bun')) {
    throw new Error('无法确认当前 VioletCode 二进制路径，已取消更新。')
  }

  const installationDirectory = dirname(executablePath)
  const temporaryDirectory = await mkdtemp(join(installationDirectory, '.violet-update-'))
  const lockPath = join(process.env.VIOLET_CONFIG_DIR ?? join(homedir(), '.violet'), 'update.lock')
  let lock: Awaited<ReturnType<typeof open>> | undefined

  try {
    const archivePath = join(temporaryDirectory, assetName)
    const checksumPath = join(temporaryDirectory, 'SHA256SUMS')
    await Promise.all([
      download(asset.browser_download_url, archivePath, fetcher),
      download(checksums.browser_download_url, checksumPath, fetcher),
    ])
    const expected = expectedChecksum(await readFile(checksumPath, 'utf8'), assetName)
    const actual = await sha256(archivePath)
    if (expected !== actual) throw new Error(`SHA-256 校验失败：${assetName}`)

    const extractedDirectory = join(temporaryDirectory, 'extracted')
    await mkdir(extractedDirectory)
    const candidate = await extractArchive(archivePath, extractedDirectory)
    await verifyExecutable(candidate, latestVersion)

    lock = await acquireLock(lockPath)
    const replacement = join(installationDirectory, `.violet-new-${process.pid}`)
    await rename(candidate, replacement)
    await chmod(replacement, 0o755)
    await rename(replacement, executablePath)
    process.stdout.write(`VioletCode 已更新到 v${latestVersion}。\n`)
  } finally {
    await lock?.close().catch(() => undefined)
    if (lock) await unlink(lockPath).catch(() => undefined)
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}
