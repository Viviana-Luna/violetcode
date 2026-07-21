import { describe, expect, test } from 'bun:test'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { stringWidth } from '../src/ink/stringWidth.js'
import {
  getDefaultCharacters,
  getSpinnerFrames,
} from '../src/components/Spinner/utils.js'

const root = join(import.meta.dir, '..')

async function source(path: string): Promise<string> {
  return readFile(join(root, path), 'utf8')
}

describe('VioletCode 品牌边界', () => {
  test('状态动画使用单宽紫罗兰花形帧并提供静态无动画状态', async () => {
    const frames = getDefaultCharacters()
    const [glyph, row, spinner] = await Promise.all([
      source('src/components/Spinner/SpinnerGlyph.tsx'),
      source('src/components/Spinner/SpinnerAnimationRow.tsx'),
      source('src/components/Spinner.tsx'),
    ])

    expect(frames).toEqual(['·', '✢', '✣', '✤', '✥'])
    expect(getSpinnerFrames()).toEqual([
      '·',
      '✢',
      '✣',
      '✤',
      '✥',
      '✤',
      '✣',
      '✢',
    ])
    expect(frames.every(frame => stringWidth(frame) === 1)).toBe(true)
    expect(glyph).toContain("const REDUCED_MOTION_GLYPH = '✥'")
    expect(glyph).toContain('<Text color="brand">')
    expect(glyph).not.toContain('ERROR_RED')
    expect(row).not.toContain('stalledIntensity={overrideColor')
    expect(spinner).toContain('<Text color="brand">✥</Text>')
  })

  test('主状态文案按真实模式映射，默认动词为少量中文过程文案', async () => {
    const { getSpinnerModeText } = await import(
      '../src/components/Spinner/utils.js'
    )
    expect(getSpinnerModeText('requesting')).toBe('请求连接')
    expect(getSpinnerModeText('thinking')).toBe('模型思考')
    expect(getSpinnerModeText('responding')).toBe('生成回复')
    expect(getSpinnerModeText('tool-input')).toBe('准备工具')
    expect(getSpinnerModeText('tool-use')).toBe('执行工具')

    const { SPINNER_VERBS } = await import('../src/constants/spinnerVerbs.js')
    expect(SPINNER_VERBS.length).toBeLessThanOrEqual(20)
    for (const verb of SPINNER_VERBS) {
      expect(verb).toMatch(/^[\u4e00-\u9fff]+$/)
    }
    expect(SPINNER_VERBS).not.toContain('Clauding')

    const verbsSource = await source('src/constants/spinnerVerbs.ts')
    expect(verbsSource).not.toContain('Clauding')
  })

  test('无新 Token 15 秒后才进入低权重等待态，不使用错误红', async () => {
    const stalled = await source(
      'src/components/Spinner/useStalledAnimation.ts',
    )
    const row = await source('src/components/Spinner/SpinnerAnimationRow.tsx')

    expect(stalled).toContain('STALL_THRESHOLD_MS = 15_000')
    expect(stalled).not.toMatch(/timeSinceLastToken > 3000/)
    expect(row).toContain('仍在等待')
    expect(row).not.toContain('isStalled ? -100')
  })

  test('产品源码与公开文档不再使用旧产品名称', async () => {
    const files = [
      'src/constants/prompts.ts',
      'src/constants/system.ts',
      'src/components/LogoV2/LogoV2.tsx',
      'src/components/LogoV2/WelcomeV2.tsx',
      'docs/brand/README.md',
    ]
    const contents = await Promise.all(files.map(source))

    for (const content of contents) {
      expect(content).not.toContain('Claude Code')
      expect(content).not.toContain('Clawd')
    }
  })

  test('品牌资产包含矢量源和常用小尺寸导出', async () => {
    const files = [
      'assets/brand/violetcode-icon.svg',
      'assets/brand/violetcode-mark-mono.svg',
      'assets/brand/png/violetcode-icon-16.png',
      'assets/brand/png/violetcode-icon-32.png',
      'assets/brand/png/violetcode-icon-512.png',
      'assets/brand/png/violetcode-icon-1024.png',
    ]

    for (const file of files) {
      expect((await stat(join(root, file))).size).toBeGreaterThan(0)
    }
  })

  test('终端欢迎页使用字标与 Provider 概览，不再渲染字符花', async () => {
    const [fullLogo, condensedLogo, firstRunWelcome, overview] = await Promise.all([
      source('src/components/LogoV2/LogoV2.tsx'),
      source('src/components/LogoV2/CondensedLogo.tsx'),
      source('src/components/LogoV2/WelcomeV2.tsx'),
      source('src/components/LogoV2/ProviderOverview.tsx'),
    ])

    expect(fullLogo).toContain('violet code')
    expect(condensedLogo).toContain('violet code')
    expect(firstRunWelcome).toContain('violet code')
    expect(fullLogo).not.toContain('AnimatedVioletMark')
    expect(condensedLogo).not.toContain('VioletMark')
    expect(firstRunWelcome).not.toContain('████')
    expect(overview).toContain("row(\n          'BALANCE'")
    expect(overview).not.toContain("'QUOTA'")
    expect(overview).toContain('Agent Plan')
  })

  test('项目说明入口统一使用 AGENTS.md', async () => {
    const [loader, onboarding, initCommand] = await Promise.all([
      source('src/utils/claudemd.ts'),
      source('src/projectOnboardingState.ts'),
      source('src/commands/init.ts'),
    ])

    expect(loader).toContain("'AGENTS.md'")
    expect(loader).toContain("'AGENTS.local.md'")
    expect(onboarding).toContain("join(getCwd(), 'AGENTS.md')")
    expect(initCommand).toContain('创建或完善根目录的 AGENTS.md')
  })
})

