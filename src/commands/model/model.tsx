import * as React from 'react'
import type { CommandResultDisplay } from '../../commands.js'
import { ModelPicker } from '../../components/ModelPicker.js'
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { getProviderCredential } from '../../utils/authStore.js'
import {
  getDefaultMainLoopModel,
  modelDisplayString,
} from '../../utils/model/model.js'
import {
  resolveProviderModelReference,
} from '../../utils/model/providerDefinitions.js'
import { rememberProviderModel } from '../../utils/model/providerModelStore.js'
import { applyProviderEnv } from '../../utils/model/providerPresets.js'

type Done = (
  result?: string,
  options?: { display?: CommandResultDisplay },
) => void

function applySelectedModel(
  model: string | null,
  setAppState: ReturnType<typeof useSetAppState>,
): void {
  if (model) {
    const reference = resolveProviderModelReference(model)
    if (!reference) throw new Error(`无法识别模型 ${model}`)
    applyProviderEnv(process.env, reference.provider, reference.modelId)
  }
  setAppState(previous => ({
    ...previous,
    mainLoopModel: model,
    mainLoopModelForSession: null,
  }))
}

function ModelPickerCommand({ onDone }: { onDone: Done }): React.ReactNode {
  const mainLoopModel = useAppState(state => state.mainLoopModel)
  const sessionModel = useAppState(state => state.mainLoopModelForSession)
  const setAppState = useSetAppState()

  return (
    <ModelPicker
      initial={mainLoopModel}
      sessionModel={sessionModel}
      allowAddModel
      isStandaloneCommand
      onCancel={() =>
        onDone(`已保留当前模型：${modelDisplayString(mainLoopModel)}`, {
          display: 'system',
        })
      }
      onSelect={model => {
        try {
          applySelectedModel(model, setAppState)
          onDone(`已切换模型：${modelDisplayString(model)}`)
        } catch (error) {
          onDone(error instanceof Error ? error.message : String(error), {
            display: 'system',
          })
        }
      }}
    />
  )
}

function SetModelAndClose({ args, onDone }: { args: string; onDone: Done }) {
  const setAppState = useSetAppState()

  React.useEffect(() => {
    if (args === 'default') {
      applySelectedModel(null, setAppState)
      onDone(`已恢复默认模型：${getDefaultMainLoopModel()}`)
      return
    }

    const reference = resolveProviderModelReference(args)
    if (!reference) {
      onDone(
        `无法识别模型“${args}”。内置模型可使用唯一裸名称；火山方舟自定义模型必须写成 volcengineArk/模型ID。`,
        { display: 'system' },
      )
      return
    }
    if (!getProviderCredential(reference.provider)) {
      onDone(`Provider ${reference.provider} 尚未配置凭据，请先运行 /connect。`, {
        display: 'system',
      })
      return
    }

    if (reference.provider === 'volcengineArk') {
      rememberProviderModel(reference.provider, reference.modelId)
    }
    applySelectedModel(reference.value, setAppState)
    onDone(`已切换模型：${reference.value}`)
  }, [args, onDone, setAppState])

  return null
}

function ShowModelAndClose({ onDone }: { onDone: Done }) {
  const mainLoopModel = useAppState(state => state.mainLoopModel)
  const sessionModel = useAppState(state => state.mainLoopModelForSession)

  React.useEffect(() => {
    const base = modelDisplayString(mainLoopModel)
    onDone(
      sessionModel
        ? `当前会话模型：${sessionModel}\n基础模型：${base}`
        : `当前模型：${base}`,
    )
  }, [mainLoopModel, onDone, sessionModel])
  return null
}

export const call: LocalJSXCommandCall = async (onDone, _context, rawArgs) => {
  const args = rawArgs?.trim() ?? ''
  if (COMMON_INFO_ARGS.includes(args)) {
    return <ShowModelAndClose onDone={onDone} />
  }
  if (COMMON_HELP_ARGS.includes(args)) {
    onDone(
      '运行 /model 打开模型列表；运行 /model provider/modelId 直接切换；运行 /model default 恢复默认值。',
      { display: 'system' },
    )
    return
  }
  if (args) return <SetModelAndClose args={args} onDone={onDone} />
  return <ModelPickerCommand onDone={onDone} />
}
