import React, { useMemo, useState } from 'react'
import { ContentWidthContext } from '../context/contentWidthContext.js'
import { useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCDWithKeybindings.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { Box, Text, useTheme } from '../ink.js'
import { needsProviderSetup } from '../utils/model/providers.js'
import type { APIProvider } from '../utils/model/types.js'
import type { ThemeSetting } from '../utils/theme.js'
import { CustomApiSetup } from './CustomApiSetup.js'
import { WelcomeV2 } from './LogoV2/WelcomeV2.js'
import { ThemePicker } from './ThemePicker.js'

type Props = {
  onDone(): void
  requiredProvider?: APIProvider
}

type StepId = 'provider' | 'theme'

export function Onboarding({
  onDone,
  requiredProvider,
}: Props): React.ReactNode {
  const [stepIndex, setStepIndex] = useState(0)
  const [, setTheme] = useTheme()
  const { columns } = useTerminalSize()
  const exitState = useExitOnCtrlCDWithKeybindings()
  const steps = useMemo<StepId[]>(
    () => (needsProviderSetup(requiredProvider) ? ['provider', 'theme'] : ['theme']),
    [requiredProvider],
  )

  function nextStep(): void {
    if (stepIndex + 1 >= steps.length) onDone()
    else setStepIndex(index => index + 1)
  }

  function selectTheme(theme: ThemeSetting): void {
    setTheme(theme)
    nextStep()
  }

  const currentStep = steps[stepIndex]
  return (
    <Box flexDirection="column">
      <WelcomeV2 />
      <Box flexDirection="column" marginTop={1}>
        {currentStep === 'provider' ? (
          <CustomApiSetup
            onDone={nextStep}
            initialProvider={requiredProvider}
          />
        ) : (
          <ContentWidthContext.Provider value={Math.max(columns - 2, 1)}>
            <Box marginX={1}>
              <ThemePicker
                onThemeSelect={selectTheme}
                showIntroText
                helpText="稍后可运行 /theme 修改主题"
                hideEscToCancel
                skipExitHandling
              />
            </Box>
          </ContentWidthContext.Provider>
        )}
        {exitState.pending ? (
          <Box padding={1}>
            <Text dimColor>再次按 {exitState.keyName} 退出</Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}
