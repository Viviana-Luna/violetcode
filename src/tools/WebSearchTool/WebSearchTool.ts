import type {
  BetaContentBlock,
  BetaWebSearchTool20250305,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { PermissionResult } from 'src/utils/permissions/PermissionResult.js'
import { z } from 'zod/v4'
import { queryModelWithStreaming } from '../../services/api/claude.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logError } from '../../utils/log.js'
import { createUserMessage } from '../../utils/messages.js'
import { getWebSearchStrategyForModel } from '../../utils/model/providerDefinitions.js'
import { jsonParse } from '../../utils/slowOperations.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { getWebSearchPrompt, WEB_SEARCH_TOOL_NAME } from './prompt.js'
import { getSearchProvider } from './providers/index.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    query: z.string().min(2).describe('The search query to use'),
    allowed_domains: z
      .array(z.string())
      .optional()
      .describe('Only include search results from these domains'),
    blocked_domains: z
      .array(z.string())
      .optional()
      .describe('Never include search results from these domains'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

type Input = z.infer<InputSchema>

const searchResultSchema = lazySchema(() => {
  const searchHitSchema = z.object({
    title: z.string().describe('The title of the search result'),
    url: z.string().describe('The URL of the search result'),
    description: z.string().optional().describe('Relevant excerpt from the result'),
    publishedDate: z.string().optional().describe('Published date when available'),
  })

  return z.object({
    tool_use_id: z.string().describe('ID of the tool use'),
    content: z.array(searchHitSchema).describe('Array of search hits'),
  })
})

export type SearchResult = z.infer<ReturnType<typeof searchResultSchema>>

const outputSchema = lazySchema(() =>
  z.object({
    query: z.string().describe('The search query that was executed'),
    provider: z.string().optional().describe('Search service that handled the request'),
    results: z
      .array(z.union([searchResultSchema(), z.string()]))
      .describe('Search results and/or text commentary from the model'),
    durationSeconds: z
      .number()
      .describe('Time taken to complete the search operation'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

// Re-export WebSearchProgress from centralized types to break import cycles
export type { WebSearchProgress } from '../../types/tools.js'

import type { WebSearchProgress } from '../../types/tools.js'

export function makeWebSearchToolSchema(
  input: Input,
  model: string,
): BetaWebSearchTool20250305 {
  const strategy = getWebSearchStrategyForModel(model)
  if (strategy?.kind !== 'native-anthropic-server-tool') {
    throw new Error(`当前模型 ${model} 不支持 Provider 原生网页搜索。`)
  }
  return {
    type: strategy.toolType,
    name: 'web_search',
    allowed_domains: input.allowed_domains,
    blocked_domains: input.blocked_domains,
    max_uses: strategy.maxUses,
  }
}

function makeOutputFromSearchResponse(
  result: BetaContentBlock[],
  query: string,
  durationSeconds: number,
): Output {
  // The result is a sequence of these blocks:
  // - text to start -- always?
  // [
  //    - server_tool_use
  //    - web_search_tool_result
  //    - text and citation blocks intermingled
  //  ]+  (this block repeated for each search)

  const results: (SearchResult | string)[] = []
  let textAcc = ''
  let inText = true

  for (const block of result) {
    if (block.type === 'server_tool_use') {
      if (inText) {
        inText = false
        if (textAcc.trim().length > 0) {
          results.push(textAcc.trim())
        }
        textAcc = ''
      }
      continue
    }

    if (block.type === 'web_search_tool_result') {
      // Handle error case - content is a WebSearchToolResultError
      if (!Array.isArray(block.content)) {
        const errorMessage = `网页搜索失败：${block.content.error_code}`
        logError(new Error(errorMessage))
        results.push(errorMessage)
        continue
      }
      // Success case - add results to our collection
      const hits = block.content.map(r => ({ title: r.title, url: r.url }))
      results.push({
        tool_use_id: block.tool_use_id,
        content: hits,
      })
    }

    if (block.type === 'text') {
      if (inText) {
        textAcc += block.text
      } else {
        inText = true
        textAcc = block.text
      }
    }
  }

  if (textAcc.length) {
    results.push(textAcc.trim())
  }

  return {
    query,
    provider: 'DeepSeek',
    results,
    durationSeconds,
  }
}

export function modelSupportsWebSearch(model: string): boolean {
  const strategy = getWebSearchStrategyForModel(model)
  if (strategy?.kind === 'native-anthropic-server-tool') return true
  return strategy?.kind === 'client-search-provider'
}

export const WebSearchTool = buildTool({
  name: WEB_SEARCH_TOOL_NAME,
  searchHint: 'search the web for current information',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description(input) {
    return `VioletCode 准备搜索网页：${input.query}`
  },
  userFacingName() {
    return '网页搜索'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `正在搜索：${summary}` : '正在搜索网页'
  },
  supportsModel(model) {
    return modelSupportsWebSearch(model)
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.query
  },
  async checkPermissions(_input, context): Promise<PermissionResult> {
    const strategy = getWebSearchStrategyForModel(context.options.mainLoopModel)
    const message =
      strategy?.kind === 'client-search-provider'
        ? 'VioletCode 将把搜索关键词和域名过滤条件发送给 Exa；不会发送会话全文或模型 Provider API Key。'
        : '当前搜索由模型 Provider 的端点原生网页搜索处理。'
    return {
      behavior: 'passthrough',
      message,
      suggestions: [
        {
          type: 'addRules',
          rules: [{ toolName: WEB_SEARCH_TOOL_NAME }],
          behavior: 'allow',
          destination: 'localSettings',
        },
      ],
    }
  },
  async prompt() {
    return getWebSearchPrompt()
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  extractSearchText() {
    // 结果渲染只显示搜索次数和耗时，results 内容不会出现在屏幕上。
    // 若在此索引字符串结果，会产生用户不可见的幽灵匹配，因此保持为空。
    return ''
  },
  async validateInput(input, context) {
    const { query, allowed_domains, blocked_domains } = input
    const strategy = getWebSearchStrategyForModel(context.options.mainLoopModel)
    if (!strategy) {
      return {
        result: false,
        message: `当前模型 ${context.options.mainLoopModel} 不支持网页搜索。`,
        errorCode: 3,
      }
    }
    if (
      strategy.kind === 'client-search-provider' &&
      !getSearchProvider(strategy.provider).isConfigured()
    ) {
      return {
        result: false,
        message: '尚未配置 Exa API Key，请通过 /connect 配置 Exa 网页搜索。本次时效性信息未验证。',
        errorCode: 4,
        preventContinuation: true,
      }
    }
    if (!query.length) {
      return {
        result: false,
        message: '错误：缺少搜索关键词。',
        errorCode: 1,
      }
    }
    if (allowed_domains?.length && blocked_domains?.length) {
      return {
        result: false,
        message: '错误：同一次请求不能同时指定允许域名和屏蔽域名。',
        errorCode: 2,
      }
    }
    return { result: true }
  },
  async call(input, context, _canUseTool, _parentMessage, onProgress) {
    const startTime = performance.now()
    const { query } = input
    const strategy = getWebSearchStrategyForModel(context.options.mainLoopModel)
    if (!strategy) {
      throw new Error(`当前模型 ${context.options.mainLoopModel} 不支持网页搜索。`)
    }

    if (strategy.kind === 'client-search-provider') {
      const provider = getSearchProvider(strategy.provider)
      onProgress?.({
        toolUseID: `search-query-${context.toolUseId ?? 'exa'}`,
        data: { type: 'query_update', query },
      })
      const providerOutput = await provider.search(
        {
          query,
          allowedDomains: input.allowed_domains,
          blockedDomains: input.blocked_domains,
        },
        context.abortController.signal,
      )
      onProgress?.({
        toolUseID: `search-results-${context.toolUseId ?? 'exa'}`,
        data: {
          type: 'search_results_received',
          resultCount: providerOutput.hits.length,
          query,
        },
      })

      const results: (SearchResult | string)[] = providerOutput.hits.length
        ? [
            {
              tool_use_id: `exa-${providerOutput.requestId ?? context.toolUseId ?? 'search'}`,
              content: providerOutput.hits,
            },
          ]
        : ['Exa 未返回搜索结果。本次时效性信息未验证。']
      return {
        data: {
          query,
          provider: providerOutput.providerName,
          results,
          durationSeconds: providerOutput.durationSeconds,
        },
      }
    }

    const userMessage = createUserMessage({
      content: 'Perform a web search for the query: ' + query,
    })
    const toolSchema = makeWebSearchToolSchema(
      input,
      context.options.mainLoopModel,
    )

    const appState = context.getAppState()
    const queryStream = queryModelWithStreaming({
      messages: [userMessage],
      systemPrompt: asSystemPrompt([
        'You are an assistant for performing a web search tool use',
      ]),
      thinkingConfig: context.options.thinkingConfig,
      tools: [],
      signal: context.abortController.signal,
      options: {
        getToolPermissionContext: async () => appState.toolPermissionContext,
        model: context.options.mainLoopModel,
        isNonInteractiveSession: context.options.isNonInteractiveSession,
        hasAppendSystemPrompt: !!context.options.appendSystemPrompt,
        extraToolSchemas: [toolSchema],
        querySource: 'web_search_tool',
        agents: context.options.agentDefinitions.activeAgents,
        mcpTools: [],
        agentId: context.agentId,
      },
    })

    const allContentBlocks: BetaContentBlock[] = []
    let currentToolUseId = null
    let currentToolUseJson = ''
    let progressCounter = 0
    const toolUseQueries = new Map() // Map of tool_use_id to query

    for await (const event of queryStream) {
      if (event.type === 'assistant') {
        allContentBlocks.push(...event.message.content)
        continue
      }

      // Track tool use ID when server_tool_use starts
      if (
        event.type === 'stream_event' &&
        event.event?.type === 'content_block_start'
      ) {
        const contentBlock = event.event.content_block
        if (contentBlock && contentBlock.type === 'server_tool_use') {
          currentToolUseId = contentBlock.id
          currentToolUseJson = ''
          // Note: The ServerToolUseBlock doesn't contain input.query
          // The actual query comes through input_json_delta events
          continue
        }
      }

      // Accumulate JSON for current tool use
      if (
        currentToolUseId &&
        event.type === 'stream_event' &&
        event.event?.type === 'content_block_delta'
      ) {
        const delta = event.event.delta
        if (delta?.type === 'input_json_delta' && delta.partial_json) {
          currentToolUseJson += delta.partial_json

          // Try to extract query from partial JSON for progress updates
          try {
            // Look for a complete query field
            const queryMatch = currentToolUseJson.match(
              /"query"\s*:\s*"((?:[^"\\]|\\.)*)"/,
            )
            if (queryMatch && queryMatch[1]) {
              // The regex properly handles escaped characters
              const query = jsonParse('"' + queryMatch[1] + '"')

              if (
                !toolUseQueries.has(currentToolUseId) ||
                toolUseQueries.get(currentToolUseId) !== query
              ) {
                toolUseQueries.set(currentToolUseId, query)
                progressCounter++
                if (onProgress) {
                  onProgress({
                    toolUseID: `search-progress-${progressCounter}`,
                    data: {
                      type: 'query_update',
                      query,
                    },
                  })
                }
              }
            }
          } catch {
            // Ignore parsing errors for partial JSON
          }
        }
      }

      // Yield progress when search results come in
      if (
        event.type === 'stream_event' &&
        event.event?.type === 'content_block_start'
      ) {
        const contentBlock = event.event.content_block
        if (contentBlock && contentBlock.type === 'web_search_tool_result') {
          // Get the actual query that was used for this search
          const toolUseId = contentBlock.tool_use_id
          const actualQuery = toolUseQueries.get(toolUseId) || query
          const content = contentBlock.content

          progressCounter++
          if (onProgress) {
            onProgress({
              toolUseID: toolUseId || `search-progress-${progressCounter}`,
              data: {
                type: 'search_results_received',
                resultCount: Array.isArray(content) ? content.length : 0,
                query: actualQuery,
              },
            })
          }
        }
      }
    }

    // Process the final result
    const endTime = performance.now()
    const durationSeconds = (endTime - startTime) / 1000

    const data = makeOutputFromSearchResponse(
      allContentBlocks,
      query,
      durationSeconds,
    )
    return { data }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const { provider, query, results } = output

    let formattedOutput = `网页搜索服务：${provider ?? '未知'}\n搜索关键词："${query}"\n\n`

    // Process the results array - it can contain both string summaries and search result objects.
    // Guard against null/undefined entries that can appear after JSON round-tripping
    // (e.g., from compaction or transcript deserialization).
    ;(results ?? []).forEach(result => {
      if (result == null) {
        return
      }
      if (typeof result === 'string') {
        // Text summary
        formattedOutput += result + '\n\n'
      } else {
        // Search result with links
        if (result.content?.length > 0) {
          result.content.forEach((hit, index) => {
            formattedOutput += `${index + 1}. ${hit.title}\n${hit.url}\n`
            if (hit.publishedDate) {
              formattedOutput += `发布日期：${hit.publishedDate}\n`
            }
            if (hit.description) {
              formattedOutput += `相关摘录：${hit.description}\n`
            }
            formattedOutput += '\n'
          })
        } else {
          formattedOutput += '未找到链接。本次时效性信息未验证。\n\n'
        }
      }
    })

    formattedOutput +=
      '\n必须在回答中使用 Markdown 链接引用以上来源；没有有效结果时必须明确说明时效性信息未验证。'

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: formattedOutput.trim(),
    }
  },
} satisfies ToolDef<InputSchema, Output, WebSearchProgress>)
