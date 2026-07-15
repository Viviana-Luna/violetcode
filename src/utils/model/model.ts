import { getMainLoopModelOverride } from '../../bootstrap/state.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import { getAPIProvider } from './providers.js'
import {
  formatProviderModelReference,
  getProviderDefinition,
  getProviderModelByReference,
  resolveProviderModelReference,
} from './providerDefinitions.js'
import type {
  ProviderDefinition,
  ProviderModel,
  ProviderModelCapabilities,
} from './types.js'

export type ModelName = string
export type ModelShortName = string
export type ModelSetting = ModelName | null

export function getSmallFastModel(): ModelName {
  return process.env.ANTHROPIC_SMALL_FAST_MODEL || getMainLoopModel()
}

export function getUserSpecifiedModelSetting(): ModelSetting | undefined {
  const modelOverride = getMainLoopModelOverride()
  if (modelOverride !== undefined) {
    return modelOverride
  }
  const settings = getSettings_DEPRECATED() || {}
  return process.env.ANTHROPIC_MODEL || settings.model || undefined
}

export function getMainLoopModel(): ModelName {
  const model = getUserSpecifiedModelSetting()
  if (model !== undefined && model !== null) {
    return parseUserSpecifiedModel(model)
  }
  return getDefaultMainLoopModel()
}

export function getDefaultMainLoopModel(): ModelName {
  const provider = getAPIProvider()
  const def = getProviderDefinition(provider)
  const modelId = def?.models[0]?.id ?? 'deepseek-v4-pro'
  return formatProviderModelReference(provider, modelId)
}

export function parseUserSpecifiedModel(modelInput: ModelName): ModelName {
  const reference = resolveProviderModelReference(modelInput)
  return reference?.value ?? modelInput.trim()
}

export function normalizeModelStringForAPI(model: string): string {
  const reference = resolveProviderModelReference(model, getAPIProvider(model))
  return reference?.modelId ?? model.replace(/\[(1|2)m\]/gi, '').trim()
}

export function renderModelName(model: ModelName): string {
  return model
}

export function modelDisplayString(model: ModelSetting): string {
  if (model === null) {
    return `Default (${getDefaultMainLoopModel()})`
  }
  return model
}

export function getPublicModelName(model: ModelName): string {
  return model
}

export function getCanonicalName(fullModelName: ModelName): ModelShortName {
  return normalizeModelStringForAPI(fullModelName)
}

export function firstPartyNameToCanonical(name: ModelName): ModelShortName {
  return name
}

export function getModelCapabilities(
  model: ModelName,
): ProviderModelCapabilities | undefined {
  const result = getProviderModelByReference(model, getAPIProvider(model))
  return result?.model.capabilities
}

export function getProviderModelInfo(
  model: ModelName,
): { provider: ProviderDefinition; model: ProviderModel } | undefined {
  return getProviderModelByReference(model, getAPIProvider(model))
}

// Stubs for backward compatibility with callers not yet fully refactored
export function getDefaultMainLoopModelSetting(): ModelName {
  return getDefaultMainLoopModel()
}
export function renderDefaultModelSetting(setting: ModelName | string): string {
  return String(setting)
}
export function isOpus1mMergeEnabled(): boolean {
  return false
}
export function getMarketingNameForModel(_modelId: string): string | undefined {
  return undefined
}
export function getDefaultSonnetModel(): ModelName {
  return getDefaultMainLoopModel()
}
export function getDefaultHaikuModel(): ModelName {
  return getDefaultMainLoopModel()
}
export function getDefaultOpusModel(): ModelName {
  return getDefaultMainLoopModel()
}
export function getBestModel(): ModelName {
  return getDefaultMainLoopModel()
}
export function isNonCustomOpusModel(_model: ModelName): boolean {
  return false
}
export function getRuntimeMainLoopModel(params: {
  permissionMode: unknown
  mainLoopModel: string
  exceeds200kTokens?: boolean
}): ModelName {
  return params.mainLoopModel
}
export function resolveSkillModelOverride(skillModel: string): string {
  return skillModel
}
export function getPublicModelDisplayName(_model: ModelName): string | null {
  return null
}
export function renderModelSetting(setting: ModelName | string): string {
  return String(setting)
}
export function getClaudeAiUserDefaultModelDescription(): string {
  return ''
}
export function getOpus46PricingSuffix(): string {
  return ''
}
