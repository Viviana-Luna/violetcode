import { getProviderWebSearchStrategy } from './providerDefinitions.js'
import type { APIProvider } from './types.js'

export type ProviderSetupCredentialTarget = 'provider' | 'exa'
export type ProviderSetupContinuation = 'complete' | 'capability'

/**
 * 使用客户端搜索服务的 Provider 包含必填的模型凭据和可选的搜索凭据。
 * 保存其中任一项后都应回到能力配置页，交由用户确认完整状态；仅使用
 * 端点原生搜索的 Provider 保持单凭据直达完成。
 */
export function getProviderSetupContinuation(
  provider: APIProvider,
  _target: ProviderSetupCredentialTarget,
): ProviderSetupContinuation {
  return getProviderWebSearchStrategy(provider)?.kind ===
    'client-search-provider'
    ? 'capability'
    : 'complete'
}

/** 只有模型 Provider 凭据存在时，连接流程才可以宣告完成。 */
export function canCompleteProviderSetup(
  provider: APIProvider,
  hasProviderCredential: boolean,
): boolean {
  return (
    getProviderWebSearchStrategy(provider)?.kind !== 'client-search-provider' ||
    hasProviderCredential
  )
}
