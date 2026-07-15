// Stub for @ant/claude-for-chrome-mcp (Anthropic internal package, not publicly available)
// Provides minimal exports so the module graph resolves. All runtime values are no-ops/stubs.

export type ClaudeForChromeContext = Record<string, unknown>
export type Logger = { debug: (...args: unknown[]) => void; info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void }
export type PermissionMode = 'default' | 'plan' | 'auto' | string

export const BROWSER_TOOLS: unknown[] = []

export async function createClaudeForChromeMcpServer(_options: unknown): Promise<unknown> {
  throw new Error('@ant/claude-for-chrome-mcp stub: createClaudeForChromeMcpServer is not available (internal package not installed)')
}
