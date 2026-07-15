import type { Command } from '../../commands.js'
const checkCachedPassesEligibility = () => ({ eligible: false, hasCache: false })
const getCachedReferrerReward = (): number | undefined => undefined

export default {
  type: 'local-jsx',
  name: 'passes',
  get description() {
    const reward = getCachedReferrerReward()
    if (reward) {
      return 'Share a free week of VioletCode with friends and earn extra usage'
    }
    return 'Share a free week of VioletCode with friends'
  },
  get isHidden() {
    const { eligible, hasCache } = checkCachedPassesEligibility()
    return !eligible || !hasCache
  },
  load: () => import('./passes.js'),
} satisfies Command
