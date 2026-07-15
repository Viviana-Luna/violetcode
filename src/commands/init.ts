import type { Command } from '../commands.js'
import { maybeMarkProjectOnboardingComplete } from '../projectOnboardingState.js'

const INIT_PROMPT = `请调查当前代码库，并创建或完善根目录的 AGENTS.md，供 VioletCode 在后续会话中读取。

执行要求：
1. 先读取 README、清单文件、构建配置、CI 配置和已有的 AGENTS.md；不得凭空推断。
2. 只记录删除后会导致编码助手犯错的约束，例如非标准构建命令、架构边界、测试方式和仓库约定。
3. 不要罗列可直接从目录看出的文件结构，不要写通用工程建议，不要写宣传内容。
4. 如果 AGENTS.md 已存在，保留有效内容并做最小增量修改，不得静默覆盖。
5. 写入前先向用户展示拟新增或修改的要点；只有用户明确同意后才能编辑文件。
6. 不得收集、上传或在文件中写入 API Key、Token、账号、私有地址等敏感信息。
7. 最终说明读取了哪些事实来源、修改了哪些内容，以及仍无法从仓库确认的问题。

AGENTS.md 使用简洁的 Markdown，标题为 \`# AGENTS.md\`。`

const command = {
  type: 'prompt',
  name: 'init',
  description: '调查代码库并创建或完善 AGENTS.md 项目说明',
  contentLength: 0,
  progressMessage: '正在分析代码库',
  source: 'builtin',
  async getPromptForCommand() {
    maybeMarkProjectOnboardingComplete()
    return [{ type: 'text', text: INIT_PROMPT }]
  },
} satisfies Command

export default command
