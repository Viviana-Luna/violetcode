import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getAnthropicClient } from '../src/services/api/client.js'
import {
  DEEPSEEK_BALANCE_URL,
  loadProviderAccountStatus,
  parseDeepSeekBalanceResponse,
} from '../src/services/providerAccountStatus.js'
import {
  CURRENT_PROVIDER_MIGRATION_VERSION,
  identifyKnownProviderBaseUrl,
  mapLegacyProcessProviderEnv,
  migrateProviderConfiguration,
} from '../src/migrations/migrateProviderConfiguration.js'
import {
  getAuthStorePath,
  getProviderCredential,
  readAuthStore,
  setProviderApiKey,
  writeAuthStore,
} from '../src/utils/authStore.js'
import { getGlobalConfig, saveGlobalConfig } from '../src/utils/config.js'
import {
  getModelCapabilities,
  normalizeModelStringForAPI,
} from '../src/utils/model/model.js'
import {
  PROVIDER_DEFINITIONS,
  getProviderModel,
  resolveProviderModelReference,
} from '../src/utils/model/providerDefinitions.js'
import {
  getRememberedProviderModels,
  rememberProviderModel,
} from '../src/utils/model/providerModelStore.js'
import { applyProviderEnv } from '../src/utils/model/providerPresets.js'
import {
  canCompleteProviderSetup,
  getProviderSetupContinuation,
} from '../src/utils/model/providerSetupFlow.js'
import { needsProviderSetup } from '../src/utils/model/providers.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../src/utils/settings/settings.js'
import { resetSettingsCache } from '../src/utils/settings/settingsCache.js'

type CapturedRequest = {
  url: string
  headers: Headers
  body: Record<string, unknown>
}

const ORIGINAL_ENV = {
  VIOLET_CONFIG_DIR: process.env.VIOLET_CONFIG_DIR,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  VOLCENGINE_ARK_API_KEY: process.env.VOLCENGINE_ARK_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
  ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  VIOLET_PROVIDER: process.env.VIOLET_PROVIDER,
}

type LegacyConfigWithEndpoints = ReturnType<typeof getGlobalConfig> & {
  providerEndpoints?: Partial<Record<'deepseek' | 'volcengineArk', string>>
}

let configDir = ''

