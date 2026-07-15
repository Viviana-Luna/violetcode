import type { AppState } from '../state/AppState.js'
import { getInitialSettings } from './settings/settings.js'

export type AttributionTexts = {
  commit: string
  pr: string
}

/**
 * 只返回用户显式配置的归属文本。
 * VioletCode 不会默认向提交或 PR 注入产品署名、模型统计或会话链接。
 */
export function getAttributionTexts(): AttributionTexts {
  const settings = getInitialSettings()
  return {
    commit: settings.attribution?.commit ?? '',
    pr: settings.attribution?.pr ?? '',
  }
}

/**
 * 保留现有命令接口，但不读取会话记录或推导贡献比例。
 */
export async function getEnhancedPRAttribution(
  _getAppState: () => AppState,
): Promise<string> {
  return getInitialSettings().attribution?.pr ?? ''
}
