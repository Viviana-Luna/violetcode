/**
 * 内置 Provider 使用字面量 id；用户自定义 Provider 使用 `custom-` 前缀 id，
 * 因此整体放宽为 string，同时保留内置 id 的自动补全。
 */
export type APIProvider = 'deepseek' | 'volcengineArk' | (string & {})

export type SearchProviderId = 'exa'

export type ProviderModelCapabilities = {
  thinking: boolean
  toolUse: boolean
  images: boolean
  betaHeaders: boolean
}

export type ProviderModel = {
  id: string
  contextWindow?: number
  /** Provider 官方允许的单次输出硬上限。 */
  maxOutputTokens?: number
  /** VioletCode 发起普通请求时采用的安全默认值。 */
  defaultMaxOutputTokens?: number
  capabilities: ProviderModelCapabilities
}

export type ProviderWebSearchStrategy =
  | {
      kind: 'native-anthropic-server-tool'
      toolType: 'web_search_20250305'
      maxUses: number
    }
  | {
      kind: 'client-search-provider'
      provider: SearchProviderId
    }

export type ProviderDefinition = {
  id: APIProvider
  label: string
  baseUrl: string
  authMethod: 'x-api-key' | 'bearer'
  apiKeyEnvVar: string
  models: ProviderModel[]
  allowCustomModels: boolean
  unknownModelDefaults?: Omit<ProviderModel, 'id'>
  webSearch: ProviderWebSearchStrategy
}

export type ProviderProfile = {
  id: string
  name: string
  provider: APIProvider
  apiKey: string
  models: ProviderModel[]
}

/** 自定义 Provider 的认证方式，与 ProviderDefinition.authMethod 对齐。 */
export type CustomProviderAuthMethod = 'x-api-key' | 'bearer'

/** 自定义 Provider 的网页搜索链路：端点原生服务端搜索或 Exa 客户端搜索。 */
export type CustomProviderWebSearch = 'native' | 'exa'

/** 用户在新增自定义模型时显式配置的字段；其余能力走保守默认。 */
export type CustomProviderModelConfig = {
  id: string
  contextWindow?: number
  thinking?: boolean
}

/** 持久化在 GlobalConfig 中的用户自定义 Provider（Anthropic Messages 兼容端点）。 */
export type CustomProviderConfig = {
  id: string
  label: string
  baseUrl: string
  authMethod: CustomProviderAuthMethod
  webSearch: CustomProviderWebSearch
  models: CustomProviderModelConfig[]
}
