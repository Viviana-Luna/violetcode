import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'connect',
  description: '配置 DeepSeek 或火山方舟凭据',
  load: () => import('./connect.js'),
} satisfies Command
