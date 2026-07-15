import type { Theme } from '../../utils/theme.js'

export type TipContext = {
  theme: Theme
  readFileState?: unknown
  bashTools?: Set<string>
}

export type Tip = {
  id: string
  content: (context: Pick<TipContext, 'theme'>) => Promise<string>
  cooldownSessions: number
  isRelevant: (context?: TipContext) => Promise<boolean>
}
