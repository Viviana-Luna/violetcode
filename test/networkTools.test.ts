import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  WebSearchTool,
  makeWebSearchToolSchema,
  modelSupportsWebSearch,
} from '../src/tools/WebSearchTool/WebSearchTool.js'
import { StreamingToolExecutor } from '../src/services/tools/StreamingToolExecutor.js'
import { runTools } from '../src/services/tools/toolOrchestration.js'
import {
  EXA_HIGHLIGHT_MAX_CHARACTERS,
  EXA_SEARCH_ENDPOINT,
  EXA_SEARCH_RESULT_LIMIT,
  createExaSearchProvider,
} from '../src/tools/WebSearchTool/providers/exa.js'
import {
  convertHtmlToMarkdown,
  getWithPermittedRedirects,
  isPermittedRedirect,
  validateURL,
} from '../src/tools/WebFetchTool/utils.js'
import {
  getProviderWebSearchStrategy,
  getWebSearchStrategyForModel,
} from '../src/utils/model/providerDefinitions.js'
import { filterToolsForModel } from '../src/utils/model/toolAvailability.js'
import {
  getAuthStorePath,
  getSearchServiceCredential,
  readAuthStore,
  setSearchServiceApiKey,
} from '../src/utils/authStore.js'
import { getKnownProviderSecretEnvKeys } from '../src/utils/providerSecrets.js'
import {
  isWebFetchBlockedAddress,
  webFetchSsrfGuardedLookup,
} from '../src/utils/hooks/ssrfGuard.js'

const ORIGINAL_ENV = {
  VIOLET_CONFIG_DIR: process.env.VIOLET_CONFIG_DIR,
  EXA_API_KEY: process.env.EXA_API_KEY,
  VOLCENGINE_ARK_API_KEY: process.env.VOLCENGINE_ARK_API_KEY,
}

