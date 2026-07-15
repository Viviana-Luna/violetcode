import type { APIProvider } from './types.js'
import { getProviderApiKey } from '../authStore.js'
import {
  getProviderDefinition,
  PROVIDER_DEFINITIONS,
  resolveProviderModelReference,
} from './providerDefinitions.js'

export type { APIProvider }

export function getAPIProvider(model?: string): APIProvider {
  if (model) {
    const reference = resolveProviderModelReference(model)
    if (reference) return reference.provider
  }

  const envProvider = process.env.VIOLET_PROVIDER as APIProvider | undefined
  if (envProvider && getProviderDefinition(envProvider)) {
    return envProvider
  }

  const environmentModel = process.env.ANTHROPIC_MODEL
  if (environmentModel) {
    const reference = resolveProviderModelReference(environmentModel)
    if (reference) return reference.provider
  }

  const configured = PROVIDER_DEFINITIONS.find(definition =>
    Boolean(getProviderApiKey(definition.id)),
  )
  if (configured) return configured.id
  return 'deepseek'
}

export function getAPIProviderForStatsig(): APIProvider {
  return getAPIProvider()
}

export function isAnthropicCompatibleProvider(): boolean {
  return true
}

export function getAPIProviderDisplayName(provider: APIProvider): string {
  return getProviderDefinition(provider)?.label ?? provider
}

export function hasCustomAnthropicBaseUrl(): boolean {
  return true
}

export function hasConfiguredCustomApi(): boolean {
  return PROVIDER_DEFINITIONS.some(definition =>
    Boolean(getProviderApiKey(definition.id)),
  )
}

export function needsCustomApiSetup(): boolean {
  return !hasConfiguredCustomApi()
}

export function needsProviderSetup(requiredProvider?: APIProvider): boolean {
  return requiredProvider
    ? !getProviderApiKey(requiredProvider)
    : needsCustomApiSetup()
}

// Stubs for backward compatibility
export function isFirstPartyAnthropicBaseUrl(): boolean {
  return false
}
export function isDeepSeekAnthropicBaseUrl(): boolean {
  return false
}
