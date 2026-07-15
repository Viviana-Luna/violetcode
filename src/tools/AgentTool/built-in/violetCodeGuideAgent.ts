import { BASH_TOOL_NAME } from 'src/tools/BashTool/toolName.js'
import { FILE_READ_TOOL_NAME } from 'src/tools/FileReadTool/prompt.js'
import { GLOB_TOOL_NAME } from 'src/tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from 'src/tools/GrepTool/prompt.js'
import { SEND_MESSAGE_TOOL_NAME } from 'src/tools/SendMessageTool/constants.js'
import { hasEmbeddedSearchTools } from 'src/utils/embeddedTools.js'
import { getSettings_DEPRECATED } from 'src/utils/settings/settings.js'
import { jsonStringify } from '../../../utils/slowOperations.js'
import type {
  AgentDefinition,
  BuiltInAgentDefinition,
} from '../loadAgentsDir.js'

export const VIOLET_CODE_GUIDE_AGENT_TYPE = 'violetcode-guide'

function getVioletCodeGuideBasePrompt(): string {
  const localSearchHint = hasEmbeddedSearchTools()
    ? `${FILE_READ_TOOL_NAME}、\`find\` 和 \`grep\``
    : `${FILE_READ_TOOL_NAME}、${GLOB_TOOL_NAME} 和 ${GREP_TOOL_NAME}`

  return `你是 VioletCode 使用指南智能体，负责根据当前安装版本的真实源码和本地文档，帮助用户理解 VioletCode 的功能、配置与工作流。

优先处理以下领域：

1. VioletCode CLI：安装、Provider、模型、hooks、skills、MCP、快捷键、设置与工作流。
2. Provider：DeepSeek 与火山方舟 Agent Plan 的凭据、模型身份、能力边界和排错。
3. 项目兼容能力：插件、Agent SDK 兼容入口以及 Anthropic Messages 协议兼容层。

工作方式：

- 使用 ${localSearchHint} 检查 README、docs、当前源码和用户配置，不能用第三方产品文档代替 VioletCode 现场。
- 明确区分 VioletCode 产品功能与第三方协议或生态兼容格式。
- 配置和命令必须以当前版本实际注册内容为准。
- 找不到功能时直接说明，不得暗示 VioletCode.ai、Anthropic Console、VioletCode Desktop 或 VioletCode in Chrome 能力仍然可用。
- 回答保持简洁、可执行，并在需要时给出准确文件路径或命令。`
}

export const VIOLET_CODE_GUIDE_AGENT: BuiltInAgentDefinition = {
  agentType: VIOLET_CODE_GUIDE_AGENT_TYPE,
  whenToUse: `当用户询问 VioletCode 的命令、Provider、模型、hooks、skills、MCP、设置、插件或排错方式时使用。启动前先检查是否已有可通过 ${SEND_MESSAGE_TOOL_NAME} 继续的 violetcode-guide 智能体。`,
  tools: hasEmbeddedSearchTools()
    ? [BASH_TOOL_NAME, FILE_READ_TOOL_NAME]
    : [GLOB_TOOL_NAME, GREP_TOOL_NAME, FILE_READ_TOOL_NAME],
  source: 'built-in',
  baseDir: 'built-in',
  permissionMode: 'dontAsk',
  getSystemPrompt({ toolUseContext }) {
    const contextSections: string[] = []
    const commands = toolUseContext.options.commands

    const customCommands = commands.filter(command => command.type === 'prompt')
    if (customCommands.length > 0) {
      contextSections.push(
        `**当前自定义技能：**\n${customCommands
          .map(command => `- /${command.name}: ${command.description}`)
          .join('\n')}`,
      )
    }

    const customAgents =
      toolUseContext.options.agentDefinitions.activeAgents.filter(
        (agent: AgentDefinition) => agent.source !== 'built-in',
      )
    if (customAgents.length > 0) {
      contextSections.push(
        `**当前自定义智能体：**\n${customAgents
          .map(agent => `- ${agent.agentType}: ${agent.whenToUse}`)
          .join('\n')}`,
      )
    }

    const mcpClients = toolUseContext.options.mcpClients
    if (mcpClients && mcpClients.length > 0) {
      contextSections.push(
        `**当前 MCP 服务：**\n${mcpClients
          .map(client => `- ${client.name}`)
          .join('\n')}`,
      )
    }

    const settings = getSettings_DEPRECATED()
    if (Object.keys(settings).length > 0) {
      contextSections.push(
        `**当前 settings.json：**\n\`\`\`json\n${jsonStringify(settings, null, 2)}\n\`\`\``,
      )
    }

    const basePrompt = getVioletCodeGuideBasePrompt()
    if (contextSections.length === 0) return basePrompt

    return `${basePrompt}\n\n# 当前环境\n\n${contextSections.join('\n\n')}`
  },
}
