import { getSettings_DEPRECATED } from '../settings/settings.js'

function prefixMatchesModel(modelName: string, prefix: string): boolean {
  if (!modelName.startsWith(prefix)) {
    return false
  }
  return modelName.length === prefix.length || modelName[prefix.length] === '-'
}

function modelMatchesVersionPrefix(model: string, entry: string): boolean {
  if (prefixMatchesModel(model, entry)) {
    return true
  }
  if (
    !entry.startsWith('claude-') &&
    prefixMatchesModel(model, `claude-${entry}`)
  ) {
    return true
  }
  return false
}

export function isModelAllowed(model: string): boolean {
  const settings = getSettings_DEPRECATED() || {}
  const { availableModels } = settings
  if (!availableModels) {
    return true
  }
  if (availableModels.length === 0) {
    return false
  }

  const normalizedModel = model.trim().toLowerCase()
  const normalizedAllowlist = availableModels.map(m => m.trim().toLowerCase())

  if (normalizedAllowlist.includes(normalizedModel)) {
    return true
  }

  for (const entry of normalizedAllowlist) {
    if (modelMatchesVersionPrefix(normalizedModel, entry)) {
      return true
    }
  }

  return false
}
