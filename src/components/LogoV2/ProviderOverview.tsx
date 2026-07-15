import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'
import { useProviderAccountStatus } from '../../hooks/useProviderAccountStatus.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { stringWidth } from '../../ink/stringWidth.js'
import { truncate } from '../../utils/format.js'
import {
  getProviderDefinition,
  resolveProviderModelReference,
} from '../../utils/model/providerDefinitions.js'
import { getAPIProvider } from '../../utils/model/providers.js'

export type ProviderOverviewVariant = 'full' | 'compact' | 'condensed'

function formatBalance(currency: string, amount: string): string {
  const symbol = currency.toUpperCase() === 'CNY' ? '¥' : `${currency} `
  return `${symbol}${amount}`
}

export function ProviderOverview({
  variant = 'full',
}: {
  variant?: ProviderOverviewVariant
}): React.ReactNode {
  const model = String(useMainLoopModel())
  const { columns } = useTerminalSize()
  const provider = getAPIProvider(model)
  const reference = resolveProviderModelReference(model, provider)
  const definition = getProviderDefinition(provider)
  const status = useProviderAccountStatus(provider)
  const providerLabel =
    provider === 'volcengineArk' ? '火山方舟' : definition?.label ?? provider
  const rawModelId = reference?.modelId ?? model
  const modelMaxWidth =
    variant === 'compact'
      ? Math.max(columns - 15, 12)
      : variant === 'condensed'
        ? Math.max(columns - stringWidth(providerLabel) - 8, 12)
        : 38
  const modelId = truncate(rawModelId, modelMaxWidth)

  const rawAccount = status.credential.connected
    ? `已连接 · ${status.credential.sourceLabel}`
    : status.credential.sourceLabel
  const valueMaxWidth = variant === 'compact' ? Math.max(columns - 15, 12) : 38
  const account = truncate(rawAccount, valueMaxWidth)
  let balanceText = '正在查询…'
  let balanceTone: 'success' | 'warning' | undefined
  if (status.kind === 'deepseek-balance') {
    balanceText = status.balances.length
      ? status.balances
          .map(item => formatBalance(item.currency, item.totalBalance))
          .join(' / ')
      : '未返回余额'
    balanceTone = status.available ? 'success' : 'warning'
  } else if (status.kind === 'not-configured') {
    balanceText = '连接 Provider 后显示'
    balanceTone = 'warning'
  } else if (status.kind === 'unavailable') {
    balanceText = status.message
    balanceTone = 'warning'
  }

  if (variant === 'condensed') {
    const condensedBalance = truncate(balanceText, Math.max(columns - 4, 12))
    return (
      <Box flexDirection="column">
        <Text>
          <Text bold={true} color="brand">{providerLabel}</Text>
          <Text dimColor={true}> · {modelId}</Text>
        </Text>
        <Text dimColor={true}>{account}</Text>
        {provider === 'deepseek' && (
          <Text color={balanceTone} dimColor={!balanceTone}>
            {condensedBalance}
          </Text>
        )}
      </Box>
    )
  }

  const labelWidth = variant === 'compact' ? 9 : 10
  const row = (label: string, value: React.ReactNode) => (
    <Text>
      <Text dimColor={true}>{label.padEnd(labelWidth)}</Text>
      {value}
    </Text>
  )

  return (
    <Box flexDirection="column">
      {row('PROVIDER', <Text bold={true}>{providerLabel}</Text>)}
      {provider === 'volcengineArk' &&
        row('PLAN', <Text color="brand">Agent Plan</Text>)}
      {row('MODEL', <Text color="brand">{modelId}</Text>)}
      {row(
        'ACCOUNT',
        <Text color={status.credential.connected ? 'success' : 'warning'}>
          {account}
        </Text>,
      )}
      {provider === 'deepseek' &&
        row(
          'BALANCE',
          <Text color={balanceTone} dimColor={!balanceTone}>
            {truncate(balanceText, valueMaxWidth)}
          </Text>,
        )}
    </Box>
  )
}
