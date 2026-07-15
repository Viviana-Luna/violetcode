// Stub types for @ant/computer-use-mcp/types

export type ComputerUseHostAdapter = unknown
export type Logger = { debug: (...args: unknown[]) => void; info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void }
export type CoordinateMode = 'absolute' | 'relative' | string
export type CuSubGates = Record<string, boolean>
export type CuPermissionRequest = unknown
export type CuPermissionResponse = unknown

// Re-export value so `import { DEFAULT_GRANT_FLAGS } from '@ant/computer-use-mcp/types'` resolves
export { DEFAULT_GRANT_FLAGS } from './index.js'
