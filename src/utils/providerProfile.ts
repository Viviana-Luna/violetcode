import type { GlobalConfig, UserCustomModelProfile } from './config.js'
import {
  clearManagedProviderEnv,
  getPrimaryModel,
  normalizeProviderBaseUrl,
  parseModelList,
} from './model/providerPresets.js'
import { getProviderDefinition } from './model/providerDefinitions.js'
import { sanitizeApiKey } from './providerSecrets.js'
import { validateProviderProfileInput } from './providerValidation.js'
import type { APIProvider } from './model/types.js'

export type ProviderProfileInput = {
  id?: string
  name?: string
  provider?: string
  baseUrl: string
  apiKey: string
  modelName: string
}

function hashProfileId(value: string): string {
  let hash = 5381
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

function normalizeApiKeyForConfig(apiKey: string): string {
  return apiKey.slice(-20)
}

function hostFromBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

function resolveProviderFromBaseUrl(baseUrl: string): APIProvider {
  try {
    const host = new URL(baseUrl).hostname
    if (host.includes('volces.com')) {
      return 'volcengineArk'
    }
  } catch {
    // ignore invalid URLs and fall back to default
  }
  return 'deepseek'
}

function resolveProviderId(
  provider: string | undefined,
  baseUrl: string,
): string {
  if (provider) {
    return provider
  }
  return resolveProviderFromBaseUrl(baseUrl)
}

export function getProviderProfileModels(
  profile: UserCustomModelProfile,
): string[] {
  return parseModelList(profile.modelName)
}

export function createProviderProfile(
  input: ProviderProfileInput,
): UserCustomModelProfile {
  const baseUrl = normalizeProviderBaseUrl(input.baseUrl)
  const apiKey = sanitizeApiKey(input.apiKey) ?? input.apiKey.trim()
  const modelName = input.modelName.trim()
  const provider = resolveProviderId(input.provider, baseUrl)
  const id =
    input.id ??
    `provider-${hashProfileId(`${provider}:${baseUrl}:${modelName}`)}`

  return {
    id,
    name: input.name?.trim() || undefined,
    provider,
    baseUrl,
    apiKey,
    modelName,
  }
}

export function normalizeProviderProfile(
  profile: UserCustomModelProfile,
): UserCustomModelProfile {
  return createProviderProfile(profile)
}

export function getProviderProfileDescription(
  profile: UserCustomModelProfile,
): string {
  const normalized = normalizeProviderProfile(profile)
  const def = normalized.provider
    ? getProviderDefinition(normalized.provider)
    : undefined
  const label = def?.label ?? normalized.provider ?? 'Custom'
  return `${label} · ${hostFromBaseUrl(normalized.baseUrl)}`
}

export function getProviderProfileDisplayName(
  profile: UserCustomModelProfile,
): string {
  const normalized = normalizeProviderProfile(profile)
  return normalized.name || normalized.modelName
}

export function resolveProviderProfileFromModel(
  profiles: readonly UserCustomModelProfile[],
  modelName: string,
): UserCustomModelProfile | undefined {
  return profiles.find(profile =>
    getProviderProfileModels(profile).includes(modelName),
  )
}

export function upsertProviderProfile(
  profiles: readonly UserCustomModelProfile[],
  profile: UserCustomModelProfile,
): UserCustomModelProfile[] {
  const normalized = normalizeProviderProfile(profile)
  const next = profiles.filter(existing => {
    const existingNormalized = normalizeProviderProfile(existing)
    if (existingNormalized.id === normalized.id) {
      return false
    }
    return !(
      existingNormalized.baseUrl === normalized.baseUrl &&
      existingNormalized.modelName === normalized.modelName
    )
  })
  return [...next, normalized]
}

export function removeProviderProfile(
  profiles: readonly UserCustomModelProfile[],
  idOrModelName: string,
): {
  profiles: UserCustomModelProfile[]
  removedModels: string[]
  removedProfileId?: string
} {
  const removedModels = new Set<string>()
  let removedProfileId: string | undefined

  const next = profiles.filter(profile => {
    const normalized = normalizeProviderProfile(profile)
    const shouldRemove =
      normalized.id === idOrModelName || normalized.modelName === idOrModelName
    if (shouldRemove) {
      removedProfileId = normalized.id
      for (const model of getProviderProfileModels(normalized)) {
        removedModels.add(model)
      }
      return false
    }
    return true
  })

  return {
    profiles: next,
    removedModels: [...removedModels],
    removedProfileId,
  }
}

export function applyProviderProfileEnv(
  targetEnv: Record<string, string | undefined>,
  profile: UserCustomModelProfile,
  selectedModelName?: string,
): void {
  const normalized = normalizeProviderProfile(profile)
  const modelName =
    selectedModelName?.trim() || getPrimaryModel(normalized.modelName)

  clearManagedProviderEnv(targetEnv)

  targetEnv.ANTHROPIC_BASE_URL = normalized.baseUrl
  targetEnv.ANTHROPIC_MODEL = modelName

  const def = normalized.provider
    ? getProviderDefinition(normalized.provider)
    : undefined
  if (def) {
    targetEnv[def.apiKeyEnvVar] = normalized.apiKey
    if (def.authMethod === 'x-api-key') {
      targetEnv.ANTHROPIC_API_KEY = normalized.apiKey
    } else {
      targetEnv.ANTHROPIC_AUTH_TOKEN = normalized.apiKey
    }
  } else {
    targetEnv.ANTHROPIC_API_KEY = normalized.apiKey
  }
}

function approveApiKey(
  current: GlobalConfig,
  apiKey: string,
): GlobalConfig['customApiKeyResponses'] {
  const normalizedKey = normalizeApiKeyForConfig(apiKey)
  return {
    ...current.customApiKeyResponses,
    approved: [
      ...(current.customApiKeyResponses?.approved ?? []).filter(
        key => key !== normalizedKey,
      ),
      normalizedKey,
    ],
    rejected: (current.customApiKeyResponses?.rejected ?? []).filter(
      key => key !== normalizedKey,
    ),
  }
}

export function applyProviderProfileToGlobalConfig(
  current: GlobalConfig,
  profile: UserCustomModelProfile,
  selectedModelName?: string,
): GlobalConfig {
  const validationError = validateProviderProfileInput(profile)
  if (validationError) {
    return current
  }

  const normalized = normalizeProviderProfile(profile)
  const env = { ...current.env }
  applyProviderProfileEnv(env, normalized, selectedModelName)

  return {
    ...current,
    env: env as { [key: string]: string },
    activeProviderProfileId: normalized.id,
    customApiKeyResponses: approveApiKey(current, normalized.apiKey),
  }
}
