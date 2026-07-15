import { getInitialSettings } from '../../utils/settings/settings.js'
import { getSessionsSinceLastShown } from './tipHistory.js'
import type { Tip, TipContext } from './types.js'

const builtInTips: Tip[] = [
  {
    id: 'plan-before-change',
    content: async () =>
      '复杂改动可以先进入 Plan Mode，确认范围和验收标准后再执行。',
    cooldownSessions: 5,
    isRelevant: async () => true,
  },
  {
    id: 'connect-provider',
    content: async () =>
      '使用 /connect 管理 DeepSeek 或火山方舟凭据，密钥不会写入项目配置。',
    cooldownSessions: 8,
    isRelevant: async () => true,
  },
  {
    id: 'switch-model',
    content: async () => '使用 /model 查看并切换当前 Provider 的模型。',
    cooldownSessions: 8,
    isRelevant: async () => true,
  },
  {
    id: 'project-instructions',
    content: async () =>
      '使用 /init 调查代码库，并创建精简的 AGENTS.md 项目说明。',
    cooldownSessions: 12,
    isRelevant: async () => true,
  },
  {
    id: 'permissions',
    content: async () =>
      '使用 /permissions 预先允许或拒绝 Bash、编辑和 MCP 工具。',
    cooldownSessions: 10,
    isRelevant: async () => true,
  },
  {
    id: 'resume',
    content: async () => '使用 violet --continue 或 violet --resume 恢复本地会话。',
    cooldownSessions: 10,
    isRelevant: async () => true,
  },
]

function getCustomTips(): Tip[] {
  const settings = getInitialSettings()
  const override = settings.spinnerTipsOverride
  if (!override?.tips?.length) return []

  return override.tips.map((content, index) => ({
    id: `custom-tip-${index}`,
    content: async () => content,
    cooldownSessions: 0,
    isRelevant: async () => true,
  }))
}

export async function getRelevantTips(context?: TipContext): Promise<Tip[]> {
  const settings = getInitialSettings()
  const customTips = getCustomTips()

  if (settings.spinnerTipsOverride?.excludeDefault && customTips.length > 0) {
    return customTips
  }

  const relevance = await Promise.all(
    builtInTips.map(tip => tip.isRelevant(context)),
  )
  const visibleBuiltIns = builtInTips
    .filter((_, index) => relevance[index])
    .filter(tip => getSessionsSinceLastShown(tip.id) >= tip.cooldownSessions)

  return [...visibleBuiltIns, ...customTips]
}
