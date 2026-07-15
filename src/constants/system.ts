// Critical system constants extracted to break circular dependencies

const DEFAULT_PREFIX = `You are VioletCode, a personal AI coding CLI created and maintained by Violet.`
const AGENT_SDK_PRODUCT_PRESET_PREFIX = `You are VioletCode, a personal AI coding CLI created and maintained by Violet, running in Agent SDK compatibility mode.`
const AGENT_SDK_PREFIX = `You are a Violet agent, running in Agent SDK compatibility mode.`

const CLI_SYSPROMPT_PREFIX_VALUES = [
  DEFAULT_PREFIX,
  AGENT_SDK_PRODUCT_PRESET_PREFIX,
  AGENT_SDK_PREFIX,
] as const

export type CLISyspromptPrefix = (typeof CLI_SYSPROMPT_PREFIX_VALUES)[number]

/**
 * All possible CLI sysprompt prefix values, used by splitSysPromptPrefix
 * to identify prefix blocks by content rather than position.
 */
export const CLI_SYSPROMPT_PREFIXES: ReadonlySet<string> = new Set(
  CLI_SYSPROMPT_PREFIX_VALUES,
)

export function getCLISyspromptPrefix(options?: {
  isNonInteractive: boolean
  hasAppendSystemPrompt: boolean
}): CLISyspromptPrefix {
  if (options?.isNonInteractive) {
    if (options.hasAppendSystemPrompt) {
      return AGENT_SDK_PRODUCT_PRESET_PREFIX
    }
    return AGENT_SDK_PREFIX
  }
  return DEFAULT_PREFIX
}

/**
 * Provider 请求不附加上游计费、指纹或客户端证明信息。
 * 参数保留用于兼容现有调用接口。
 */
export function getAttributionHeader(_fingerprint: string): string {
  return ''
}
