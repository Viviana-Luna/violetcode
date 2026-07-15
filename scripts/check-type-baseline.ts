import { resolve } from 'node:path'
import ts from 'typescript'

type TypeBaseline = {
  schemaVersion: 1
  typescriptVersion: string
  totalDiagnostics: number
  byFile: Record<string, number>
  note: string
}

const root = resolve(import.meta.dir, '..')
const baselinePath = resolve(root, 'config/typecheck-baseline.json')
const tscPath = resolve(root, 'node_modules/typescript/bin/tsc')

const child = Bun.spawn([process.execPath, tscPath, '--noEmit', '--pretty', 'false'], {
  cwd: root,
  stdout: 'pipe',
  stderr: 'pipe',
})

const [stdout, stderr, exitCode] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
])

const output = `${stdout}\n${stderr}`
const diagnosticPattern = /^(.+?)\(\d+,\d+\): error TS(\d+):/gm
const byFile: Record<string, number> = {}
let totalDiagnostics = 0

for (const match of output.matchAll(diagnosticPattern)) {
  const file = match[1]!.replaceAll('\\', '/')
  byFile[file] = (byFile[file] ?? 0) + 1
  totalDiagnostics += 1
}

const snapshot: TypeBaseline = {
  schemaVersion: 1,
  typescriptVersion: ts.version,
  totalDiagnostics,
  byFile: Object.fromEntries(Object.entries(byFile).sort(([a], [b]) => a.localeCompare(b))),
  note: '该快照只记录继承的类型债务；新增文件诊断或任一文件诊断数上升都会使发布门禁失败。',
}

if (Bun.argv.includes('--print-baseline')) {
  console.log(JSON.stringify(snapshot, null, 2))
  process.exit(0)
}

const baseline = (await Bun.file(baselinePath).json()) as TypeBaseline
if (baseline.typescriptVersion !== ts.version) {
  console.error(`TypeScript 版本已变化：当前 ${ts.version}，基线 ${baseline.typescriptVersion}。请人工复核全部诊断后更新基线。`)
  process.exit(1)
}
const regressions = Object.entries(snapshot.byFile)
  .filter(([file, count]) => count > (baseline.byFile[file] ?? 0))
  .map(([file, count]) => ({ file, count, baseline: baseline.byFile[file] ?? 0 }))

if (regressions.length > 0 || totalDiagnostics > baseline.totalDiagnostics) {
  console.error('类型检查发现了基线之外的新诊断：')
  for (const regression of regressions.slice(0, 30)) {
    console.error(`- ${regression.file}: 当前 ${regression.count}，基线 ${regression.baseline}`)
  }
  if (regressions.length > 30) {
    console.error(`- 另有 ${regressions.length - 30} 项未展示`)
  }
  console.error(`诊断总数：当前 ${totalDiagnostics}，基线 ${baseline.totalDiagnostics}`)
  process.exit(1)
}

if (exitCode === 0 && totalDiagnostics === 0) {
  console.log('完整 TypeScript 检查通过，无诊断。')
} else {
  console.log(`类型增量门禁通过：当前继承诊断 ${totalDiagnostics} 项，未超过基线 ${baseline.totalDiagnostics} 项。`)
}
