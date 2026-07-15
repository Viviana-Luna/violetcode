export type APIProvider = 'deepseek' | 'volcengineArk'

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
