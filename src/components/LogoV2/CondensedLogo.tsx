import * as React from 'react'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { stringWidth } from '../../ink/stringWidth.js'
import { Box, Text } from '../../ink.js'
import { useAppState } from '../../state/AppState.js'
import { truncate } from '../../utils/format.js'
import { getLogoDisplayData, truncatePath } from '../../utils/logoV2Utils.js'
import { OffscreenFreeze } from '../OffscreenFreeze.js'
import { ProviderOverview } from './ProviderOverview.js'

export function CondensedLogo(): React.ReactNode {
  const { columns } = useTerminalSize()
  const agent = useAppState(state => state.agent)
  const {
    version,
    cwd,
    agentName: agentNameFromSettings,
  } = getLogoDisplayData()
  const agentName = agent ?? agentNameFromSettings
  const textWidth = Math.max(columns - 4, 20)
  const truncatedVersion = truncate(version, Math.max(textWidth - 13, 6))
  const cwdWidth = agentName
    ? textWidth - 1 - stringWidth(agentName) - 3
    : textWidth
  const truncatedCwd = truncatePath(cwd, Math.max(cwdWidth, 10))

  return (
    <OffscreenFreeze>
      <Box flexDirection="column" paddingLeft={1}>
        <Text>
          <Text bold={true} color="brand">
            violet code
          </Text>{' '}
          <Text dimColor={true}>v{truncatedVersion}</Text>
        </Text>
        <Box marginTop={1}>
          <ProviderOverview variant="condensed" />
        </Box>
        <Box marginTop={1}>
          <Text dimColor={true}>
            {agentName ? `@${agentName} · ${truncatedCwd}` : truncatedCwd}
          </Text>
        </Box>
      </Box>
    </OffscreenFreeze>
  )
}
