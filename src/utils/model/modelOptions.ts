// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { getAllProviderDefinitions } from './providerDefinitions.js'
import { getProviderCredential } from '../authStore.js'
import { getGlobalConfig } from '../config.js'
import { getMainLoopModel, type ModelSetting } from './model.js'
import { formatProviderModelReference } from './providerDefinitions.js'

export type ModelOption = {
  value: ModelSetting
  label: string
  description: string
  descriptionForModel?: string
}

export function getModelOptions(): ModelOption[] {
  const options: ModelOption[] = []
  const config = getGlobalConfig()

  // 从已配置凭据的 Provider 生成模型选项
  for (const def of getAllProviderDefinitions()) {
    if (!getProviderCredential(def.id)) continue
    for (const model of def.models) {
      const value = formatProviderModelReference(def.id, model.id)
      options.push({
        value,
        label: model.id,
        description: `${def.label} · ${model.id}`,
      })
    }
    for (const modelId of config.providerModels?.[def.id] ?? []) {
      const value = formatProviderModelReference(def.id, modelId)
      if (options.some(option => option.value === value)) continue
      options.push({
        value,
        label: modelId,
        description: `${def.label} · 自定义模型`,
      })
    }
  }

  // 追加当前模型
  const currentModel = getMainLoopModel()
  if (currentModel && !options.some(o => o.value === currentModel)) {
    options.push({ value: currentModel, label: currentModel, description: '当前模型' })
  }

  return options
}
