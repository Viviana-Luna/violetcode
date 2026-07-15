import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, normalize, resolve } from 'node:path'
import type { BunPlugin } from 'bun'
import { noTelemetryPlugin } from './no-telemetry-plugin'

const root = resolve(import.meta.dir, '..')
const sourceRoot = join(root, 'src')
const packageJson = await Bun.file(join(root, 'package.json')).json()
const version = String(packageJson.version)

const supportedTargets = new Set([
  'bun-darwin-arm64',
  'bun-darwin-x64',
  'bun-linux-arm64',
  'bun-linux-x64',
  'bun-linux-x64-baseline',
])

function argument(name: string): string | undefined {
  const index = Bun.argv.indexOf(name)
  return index === -1 ? undefined : Bun.argv[index + 1]
}

const target = argument('--target') ?? `bun-${process.platform}-${process.arch}`
if (!supportedTargets.has(target)) {
  throw new Error(`不支持的发布目标：${target}`)
}

const outputDirectory = resolve(argument('--outdir') ?? join(root, 'dist', 'release', version, target))
const stagingDirectory = join(root, 'dist', '.release-staging', target)
const outputPath = join(outputDirectory, 'violet')

const featureImportPattern = /import\s*\{[^}]*\bfeature\b[^}]*\}\s*from\s*['"]bun:bundle['"];?\s*\n?/g
const featureCallPattern = /\bfeature\(\s*['"](\w+)['"][,\s]*\)/gs

const featurePlugin: BunPlugin = {
  name: 'violet-public-features',
  setup(build) {
    build.onLoad({ filter: /\.[cm]?tsx?$/ }, args => {
      if (!normalize(args.path).startsWith(normalize(sourceRoot))) return null
      const source = readFileSync(args.path, 'utf8')
      if (!source.includes('feature(')) return null
      const contents = source
        .replace(featureImportPattern, '')
        .replace(featureCallPattern, 'false')
      return {
        contents,
        loader: args.path.endsWith('x') ? 'tsx' : 'ts',
      }
    })
  },
}

type MissingRelative = {
  importer: string
  stubPath: string
}

const missingBare = new Set<string>()
const missingRelative = new Map<string, MissingRelative[]>()
const namedExports = new Map<string, Set<string>>()

function candidatesFor(path: string): string[] {
  return [
    path,
    `${path}.ts`,
    `${path}.tsx`,
    path.replace(/\.js$/, '.ts'),
    path.replace(/\.js$/, '.tsx'),
    path.replace(/\.jsx$/, '.tsx'),
    join(path, 'index.ts'),
    join(path, 'index.tsx'),
  ]
}

function addNamedExports(key: string, rawNames: string): void {
  if (!rawNames.trim()) return
  const names = namedExports.get(key) ?? new Set<string>()
  for (const rawName of rawNames.split(',')) {
    const name = rawName
      .trim()
      .replace(/^type\s+/, '')
      .split(/\s+as\s+/)[0]
    if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
  }
  namedExports.set(key, names)
}

function registerImport(specifier: string, importer: string, imports: string): void {
  if (specifier.startsWith('node:') || specifier === 'bun' || specifier === 'bun:bundle') return

  if (specifier.startsWith('src/')) {
    const absolute = resolve(root, specifier)
    if (!candidatesFor(absolute).some(existsSync)) {
      missingBare.add(specifier)
      addNamedExports(specifier, imports)
    }
    return
  }

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const absolute = resolve(dirname(importer), specifier)
    if (candidatesFor(absolute).some(existsSync)) return
    const stubPath = absolute.replace(/\.js$/, '.ts')
    const entries = missingRelative.get(specifier) ?? []
    entries.push({ importer: normalize(importer), stubPath })
    missingRelative.set(specifier, entries)
    addNamedExports(stubPath, imports)
    return
  }

  try {
    Bun.resolveSync(specifier, dirname(importer))
  } catch {
    missingBare.add(specifier)
    addNamedExports(specifier, imports)
  }
}

function scanMissingImports(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      scanMissingImports(path)
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue

    const source = readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')

    for (const match of source.matchAll(/import\s+(?:\{([^}]*)\}|([\w$]+))?\s*(?:,\s*\{([^}]*)\})?\s*from\s+['"]([^'"]+)['"]/g)) {
      registerImport(match[4], path, match[1] || match[3] || '')
    }
    for (const match of source.matchAll(/(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      registerImport(match[1], path, '')
    }
  }
}

scanMissingImports(sourceRoot)

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const missingModulePlugin: BunPlugin = {
  name: 'violet-missing-module-guard',
  setup(build) {
    build.onResolve({ filter: /^image-processor-napi$/ }, () => ({
      path: 'image-processor-napi',
      namespace: 'violet-optional-unavailable',
    }))
    build.onLoad({ filter: /.*/, namespace: 'violet-optional-unavailable' }, () => ({
      contents: `throw new Error('当前发布包不包含可选原生图像处理模块。');`,
      loader: 'js',
    }))

    for (const specifier of missingBare) {
      build.onResolve({ filter: new RegExp(`^${escapeRegex(specifier)}$`) }, () => ({
        path: specifier,
        namespace: 'violet-missing-module',
      }))
    }

    for (const [specifier, entries] of missingRelative) {
      build.onResolve({ filter: new RegExp(`^${escapeRegex(specifier)}$`) }, args => {
        const importer = normalize(args.importer)
        const entry = entries.find(candidate => candidate.importer === importer)
        return entry
          ? { path: entry.stubPath, namespace: 'violet-missing-module' }
          : null
      })
    }

    build.onLoad({ filter: /.*/, namespace: 'violet-missing-module' }, args => {
      const exports = [...(namedExports.get(args.path) ?? [])]
        .map(name => `export const ${name} = noop;`)
        .join('\n')
      const marker = JSON.stringify(`violet-missing-module:${args.path}`)
      return {
        contents: `
const noop = () => null;
;(globalThis.__violetMissingModules ??= []).push(${marker});
export default noop;
${exports}
`,
        loader: 'js',
      }
    })
  },
}

const nodeRequire = createRequire(import.meta.url)
const productionModules = new Map<string, string>([
  ['react', join(dirname(nodeRequire.resolve('react/package.json')), 'cjs/react.production.js')],
  ['react/jsx-runtime', join(dirname(nodeRequire.resolve('react/package.json')), 'cjs/react-jsx-runtime.production.js')],
  ['react-reconciler', join(dirname(nodeRequire.resolve('react-reconciler/package.json')), 'cjs/react-reconciler.production.js')],
  ['react-reconciler/constants.js', join(dirname(nodeRequire.resolve('react-reconciler/package.json')), 'cjs/react-reconciler-constants.production.js')],
  ['scheduler', join(dirname(nodeRequire.resolve('scheduler/package.json')), 'cjs/scheduler.production.js')],
])

const productionReactPlugin: BunPlugin = {
  name: 'violet-production-react',
  setup(build) {
    build.onResolve({ filter: /^(react|react\/jsx-runtime|react-reconciler|react-reconciler\/constants\.js|scheduler)$/ }, args => {
      const path = productionModules.get(args.path)
      return path ? { path } : null
    })
    build.onResolve({ filter: /^react\/compiler-runtime$/ }, () => ({
      path: 'react/compiler-runtime',
      namespace: 'violet-react-compiler',
    }))
    build.onLoad({ filter: /.*/, namespace: 'violet-react-compiler' }, () => ({
      contents: `export function c(size) { return new Array(size).fill(Symbol.for('react.memo_cache_sentinel')); }`,
      loader: 'js',
    }))
  },
}

await rm(stagingDirectory, { recursive: true, force: true })
await mkdir(stagingDirectory, { recursive: true })
await mkdir(outputDirectory, { recursive: true })

const bundle = await Bun.build({
  entrypoints: [join(sourceRoot, 'entrypoints', 'cli.tsx')],
  outdir: stagingDirectory,
  target: 'bun',
  format: 'esm',
  conditions: ['bun', 'node'],
  minify: { whitespace: true, syntax: true, identifiers: false },
  sourcemap: 'none',
  naming: 'violet.js',
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env.USER_TYPE': JSON.stringify('external'),
    'process.env.CLAUDE_CODE_VERIFY_PLAN': 'undefined',
    'MACRO.VERSION': JSON.stringify(version),
    'MACRO.BUILD_TIME': JSON.stringify(new Date().toISOString()),
    'MACRO.ISSUES_EXPLAINER': JSON.stringify('请在 VioletCode GitHub 仓库报告问题'),
    'MACRO.FEEDBACK_CHANNEL': JSON.stringify('https://github.com/Viviana-Luna/violetcode/issues'),
    'MACRO.PACKAGE_URL': JSON.stringify('violet-code'),
    'MACRO.NATIVE_PACKAGE_URL': 'undefined',
    'MACRO.VERSION_CHANGELOG': 'undefined',
  },
  plugins: [noTelemetryPlugin, featurePlugin, productionReactPlugin, missingModulePlugin],
})

