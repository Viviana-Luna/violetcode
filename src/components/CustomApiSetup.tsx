import React, { useMemo, useState } from 'react'
import { setInitialMainLoopModel } from '../bootstrap/state.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { Box, Text } from '../ink.js'
import {
  getProviderCredential,
  getSearchServiceApiKeyEnvVar,
  getSearchServiceCredential,
  setProviderApiKey,
  setSearchServiceApiKey,
} from '../utils/authStore.js'
import {
  formatProviderModelReference,
  getProviderDefinition,
  PROVIDER_DEFINITIONS,
} from '../utils/model/providerDefinitions.js'
import { applyProviderEnv } from '../utils/model/providerPresets.js'
import {
  canCompleteProviderSetup,
  getProviderSetupContinuation,
  type ProviderSetupCredentialTarget,
} from '../utils/model/providerSetupFlow.js'
import type { APIProvider } from '../utils/model/types.js'
import { updateSettingsForSource } from '../utils/settings/settings.js'
import { Select } from './CustomSelect/index.js'
import { Dialog } from './design-system/Dialog.js'
import TextInput from './TextInput.js'

type Props = {
  onDone(): void
  onCancel?: () => void
  initialProvider?: APIProvider
}

type Step = 'provider' | 'capability' | 'api-key' | 'environment'

function getCredentialDescription(provider: APIProvider): string {
  const definition = getProviderDefinition(provider)!
  const credential = getProviderCredential(provider)
  if (credential?.source === 'environment') {
    return `已由环境变量 ${definition.apiKeyEnvVar} 提供`
  }
  if (credential?.source === 'auth-store') {
    return '已保存在 auth.json，可选择后覆盖'
  }
  return `未配置，可使用 ${definition.apiKeyEnvVar} 或 auth.json`
}

function getSearchCredentialDescription(): string {
  const credential = getSearchServiceCredential('exa')
  const envVar = getSearchServiceApiKeyEnvVar('exa')
  if (credential?.source === 'environment') {
    return `Exa 搜索已由环境变量 ${envVar} 提供`
  }
  if (credential?.source === 'auth-store') {
    return 'Exa 搜索已保存在 auth.json'
  }
  return `Exa 搜索未配置，可使用 ${envVar} 或 auth.json`
}

function getProviderOptionDescription(provider: APIProvider): string {
  const providerDescription = getCredentialDescription(provider)
  return provider === 'volcengineArk'
    ? `${providerDescription}；${getSearchCredentialDescription()}`
    : providerDescription
}

function configureFirstProvider(provider: APIProvider): void {
  const definition = getProviderDefinition(provider)
  const modelId = definition?.models[0]?.id
  if (!modelId) return

  const model = formatProviderModelReference(provider, modelId)
  updateSettingsForSource('userSettings', { model })
  setInitialMainLoopModel(model)
  applyProviderEnv(process.env, provider, modelId)
}

