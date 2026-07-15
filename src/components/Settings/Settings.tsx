import React, { Suspense, useState } from 'react'
import type {
  CommandResultDisplay,
  LocalJSXCommandContext,
} from '../../commands.js'
import {
  useIsInsideModal,
  useModalOrTerminalSize,
} from '../../context/modalContext.js'
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import { Pane } from '../design-system/Pane.js'
import { Tab, Tabs } from '../design-system/Tabs.js'
import { Config } from './Config.js'
import { buildDiagnostics, Status } from './Status.js'

type Props = {
  onClose: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
  context: LocalJSXCommandContext
  defaultTab: 'Status' | 'Config'
}

export function Settings({
  onClose,
  context,
  defaultTab,
}: Props): React.ReactNode {
  const [selectedTab, setSelectedTab] = useState(defaultTab)
  const [tabsHidden, setTabsHidden] = useState(false)
  const [configOwnsEsc, setConfigOwnsEsc] = useState(false)
  const insideModal = useIsInsideModal()
  const { rows } = useModalOrTerminalSize(useTerminalSize())
  const contentHeight = insideModal
    ? rows + 1
    : Math.max(15, Math.min(Math.floor(rows * 0.8), 30))
  const [diagnosticsPromise] = useState(() =>
    buildDiagnostics().catch(() => []),
  )

  useExitOnCtrlCDWithKeybindings()
  useKeybinding(
    'confirm:no',
    () => {
      if (!tabsHidden) {
        onClose('设置对话框已关闭', { display: 'system' })
      }
    },
    {
      context: 'Settings',
      isActive:
        !tabsHidden && !(selectedTab === 'Config' && configOwnsEsc),
    },
  )

  const tabs = [
    <Tab key="status" title="Status">
      <Status context={context} diagnosticsPromise={diagnosticsPromise} />
    </Tab>,
    <Tab key="config" title="Config">
      <Suspense fallback={null}>
        <Config
          context={context}
          onClose={onClose}
          setTabsHidden={setTabsHidden}
          onIsSearchModeChange={setConfigOwnsEsc}
          contentHeight={contentHeight}
        />
      </Suspense>
    </Tab>,
  ]

  return (
    <Pane color="permission">
      <Tabs
        color="permission"
        selectedTab={selectedTab}
        onTabChange={value => setSelectedTab(value as 'Status' | 'Config')}
        hidden={tabsHidden}
        initialHeaderFocused={defaultTab !== 'Config'}
        contentHeight={tabsHidden || insideModal ? undefined : contentHeight}
      >
        {tabs}
      </Tabs>
    </Pane>
  )
}
