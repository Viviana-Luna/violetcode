import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import type {
  CustomProviderConfig,
  CustomProviderModelConfig,
  ProviderDefinition,
  ProviderModel,
} from './types.js'

/**
 * 自定义 Provider 的保守能力默认：与火山方舟未知模型的策略一致，
 * 仅 contextWindow 与 thinking 由用户在新增时显式配置。
 */
export const CUSTOM_PROVIDER_DEFAULT_CONTEXT_WINDOW = 200_000
export const CUSTOM_PROVIDER_DEFAULT_MAX_OUTPUT_TOKENS = 32_000

const CUSTOM_PROVIDER_ID_PREFIX = 'custom-'

export function isCustomProviderId(id: string): boolean {
  return id.startsWith(CUSTOM_PROVIDER_ID_PREFIX)
}

/** 每个自定义 Provider 的专属凭据环境变量，id 为确定性 hash，因此变量名稳定。 */
export function getCustomProviderApiKeyEnvVar(id: string): string {
  const suffix = id
    .slice(CUSTOM_PROVIDER_ID_PREFIX.length)
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
  return `VIOLET_CUSTOM_${suffix}_API_KEY`
}

function hashCustomProviderId(value: string): string {
  let hash = 5381
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

export function generateCustomProviderId(baseUrl: string): string {
  return `${CUSTOM_PROVIDER_ID_PREFIX}${hashCustomProviderId(baseUrl)}`
}

export function normalizeCustomProviderBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function isValidCustomProviderBaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function isValidCustomModelId(id: string): boolean {
  return id.length > 0 && !/[\s\u0000-\u001f\u007f]/u.test(id)
}

/**
 * 解析用户输入的上下文窗口：空输入表示使用默认值；
 * 合法值必须是正整数；非法输入返回 null，避免误输入被当成默认值。
 */
export function parseCustomModelContextWindow(
  value: string,
): number | undefined | null {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null
  return parsed
}

function customModelToProviderModel(
  model: CustomProviderModelConfig,
): ProviderModel {
  return {
    id: model.id,
    contextWindow:
      model.contextWindow ?? CUSTOM_PROVIDER_DEFAULT_CONTEXT_WINDOW,
    maxOutputTokens: CUSTOM_PROVIDER_DEFAULT_MAX_OUTPUT_TOKENS,
    defaultMaxOutputTokens: CUSTOM_PROVIDER_DEFAULT_MAX_OUTPUT_TOKENS,
    capabilities: {
      thinking: model.thinking ?? false,
      toolUse: true,
      images: false,
      betaHeaders: false,
    },
  }
}

export function customProviderToDefinition(
  config: CustomProviderConfig,
): ProviderDefinition {
  return {
    id: config.id,
    label: config.label,
    baseUrl: config.baseUrl,
    authMethod: config.authMethod,
    apiKeyEnvVar: getCustomProviderApiKeyEnvVar(config.id),
    allowCustomModels: false,
    models: config.models.map(customModelToProviderModel),
    webSearch:
      config.webSearch === 'exa'
        ? { kind: 'client-search-provider', provider: 'exa' }
        : {
            kind: 'native-anthropic-server-tool',
            toolType: 'web_search_20250305',
            maxUses: 3,
          },
  }
}

function isValidCustomProviderConfig(
  value: unknown,
): value is CustomProviderConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Partial<CustomProviderConfig>
  if (
    typeof entry.id !== 'string' ||
    !isCustomProviderId(entry.id) ||
    typeof entry.label !== 'string' ||
    !entry.label.trim() ||
    typeof entry.baseUrl !== 'string' ||
    !isValidCustomProviderBaseUrl(entry.baseUrl) ||
    // 地址必须与凭据绑定用的 Provider ID 一致，避免旧凭据被静默转发到手工改写后的新端点。
    entry.id !==
      generateCustomProviderId(normalizeCustomProviderBaseUrl(entry.baseUrl)) ||
    (entry.authMethod !== 'x-api-key' && entry.authMethod !== 'bearer') ||
    (entry.webSearch !== 'native' && entry.webSearch !== 'exa') ||
    !Array.isArray(entry.models) ||
    entry.models.length === 0
  ) {
    return false
  }

  const modelIds = new Set<string>()
  for (const value of entry.models as unknown[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const model = value as Partial<CustomProviderModelConfig>
    if (
      typeof model.id !== 'string' ||
      !isValidCustomModelId(model.id) ||
      modelIds.has(model.id) ||
      (model.contextWindow !== undefined &&
        (!Number.isSafeInteger(model.contextWindow) ||
          model.contextWindow <= 0)) ||
      (model.thinking !== undefined && typeof model.thinking !== 'boolean')
    ) {
      return false
    }
    modelIds.add(model.id)
  }
  return true
}

/**
 * 用户可能手工编辑 config.json；畸形条目直接跳过，
 * 避免坏数据顺着合并查找炸掉包括内置 Provider 在内的整个模型链路。
 */
export function getCustomProviderConfigs(): CustomProviderConfig[] {
  const configs = getGlobalConfig().customProviders
  if (!Array.isArray(configs)) return []
  return configs.filter(isValidCustomProviderConfig)
}

export function getCustomProviderDefinitions(): ProviderDefinition[] {
  return getCustomProviderConfigs().map(customProviderToDefinition)
}

/**
 * 新增或覆盖同 id 的自定义 Provider；仅写配置，凭据由调用方
 * 通过 setProviderApiKey 单独写入 auth.json。
 */
export function upsertCustomProvider(
  input: Omit<CustomProviderConfig, 'id' | 'label'> & { label?: string },
): CustomProviderConfig {
  const baseUrl = normalizeCustomProviderBaseUrl(input.baseUrl)
  if (!baseUrl || !isValidCustomProviderBaseUrl(baseUrl)) {
    throw new Error('Base URL 必须是合法的 http:// 或 https:// 地址')
  }
  if (input.authMethod !== 'x-api-key' && input.authMethod !== 'bearer') {
    throw new Error('认证方式必须是 X-Api-Key 或 Bearer Token')
  }
  if (input.webSearch !== 'native' && input.webSearch !== 'exa') {
    throw new Error('网页搜索链路必须是端点原生搜索或 Exa')
  }
  if (!Array.isArray(input.models) || input.models.length === 0) {
    throw new Error('至少需要添加一个模型')
  }
  const seenModelIds = new Set<string>()
  for (const model of input.models) {
    if (!isValidCustomModelId(model.id)) {
      throw new Error('模型 ID 不能为空，也不能包含空白或控制字符')
    }
    if (seenModelIds.has(model.id)) {
      throw new Error(`模型 ${model.id} 重复`)
    }
    seenModelIds.add(model.id)
    if (
      model.contextWindow !== undefined &&
      (!Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0)
    ) {
      throw new Error(`模型 ${model.id} 的上下文窗口必须是正整数`)
    }
    if (model.thinking !== undefined && typeof model.thinking !== 'boolean') {
      throw new Error(`模型 ${model.id} 的 Thinking 配置必须是布尔值`)
    }
  }
  const id = generateCustomProviderId(baseUrl)
  let label = input.label?.trim() ?? ''
  if (!label) {
    try {
      label = new URL(baseUrl).host
    } catch {
      label = baseUrl
    }
  }
  const entry: CustomProviderConfig = {
    id,
    label,
    baseUrl,
    authMethod: input.authMethod,
    webSearch: input.webSearch,
    models: input.models,
  }
  saveGlobalConfig(current => ({
    ...current,
    customProviders: [
      ...(Array.isArray(current.customProviders)
        ? current.customProviders.filter(
            existing =>
              isValidCustomProviderConfig(existing) && existing.id !== id,
          )
        : []),
      entry,
    ],
  }))
  return entry
}