function restoreEnv(name: keyof typeof ORIGINAL_ENV): void {
  const value = ORIGINAL_ENV[name]
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function createCaptureFetch(captures: CapturedRequest[]): typeof fetch {
  return async (input, init) => {
    captures.push({
      url: input instanceof Request ? input.url : String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    })
    return new Response(
      JSON.stringify({
        id: 'msg_provider_test',
        type: 'message',
        role: 'assistant',
        model: 'provider-test',
        content: [],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
}

beforeEach(() => {
  globalThis.MACRO = {
    VERSION: 'provider-test',
    PACKAGE_URL: '',
    NATIVE_PACKAGE_URL: '',
    FEEDBACK_CHANNEL: '',
    ISSUES_EXPLAINER: '',
    BUILD_TIME: '',
  }
  configDir = mkdtempSync(join(tmpdir(), 'violet-provider-test-'))
  process.env.VIOLET_CONFIG_DIR = configDir
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.VOLCENGINE_ARK_API_KEY
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_AUTH_TOKEN
  delete process.env.ANTHROPIC_BASE_URL
  delete process.env.ANTHROPIC_MODEL
  delete process.env.VIOLET_PROVIDER
  resetSettingsCache()
  saveGlobalConfig(current => ({
    ...current,
    env: {},
    providerMigrationVersion: undefined,
    providerModels: undefined,
    userCustomModelProfiles: undefined,
    userAddedModelOptions: undefined,
    activeProviderProfileId: undefined,
  }))
})

afterEach(() => {
  restoreEnv('VIOLET_CONFIG_DIR')
  restoreEnv('DEEPSEEK_API_KEY')
  restoreEnv('VOLCENGINE_ARK_API_KEY')
  restoreEnv('ANTHROPIC_API_KEY')
  restoreEnv('ANTHROPIC_AUTH_TOKEN')
  restoreEnv('ANTHROPIC_BASE_URL')
  restoreEnv('ANTHROPIC_MODEL')
  restoreEnv('VIOLET_PROVIDER')
  resetSettingsCache()
})

describe('Provider 模型身份', () => {
  test('火山方舟保存任一凭据后继续配置，且模型凭据缺失时不能完成', () => {
    expect(getProviderSetupContinuation('volcengineArk', 'provider')).toBe(
      'capability',
    )
    expect(getProviderSetupContinuation('volcengineArk', 'exa')).toBe(
      'capability',
    )
    expect(canCompleteProviderSetup('volcengineArk', false)).toBe(false)
    expect(canCompleteProviderSetup('volcengineArk', true)).toBe(true)
    expect(getProviderSetupContinuation('deepseek', 'provider')).toBe(
      'complete',
    )
  })

  test('显式模型只要求配置它所属的 Provider', () => {
    expect(needsProviderSetup()).toBe(true)
    expect(needsProviderSetup('volcengineArk')).toBe(true)

    setProviderApiKey('deepseek', 'deepseek-only-test-key')

    expect(needsProviderSetup()).toBe(false)
    expect(needsProviderSetup('deepseek')).toBe(false)
    expect(needsProviderSetup('volcengineArk')).toBe(true)
  })

  test('规范化 provider/model 并从 API 模型中移除前缀', () => {
    expect(resolveProviderModelReference('deepseek/deepseek-v4-pro')).toEqual({
      provider: 'deepseek',
      modelId: 'deepseek-v4-pro',
      value: 'deepseek/deepseek-v4-pro',
    })
    expect(normalizeModelStringForAPI('deepseek/deepseek-v4-pro')).toBe(
      'deepseek-v4-pro',
    )
  })

  test('裸模型只有唯一匹配时才接受，同名模型必须显式指定 Provider', () => {
    const deepseek = PROVIDER_DEFINITIONS[0]!
    const ark = PROVIDER_DEFINITIONS[1]!
    const duplicate = {
      id: 'same-model',
      contextWindow: 1,
      maxOutputTokens: 1,
      defaultMaxOutputTokens: 1,
      capabilities: {
        thinking: false,
        toolUse: false,
        images: false,
        betaHeaders: false,
      },
    }
    deepseek.models.push(duplicate)
    ark.models.push({ ...duplicate })
    try {
      expect(resolveProviderModelReference('same-model')).toBeUndefined()
      expect(resolveProviderModelReference('deepseek/same-model')?.provider).toBe(
        'deepseek',
      )
      expect(
        resolveProviderModelReference('volcengineArk/same-model')?.provider,
      ).toBe('volcengineArk')
    } finally {
      deepseek.models.pop()
      ark.models.pop()
    }
  })

  test('方舟接受带前缀的任意模型并应用保守能力默认值', () => {
    expect(resolveProviderModelReference('custom-ark-model')).toBeUndefined()
    const reference = resolveProviderModelReference(
      'volcengineArk/custom-ark-model',
    )
    expect(reference?.modelId).toBe('custom-ark-model')
    expect(getProviderModel('volcengineArk', 'custom-ark-model')?.model).toMatchObject({
      contextWindow: 200_000,
      maxOutputTokens: 32_000,
      defaultMaxOutputTokens: 32_000,
      capabilities: {
        thinking: false,
        toolUse: true,
        images: false,
        betaHeaders: false,
      },
    })
  })

  test('DeepSeek 模型能力记录官方硬上限和安全默认值', () => {
    const pro = getProviderModel('deepseek', 'deepseek-v4-pro')?.model
    const flash = getProviderModel('deepseek', 'deepseek-v4-flash')?.model
    expect(pro).toMatchObject({
      contextWindow: 1_000_000,
      maxOutputTokens: 384_000,
      defaultMaxOutputTokens: 64_000,
    })
    expect(flash?.defaultMaxOutputTokens).toBe(8_000)
    expect(getModelCapabilities('deepseek/deepseek-v4-pro')).toEqual({
      thinking: true,
      toolUse: true,
      images: false,
      betaHeaders: false,
    })
  })

  test('方舟自定义模型去重、最近优先且最多保留 20 个', () => {
    saveGlobalConfig(current => ({
      ...current,
      providerModels: { ...current.providerModels, volcengineArk: [] },
    }))
    for (let index = 0; index < 25; index += 1) {
      rememberProviderModel('volcengineArk', `custom-${index}`)
    }
    rememberProviderModel('volcengineArk', 'custom-10')

    const remembered = getRememberedProviderModels('volcengineArk')
    expect(remembered).toHaveLength(20)
    expect(remembered[0]).toBe('custom-10')
    expect(new Set(remembered).size).toBe(20)
    expect(remembered).not.toContain('custom-0')
  })
})

describe('Provider 账户与额度状态', () => {
  test('DeepSeek 使用官方余额接口且不暴露 API Key', async () => {
    process.env.DEEPSEEK_API_KEY = 'deepseek-balance-test-key'
    let capturedUrl = ''
    let capturedAuthorization = ''
    const status = await loadProviderAccountStatus('deepseek', {
      fetchImpl: async (input, init) => {
        capturedUrl = String(input)
        capturedAuthorization = new Headers(init?.headers).get('authorization') ?? ''
        return new Response(
          JSON.stringify({
            is_available: true,
            balance_infos: [
              {
                currency: 'CNY',
                total_balance: '12.34',
                granted_balance: '2.00',
                topped_up_balance: '10.34',
              },
            ],
          }),
          { status: 200 },
        )
      },
    })

    expect(capturedUrl).toBe(DEEPSEEK_BALANCE_URL)
    expect(capturedAuthorization).toBe('Bearer deepseek-balance-test-key')
    expect(status).toEqual({
      kind: 'deepseek-balance',
      credential: {
        connected: true,
        sourceLabel: 'DEEPSEEK_API_KEY',
      },
      available: true,
      balances: [
        {
          currency: 'CNY',
          totalBalance: '12.34',
          grantedBalance: '2.00',
          toppedUpBalance: '10.34',
        },
      ],
    })
    expect(JSON.stringify(status)).not.toContain('deepseek-balance-test-key')
  })

  test('火山方舟不查询额度，也不发起未知请求', async () => {
    process.env.VOLCENGINE_ARK_API_KEY = 'ark-quota-test-key'
    let requestCount = 0
    const status = await loadProviderAccountStatus('volcengineArk', {
      fetchImpl: async () => {
        requestCount += 1
        return new Response('{}')
      },
    })

    expect(requestCount).toBe(0)
    expect(status).toEqual({
      kind: 'connected',
      credential: {
        connected: true,
        sourceLabel: 'VOLCENGINE_ARK_API_KEY',
      },
    })
  })

  test('拒绝无法识别的 DeepSeek 余额响应', () => {
    expect(parseDeepSeekBalanceResponse({ balance_infos: [] })).toBeUndefined()
    expect(
      parseDeepSeekBalanceResponse({
        is_available: true,
        balance_infos: [{ currency: 'CNY', total_balance: 1 }],
      }),
    ).toBeUndefined()
  })
})

describe('Provider 凭据存储', () => {
  test('双凭据隔离，Provider 专属环境变量优先于 auth.json', () => {
    writeAuthStore({
      deepseek: { apiKey: 'stored-deepseek' },
      volcengineArk: { apiKey: 'stored-ark' },
    })
    process.env.DEEPSEEK_API_KEY = 'env-deepseek'

    expect(getProviderCredential('deepseek')).toEqual({
      apiKey: 'env-deepseek',
      source: 'environment',
    })
    expect(getProviderCredential('volcengineArk')).toEqual({
      apiKey: 'stored-ark',
      source: 'auth-store',
    })
  })

  test('auth.json 使用 0600，损坏时禁止覆盖', () => {
    setProviderApiKey('deepseek', 'stored-deepseek')
    expect(statSync(getAuthStorePath()).mode & 0o777).toBe(0o600)

    writeFileSync(getAuthStorePath(), '{broken', 'utf8')
    expect(() => readAuthStore()).toThrow('无法读取 Provider 凭据文件')
    expect(() => setProviderApiKey('volcengineArk', 'must-not-write')).toThrow(
      '无法读取 Provider 凭据文件',
    )
    expect(readFileSync(getAuthStorePath(), 'utf8')).toBe('{broken')
  })

  test('原子替换后会修正既有文件权限', () => {
    mkdirSync(configDir, { recursive: true })
    writeFileSync(getAuthStorePath(), '{}\n', { mode: 0o644 })
    chmodSync(getAuthStorePath(), 0o644)
    writeAuthStore({ deepseek: { apiKey: 'secure' } })
    expect(statSync(getAuthStorePath()).mode & 0o777).toBe(0o600)
  })
})

describe('旧 Provider 配置迁移', () => {
  test('识别已知 Base URL，删除未知 profile 与旧明文环境配置', () => {
    expect(identifyKnownProviderBaseUrl('https://api.deepseek.com/anthropic')).toBe(
      'deepseek',
    )
    expect(
      identifyKnownProviderBaseUrl(
        'https://ark.cn-beijing.volces.com/api/coding/v1',
      ),
    ).toBeUndefined()
    expect(
      identifyKnownProviderBaseUrl(
        'https://ark.cn-beijing.volces.com/api/plan/v1/messages',
      ),
    ).toBe('volcengineArk')
    expect(identifyKnownProviderBaseUrl('https://unknown.example/v1')).toBeUndefined()

    saveGlobalConfig(current => ({
      ...current,
      providerMigrationVersion: undefined,
      activeProviderProfileId: 'known-deepseek',
      userCustomModelProfiles: [
        {
          id: 'known-deepseek',
          name: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com/anthropic',
          apiKey: 'migrated-deepseek',
          modelName: 'deepseek-v4-pro',
        },
        {
          id: 'known-ark-agent',
          name: '火山方舟 Agent Plan',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
          apiKey: 'migrated-ark',
          modelName: 'custom-agent-model',
        },
        {
          id: 'unknown',
          name: '未知端点',
          baseUrl: 'https://unknown.example/v1',
          apiKey: 'must-be-deleted',
          modelName: 'unknown-model',
        },
      ],
      env: {
        ...(current.env ?? {}),
        ANTHROPIC_BASE_URL: 'https://unknown.example/v1',
        ANTHROPIC_API_KEY: 'legacy-plain-text',
        ANTHROPIC_AUTH_TOKEN: 'legacy-token',
        ANTHROPIC_MODEL: 'unknown-model',
      },
    }))
    updateSettingsForSource('userSettings', { model: 'deepseek-v4-pro' })
    resetSettingsCache()

    migrateProviderConfiguration()
    resetSettingsCache()

    expect(readAuthStore()).toEqual({
      deepseek: { apiKey: 'migrated-deepseek' },
      volcengineArk: { apiKey: 'migrated-ark' },
    })
    expect(getGlobalConfig()).toMatchObject({
      providerMigrationVersion: CURRENT_PROVIDER_MIGRATION_VERSION,
      providerModels: { volcengineArk: ['custom-agent-model'] },
    })
    expect(
      (getGlobalConfig() as LegacyConfigWithEndpoints).providerEndpoints,
    ).toBeUndefined()
    expect(getGlobalConfig().userCustomModelProfiles).toBeUndefined()
    expect(getGlobalConfig().activeProviderProfileId).toBeUndefined()
    expect(getGlobalConfig().env?.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(getGlobalConfig().env?.ANTHROPIC_API_KEY).toBeUndefined()
    expect(getGlobalConfig().env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(getSettingsForSource('userSettings')?.model).toBe(
      'deepseek/deepseek-v4-pro',
    )
    expect(JSON.stringify(readAuthStore())).not.toContain('must-be-deleted')
  })

  test('旧进程级 Agent Plan 配置只映射当前运行，不写入磁盘', () => {
    process.env.ANTHROPIC_BASE_URL =
      'https://ark.cn-beijing.volces.com/api/plan'
    process.env.ANTHROPIC_AUTH_TOKEN = 'runtime-agent-key'
    process.env.ANTHROPIC_MODEL = 'ark-code-latest'

    mapLegacyProcessProviderEnv()

    expect(process.env.VIOLET_PROVIDER).toBe('volcengineArk')
    expect(process.env.ANTHROPIC_BASE_URL).toBe(
      'https://ark.cn-beijing.volces.com/api/plan',
    )
    expect(process.env.VOLCENGINE_ARK_API_KEY).toBe('runtime-agent-key')
  })

  test('版本 2 的 Agent Plan 凭据保留，并删除旧端点字段', () => {
    writeAuthStore({ volcengineArk: { apiKey: 'stored-agent-key' } })
    saveGlobalConfig(current => {
      const next = {
        ...current,
        providerMigrationVersion: 2,
      } as LegacyConfigWithEndpoints
      next.providerEndpoints = { volcengineArk: 'agent' }
      return next
    })

    migrateProviderConfiguration()

    expect(readAuthStore()).toEqual({
      volcengineArk: { apiKey: 'stored-agent-key' },
    })
    expect(
      (getGlobalConfig() as LegacyConfigWithEndpoints).providerEndpoints,
    ).toBeUndefined()
  })

  test('版本 2 的 Coding Plan 凭据删除，避免错误路由到 Agent Plan', () => {
    writeAuthStore({ volcengineArk: { apiKey: 'stored-coding-key' } })
    saveGlobalConfig(current => {
      const next = {
        ...current,
        providerMigrationVersion: 2,
      } as LegacyConfigWithEndpoints
      next.providerEndpoints = { volcengineArk: 'coding' }
      return next
    })

    migrateProviderConfiguration()

    expect(readAuthStore()).toEqual({})
    expect(
      (getGlobalConfig() as LegacyConfigWithEndpoints).providerEndpoints,
    ).toBeUndefined()
  })
})

describe('SDK 请求路由快照', () => {
  test('DeepSeek 使用 X-Api-Key、正确 URL 和无前缀模型 ID', async () => {
    const captures: CapturedRequest[] = []
    const client = await getAnthropicClient({
      apiKey: 'explicit-deepseek',
      maxRetries: 0,
      model: 'deepseek/deepseek-v4-pro',
      fetchOverride: createCaptureFetch(captures),
    })
    await client.messages.create({
      model: normalizeModelStringForAPI('deepseek/deepseek-v4-pro'),
      max_tokens: 64,
      messages: [{ role: 'user', content: 'ping' }],
      thinking: { type: 'disabled' },
      tools: [
        {
          name: 'echo',
          description: 'echo',
          input_schema: { type: 'object', properties: {} },
        },
      ],
    })

    const request = captures[0]!
    expect(request.url).toBe('https://api.deepseek.com/anthropic/v1/messages')
    expect(request.headers.get('x-api-key')).toBe('explicit-deepseek')
    expect(request.headers.get('authorization')).toBeNull()
    expect(request.headers.get('anthropic-beta')).toBeNull()
    expect(request.body).toMatchObject({
      model: 'deepseek-v4-pro',
      thinking: { type: 'disabled' },
    })
  })

  test('火山方舟使用 Bearer，且保守请求不含 beta、图片或 thinking', async () => {
    const captures: CapturedRequest[] = []
    process.env.VOLCENGINE_ARK_API_KEY = 'environment-ark'
    applyProviderEnv(process.env, 'volcengineArk', 'ark-code-latest')
    expect(process.env.ANTHROPIC_BASE_URL).toBe(
      'https://ark.cn-beijing.volces.com/api/plan',
    )
    const client = await getAnthropicClient({
      apiKey: 'explicit-ark',
      maxRetries: 0,
      model: 'volcengineArk/ark-code-latest',
      fetchOverride: createCaptureFetch(captures),
    })
    await client.messages.create({
      model: normalizeModelStringForAPI('volcengineArk/ark-code-latest'),
      max_tokens: 32,
      messages: [{ role: 'user', content: 'ping' }],
      tools: [
        {
          name: 'echo',
          description: 'echo',
          input_schema: { type: 'object', properties: {} },
        },
      ],
    })

    const request = captures[0]!
    expect(request.url).toBe(
      'https://ark.cn-beijing.volces.com/api/plan/v1/messages',
    )
    expect(request.headers.get('authorization')).toBe('Bearer explicit-ark')
    expect(request.headers.get('x-api-key')).toBeNull()
    expect(request.headers.get('anthropic-beta')).toBeNull()
    expect(request.body.model).toBe('ark-code-latest')
    expect(request.body.thinking).toBeUndefined()
    expect(JSON.stringify(request.body)).not.toContain('image')
  })
})
