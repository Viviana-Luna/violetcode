import { getInitialSettings } from '../utils/settings/settings.js'

export function getSpinnerVerbs(): string[] {
  const settings = getInitialSettings()
  const config = settings.spinnerVerbs
  if (!config) {
    return SPINNER_VERBS
  }
  if (config.mode === 'replace') {
    return config.verbs.length > 0 ? config.verbs : SPINNER_VERBS
  }
  return [...SPINNER_VERBS, ...config.verbs]
}

// Spinner 默认过程文案：少量 VioletCode 中文状态词。
// 主状态行的模式文案（请求连接/模型思考等）优先级更高，本列表用于
// 队友行、Brief 模式等需要变化感的场景；用户 spinnerVerbs 配置仍兼容。
export const SPINNER_VERBS = [
  '生长中',
  '编织中',
  '酝酿中',
  '打磨中',
  '推进中',
  '梳理中',
  '联结中',
  '绽放中',
]
