import memoize from 'lodash-es/memoize.js'
import { getSdkBetas } from '../bootstrap/state.js'
import { TOOL_SEARCH_BETA_HEADER_1P } from '../constants/betas.js'
import { getModelCapabilities } from './model/model.js'

let hasWarnedAboutIgnoredBetas = false

export function warnBetaHeadersIgnored(model: string): void {
  if (hasWarnedAboutIgnoredBetas) return
  hasWarnedAboutIgnoredBetas = true
  // biome-ignore lint/suspicious/noConsole: 这是用户显式 beta 被忽略时的一次性警告。
  console.warn(`警告：模型 ${model} 不支持 beta header，已忽略相关配置。`)
}

export function filterAllowedSdkBetas(
  sdkBetas: string[] | undefined,
): string[] | undefined {
  const normalized = sdkBetas?.map(beta => beta.trim()).filter(Boolean)
  return normalized && normalized.length > 0 ? [...new Set(normalized)] : undefined
}

export function modelSupportsISP(_model: string): boolean {
  return false
}

export function modelSupportsContextManagement(_model: string): boolean {
  return false
}

export function modelSupportsStructuredOutputs(_model: string): boolean {
  return false
}

export function modelSupportsAutoMode(_model: string): boolean {
  return false
}

export function getToolSearchBetaHeader(): string {
  return TOOL_SEARCH_BETA_HEADER_1P
}

export function shouldIncludeFirstPartyOnlyBetas(): boolean {
  return false
}

export function shouldUseGlobalCacheScope(): boolean {
  return false
}

function shouldWarnForUserBetas(): boolean {
  return Boolean(
    process.env.ANTHROPIC_BETAS ||
      process.env.CLAUDE_CODE_EXTRA_BODY?.includes('anthropic_beta') ||
      getSdkBetas()?.length,
  )
}

export const getAllModelBetas = memoize((model: string): string[] => {
  if (getModelCapabilities(model)?.betaHeaders) {
    return []
  }
  if (shouldWarnForUserBetas()) warnBetaHeadersIgnored(model)
  return []
})

export const getModelBetas = memoize((model: string): string[] =>
  getAllModelBetas(model),
)

export const getBedrockExtraBodyParamsBetas = memoize(
  (_model: string): string[] => [],
)

export function getMergedBetas(
  model: string,
  _options?: { isAgenticQuery?: boolean },
): string[] {
  if (!getModelCapabilities(model)?.betaHeaders) {
    if (shouldWarnForUserBetas()) warnBetaHeadersIgnored(model)
    return []
  }
  return getModelBetas(model)
}

export function clearBetasCaches(): void {
  getAllModelBetas.cache?.clear?.()
  getModelBetas.cache?.clear?.()
  getBedrockExtraBodyParamsBetas.cache?.clear?.()
  hasWarnedAboutIgnoredBetas = false
}
