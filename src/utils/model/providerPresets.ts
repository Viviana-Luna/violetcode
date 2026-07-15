import type { APIProvider } from './types.js'
import { getProviderDefinition } from './providerDefinitions.js'
import { getProviderApiKey } from '../authStore.js'

export const MANAGED_PROVIDER_ENV_KEYS: readonly string[] = [
  'VIOLET_PROVIDER',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
]

export function clearManagedProviderEnv(
  targetEnv: Record<string, string | undefined>,
): void {
  for (const key of MANAGED_PROVIDER_ENV_KEYS) {
    delete targetEnv[key]
  }
}

export function applyProviderEnv(
  targetEnv: Record<string, string | undefined>,
  provider: APIProvider,
  modelId?: string,
): void {
  const def = getProviderDefinition(provider)
  if (!def) return
  const apiKey = getProviderApiKey(provider) ?? ''
  clearManagedProviderEnv(targetEnv)

  targetEnv.VIOLET_PROVIDER = provider
  targetEnv.ANTHROPIC_BASE_URL = def.baseUrl
  targetEnv.ANTHROPIC_MODEL = modelId ?? def.models[0]?.id ?? ''

  if (def.authMethod === 'x-api-key') {
    targetEnv.ANTHROPIC_API_KEY = apiKey
  } else {
    targetEnv.ANTHROPIC_AUTH_TOKEN = apiKey
  }
}

export function parseModelList(modelField: string): string[] {
  return modelField
    .split(/[;,]/)
    .map(part => part.trim())
    .filter(part => part.length > 0)
}

export function getPrimaryModel(modelField: string): string {
  const models = parseModelList(modelField)
  return models.length > 0 ? models[0] : modelField.trim()
}

export function normalizeProviderBaseUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return trimmed
  }
  try {
    return new URL(trimmed).toString().replace(/\/$/, '')
  } catch {
    return trimmed
  }
}
