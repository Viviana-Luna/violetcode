import type { Tool } from '../../Tool.js'

type ModelAwareTool = Pick<Tool, 'supportsModel'>

/**
 * 在每次请求前根据当前模型重新筛选工具，避免切换 Provider 后复用旧工具池。
 */
export function filterToolsForModel<T extends ModelAwareTool>(
  tools: readonly T[],
  model: string,
): T[] {
  return tools.filter(tool => tool.supportsModel?.(model) ?? true)
}
