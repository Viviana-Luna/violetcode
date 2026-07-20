import React, { useMemo, useState } from 'react'
import { setInitialMainLoopModel } from '../bootstrap/state.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { Box, Text } from '../ink.js'
import { useSetAppState } from '../state/AppState.js'
import {
  getProviderCredential,
  getSearchServiceApiKeyEnvVar,
  getSearchServiceCredential,
  setProviderApiKey,
  setSearchServiceApiKey,
} from '../utils/authStore.js'
import {
  formatProviderModelReference,
  getAllProviderDefinitions,
  getProviderDefinition,
} from '../utils/model/providerDefinitions.js'
import {
  isValidCustomModelId,
  isValidCustomProviderBaseUrl,
  normalizeCustomProviderBaseUrl,
  parseCustomModelContextWindow,
  upsertCustomProvider,
  CUSTOM_PROVIDER_DEFAULT_CONTEXT_WINDOW,
} from '../utils/model/customProviders.js'
import { applyProviderEnv } from '../utils/model/providerPresets.js'
import {
  canCompleteProviderSetup,
  getProviderSetupContinuation,
  type ProviderSetupCredentialTarget,
} from '../utils/model/providerSetupFlow.js'
import type {
  APIProvider,
  CustomProviderAuthMethod,
  CustomProviderWebSearch,
} from '../utils/model/types.js'
import { updateSettingsForSource } from '../utils/settings/settings.js'
import { Select } from './CustomSelect/index.js'
import { Dialog } from './design-system/Dialog.js'
import TextInput from './TextInput.js'

type Props = {
  onDone(): void
  onCancel?: () => void
  initialProvider?: APIProvider
}

type Step =
  | 'provider'
  | 'capability'
  | 'api-key'
  | 'environment'
  | 'custom-base-url'
  | 'custom-auth-method'
  | 'custom-api-key'
  | 'custom-web-search'
  | 'custom-model-id'
  | 'custom-model-context'
  | 'custom-model-thinking'
  | 'custom-model-more'

const NEW_CUSTOM_PROVIDER = '__new_custom_provider__'

type CustomModelDraft = {
  id: string
  contextWindow?: number
  thinking: boolean
}

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
  return getProviderDefinition(provider)?.webSearch.kind ===
    'client-search-provider'
    ? `${providerDescription}；${getSearchCredentialDescription()}`
    : providerDescription
}

function configureFirstProvider(provider: APIProvider): string | null {
  const definition = getProviderDefinition(provider)
  const modelId = definition?.models[0]?.id
  if (!modelId) return null

  const model = formatProviderModelReference(provider, modelId)
  updateSettingsForSource('userSettings', { model })
  setInitialMainLoopModel(model)
  applyProviderEnv(process.env, provider, modelId)
  return model
}