describe('默认隐私行为', () => {
  test('启动链路不初始化上游预连接或第一方分析服务', async () => {
    const [init, main, interactive, housekeeping] = await Promise.all([
      source('src/entrypoints/init.ts'),
      source('src/main.tsx'),
      source('src/interactiveHelpers.tsx'),
      source('src/utils/backgroundHousekeeping.ts'),
    ])

    expect(init).not.toContain('preconnectAnthropicApi')
    expect(init).not.toContain('initializeFirstPartyEventLogger')
    expect(main).not.toContain('fetchClaudeAIMcpConfigsIfEligible')
    expect(main).not.toContain('assertMinVersion')
    expect(main).not.toContain('void loadRemoteManagedSettings()')
    expect(main).not.toContain('void loadPolicyLimits()')
    expect(main).not.toContain('uploadUserSettingsInBackground')
    expect(main).not.toContain('initializeTelemetryAfterTrust')
    expect(main).not.toContain('startKeychainPrefetch')
    expect(main).not.toContain('refreshRemoteManagedSettings')
    expect(main).not.toContain('refreshGrowthBookAfterAuthChange')
    expect(main).not.toContain("process.on('SIGINT'")
    expect(interactive).not.toContain('ApproveApiKey')
    expect(interactive).not.toContain('ANTHROPIC_API_KEY')
    expect(housekeeping).not.toContain(
      'autoUpdateMarketplacesAndPluginsInBackground',
    )
  })

  test('退出编排先排空活动查询，并按运行时选择安全退出路径', async () => {
    const shutdown = await source('src/utils/gracefulShutdown.ts')
    const gracefulStart = shutdown.indexOf(
      'export async function gracefulShutdown',
    )
    const gracefulBody = shutdown.slice(gracefulStart)
    const drainIndex = gracefulBody.indexOf(
      'await drainActiveQueries(2000)',
    )
    const terminalCleanupIndex = gracefulBody.indexOf(
      'cleanupTerminalModes()',
      drainIndex,
    )
    expect(drainIndex).toBeGreaterThan(-1)
    expect(terminalCleanupIndex).toBeGreaterThan(drainIndex)
    expect(shutdown).toContain('inst.unmount()')
    expect(shutdown).toContain(
      'inst.detachForShutdown({ restoreStdin: false })',
    )
    expect(shutdown).toContain("spawnSync('/bin/stty', ['sane']")
    expect(shutdown).toContain('libc.symbols._exit(exitCode)')
    expect(shutdown).toContain('./violet --resume')
    expect(shutdown).not.toContain('claude --resume')
  })

  test('分析与反馈调查保持默认关闭', async () => {
    const analytics = await source('src/services/analytics/config.ts')
    expect(analytics).toContain('export function isAnalyticsDisabled(): boolean')
    expect(analytics).toContain('export function isFeedbackSurveyDisabled(): boolean')
    expect(analytics.match(/return true/g)?.length).toBeGreaterThanOrEqual(2)
  })

  test('提交与 PR 不会默认附加归属文本', async () => {
    const [attribution, system] = await Promise.all([
      source('src/utils/attribution.ts'),
      source('src/constants/system.ts'),
    ])
    expect(attribution).toContain("commit: settings.attribution?.commit ?? ''")
    expect(attribution).toContain("pr: settings.attribution?.pr ?? ''")
    expect(system).toContain('export function getAttributionHeader(_fingerprint: string)')
    expect(system).not.toContain('x-anthropic-billing-header')
    expect(system).not.toContain('NATIVE_CLIENT_ATTESTATION')
  })

  test('主命令入口不注册上游商业功能', async () => {
    const commands = await source('src/commands.ts')
    for (const moduleName of [
      './commands/chrome/index.js',
      './commands/desktop/index.js',
      './commands/mobile/index.js',
      './commands/install-github-app/index.js',
      './commands/install-slack-app/index.js',
      './commands/privacy-settings/index.js',
      './commands/remote-env/index.js',
      './commands/remote-setup/index.js',
      './commands/bridge/index.js',
      './commands/remoteControlServer/index.js',
    ]) {
      expect(commands).not.toContain(moduleName)
    }
  })

  test('MCP 客户端使用 VioletCode 身份且不发布上游产品链接', async () => {
    const client = await source('src/services/mcp/client.ts')
    expect(client).toContain("name: 'violetcode'")
    expect(client).toContain("description: 'VioletCode 智能编程工具'")
    expect(client).not.toContain("name: 'claude-code'")
    expect(client).not.toContain("Anthropic's agentic coding tool")
    expect(client).not.toContain('websiteUrl: PRODUCT_URL')
  })
})
