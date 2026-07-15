import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const maximumTextFileSize = 5 * 1024 * 1024

type Rule = {
  name: string
  pattern: RegExp
}

const contentRules: Rule[] = [
  { name: '私钥', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'GitHub Token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { name: 'OpenAI API Key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Slack Token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: 'AWS Access Key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  {
    name: '疑似硬编码凭据',
    pattern: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password)\s*[:=]\s*['"][^'"\r\n]{20,}['"]/i,
  },
  { name: '本机用户绝对路径', pattern: /\/Users\/(?:luna|violet)\//i },
]

function trackedAndUnignoredFiles(): string[] {
  const result = Bun.spawnSync(
    ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, stdout: 'pipe', stderr: 'pipe' },
  )
  if (result.exitCode !== 0) {
    throw new Error(`无法获取待扫描文件：${result.stderr.toString().trim()}`)
  }
  return result.stdout
    .toString()
    .split('\0')
    .filter(Boolean)
}

function forbiddenPathReason(path: string): string | undefined {
  const segments = path.split('/')
  if (['.agent', '.violet', '.superpowers'].includes(segments[0] ?? '')) {
    return '本地私有目录'
  }

  const name = segments.at(-1) ?? ''
  if (name === '.env' || (name.startsWith('.env.') && !name.endsWith('.example'))) {
    return '环境变量文件'
  }
  if (/^(?:auth|credentials?|secrets?)\.json$/i.test(name)) {
    return '凭据文件'
  }
  if (/\.(?:pem|key|p12|pfx)$/i.test(name)) {
    return '密钥文件'
  }
  return undefined
}

const files = trackedAndUnignoredFiles()
const findings: Array<{ path: string; reason: string }> = []

for (const path of files) {
  const pathReason = forbiddenPathReason(path)
  if (pathReason) {
    findings.push({ path, reason: pathReason })
    continue
  }

  const absolutePath = resolve(root, path)
  // 索引中已删除但尚未提交的文件不应被当作读取失败。
  if (!existsSync(absolutePath)) continue
  let size = 0
  try {
    size = statSync(absolutePath).size
  } catch {
    findings.push({ path, reason: '文件无法读取' })
    continue
  }
  if (size > maximumTextFileSize) continue

  const buffer = readFileSync(absolutePath)
  if (buffer.includes(0)) continue
  const text = buffer.toString('utf8')
  for (const rule of contentRules) {
    if (rule.pattern.test(text)) findings.push({ path, reason: rule.name })
  }
}

if (findings.length > 0) {
  console.error('敏感信息扫描失败；以下文件需要人工确认：')
  for (const finding of findings) console.error(`- ${finding.path}：${finding.reason}`)
  process.exit(1)
}

console.log(`敏感信息扫描通过，共检查 ${files.length} 个受 Git 管理或待纳入文件。`)