function restoreEnv(name: keyof typeof ORIGINAL_ENV): void {
  const value = ORIGINAL_ENV[name]
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

beforeEach(() => {
  process.env.VIOLET_CONFIG_DIR = mkdtempSync(
    join(tmpdir(), 'violet-network-test-'),
  )
  delete process.env.EXA_API_KEY
  delete process.env.VOLCENGINE_ARK_API_KEY
})

afterEach(() => {
  restoreEnv('VIOLET_CONFIG_DIR')
  restoreEnv('EXA_API_KEY')
  restoreEnv('VOLCENGINE_ARK_API_KEY')
})

describe('Provider 联网策略', () => {
  test('DeepSeek 使用原生服务端搜索并限制为三次', () => {
    expect(getProviderWebSearchStrategy('deepseek')).toEqual({
      kind: 'native-anthropic-server-tool',
      toolType: 'web_search_20250305',
      maxUses: 3,
    })
    expect(
      makeWebSearchToolSchema(
        { query: 'VioletCode' },
        'deepseek/deepseek-v4-pro',
      ),
    ).toMatchObject({
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 3,
    })
  })

  test('火山方舟使用独立 Exa 适配器，缺少凭据时提示使用 /connect', async () => {
    expect(getWebSearchStrategyForModel('volcengineArk/ark-code-latest')).toEqual({
      kind: 'client-search-provider',
      provider: 'exa',
    })
    process.env.VOLCENGINE_ARK_API_KEY = 'ark-model-key'
    expect(modelSupportsWebSearch('volcengineArk/ark-code-latest')).toBeTrue()
    const validation = await WebSearchTool.validateInput(
      { query: '需要联网验证的信息' },
      {
        options: { mainLoopModel: 'volcengineArk/ark-code-latest' },
      } as never,
    )
    expect(validation.result).toBeFalse()
    expect(validation.message).toContain('/connect')
    expect(validation.message).toContain('Exa')
    expect(validation).toMatchObject({ preventContinuation: true })
  })

  test('火山方舟始终获得搜索工具，配置 Exa 后下一次校验立即生效', async () => {
    const ordinaryTool = { name: 'OrdinaryTool' }
    const tools = [WebSearchTool, ordinaryTool]

    expect(
      filterToolsForModel(tools, 'deepseek/deepseek-v4-flash').map(
        tool => tool.name,
      ),
    ).toContain('WebSearch')
    expect(
      filterToolsForModel(tools, 'volcengineArk/ark-code-latest').map(
        tool => tool.name,
      ),
    ).toEqual(['WebSearch', 'OrdinaryTool'])

    const unavailable = await WebSearchTool.validateInput(
      { query: '配置前搜索' },
      {
        options: { mainLoopModel: 'volcengineArk/ark-code-latest' },
      } as never,
    )
    expect(unavailable.result).toBeFalse()
    expect(unavailable.message).toContain('/connect')

    setSearchServiceApiKey('exa', 'stored-exa-key')
    expect(
      filterToolsForModel(tools, 'volcengineArk/ark-code-latest').map(
        tool => tool.name,
      ),
    ).toEqual(['WebSearch', 'OrdinaryTool'])
    expect(
      await WebSearchTool.validateInput(
        { query: '配置后搜索' },
        {
          options: { mainLoopModel: 'volcengineArk/ark-code-latest' },
        } as never,
      ),
    ).toEqual({ result: true })
  })

  test('Exa 未配置提示会在普通与流式工具执行后阻止模型继续回答', async () => {
    const toolUse = {
      type: 'tool_use',
      id: 'exa-unconfigured-tool-use',
      name: WebSearchTool.name,
      input: { query: '需要联网验证的信息' },
    }
    const assistantMessage = {
      uuid: 'assistant-with-exa-tool-use',
      message: {
        id: 'assistant-message-id',
        content: [toolUse],
      },
    }
    const createContext = () => {
      let inProgressToolUseIDs = new Set<string>()
      return {
        messages: [],
        abortController: new AbortController(),
        options: {
          tools: [WebSearchTool],
          mcpClients: [],
          mainLoopModel: 'volcengineArk/ark-code-latest',
        },
        setInProgressToolUseIDs(
          update: (current: Set<string>) => Set<string>,
        ) {
          inProgressToolUseIDs = update(inProgressToolUseIDs)
        },
      }
    }
    const unexpectedPermissionCheck = async () => {
      throw new Error('本地 Exa 配置校验失败后不应进入权限检查')
    }

    const ordinaryUpdates = []
    for await (const update of runTools(
      [toolUse] as never,
      [assistantMessage] as never,
      unexpectedPermissionCheck as never,
      createContext() as never,
    )) {
      ordinaryUpdates.push(update)
    }
    expect(
      ordinaryUpdates.some(update => update.preventContinuation === true),
    ).toBeTrue()
    expect(JSON.stringify(ordinaryUpdates)).toContain('/connect')

    const streamingContext = createContext()
    const streamingExecutor = new StreamingToolExecutor(
      [WebSearchTool],
      unexpectedPermissionCheck as never,
      streamingContext as never,
    )
    streamingExecutor.addTool(toolUse as never, assistantMessage as never)
    const streamingUpdates = []
    for await (const update of streamingExecutor.getRemainingResults()) {
      streamingUpdates.push(update)
    }
    expect(
      streamingUpdates.some(update => update.preventContinuation === true),
    ).toBeTrue()
    expect(JSON.stringify(streamingUpdates)).toContain('/connect')

    const querySource = readFileSync(
      join(import.meta.dir, '../src/query.ts'),
      'utf8',
    )
    const localStopIndex = querySource.indexOf(
      'if (shouldPreventModelContinuation)',
    )
    const toolSummaryIndex = querySource.indexOf(
      '// Generate tool use summary after tool batch completes',
    )
    expect(localStopIndex).toBeGreaterThan(-1)
    expect(toolSummaryIndex).toBeGreaterThan(localStopIndex)
  })
})

describe('Exa 搜索凭据与请求', () => {
  test('环境变量优先于 auth.json，且搜索凭据保持 0600', () => {
    setSearchServiceApiKey('exa', 'stored-exa-key')
    expect(readAuthStore().searchServices?.exa).toEqual({
      apiKey: 'stored-exa-key',
    })
    expect(statSync(getAuthStorePath()).mode & 0o777).toBe(0o600)
    expect(getSearchServiceCredential('exa')).toEqual({
      apiKey: 'stored-exa-key',
      source: 'auth-store',
    })

    process.env.EXA_API_KEY = 'environment-exa-key'
    expect(getSearchServiceCredential('exa')).toEqual({
      apiKey: 'environment-exa-key',
      source: 'environment',
    })
    expect(getKnownProviderSecretEnvKeys()).toContain('EXA_API_KEY')
  })

  test('旧 auth.json 保持兼容，损坏的搜索凭据禁止覆盖', () => {
    writeFileSync(
      getAuthStorePath(),
      JSON.stringify({ deepseek: { apiKey: 'deepseek-key' } }),
      { mode: 0o600 },
    )
    setSearchServiceApiKey('exa', 'exa-key')
    expect(readAuthStore()).toEqual({
      deepseek: { apiKey: 'deepseek-key' },
      searchServices: { exa: { apiKey: 'exa-key' } },
    })

    const damaged = JSON.stringify({
      deepseek: { apiKey: 'deepseek-key' },
      searchServices: { exa: { apiKey: 42 } },
    })
    writeFileSync(getAuthStorePath(), damaged, { mode: 0o600 })
    expect(() => setSearchServiceApiKey('exa', 'replacement')).toThrow(
      '搜索服务 exa 的凭据格式无效',
    )
    expect(readFileSync(getAuthStorePath(), 'utf8')).toBe(damaged)
  })

  test('请求快照使用质量档、域名过滤和独立 x-api-key', async () => {
    process.env.VOLCENGINE_ARK_API_KEY = 'ark-model-key'
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const provider = createExaSearchProvider({
      getApiKey: () => 'exa-only-key',
      fetchImpl: (async (input, init) => {
        requests.push({ url: String(input), init })
        return new Response(
          JSON.stringify({
            requestId: 'request-1',
            results: [
              {
                title: '有效结果',
                url: 'https://docs.example.com/a',
                highlights: ['a'.repeat(1_500)],
                publishedDate: '2026-07-14T00:00:00.000Z',
              },
              {
                title: '重复结果',
                url: 'https://docs.example.com/a',
              },
              { title: '越界域名', url: 'https://other.example/b' },
              { title: '无效协议', url: 'file:///etc/passwd' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }) as typeof fetch,
    })

    const output = await provider.search({
      query: 'VioletCode 最新状态',
      allowedDomains: ['https://example.com/docs'],
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe(EXA_SEARCH_ENDPOINT)
    const headers = new Headers(requests[0]?.init?.headers)
    expect(headers.get('x-api-key')).toBe('exa-only-key')
    expect(headers.get('authorization')).toBeNull()
    expect(JSON.stringify(requests[0]?.init)).not.toContain('ark-model-key')
    const body = JSON.parse(String(requests[0]?.init?.body)) as Record<
      string,
      unknown
    >
    expect(body).toEqual({
      query: 'VioletCode 最新状态',
      type: 'auto',
      numResults: EXA_SEARCH_RESULT_LIMIT,
      contents: {
        highlights: {
          query: 'VioletCode 最新状态',
          maxCharacters: EXA_HIGHLIGHT_MAX_CHARACTERS,
        },
      },
      includeDomains: ['example.com'],
    })
    expect(JSON.stringify(body)).not.toContain('ark-model-key')
    expect(output.hits).toHaveLength(1)
    expect(output.hits[0]?.description?.length).toBe(
      EXA_HIGHLIGHT_MAX_CHARACTERS,
    )
    expect(output.hits[0]?.publishedDate).toBe('2026-07-14T00:00:00.000Z')
    expect(output.requestId).toBe('request-1')
  })

  test('屏蔽域名同时映射到 Exa 请求并在本地再次过滤', async () => {
    const requests: RequestInit[] = []
    const provider = createExaSearchProvider({
      getApiKey: () => 'exa-key',
      fetchImpl: (async (_input, init) => {
        requests.push(init ?? {})
        return new Response(
          JSON.stringify({
            results: [
              { title: '保留结果', url: 'https://example.com/kept' },
              { title: '屏蔽结果', url: 'https://private.example/blocked' },
            ],
          }),
          { status: 200 },
        )
      }) as typeof fetch,
    })

    const output = await provider.search({
      query: '屏蔽域名测试',
      blockedDomains: ['private.example'],
    })

    expect(requests).toHaveLength(1)
    expect(JSON.parse(String(requests[0]?.body))).toMatchObject({
      excludeDomains: ['private.example'],
    })
    expect(output.hits.map(hit => hit.url)).toEqual([
      'https://example.com/kept',
    ])
  })

  test('零结果保持未验证语义，HTTP 错误不会重试或降级', async () => {
    const emptyProvider = createExaSearchProvider({
      getApiKey: () => 'exa-key',
      fetchImpl: (async () =>
        new Response(JSON.stringify({ requestId: 'empty', results: [] }), {
          status: 200,
        })) as typeof fetch,
    })
    expect((await emptyProvider.search({ query: '没有结果' })).hits).toEqual([])

    for (const [status, message] of [
      [401, '无效或没有搜索权限，请通过 /connect'],
      [403, '无效或没有搜索权限，请通过 /connect'],
      [429, '配额不足或请求过于频繁'],
      [503, '暂时不可用'],
    ] as const) {
      let requestCount = 0
      const provider = createExaSearchProvider({
        getApiKey: () => 'exa-key',
        fetchImpl: (async () => {
          requestCount++
          return new Response('', { status })
        }) as typeof fetch,
      })
      await expect(provider.search({ query: '错误测试' })).rejects.toThrow(
        message,
      )
      expect(requestCount).toBe(1)
    }
  })

  test('取消立即停止，超时明确报错且不发起第二次请求', async () => {
    let abortRequestCount = 0
    const abortProvider = createExaSearchProvider({
      getApiKey: () => 'exa-key',
      fetchImpl: ((_input, init) => {
        abortRequestCount++
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        })
      }) as typeof fetch,
    })
    const controller = new AbortController()
    const aborted = abortProvider.search({ query: '取消测试' }, controller.signal)
    controller.abort()
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })
    expect(abortRequestCount).toBe(1)

    let timeoutRequestCount = 0
    const timeoutProvider = createExaSearchProvider({
      getApiKey: () => 'exa-key',
      timeoutMs: 5,
      fetchImpl: ((_input, init) => {
        timeoutRequestCount++
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        })
      }) as typeof fetch,
    })
    await expect(timeoutProvider.search({ query: '超时测试' })).rejects.toThrow(
      'Exa 搜索超时',
    )
    expect(timeoutRequestCount).toBe(1)
  })

  test('火山方舟 WebSearch 直接调用 Exa 并把摘录交回主模型', async () => {
    const originalFetch = globalThis.fetch
    process.env.EXA_API_KEY = 'exa-tool-key'
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          requestId: 'tool-request',
          results: [
            {
              title: 'Exa 工具结果',
              url: 'https://example.com/result',
              highlights: ['供主模型使用的事实摘录'],
            },
          ],
        }),
        { status: 200 },
      )) as typeof fetch

    try {
      const progress: unknown[] = []
      const result = await WebSearchTool.call(
        { query: '工具分流测试' },
        {
          options: { mainLoopModel: 'volcengineArk/ark-code-latest' },
          abortController: new AbortController(),
          toolUseId: 'outer-tool-use',
        } as never,
        (() => undefined) as never,
        {} as never,
        update => progress.push(update),
      )
      expect(result.data).toMatchObject({
        provider: 'Exa',
        query: '工具分流测试',
        results: [
          {
            content: [
              {
                title: 'Exa 工具结果',
                description: '供主模型使用的事实摘录',
              },
            ],
          },
        ],
      })
      expect(progress).toHaveLength(2)
      const toolResult = WebSearchTool.mapToolResultToToolResultBlockParam?.(
        result.data,
        'outer-tool-use',
      )
      expect(toolResult?.content).toContain('网页搜索服务：Exa')
      expect(toolResult?.content).toContain('供主模型使用的事实摘录')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('通用 WebFetch', () => {
  test('HTML 可以转换为 Markdown', async () => {
    const markdown = await convertHtmlToMarkdown(
      '<main><h1>紫罗兰</h1><p>Provider 联网能力</p></main>',
    )
    expect(markdown).toContain('紫罗兰')
    expect(markdown).toContain('Provider 联网能力')
    expect(markdown).not.toContain('<h1>')
  })

  test('只接受 HTTP 与 HTTPS，拒绝私网和回环地址', async () => {
    expect(validateURL('file:///etc/passwd')).toBeFalse()
    expect(validateURL('https://example.com/path')).toBeTrue()
    expect(isWebFetchBlockedAddress('127.0.0.1')).toBeTrue()
    expect(isWebFetchBlockedAddress('10.0.0.1')).toBeTrue()
    expect(isWebFetchBlockedAddress('169.254.169.254')).toBeTrue()
    expect(isWebFetchBlockedAddress('8.8.8.8')).toBeFalse()

    const lookupError = await new Promise<Error | null>(resolve => {
      webFetchSsrfGuardedLookup('127.0.0.1', {}, error => resolve(error))
    })
    expect(lookupError).toMatchObject({
      code: 'ERR_WEB_FETCH_BLOCKED_ADDRESS',
    })

    await expect(
      getWithPermittedRedirects(
        'https://127.0.0.1/',
        new AbortController().signal,
        isPermittedRedirect,
      ),
    ).rejects.toMatchObject({ code: 'ERR_WEB_FETCH_BLOCKED_ADDRESS' })
  })

  test('源码不再把目标域名发送给 Anthropic 预检接口', () => {
    const source = readFileSync(
      new URL('../src/tools/WebFetchTool/utils.ts', import.meta.url),
      'utf8',
    )
    expect(source).not.toContain('api.anthropic.com/api/web/domain_info')
    expect(source).not.toContain('checkDomainBlocklist')
  })
})
