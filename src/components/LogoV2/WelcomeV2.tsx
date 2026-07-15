import * as React from 'react'
import { Box, Text } from '../../ink.js'

export function WelcomeV2(): React.ReactNode {
  const version = process.env.DEMO_VERSION ?? MACRO.VERSION

  return (
    <Box flexDirection="column" paddingX={1} marginBottom={1}>
      <Text>
        <Text bold={true} color="brand">
          violet code
        </Text>{' '}
        <Text dimColor={true}>v{version}</Text>
      </Text>
      <Text dimColor={true}>从当前项目开始，让代码自然生长。</Text>
    </Box>
  )
}
