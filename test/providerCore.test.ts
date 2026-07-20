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
  CUSTOM_PROVIDER_DEFAULT_CONTEXT_WINDOW,
  generateCustomProviderId,
  getCustomProviderApiKeyEnvVar,
  isValidCustomModelId,
  isValidCustomProviderBaseUrl,
  parseCustomModelContextWindow,
  upsertCustomProvider,
} from '../src/utils/model/customProviders.js'
import { getContextWindowForModel } from '../src/utils/context.js'
import {
  getModelCapabilities,
  normalizeModelStringForAPI,
} from '../src/utils/model/model.js'
import {
  PROVIDER_DEFINITIONS,
  getAllProviderDefinitions,
  getProviderDefinition,
  getProviderModel,
  resolveProviderModelReference,
} from '../src/utils/model/providerDefinitions.js'
import { getModelOptions } from '../src/utils/model/modelOptions.js'
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
    customProviders: undefined,
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

  test('x-api-key Provider 的请求不携带环境变量中其他 Provider 的 AUTH_TOKEN', async () => {
    // 回归：会话在 Provider A（bearer）环境下为 Provider B（x-api-key）构造
    // 客户端时，SDK 的 authToken env 回退不得把 A 的凭据发给 B 的服务器。
    process.env.ANTHROPIC_AUTH_TOKEN = 'other-provider-bearer-token'
    const captures: CapturedRequest[] = []
    const client = await getAnthropicClient({
      apiKey: 'explicit-deepseek',
      maxRetries: 0,
      model: 'deepseek/deepseek-v4-pro',
      fetchOverride: createCaptureFetch(captures),
    })
    await client.messages.create({
      model: 'deepseek-v4-pro',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    })

    const request = captures[0]!
    expect(request.headers.get('x-api-key')).toBe('explicit-deepseek')
    expect(request.headers.get('authorization')).toBeNull()
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

describe('自定义 Provider 端点', () => {
  test('config.json 中的畸形自定义条目被跳过，不影响内置 Provider 链路', () => {
    saveGlobalConfig(current => ({
      ...current,
      customProviders: [
        { id: 'not-custom-prefix' },
        {
          id: 'custom-broken',
          label: '坏条目',
          baseUrl: 'https://broken.example',
          authMethod: 'bearer',
          webSearch: 'native',
          models: 'not-an-array',
        },
      ] as never,
    }))

    expect(getAllProviderDefinitions().map(def => def.id)).toEqual([
      'deepseek',
      'volcengineArk',
    ])
    expect(getProviderDefinition('deepseek')?.label).toBe('DeepSeek')
  })

  test('输入校验：baseUrl、模型 ID 与上下文窗口', () => {
    expect(isValidCustomProviderBaseUrl('https://example.com/anthropic')).toBe(true)
    expect(isValidCustomProviderBaseUrl('http://127.0.0.1:8317/v1')).toBe(true)
    expect(isValidCustomProviderBaseUrl('ftp://example.com')).toBe(false)
    expect(isValidCustomProviderBaseUrl('not-a-url')).toBe(false)

    expect(isValidCustomModelId('my-model_v2.1')).toBe(true)
    expect(isValidCustomModelId('')).toBe(false)
    expect(isValidCustomModelId('bad model')).toBe(false)

    expect(parseCustomModelContextWindow('')).toBeUndefined()
    expect(parseCustomModelContextWindow('  ')).toBeUndefined()
    expect(parseCustomModelContextWindow('128000')).toBe(128_000)
    expect(parseCustomModelContextWindow('0')).toBeNull()
    expect(parseCustomModelContextWindow('-5')).toBeNull()
    expect(parseCustomModelContextWindow('abc')).toBeNull()
    expect(parseCustomModelContextWindow('1.5')).toBeNull()
  })

  test('upsert 拒绝非法输入，不写入半成品配置', () => {
    const valid = {
      baseUrl: 'https://custom.example/anthropic',
      authMethod: 'bearer' as const,
      webSearch: 'native' as const,
      models: [{ id: 'custom-pro' }],
    }
    expect(() =>
      upsertCustomProvider({ ...valid, baseUrl: 'not-a-url' }),
    ).toThrow('Base URL')
    expect(() => upsertCustomProvider({ ...valid, models: [] })).toThrow(
      '至少需要添加一个模型',
    )
    expect(() =>
      upsertCustomProvider({ ...valid, models: [{ id: 'bad model' }] }),
    ).toThrow('模型 ID')
    expect(() =>
      upsertCustomProvider({
        ...valid,
        models: [{ id: 'dup' }, { id: 'dup' }],
      }),
    ).toThrow('重复')
    expect(() =>
      upsertCustomProvider({
        ...valid,
        models: [{ id: 'bad-ctx', contextWindow: -1 }],
      }),
    ).toThrow('上下文窗口')
    expect(getGlobalConfig().customProviders ?? []).toHaveLength(0)
  })

  test('注册后进入合并定义列表，模型能力按用户配置与保守默认生成', () => {
    const entry = upsertCustomProvider({
      baseUrl: 'https://custom.example/anthropic/',
      authMethod: 'bearer',
      webSearch: 'native',
      models: [
        { id: 'custom-pro', contextWindow: 128_000, thinking: true },
        { id: 'custom-flash' },
      ],
    })

    expect(entry.id).toBe(generateCustomProviderId('https://custom.example/anthropic'))
    expect(entry.label).toBe('custom.example')
    expect(getAllProviderDefinitions().map(def => def.id)).toContain(entry.id)

    const definition = getProviderDefinition(entry.id)
    expect(definition?.baseUrl).toBe('https://custom.example/anthropic')
    expect(definition?.authMethod).toBe('bearer')
    expect(definition?.allowCustomModels).toBe(false)
    expect(definition?.webSearch).toEqual({
      kind: 'native-anthropic-server-tool',
      toolType: 'web_search_20250305',
      maxUses: 3,
    })

    expect(getProviderModel(entry.id, 'custom-pro')?.model).toMatchObject({
      contextWindow: 128_000,
      maxOutputTokens: 32_000,
      defaultMaxOutputTokens: 32_000,
      capabilities: {
        thinking: true,
        toolUse: true,
        images: false,
        betaHeaders: false,
      },
    })
    // 未配置 contextWindow/thinking 的模型回落到保守默认
    expect(getProviderModel(entry.id, 'custom-flash')?.model).toMatchObject({
      contextWindow: CUSTOM_PROVIDER_DEFAULT_CONTEXT_WINDOW,
      capabilities: { thinking: false, toolUse: true },
    })
    // 未列出的模型不被接受
    expect(getProviderModel(entry.id, 'unlisted-model')).toBeUndefined()
  })

  test('provider/model 引用解析与上下文窗口读取走自定义定义', () => {
    const entry = upsertCustomProvider({
      baseUrl: 'https://custom.example/anthropic',
      authMethod: 'x-api-key',
      webSearch: 'exa',
      models: [{ id: 'custom-pro', contextWindow: 96_000, thinking: true }],
    })

    expect(
      resolveProviderModelReference(`${entry.id}/custom-pro`),
    ).toEqual({
      provider: entry.id,
      modelId: 'custom-pro',
      value: `${entry.id}/custom-pro`,
    })
    expect(normalizeModelStringForAPI(`${entry.id}/custom-pro`)).toBe(
      'custom-pro',
    )
    expect(getContextWindowForModel(`${entry.id}/custom-pro`)).toBe(96_000)
    expect(getModelCapabilities(`${entry.id}/custom-pro`)?.thinking).toBe(true)
    expect(getProviderDefinition(entry.id)?.webSearch).toEqual({
      kind: 'client-search-provider',
      provider: 'exa',
    })
  })

  test('凭据写入 auth.json 并可由专属环境变量覆盖，读写往返不丢失', () => {
    const entry = upsertCustomProvider({
      baseUrl: 'https://custom.example/anthropic',
      authMethod: 'bearer',
      webSearch: 'native',
      models: [{ id: 'custom-pro' }],
    })
    setProviderApiKey(entry.id, 'stored-custom-key')

    // 重新读取（模拟跨进程）后自定义凭据仍在
    expect(readAuthStore()[entry.id]?.apiKey).toBe('stored-custom-key')
    expect(getProviderCredential(entry.id)).toEqual({
      apiKey: 'stored-custom-key',
      source: 'auth-store',
    })

    const envVar = getCustomProviderApiKeyEnvVar(entry.id)
    const original = process.env[envVar]
    process.env[envVar] = 'env-custom-key'
    try {
      expect(getProviderCredential(entry.id)).toEqual({
        apiKey: 'env-custom-key',
        source: 'environment',
      })
    } finally {
      if (original === undefined) delete process.env[envVar]
      else process.env[envVar] = original
    }
  })

  test('账户状态不查询 DeepSeek 余额接口，直接显示已连接', async () => {
    const entry = upsertCustomProvider({
      baseUrl: 'https://custom.example/anthropic',
      authMethod: 'bearer',
      webSearch: 'native',
      models: [{ id: 'custom-pro' }],
    })
    setProviderApiKey(entry.id, 'custom-status-key')

    let requestCount = 0
    const status = await loadProviderAccountStatus(entry.id, {
      fetchImpl: async () => {
        requestCount += 1
        return new Response('{}')
      },
    })

    expect(requestCount).toBe(0)
    expect(status).toEqual({
      kind: 'connected',
      credential: { connected: true, sourceLabel: '本地凭据' },
    })
  })

  test('模型选项包含已配置凭据的自定义 Provider 模型', () => {
    const entry = upsertCustomProvider({
      baseUrl: 'https://custom.example/anthropic',
      authMethod: 'bearer',
      webSearch: 'native',
      models: [{ id: 'custom-pro' }, { id: 'custom-flash' }],
    })

    expect(
      getModelOptions().some(option => option.value === `${entry.id}/custom-pro`),
    ).toBe(false)

    setProviderApiKey(entry.id, 'custom-options-key')
    const values = getModelOptions().map(option => option.value)
    expect(values).toContain(`${entry.id}/custom-pro`)
    expect(values).toContain(`${entry.id}/custom-flash`)
  })

  test('请求路由快照：Bearer 与 X-Api-Key 按认证方式分流', async () => {
    const bearerEntry = upsertCustomProvider({
      baseUrl: 'https://bearer.example/anthropic',
      authMethod: 'bearer',
      webSearch: 'native',
      models: [{ id: 'pro' }],
    })
    const keyEntry = upsertCustomProvider({
      baseUrl: 'https://key.example/anthropic',
      authMethod: 'x-api-key',
      webSearch: 'native',
      models: [{ id: 'pro' }],
    })

    const bearerCaptures: CapturedRequest[] = []
    const bearerClient = await getAnthropicClient({
      apiKey: 'explicit-bearer',
      maxRetries: 0,
      model: `${bearerEntry.id}/pro`,
      fetchOverride: createCaptureFetch(bearerCaptures),
    })
    await bearerClient.messages.create({
      model: normalizeModelStringForAPI(`${bearerEntry.id}/pro`),
      max_tokens: 32,
      messages: [{ role: 'user', content: 'ping' }],
    })
    expect(bearerCaptures[0]!.url).toBe(
      'https://bearer.example/anthropic/v1/messages',
    )
    expect(bearerCaptures[0]!.headers.get('authorization')).toBe(
      'Bearer explicit-bearer',
    )
    expect(bearerCaptures[0]!.headers.get('x-api-key')).toBeNull()
    expect(bearerCaptures[0]!.body.model).toBe('pro')

    const keyCaptures: CapturedRequest[] = []
    const keyClient = await getAnthropicClient({
      apiKey: 'explicit-x-api-key',
      maxRetries: 0,
      model: `${keyEntry.id}/pro`,
      fetchOverride: createCaptureFetch(keyCaptures),
    })
    await keyClient.messages.create({
      model: normalizeModelStringForAPI(`${keyEntry.id}/pro`),
      max_tokens: 32,
      messages: [{ role: 'user', content: 'ping' }],
    })
    expect(keyCaptures[0]!.url).toBe('https://key.example/anthropic/v1/messages')
    expect(keyCaptures[0]!.headers.get('x-api-key')).toBe('explicit-x-api-key')
    expect(keyCaptures[0]!.headers.get('authorization')).toBeNull()
    expect(keyCaptures[0]!.body.model).toBe('pro')
  })
})
