import type { PermissionMode } from '../permissions/PermissionMode.js'
import { parseUserSpecifiedModel } from './model.js'
import { getAllProviderDefinitions } from './providerDefinitions.js'
import { readAuthStore } from '../authStore.js'

export type AgentModelOption = {
  value: string
  label: string
  description: string
}

/**
 * Get the default subagent model. Returns 'inherit' so subagents inherit
 * the model from the parent thread.
 */
export function getDefaultSubagentModel(): string {
  return 'inherit'
}

/**
 * Get the effective model string for an agent.
 *
 * Resolution order:
 *   1. CLAUDE_CODE_SUBAGENT_MODEL env var
 *   2. tool-specified model (e.g. from the Agent tool invocation)
 *   3. agent definition's model (or 'inherit' default)
 *      - 'inherit' returns the parent model verbatim
 *      - otherwise parseUserSpecifiedModel trims the input
 */
export function getAgentModel(
  agentModel: string | undefined,
  parentModel: string,
  toolSpecifiedModel?: string,
  _permissionMode?: PermissionMode,
): string {
  if (process.env.CLAUDE_CODE_SUBAGENT_MODEL) {
    return parseUserSpecifiedModel(process.env.CLAUDE_CODE_SUBAGENT_MODEL)
  }
  if (toolSpecifiedModel) {
    return parseUserSpecifiedModel(toolSpecifiedModel)
  }
  const model = agentModel ?? getDefaultSubagentModel()
  if (model === 'inherit') {
    return parentModel
  }
  return parseUserSpecifiedModel(model)
}

/**
 * Render an agent model setting for display.
 */
export function getAgentModelDisplay(model: string | undefined): string {
  if (!model) return 'Inherit from parent (default)'
  if (model === 'inherit') return 'Inherit from parent'
  return model
}

/**
 * Get available model options for agents. Always includes an 'inherit' option,
 * plus every model from providers that have an API key configured in the
 * auth store.
 */
export function getAgentModelOptions(): AgentModelOption[] {
  const options: AgentModelOption[] = [
    {
      value: 'inherit',
      label: 'Inherit from parent',
      description: 'Use the same model as the main conversation',
    },
  ]
  const store = readAuthStore()
  for (const def of getAllProviderDefinitions()) {
    if (!store[def.id]?.apiKey) continue
    for (const model of def.models) {
      options.push({
        value: `${def.id}/${model.id}`,
        label: model.id,
        description: `${def.label} · ${model.id}`,
      })
    }
  }
  return options
}
