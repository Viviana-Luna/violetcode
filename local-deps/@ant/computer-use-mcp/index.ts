// Stub for @ant/computer-use-mcp (Anthropic internal package, not publicly available)
// Provides minimal exports so the module graph resolves. All runtime values are no-ops/stubs.

// --- Value exports ---
export const API_RESIZE_PARAMS = { maxWidth: 1280, maxHeight: 1280 }

export const targetImageSize = 1280

export const DEFAULT_GRANT_FLAGS: Record<string, boolean> = {}

export function bindSessionContext(_ctx: unknown): void {
  throw new Error('@ant/computer-use-mcp stub: bindSessionContext is not available (internal package not installed)')
}

export function buildComputerUseTools(_options: unknown): unknown[] {
  throw new Error('@ant/computer-use-mcp stub: buildComputerUseTools is not available (internal package not installed)')
}

export function createComputerUseMcpServer(_options: unknown): unknown {
  throw new Error('@ant/computer-use-mcp stub: createComputerUseMcpServer is not available (internal package not installed)')
}

// --- Type-only exports (erased at runtime) ---
export type ComputerExecutor = unknown
export type DisplayGeometry = unknown
export type FrontmostApp = unknown
export type InstalledApp = unknown
export type ResolvePrepareCaptureResult = unknown
export type RunningApp = unknown
export type ScreenshotResult = unknown
export type ComputerUseSessionContext = unknown
export type CuCallToolResult = unknown
export type CuPermissionRequest = unknown
export type CuPermissionResponse = unknown
export type ScreenshotDims = unknown
