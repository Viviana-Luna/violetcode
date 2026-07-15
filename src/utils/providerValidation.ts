import { readAuthStore } from './authStore.js'
import { PROVIDER_DEFINITIONS } from './model/providerDefinitions.js'
import { sanitizeApiKey } from './providerSecrets.js'
import type { APIProvider } from './model/types.js'

export type ProviderValidationResult = {
  ok: boolean
  provider: APIProvider | undefined
  errors: string[]
  warnings: string[]
}

function urlLooksValid(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function validateProviderEnvironment(): ProviderValidationResult {
  const store = readAuthStore()
  const errors: string[] = []
  const warnings: string[] = []
  let provider: APIProvider | undefined

  for (const def of PROVIDER_DEFINITIONS) {
    const apiKey = sanitizeApiKey(store[def.id]?.apiKey)
    if (apiKey) {
      provider = def.id
      break
    }
  }

  if (!provider) {
    errors.push(
      'No provider API key configured. Run setup to configure a provider.',
    )
  }

  return { ok: errors.length === 0, provider, errors, warnings }
}

export function getProviderEnvironmentValidationError(): string | null {
  const result = validateProviderEnvironment()
  return result.errors[0] ?? null
}

export type ProviderProfileValidationInput = {
  baseUrl: string
  apiKey: string
  modelName: string
}

export function validateProviderProfileInput(
  input: ProviderProfileValidationInput,
): string | null {
  const baseUrl = input.baseUrl.trim()
  if (!baseUrl) {
    return 'API base URL is required.'
  }
  if (!urlLooksValid(baseUrl)) {
    return 'API base URL must be a valid http:// or https:// URL.'
  }

  if (!sanitizeApiKey(input.apiKey)) {
    return 'API key is required.'
  }

  if (!input.modelName.trim()) {
    return 'Model name is required.'
  }

  return null
}
