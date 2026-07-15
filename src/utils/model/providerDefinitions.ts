import type {
  APIProvider,
  ProviderDefinition,
  ProviderModel,
  ProviderWebSearchStrategy,
} from './types.js'

export type ProviderModelReference = {
  provider: APIProvider
  modelId: string
  value: string
}

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    authMethod: 'x-api-key',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    allowCustomModels: false,
    webSearch: {
      kind: 'native-anthropic-server-tool',
      toolType: 'web_search_20250305',
      maxUses: 3,
    },
    models: [
      {
        id: 'deepseek-v4-pro',
        contextWindow: 1_000_000,
        maxOutputTokens: 384_000,
        defaultMaxOutputTokens: 64_000,
        capabilities: { thinking: true, toolUse: true, images: false, betaHeaders: false },
      },
      {
        id: 'deepseek-v4-flash',
        contextWindow: 1_000_000,
        maxOutputTokens: 384_000,
        defaultMaxOutputTokens: 8_000,
        capabilities: { thinking: true, toolUse: true, images: false, betaHeaders: false },
      },
    ],
  },
  {
    id: 'volcengineArk',
    label: '火山方舟 Agent Plan',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
    authMethod: 'bearer',
    apiKeyEnvVar: 'VOLCENGINE_ARK_API_KEY',
    allowCustomModels: true,
    webSearch: {
      kind: 'client-search-provider',
      provider: 'exa',
    },
    unknownModelDefaults: {
      contextWindow: 200_000,
      maxOutputTokens: 32_000,
      defaultMaxOutputTokens: 32_000,
      capabilities: { thinking: false, toolUse: true, images: false, betaHeaders: false },
    },
    models: [
      {
        id: 'ark-code-latest',
        contextWindow: 200_000,
        maxOutputTokens: 32_000,
        defaultMaxOutputTokens: 32_000,
        capabilities: { thinking: false, toolUse: true, images: false, betaHeaders: false },
      },
    ],
  },
]

export function getProviderDefinition(id: string): ProviderDefinition | undefined {
  return PROVIDER_DEFINITIONS.find(p => p.id === id)
}

export function getProviderWebSearchStrategy(
  providerId: string,
): ProviderWebSearchStrategy | undefined {
  return getProviderDefinition(providerId)?.webSearch
}

export function getProviderModel(
  providerId: string,
  modelId: string,
): { provider: ProviderDefinition; model: ProviderModel } | undefined {
  const provider = getProviderDefinition(providerId)
  if (!provider) return undefined
  const model = provider.models.find(m => m.id === modelId) ??
    (provider.allowCustomModels && provider.unknownModelDefaults
      ? { id: modelId, ...provider.unknownModelDefaults }
      : undefined)
  if (!model) return undefined
  return { provider, model }
}

export function formatProviderModelReference(
  provider: APIProvider,
  modelId: string,
): string {
  return `${provider}/${modelId}`
}

/**
 * 将持久化的 provider/model 身份解析为请求所需的 Provider 与原始模型 ID。
 * 旧配置中的裸模型名只有在能够唯一匹配时才会自动迁移，避免同名模型串线。
 */
export function resolveProviderModelReference(
  value: string,
  fallbackProvider?: APIProvider,
): ProviderModelReference | undefined {
  const normalized = value.trim().replace(/\[(1|2)m\]$/i, '')
  if (!normalized) return undefined

  const separatorIndex = normalized.indexOf('/')
  if (separatorIndex > 0) {
    const providerId = normalized.slice(0, separatorIndex)
    const modelId = normalized.slice(separatorIndex + 1)
    const provider = getProviderDefinition(providerId)
    if (!provider || !modelId || !getProviderModel(provider.id, modelId)) {
      return undefined
    }
    return {
      provider: provider.id,
      modelId,
      value: formatProviderModelReference(provider.id, modelId),
    }
  }

  const matchingProviders = PROVIDER_DEFINITIONS.filter(definition =>
    definition.models.some(model => model.id === normalized),
  )
  const preferred = fallbackProvider
    ? matchingProviders.find(definition => definition.id === fallbackProvider)
    : undefined
  const provider = preferred ??
    (matchingProviders.length === 1 ? matchingProviders[0] : undefined)

  if (provider) {
    return {
      provider: provider.id,
      modelId: normalized,
      value: formatProviderModelReference(provider.id, normalized),
    }
  }

  if (fallbackProvider && getProviderModel(fallbackProvider, normalized)) {
    return {
      provider: fallbackProvider,
      modelId: normalized,
      value: formatProviderModelReference(fallbackProvider, normalized),
    }
  }

  return undefined
}

export function getProviderModelByReference(
  value: string,
  fallbackProvider?: APIProvider,
): { provider: ProviderDefinition; model: ProviderModel } | undefined {
  const reference = resolveProviderModelReference(value, fallbackProvider)
  if (!reference) return undefined
  return getProviderModel(reference.provider, reference.modelId)
}

export function getWebSearchStrategyForModel(
  value: string,
  fallbackProvider?: APIProvider,
): ProviderWebSearchStrategy | undefined {
  const reference = resolveProviderModelReference(value, fallbackProvider)
  if (!reference) return undefined
  return getProviderWebSearchStrategy(reference.provider)
}

export function modelSupportsNativeWebSearch(
  value: string,
  fallbackProvider?: APIProvider,
): boolean {
  return (
    getWebSearchStrategyForModel(value, fallbackProvider)?.kind ===
    'native-anthropic-server-tool'
  )
}
