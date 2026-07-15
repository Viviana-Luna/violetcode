import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'
import { getVioletConfigHomeDir } from './envUtils.js'
import { PROVIDER_DEFINITIONS } from './model/providerDefinitions.js'
import type { APIProvider, SearchProviderId } from './model/types.js'

type ApiKeyEntry = { apiKey: string }

export type AuthStore = Partial<Record<APIProvider, ApiKeyEntry>> & {
  searchServices?: Partial<Record<SearchProviderId, ApiKeyEntry>>
}
export type ApiCredential = {
  apiKey: string
  source: 'environment' | 'auth-store'
}
export type ProviderCredential = ApiCredential

const SEARCH_SERVICE_ENV_VARS: Record<SearchProviderId, string> = {
  exa: 'EXA_API_KEY',
}

export function getAuthStorePath(): string {
  return join(getVioletConfigHomeDir(), 'auth.json')
}

export function readAuthStore(): AuthStore {
  try {
    const content = readFileSync(getAuthStorePath(), 'utf-8')
    const parsed: unknown = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('凭据文件必须是 JSON 对象')
    }

    const store: AuthStore = {}
    for (const definition of PROVIDER_DEFINITIONS) {
      const entry = (parsed as Record<string, unknown>)[definition.id]
      if (entry === undefined) continue
      if (
        !entry ||
        typeof entry !== 'object' ||
        typeof (entry as { apiKey?: unknown }).apiKey !== 'string'
      ) {
        throw new Error(`Provider ${definition.id} 的凭据格式无效`)
      }
      const apiKey = (entry as { apiKey: string }).apiKey.trim()
      if (apiKey) store[definition.id] = { apiKey }
    }

    const searchServices = (parsed as Record<string, unknown>).searchServices
    if (searchServices !== undefined) {
      if (
        !searchServices ||
        typeof searchServices !== 'object' ||
        Array.isArray(searchServices)
      ) {
        throw new Error('搜索服务凭据必须是 JSON 对象')
      }

      const storedServices: AuthStore['searchServices'] = {}
      for (const service of Object.keys(SEARCH_SERVICE_ENV_VARS) as SearchProviderId[]) {
        const entry = (searchServices as Record<string, unknown>)[service]
        if (entry === undefined) continue
        if (
          !entry ||
          typeof entry !== 'object' ||
          typeof (entry as { apiKey?: unknown }).apiKey !== 'string'
        ) {
          throw new Error(`搜索服务 ${service} 的凭据格式无效`)
        }
        const apiKey = (entry as ApiKeyEntry).apiKey.trim()
        if (apiKey) storedServices[service] = { apiKey }
      }
      if (Object.keys(storedServices).length > 0) {
        store.searchServices = storedServices
      }
    }
    return store
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`无法读取 Provider 凭据文件 ${getAuthStorePath()}：${message}`)
  }
}

export function writeAuthStore(store: AuthStore): void {
  const dir = getVioletConfigHomeDir()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = getAuthStorePath()
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, {
      encoding: 'utf-8',
      flag: 'wx',
      mode: 0o600,
    })
    renameSync(temporaryPath, path)
    chmodSync(path, 0o600)
  } catch (error) {
    try {
      unlinkSync(temporaryPath)
    } catch {
      // 临时文件可能尚未创建或已被 rename，忽略清理错误。
    }
    throw error
  }
}

export function getProviderCredential(
  provider: APIProvider,
): ProviderCredential | undefined {
  const definition = PROVIDER_DEFINITIONS.find(item => item.id === provider)
  const environmentApiKey = definition
    ? process.env[definition.apiKeyEnvVar]?.trim()
    : undefined
  if (environmentApiKey) {
    return { apiKey: environmentApiKey, source: 'environment' }
  }
  const store = readAuthStore()
  const storedApiKey = store[provider]?.apiKey
  return storedApiKey
    ? { apiKey: storedApiKey, source: 'auth-store' }
    : undefined
}

export function getProviderApiKey(provider: APIProvider): string | undefined {
  return getProviderCredential(provider)?.apiKey
}

export function getSearchServiceApiKeyEnvVar(
  service: SearchProviderId,
): string {
  return SEARCH_SERVICE_ENV_VARS[service]
}

export function getSearchServiceCredential(
  service: SearchProviderId,
): ApiCredential | undefined {
  const environmentApiKey = process.env[
    getSearchServiceApiKeyEnvVar(service)
  ]?.trim()
  if (environmentApiKey) {
    return { apiKey: environmentApiKey, source: 'environment' }
  }
  const storedApiKey = readAuthStore().searchServices?.[service]?.apiKey
  return storedApiKey
    ? { apiKey: storedApiKey, source: 'auth-store' }
    : undefined
}

export function getSearchServiceApiKey(
  service: SearchProviderId,
): string | undefined {
  return getSearchServiceCredential(service)?.apiKey
}

export function setProviderApiKey(provider: APIProvider, apiKey: string): void {
  const normalizedApiKey = apiKey.trim()
  if (!normalizedApiKey) {
    throw new Error('API Key 不能为空')
  }
  const store = readAuthStore()
  store[provider] = { apiKey: normalizedApiKey }
  writeAuthStore(store)
}

export function setSearchServiceApiKey(
  service: SearchProviderId,
  apiKey: string,
): void {
  const normalizedApiKey = apiKey.trim()
  if (!normalizedApiKey) {
    throw new Error('API Key 不能为空')
  }
  const store = readAuthStore()
  store.searchServices = {
    ...store.searchServices,
    [service]: { apiKey: normalizedApiKey },
  }
  writeAuthStore(store)
}
