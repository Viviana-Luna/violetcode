import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import {
  formatProviderModelReference,
  getProviderDefinition,
} from './providerDefinitions.js'
import type { APIProvider } from './types.js'

const MAX_REMEMBERED_MODELS = 20

export function getRememberedProviderModels(provider: APIProvider): string[] {
  return getGlobalConfig().providerModels?.[provider] ?? []
}

export function rememberProviderModel(
  provider: APIProvider,
  modelId: string,
): string {
  const definition = getProviderDefinition(provider)
  const normalizedModelId = modelId.trim()
  if (!definition?.allowCustomModels) {
    throw new Error(`Provider ${provider} 不允许输入自定义模型 ID`)
  }
  if (!normalizedModelId || /[\s\u0000-\u001f\u007f]/u.test(normalizedModelId)) {
    throw new Error('模型 ID 不能为空，也不能包含空白或控制字符')
  }

  saveGlobalConfig(config => {
    const current = config.providerModels?.[provider] ?? []
    const next = [
      normalizedModelId,
      ...current.filter(item => item !== normalizedModelId),
    ].slice(0, MAX_REMEMBERED_MODELS)
    return {
      ...config,
      providerModels: {
        ...config.providerModels,
        [provider]: next,
      },
    }
  })
  return formatProviderModelReference(provider, normalizedModelId)
}