if (!bundle.success) {
  for (const log of bundle.logs) console.error(log)
  throw new Error('VioletCode 发布 bundle 构建失败。')
}

const bundlePath = join(stagingDirectory, 'violet.js')
const bundleText = await Bun.file(bundlePath).text()
const forbiddenLegacyMarkers = new Map<string, string>([
  [
    'Claude 原生分发地址',
    'storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819',
  ],
  ['旧原生自动更新器', 'tengu_native_auto_updater_start'],
  ['旧 npm 自动更新器', 'tengu_auto_updater_success'],
  ['旧 Claude 安装自检', 'installMethod is native, but claude command'],
])
const legacyFindings = [...forbiddenLegacyMarkers]
  .filter(([, marker]) => bundleText.includes(marker))
  .map(([name]) => name)
if (legacyFindings.length > 0) {
  for (const finding of legacyFindings) console.error(`发布 bundle 仍包含${finding}`)
  throw new Error('旧 Claude 安装或自动更新能力仍可达，拒绝生成发布二进制。')
}

const markers = [...bundleText.matchAll(/violet-missing-module:[^"'\\\s]+/g)].map(match => match[0])
if (markers.length > 0) {
  console.error('发布 bundle 中仍存在缺失模块：')
  for (const marker of [...new Set(markers)].sort()) console.error(`- ${marker}`)
  throw new Error('缺失模块仍可达，拒绝生成发布二进制。')
}

const executable = await Bun.build({
  entrypoints: [bundlePath],
  compile: {
    target: target as any,
    outfile: outputPath,
    autoloadBunfig: false,
    autoloadDotenv: false,
    autoloadTsconfig: false,
    autoloadPackageJson: false,
  },
  minify: false,
})

if (!executable.success) {
  for (const log of executable.logs) console.error(log)
  throw new Error('VioletCode standalone 二进制构建失败。')
}

if (target.startsWith('bun-darwin-')) {
  if (process.platform !== 'darwin') {
    throw new Error('macOS 发布二进制必须在 macOS runner 上完成 ad-hoc 重签。')
  }
  const signing = Bun.spawnSync(['codesign', '--force', '--sign', '-', outputPath], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (signing.exitCode !== 0) {
    throw new Error('macOS 发布二进制 ad-hoc 重签失败。')
  }
}

const artifactText = readFileSync(outputPath).toString('utf8')
const artifactRules: Array<[string, RegExp]> = [
  ['本机用户绝对路径', /\/Users\/(?:luna|violet)\//i],
  ['私钥', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['GitHub Token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/],
  ['OpenAI API Key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ['AWS Access Key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
]
const artifactFindings = artifactRules
  .filter(([, pattern]) => pattern.test(artifactText))
  .map(([name]) => name)
if (artifactFindings.length > 0) {
  for (const finding of artifactFindings) console.error(`发布二进制命中敏感规则：${finding}`)
  throw new Error('发布二进制敏感信息扫描失败。')
}

console.log(`VioletCode ${version} 已构建：${outputPath}`)
