import { getProviderCredential } from '../utils/authStore.js'
import { getProviderDefinition } from '../utils/model/providerDefinitions.js'
import type { APIProvider } from '../utils/model/types.js'

const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance'
const BALANCE_REQUEST_TIMEOUT_MS = 3000

export type ProviderCredentialDisplay = {
  connected: boolean
  sourceLabel: string
}

export type DeepSeekBalanceInfo = {
  currency: string
  totalBalance: string
  grantedBalance: string
  toppedUpBalance: string
}

export type ProviderAccountStatus =
  | {
      kind: 'loading'
      credential: ProviderCredentialDisplay
    }
  | {
      kind: 'not-configured'
      credential: ProviderCredentialDisplay
    }
  | {
      kind: 'deepseek-balance'
      credential: ProviderCredentialDisplay
      available: boolean
      balances: DeepSeekBalanceInfo[]
    }
  | {
      kind: 'connected'
      credential: ProviderCredentialDisplay
    }
  | {
      kind: 'unavailable'
      credential: ProviderCredentialDisplay
      message: string
    }

type DeepSeekBalanceResponse = {
  is_available?: unknown
  balance_infos?: unknown
}

type LoadProviderAccountStatusOptions = {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
}

function getCredentialDisplay(provider: APIProvider): {
  credential: ProviderCredentialDisplay
  apiKey?: string
} {
  const definition = getProviderDefinition(provider)
  try {
    const credential = getProviderCredential(provider)
    if (!credential) {
      return {
        credential: { connected: false, sourceLabel: '未配置凭据' },
      }
    }
    return {
      credential: {
        connected: true,
        sourceLabel:
          credential.source === 'environment'
            ? definition?.apiKeyEnvVar ?? '环境变量'
            : '本地凭据',
      },
      apiKey: credential.apiKey,
    }
  } catch {
    return {
      credential: { connected: false, sourceLabel: '凭据文件不可用' },
    }
  }
}

function isBalanceInfo(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.currency === 'string' &&
    typeof item.total_balance === 'string' &&
    typeof item.granted_balance === 'string' &&
    typeof item.topped_up_balance === 'string'
  )
}

export function parseDeepSeekBalanceResponse(
  value: unknown,
): { available: boolean; balances: DeepSeekBalanceInfo[] } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const response = value as DeepSeekBalanceResponse
  if (
    typeof response.is_available !== 'boolean' ||
    !Array.isArray(response.balance_infos) ||
    !response.balance_infos.every(isBalanceInfo)
  ) {
    return undefined
  }
  return {
    available: response.is_available,
    balances: response.balance_infos.map(item => ({
      currency: item.currency,
      totalBalance: item.total_balance,
      grantedBalance: item.granted_balance,
      toppedUpBalance: item.topped_up_balance,
    })),
  }
}

export function getInitialProviderAccountStatus(
  provider: APIProvider,
): ProviderAccountStatus {
  const { credential } = getCredentialDisplay(provider)
  if (!credential.connected) return { kind: 'not-configured', credential }
  // 仅 DeepSeek 提供官方余额接口；其余 Provider（含自定义端点）直接显示已连接，
  // 避免把凭据发往不匹配的余额端点。
  if (provider !== 'deepseek') {
    return { kind: 'connected', credential }
  }
  return { kind: 'loading', credential }
}

export async function loadProviderAccountStatus(
  provider: APIProvider,
  options: LoadProviderAccountStatusOptions = {},
): Promise<ProviderAccountStatus> {
  const { credential, apiKey } = getCredentialDisplay(provider)
  if (!credential.connected || !apiKey) {
    return { kind: 'not-configured', credential }
  }
  if (provider !== 'deepseek') {
    return { kind: 'connected', credential }
  }

  const controller = new AbortController()
  const abortFromCaller = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) abortFromCaller()
  else options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timeout = setTimeout(
    () => controller.abort(new Error('余额查询超时')),
    options.timeoutMs ?? BALANCE_REQUEST_TIMEOUT_MS,
  )

  try {
    const response = await (options.fetchImpl ?? globalThis.fetch)(
      DEEPSEEK_BALANCE_URL,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      },
    )
    if (!response.ok) {
      return {
        kind: 'unavailable',
        credential,
        message: `余额查询失败（HTTP ${response.status}）`,
      }
    }
    const parsed = parseDeepSeekBalanceResponse(await response.json())
    if (!parsed) {
      return {
        kind: 'unavailable',
        credential,
        message: '余额响应格式无法识别',
      }
    }
    return {
      kind: 'deepseek-balance',
      credential,
      ...parsed,
    }
  } catch {
    return {
      kind: 'unavailable',
      credential,
      message: '余额暂时无法查询',
    }
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}

export { DEEPSEEK_BALANCE_URL }