export function CustomApiSetup({
  onDone,
  onCancel,
  initialProvider = 'deepseek',
}: Props): React.ReactNode {
  const { columns } = useTerminalSize()
  const setAppState = useSetAppState()
  const [step, setStep] = useState<Step>('provider')
  const [provider, setProvider] = useState<APIProvider>(initialProvider)
  const [credentialTarget, setCredentialTarget] =
    useState<ProviderSetupCredentialTarget>('provider')
  const [apiKey, setApiKey] = useState('')
  const [apiKeyCursorOffset, setApiKeyCursorOffset] = useState(0)
  const [error, setError] = useState<string>()
  // 自定义端点草稿：在流程中逐步收集，最后一次性持久化，避免半成品配置。
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [customAuthMethod, setCustomAuthMethod] =
    useState<CustomProviderAuthMethod>('bearer')
  const [customWebSearch, setCustomWebSearch] =
    useState<CustomProviderWebSearch>('native')
  const [customModels, setCustomModels] = useState<CustomModelDraft[]>([])
  const [customModelId, setCustomModelId] = useState('')
  const [customContextInput, setCustomContextInput] = useState('')
  const [textCursorOffset, setTextCursorOffset] = useState(0)

  const providerOptions = useMemo(
    () => [
      ...getAllProviderDefinitions().map(definition => ({
        value: definition.id,
        label: definition.label,
        description: getProviderOptionDescription(definition.id),
      })),
      {
        value: NEW_CUSTOM_PROVIDER,
        label: '新增自定义端点',
        description: '连接任意 Anthropic Messages 兼容的 API 端点',
      },
    ],
    [step],
  )

  function startCustomProviderFlow(): void {
    setError(undefined)
    setCustomBaseUrl('')
    setCustomAuthMethod('bearer')
    setCustomWebSearch('native')
    setCustomModels([])
    setCustomModelId('')
    setCustomContextInput('')
    setApiKey('')
    setApiKeyCursorOffset(0)
    setTextCursorOffset(0)
    setStep('custom-base-url')
  }

  // /connect 在运行中的会话内完成时，必须同步切换当前会话模型；
  // 否则后续请求继续按旧 Provider 路由（曾导致凭据错发与 401）。
  function activateModel(model: string | null): void {
    if (!model) return
    setAppState(previous => ({
      ...previous,
      mainLoopModel: model,
      mainLoopModelForSession: null,
    }))
  }

  function activateFirstProvider(provider: APIProvider): void {
    activateModel(configureFirstProvider(provider))
  }

  function selectProvider(nextProvider: APIProvider): void {
    setError(undefined)
    if (nextProvider === NEW_CUSTOM_PROVIDER) {
      // 哨兵值不是真实 Provider id，不能写入 provider 状态，
      // 否则下方 getProviderDefinition(provider) 解析失败。
      startCustomProviderFlow()
      return
    }
    setProvider(nextProvider)
    if (
      getProviderSetupContinuation(nextProvider, 'provider') === 'capability'
    ) {
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
    setStep(
      getProviderSetupContinuation(provider, credentialTarget) === 'capability'
        ? 'capability'
        : 'provider',
    )
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
        const hadConfiguredProvider = getAllProviderDefinitions().some(
          definition => Boolean(getProviderCredential(definition.id)),
        )
        setProviderApiKey(provider, normalized)
        if (!hadConfiguredProvider) activateFirstProvider(provider)
      }
      continueAfterCredential()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    }
  }

  function submitCustomBaseUrl(value: string): void {
    const normalized = normalizeCustomProviderBaseUrl(value)
    if (!normalized || !isValidCustomProviderBaseUrl(normalized)) {
      setError('Base URL 必须是合法的 http:// 或 https:// 地址')
      return
    }
    setError(undefined)
    setCustomBaseUrl(normalized)
    setStep('custom-auth-method')
  }

  function submitCustomApiKey(value: string): void {
    const normalized = value.trim()
    if (!normalized) {
      setError('API Key 不能为空')
      return
    }
    // 凭据先留在草稿状态，finishCustomProvider 时才与配置一起写入。
    setError(undefined)
    setApiKey(normalized)
    setCustomModelId('')
    setTextCursorOffset(0)
    setStep('custom-web-search')
  }

  function submitCustomModelId(value: string): void {
    const normalized = value.trim()
    if (!isValidCustomModelId(normalized)) {
      setError('模型 ID 不能为空，也不能包含空白或控制字符')
      return
    }
    if (customModels.some(model => model.id === normalized)) {
      setError(`模型 ${normalized} 已添加`)
      return
    }
    setError(undefined)
    setCustomModelId(normalized)
    setCustomContextInput('')
    setTextCursorOffset(0)
    setStep('custom-model-context')
  }

  function submitCustomModelContext(value: string): void {
    const parsed = parseCustomModelContextWindow(value)
    if (parsed === null) {
      setError('上下文窗口必须是正整数，或留空使用默认值')
      return
    }
    setError(undefined)
    setCustomContextInput(value.trim())
    setStep('custom-model-thinking')
  }

  function addCustomModel(thinking: boolean): void {
    const contextWindow = parseCustomModelContextWindow(customContextInput)
    if (contextWindow === null) {
      // 上一步已校验，理论不可达；防御性返回，不写入非法配置。
      setError('上下文窗口必须是正整数，或留空使用默认值')
      setStep('custom-model-context')
      return
    }
    setError(undefined)
    setCustomModels(current => [
      ...current,
      { id: customModelId, contextWindow, thinking },
    ])
    setCustomModelId('')
    setCustomContextInput('')
    setStep('custom-model-more')
  }

  function finishCustomProvider(): void {
    if (customModels.length === 0) return
    try {
      const entry = upsertCustomProvider({
        baseUrl: customBaseUrl,
        authMethod: customAuthMethod,
        webSearch: customWebSearch,
        models: customModels,
      })
      setProviderApiKey(entry.id, apiKey)
      const firstModelId = customModels[0]!.id
      const model = formatProviderModelReference(entry.id, firstModelId)
      updateSettingsForSource('userSettings', { model })
      setInitialMainLoopModel(model)
      applyProviderEnv(process.env, entry.id, firstModelId)
      activateModel(model)
      setProvider(entry.id)
      if (customWebSearch === 'exa' && !getSearchServiceCredential('exa')) {
        // 复用能力配置页补录 Exa 凭据，与火山方舟流程一致。
        setStep('capability')
        return
      }
      onDone()
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
                  const hasOtherProvider = getAllProviderDefinitions().some(
                    candidate =>
                      candidate.id !== provider &&
                      Boolean(getProviderCredential(candidate.id)),
                  )
                  if (!hasOtherProvider && !process.env.VIOLET_PROVIDER) {
                    activateFirstProvider(provider)
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

  if (step === 'custom-base-url') {
    return (
      <Dialog title="新增自定义端点">
        <Box flexDirection="column" gap={1}>
          <Text>输入 Anthropic Messages 兼容端点的 Base URL。</Text>
          <TextInput
            value={customBaseUrl}
            onChange={setCustomBaseUrl}
            onSubmit={submitCustomBaseUrl}
            onExit={() => setStep('provider')}
            columns={Math.max(20, columns - 8)}
            cursorOffset={textCursorOffset}
            onChangeCursorOffset={setTextCursorOffset}
            focus
            showCursor
            placeholder="https://example.com/anthropic"
          />
          {error ? <Text color="error">{error}</Text> : null}
          <Text dimColor>按 Enter 继续，按 Esc 返回 Provider 列表。</Text>
        </Box>
      </Dialog>
    )
  }

  if (step === 'custom-auth-method') {
    return (
      <Dialog title="自定义端点认证方式">
        <Box flexDirection="column" gap={1}>
          <Text>选择 {customBaseUrl} 使用的认证请求头：</Text>
          <Select
            options={[
              {
                value: 'bearer' as const,
                label: 'Bearer Token',
                description: 'Authorization: Bearer <API Key>',
              },
              {
                value: 'x-api-key' as const,
                label: 'X-Api-Key',
                description: 'x-api-key 请求头（Anthropic 风格）',
              },
            ]}
            onChange={value => {
              setCustomAuthMethod(value)
              setApiKey('')
              setApiKeyCursorOffset(0)
              setStep('custom-api-key')
            }}
            onCancel={() => setStep('custom-base-url')}
          />
        </Box>
      </Dialog>
    )
  }

  if (step === 'custom-api-key') {
    return (
      <Dialog title="自定义端点 API Key">
        <Box flexDirection="column" gap={1}>
          <Text>输入 API Key；保存位置为 auth.json，文件权限固定为 0600。</Text>
          <TextInput
            value={apiKey}
            onChange={setApiKey}
            onSubmit={submitCustomApiKey}
            onExit={() => setStep('custom-auth-method')}
            columns={Math.max(20, columns - 8)}
            cursorOffset={apiKeyCursorOffset}
            onChangeCursorOffset={setApiKeyCursorOffset}
            focus
            mask="*"
            showCursor
            placeholder="API Key"
          />
          {error ? <Text color="error">{error}</Text> : null}
          <Text dimColor>按 Enter 继续，按 Esc 返回认证方式。</Text>
        </Box>
      </Dialog>
    )
  }

  if (step === 'custom-web-search') {
    return (
      <Dialog title="网页搜索链路">
        <Box flexDirection="column" gap={1}>
          <Text>选择该端点使用的网页搜索方式：</Text>
          <Select
            options={[
              {
                value: 'native' as const,
                label: '默认（端点原生搜索）',
                description: '由端点服务端执行搜索；端点不支持时会报错，可改选 Exa',
              },
              {
                value: 'exa' as const,
                label: 'Exa 客户端搜索',
                description: '搜索关键词发送给 Exa，需要 Exa API Key',
              },
            ]}
            onChange={value => {
              setCustomWebSearch(value)
              setCustomModelId('')
              setTextCursorOffset(0)
              setStep('custom-model-id')
            }}
            onCancel={() => setStep('custom-api-key')}
          />
        </Box>
      </Dialog>
    )
  }

  if (step === 'custom-model-id') {
    return (
      <Dialog title={`添加模型（第 ${customModels.length + 1} 个）`}>
        <Box flexDirection="column" gap={1}>
          <Text>输入模型 ID，需与端点上的模型名完全一致。</Text>
          <TextInput
            value={customModelId}
            onChange={setCustomModelId}
            onSubmit={submitCustomModelId}
            onExit={() => setStep('custom-web-search')}
            columns={Math.max(20, columns - 8)}
            cursorOffset={textCursorOffset}
            onChangeCursorOffset={setTextCursorOffset}
            focus
            showCursor
            placeholder="模型 ID"
          />
          {error ? <Text color="error">{error}</Text> : null}
          <Text dimColor>按 Enter 继续，按 Esc 返回搜索链路。</Text>
        </Box>
      </Dialog>
    )
  }

  if (step === 'custom-model-context') {
    return (
      <Dialog title={`${customModelId} 上下文窗口`}>
        <Box flexDirection="column" gap={1}>
          <Text>
            输入上下文窗口 token 数；留空使用默认值{' '}
            {CUSTOM_PROVIDER_DEFAULT_CONTEXT_WINDOW.toLocaleString()}。
          </Text>
          <TextInput
            value={customContextInput}
            onChange={setCustomContextInput}
            onSubmit={submitCustomModelContext}
            onExit={() => setStep('custom-model-id')}
            columns={Math.max(20, columns - 8)}
            cursorOffset={textCursorOffset}
            onChangeCursorOffset={setTextCursorOffset}
            focus
            showCursor
            placeholder={String(CUSTOM_PROVIDER_DEFAULT_CONTEXT_WINDOW)}
          />
          {error ? <Text color="error">{error}</Text> : null}
          <Text dimColor>按 Enter 继续，按 Esc 返回模型 ID。</Text>
        </Box>
      </Dialog>
    )
  }

  if (step === 'custom-model-thinking') {
    return (
      <Dialog title={`${customModelId} Thinking 能力`}>
        <Box flexDirection="column" gap={1}>
          <Text>该模型是否支持 thinking？</Text>
          <Select
            options={[
              {
                value: 'off' as const,
                label: '关闭（推荐）',
                description: '不发送 thinking 配置，兼容大多数端点',
              },
              {
                value: 'on' as const,
                label: '开启',
                description: '请求中携带 thinking budget，仅在端点支持时选择',
              },
            ]}
            onChange={value => addCustomModel(value === 'on')}
            onCancel={() => setStep('custom-model-context')}
          />
          {error ? <Text color="error">{error}</Text> : null}
        </Box>
      </Dialog>
    )
  }

  if (step === 'custom-model-more') {
    return (
      <Dialog title="自定义端点模型">
        <Box flexDirection="column" gap={1}>
          <Text>
            已添加 {customModels.length} 个模型：
            {customModels.map(model => model.id).join('、')}
          </Text>
          <Select
            options={[
              {
                value: 'add' as const,
                label: '再添加一个模型',
                description: '继续配置下一个模型 ID',
              },
              {
                value: 'done' as const,
                label: '完成创建',
                description: '保存端点、凭据与模型配置',
              },
            ]}
            onChange={value => {
              if (value === 'add') {
                setCustomModelId('')
                setTextCursorOffset(0)
                setStep('custom-model-id')
              } else {
                finishCustomProvider()
              }
            }}
            onCancel={() => setStep('provider')}
          />
          {error ? <Text color="error">{error}</Text> : null}
          <Text dimColor>按 Esc 放弃本次新增（不会保存任何内容）。</Text>
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