export function CustomApiSetup({
  onDone,
  onCancel,
  initialProvider = 'deepseek',
}: Props): React.ReactNode {
  const { columns } = useTerminalSize()
  const [step, setStep] = useState<Step>('provider')
  const [provider, setProvider] = useState<APIProvider>(initialProvider)
  const [credentialTarget, setCredentialTarget] =
    useState<ProviderSetupCredentialTarget>('provider')
  const [apiKey, setApiKey] = useState('')
  const [apiKeyCursorOffset, setApiKeyCursorOffset] = useState(0)
  const [error, setError] = useState<string>()

  const providerOptions = useMemo(
    () =>
      PROVIDER_DEFINITIONS.map(definition => ({
        value: definition.id,
        label: definition.label,
        description: getProviderOptionDescription(definition.id),
      })),
    [step],
  )

  function selectProvider(nextProvider: APIProvider): void {
    setProvider(nextProvider)
    setError(undefined)
    if (nextProvider === 'volcengineArk') {
      setStep('capability')
    } else {
      continueWithProviderCredential(nextProvider)
    }
  }

  function continueWithProviderCredential(nextProvider: APIProvider): void {
    setCredentialTarget('provider')
    const credential = getProviderCredential(nextProvider)
    if (credential?.source === 'environment') {
      setStep('environment')
      return
    }
    setApiKey('')
    setApiKeyCursorOffset(0)
    setStep('api-key')
  }

  function continueWithExaCredential(): void {
    setCredentialTarget('exa')
    const credential = getSearchServiceCredential('exa')
    if (credential?.source === 'environment') {
      setStep('environment')
      return
    }
    setApiKey('')
    setApiKeyCursorOffset(0)
    setStep('api-key')
  }

  function returnToCredentialMenu(): void {
    setError(undefined)
    setStep(provider === 'volcengineArk' ? 'capability' : 'provider')
  }

  function continueAfterCredential(): void {
    if (
      getProviderSetupContinuation(provider, credentialTarget) === 'capability'
    ) {
      setError(undefined)
      setStep('capability')
      return
    }
    onDone()
  }

  function saveCredential(value: string): void {
    const normalized = value.trim()
    if (!normalized) {
      setError('API Key 不能为空')
      return
    }

    try {
      if (credentialTarget === 'exa') {
        setSearchServiceApiKey('exa', normalized)
      } else {
        const hadConfiguredProvider = PROVIDER_DEFINITIONS.some(definition =>
          Boolean(getProviderCredential(definition.id)),
        )
        setProviderApiKey(provider, normalized)
        if (!hadConfiguredProvider) configureFirstProvider(provider)
      }
      continueAfterCredential()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    }
  }

  const definition = getProviderDefinition(provider)!
  const credentialEnvVar =
    credentialTarget === 'exa'
      ? getSearchServiceApiKeyEnvVar('exa')
      : definition.apiKeyEnvVar
  const credentialLabel =
    credentialTarget === 'exa' ? 'Exa 网页搜索' : definition.label
  const hasProviderCredential = Boolean(getProviderCredential(provider))
  const canComplete = canCompleteProviderSetup(
    provider,
    hasProviderCredential,
  )

  if (step === 'provider') {
    return (
      <Dialog title="连接模型 Provider">
        <Box flexDirection="column" gap={1}>
          <Text>选择要配置的 Provider：</Text>
          <Select
            options={providerOptions}
            onChange={value => selectProvider(value as APIProvider)}
            onCancel={onCancel}
            visibleOptionCount={providerOptions.length}
            defaultFocusValue={initialProvider}
          />
        </Box>
      </Dialog>
    )
  }

  if (step === 'capability') {
    const capabilityOptions = [
      {
        value: 'provider',
        label: '模型 API Key（必填）',
        description: getCredentialDescription(provider),
      },
      {
        value: 'exa',
        label: 'Exa 网页搜索（可选）',
        description: getSearchCredentialDescription(),
      },
      ...(canComplete
        ? [
            {
              value: 'done',
              label: '完成',
              description: getSearchServiceCredential('exa')
                ? '模型与 Exa 网页搜索均已配置'
                : '使用模型；稍后可通过 /connect 配置 Exa',
            },
          ]
        : []),
    ]

    return (
      <Dialog title={`${definition.label} 连接设置`}>
        <Box flexDirection="column" gap={1}>
          <Text>
            模型 API Key 为必填项；Exa 仅用于可选的网页搜索能力。
          </Text>
          <Select
            options={capabilityOptions}
            onChange={value => {
              if (value === 'done') onDone()
              else if (value === 'exa') continueWithExaCredential()
              else continueWithProviderCredential(provider)
            }}
            onCancel={() => setStep('provider')}
            visibleOptionCount={capabilityOptions.length}
          />
          <Text dimColor>
            Exa 只接收搜索关键词和域名过滤条件，不接收会话全文或模型 Provider API Key。
          </Text>
        </Box>
      </Dialog>
    )
  }

  if (step === 'environment') {
    return (
      <Dialog title={`${credentialLabel} 凭据`}>
        <Box flexDirection="column" gap={1}>
          <Text>
            当前凭据来自环境变量 {credentialEnvVar}，VioletCode 不会覆盖它。
          </Text>
          <Select
            options={[
              { value: 'done', label: '完成', description: '保留外部环境变量配置' },
              { value: 'back', label: '返回', description: '返回连接设置' },
            ]}
            onChange={value => {
              if (value === 'done') {
                if (credentialTarget === 'provider') {
                  const hasOtherProvider = PROVIDER_DEFINITIONS.some(
                    candidate =>
                      candidate.id !== provider &&
                      Boolean(getProviderCredential(candidate.id)),
                  )
                  if (!hasOtherProvider && !process.env.VIOLET_PROVIDER) {
                    configureFirstProvider(provider)
                  }
                }
                continueAfterCredential()
              } else returnToCredentialMenu()
            }}
            onCancel={returnToCredentialMenu}
          />
        </Box>
      </Dialog>
    )
  }

  return (
    <Dialog title={`配置 ${credentialLabel}`}>
      <Box flexDirection="column" gap={1}>
        {credentialTarget === 'exa' ? (
          <Text>
            搜索关键词和域名过滤条件会发送给 Exa；不会发送会话全文或模型 Provider API Key。
          </Text>
        ) : null}
        <Text>
          输入 API Key；保存位置为 auth.json，文件权限固定为 0600。
        </Text>
        <TextInput
          value={apiKey}
          onChange={setApiKey}
          onSubmit={saveCredential}
          onExit={returnToCredentialMenu}
          columns={Math.max(20, columns - 8)}
          cursorOffset={apiKeyCursorOffset}
          onChangeCursorOffset={setApiKeyCursorOffset}
          focus
          mask="*"
          showCursor
          placeholder={credentialTarget === 'exa' ? 'Exa API Key' : 'API Key'}
        />
        {error ? <Text color="error">{error}</Text> : null}
        <Text dimColor>按 Enter 保存，按 Esc 返回连接设置。</Text>
      </Box>
    </Dialog>
  )
}
