import * as React from 'react'
import { useMemo, useState } from 'react'
import { Box, Text } from '../ink.js'
import { getProviderCredential } from '../utils/authStore.js'
import {
  formatProviderModelReference,
  getProviderDefinition,
} from '../utils/model/providerDefinitions.js'
import { rememberProviderModel } from '../utils/model/providerModelStore.js'
import { type ModelSetting, modelDisplayString } from '../utils/model/model.js'
import { getModelOptions } from '../utils/model/modelOptions.js'
import { Select, type OptionWithDescription } from './CustomSelect/index.js'
import { Pane } from './design-system/Pane.js'

export type Props = {
  initial: string | null
  sessionModel?: ModelSetting
  onSelect: (model: string | null) => void
  onCancel?: () => void
  isStandaloneCommand?: boolean
  headerText?: string
  skipSettingsWrite?: boolean
  allowAddModel?: boolean
}

const NO_PREFERENCE = '__NO_PREFERENCE__'
const ARK_CUSTOM_MODEL = '__ARK_CUSTOM_MODEL__'

export function ModelPicker({
  initial,
  sessionModel,
  onSelect,
  onCancel,
  headerText,
  allowAddModel,
}: Props): React.ReactNode {
  const [error, setError] = useState<string>()
  const modelOptions = useMemo(() => getModelOptions(), [])

  const options = useMemo<OptionWithDescription<string>[]>(() => {
    const result: OptionWithDescription<string>[] = []
    result.push({
      value: NO_PREFERENCE,
      label: '使用默认模型',
      description: modelDisplayString(null),
    })

    for (const option of modelOptions) {
      if (!option.value) continue
      result.push({
        value: option.value,
        label: option.label,
        description: option.description,
      })
    }

    const ark = getProviderDefinition('volcengineArk')
    if (allowAddModel && ark?.allowCustomModels && getProviderCredential(ark.id)) {
      result.push({
        type: 'input',
        value: ARK_CUSTOM_MODEL,
        label: '输入火山方舟模型 ID',
        description: '例如 ark-code-latest；保存后最近使用的模型排在前面',
        placeholder: '模型 ID',
        onChange: modelId => {
          try {
            const model = rememberProviderModel('volcengineArk', modelId)
            setError(undefined)
            onSelect(model)
          } catch (inputError) {
            setError(
              inputError instanceof Error ? inputError.message : String(inputError),
            )
          }
        },
      })
    }
    return result
  }, [allowAddModel, modelOptions, onSelect])

  const initialValue = initial ?? NO_PREFERENCE
  const hasInitial = options.some(option => option.value === initialValue)

  return (
    <Pane color="permission">
      <Box flexDirection="column" gap={1}>
        <Text bold>{headerText ?? '选择模型'}</Text>
        {sessionModel ? (
          <Text dimColor>当前会话临时使用：{sessionModel}</Text>
        ) : null}
        <Select
          options={options}
          defaultValue={hasInitial ? initialValue : undefined}
          defaultFocusValue={hasInitial ? initialValue : options[0]?.value}
          visibleOptionCount={Math.min(10, options.length)}
          onChange={value => {
            if (value === ARK_CUSTOM_MODEL) return
            onSelect(value === NO_PREFERENCE ? null : value)
          }}
          onCancel={onCancel}
          layout="compact-vertical"
        />
        {error ? <Text color="error">{error}</Text> : null}
        {modelOptions.length === 0 ? (
          <Text color="warning">尚未配置 Provider，请先运行 /connect。</Text>
        ) : null}
      </Box>
    </Pane>
  )
}

export function getArkModelReference(modelId: string): string {
  return formatProviderModelReference('volcengineArk', modelId)
}
