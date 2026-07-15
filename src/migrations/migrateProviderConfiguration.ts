import { readAuthStore, writeAuthStore } from '../utils/authStore.js'
import {
  getGlobalConfig,
  saveGlobalConfig,
  type GlobalConfig,
  type UserCustomModelProfile,
} from '../utils/config.js'
import {
  formatProviderModelReference,
  getProviderDefinition,
  PROVIDER_DEFINITIONS,
  resolveProviderModelReference,
} from '../utils/model/providerDefinitions.js'
import { applyProviderEnv } from '../utils/model/providerPresets.js'
import type { APIProvider } from '../utils/model/types.js'
import {
  getSettings_DEPRECATED,
  updateSettingsForSource,
} from '../utils/settings/settings.js'

export const CURRENT_PROVIDER_MIGRATION_VERSION = 3

const LEGACY_CREDENTIAL_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'DEEPSEEK_API_KEY',
  'VOLCENGINE_ARK_API_KEY',
] as const

const LEGACY_PROVIDER_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  ...LEGACY_CREDENTIAL_KEYS,
] as const

export function identifyKnownProviderBaseUrl(
  baseUrl: string | undefined,
): APIProvider | undefined {
  if (!baseUrl) return undefined
  try {
    const url = new URL(baseUrl)
    const path = url.pathname.replace(/\/$/, '')
    for (const definition of PROVIDER_DEFINITIONS) {
      const known = new URL(definition.baseUrl)
      const knownPath = known.pathname.replace(/\/$/, '')
      if (
        url.protocol === known.protocol &&
        url.hostname === known.hostname &&
        (path === knownPath || path.startsWith(`${knownPath}/`))
      ) {
        return definition.id
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

function getLegacyApiKey(
  source: Record<string, string | undefined>,
  provider: APIProvider,
): string | undefined {
  const definition = getProviderDefinition(provider)
  const candidates = [
    definition ? source[definition.apiKeyEnvVar] : undefined,
    source.ANTHROPIC_API_KEY,
    source.ANTHROPIC_AUTH_TOKEN,
  ]
  return candidates.find(value => Boolean(value?.trim()))?.trim()
}

function normalizeLegacyModel(
  provider: APIProvider,
  model: string | undefined,
): string | undefined {
  const firstModel = model?.split(/[;,]/)[0]?.trim()
  if (!firstModel) return undefined
  return resolveProviderModelReference(firstModel, provider)?.value
}

function modelFromProfile(
  profile: UserCustomModelProfile,
): { provider: APIProvider; model?: string } | undefined {
  const provider = identifyKnownProviderBaseUrl(profile.baseUrl)
  if (!provider) return undefined
  return {
    provider,
    model: normalizeLegacyModel(provider, profile.modelName),
  }
}

function rememberMigratedArkModel(
  models: string[],
  reference: string | undefined,
): string[] {
  if (!reference) return models
  const resolved = resolveProviderModelReference(reference)
  if (!resolved || resolved.provider !== 'volcengineArk') return models
  const definition = getProviderDefinition(resolved.provider)
  if (definition?.models.some(model => model.id === resolved.modelId)) return models
  return [
    resolved.modelId,
    ...models.filter(model => model !== resolved.modelId),
  ].slice(0, 20)
}

/**
 * 将进程级旧 ANTHROPIC_* 变量映射到本次运行使用的显式 Provider。
 * 该函数不写磁盘，避免把外部注入的密钥持久化。
 */
export function mapLegacyProcessProviderEnv(): void {
  if (process.env.VIOLET_PROVIDER) return
  const provider = identifyKnownProviderBaseUrl(process.env.ANTHROPIC_BASE_URL)
  if (!provider) return
  const definition = getProviderDefinition(provider)
  if (!definition) return

  const legacyKey = getLegacyApiKey(process.env, provider)
  if (legacyKey && !process.env[definition.apiKeyEnvVar]) {
    process.env[definition.apiKeyEnvVar] = legacyKey
  }
  const model = normalizeLegacyModel(provider, process.env.ANTHROPIC_MODEL)
  const modelId = model ? resolveProviderModelReference(model)?.modelId : undefined
  applyProviderEnv(process.env, provider, modelId)
}

/**
 * 将旧自定义端点配置一次性收敛到两个受支持 Provider。
 * 无法识别的端点及其密钥直接删除，不再保留明文旁路配置。
 */
export function migrateProviderConfiguration(): void {
  const config = getGlobalConfig()
  if (config.providerMigrationVersion === CURRENT_PROVIDER_MIGRATION_VERSION) {
    return
  }

  const profiles = config.userCustomModelProfiles ?? []
  const activeProfile = profiles.find(
    profile => profile.id === config.activeProviderProfileId,
  )
  const credentialUpdates = new Map<APIProvider, string>()
  let selectedModel: string | undefined
  let selectedProvider: APIProvider | undefined
  let arkModels = [...(config.providerModels?.volcengineArk ?? [])]

  for (const profile of profiles) {
    const migrated = modelFromProfile(profile)
    if (!migrated) continue
    const apiKey = profile.apiKey.trim()
    if (apiKey) credentialUpdates.set(migrated.provider, apiKey)
    arkModels = rememberMigratedArkModel(arkModels, migrated.model)
    if (profile === activeProfile) {
      selectedProvider = migrated.provider
      selectedModel = migrated.model
    }
  }

  const legacyEnv = config.env ?? {}
  const envProvider = identifyKnownProviderBaseUrl(legacyEnv.ANTHROPIC_BASE_URL)
  if (envProvider) {
    const apiKey = getLegacyApiKey(legacyEnv, envProvider)
    if (apiKey) credentialUpdates.set(envProvider, apiKey)
    const envModel = normalizeLegacyModel(envProvider, legacyEnv.ANTHROPIC_MODEL)
    arkModels = rememberMigratedArkModel(arkModels, envModel)
    selectedProvider ??= envProvider
    selectedModel ??= envModel
  }

  const legacyEndpoint = (
    config as GlobalConfig & {
      providerEndpoints?: Partial<Record<APIProvider, string>>
    }
  ).providerEndpoints?.volcengineArk
  const shouldRemoveLegacyArkCredential =
    config.providerMigrationVersion !== undefined &&
    config.providerMigrationVersion < CURRENT_PROVIDER_MIGRATION_VERSION &&
    legacyEndpoint !== 'agent'

  if (credentialUpdates.size > 0 || shouldRemoveLegacyArkCredential) {
    const store = readAuthStore()
    if (shouldRemoveLegacyArkCredential) delete store.volcengineArk
    for (const [provider, apiKey] of credentialUpdates) {
      store[provider] = { apiKey }
    }
    writeAuthStore(store)
  }

  const settingsModel = getSettings_DEPRECATED().model
  const normalizedSettingsModel = settingsModel
    ? resolveProviderModelReference(settingsModel, selectedProvider)?.value
    : undefined
  const nextModel = normalizedSettingsModel ?? selectedModel
  if (nextModel && nextModel !== settingsModel) {
    updateSettingsForSource('userSettings', { model: nextModel })
  }

  saveGlobalConfig(current => {
    const env = { ...(current.env ?? {}) }
    for (const key of LEGACY_PROVIDER_ENV_KEYS) delete env[key]
    const next = {
      ...current,
    } as GlobalConfig & {
      providerEndpoints?: Partial<Record<APIProvider, string>>
    }
    delete next.providerEndpoints
    const migrated = {
      ...next,
      env,
      userCustomModelProfiles: undefined,
      userAddedModelOptions: undefined,
      activeProviderProfileId: undefined,
      providerModels: {
        ...current.providerModels,
        volcengineArk: arkModels,
      },
      providerMigrationVersion: CURRENT_PROVIDER_MIGRATION_VERSION,
    } as GlobalConfig & {
      providerEndpoints?: Partial<Record<APIProvider, string>>
    }
    // 测试配置使用 Object.assign，显式写入 undefined 才能清除旧字段；落盘时会被 JSON 序列化省略。
    migrated.providerEndpoints = undefined
    return migrated
  })
}

export function getDefaultProviderModel(provider: APIProvider): string | undefined {
  const modelId = getProviderDefinition(provider)?.models[0]?.id
  return modelId ? formatProviderModelReference(provider, modelId) : undefined
}
