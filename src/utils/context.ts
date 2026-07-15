import { getProviderModelInfo } from './model/model.js'

// Model context window size (200k tokens fallback when ProviderModel is unknown)
export const MODEL_CONTEXT_WINDOW_DEFAULT = 200_000

// Maximum output tokens for compact operations
export const COMPACT_MAX_OUTPUT_TOKENS = 20_000

// Capped default for slot-reservation optimization. BQ p99 output = 4,911
// tokens, so 32k/64k defaults over-reserve 8-16× slot capacity. With the cap
// enabled, <1% of requests hit the limit; those get one clean retry at 64k
// (see query.ts max_output_tokens_escalate).
export const CAPPED_DEFAULT_MAX_TOKENS = 8_000
export const ESCALATED_MAX_TOKENS = 64_000

export function getContextWindowForModel(model: string): number {
  const envOverride = process.env.ANTHROPIC_CONTEXT_WINDOW
  if (envOverride) {
    const n = parseInt(envOverride, 10)
    if (!isNaN(n) && n > 0) return n
  }
  const info = getProviderModelInfo(model)
  return info?.model.contextWindow ?? MODEL_CONTEXT_WINDOW_DEFAULT
}

export function getModelMaxOutputTokens(model: string): {
  default: number
  upperLimit: number
} {
  const envMax = process.env.ANTHROPIC_MAX_OUTPUT_TOKENS
  if (envMax) {
    const n = parseInt(envMax, 10)
    if (!isNaN(n) && n > 0) {
      return { default: Math.min(n, 32_000), upperLimit: n }
    }
  }
  const info = getProviderModelInfo(model)
  const upperLimit = info?.model.maxOutputTokens ?? 32_000
  const configuredDefault = info?.model.defaultMaxOutputTokens ?? upperLimit
  return {
    default: Math.min(configuredDefault, upperLimit),
    upperLimit,
  }
}

export function getMaxThinkingTokensForModel(model: string): number {
  return getModelMaxOutputTokens(model).upperLimit - 1
}

/**
 * Calculate context window usage percentage from token usage data.
 * Returns used and remaining percentages, or null values if no usage data.
 */
export function calculateContextPercentages(
  currentUsage: {
    input_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  } | null,
  contextWindowSize: number,
): { used: number | null; remaining: number | null } {
  if (!currentUsage) {
    return { used: null, remaining: null }
  }

  const totalInputTokens =
    currentUsage.input_tokens +
    currentUsage.cache_creation_input_tokens +
    currentUsage.cache_read_input_tokens

  const usedPercentage = Math.round(
    (totalInputTokens / contextWindowSize) * 100,
  )
  const clampedUsed = Math.min(100, Math.max(0, usedPercentage))

  return {
    used: clampedUsed,
    remaining: 100 - clampedUsed,
  }
}
