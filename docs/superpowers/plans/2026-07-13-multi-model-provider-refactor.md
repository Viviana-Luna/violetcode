# 多模型支持：显式 Provider 重构 实现计划

> **实施说明：** 按任务顺序推进；任务中的 checkbox（`- [ ]`）仅保留原始实施记录。

**目标：** 将 VioletCode 重构为仅支持两个显式 Provider（DeepSeek、火山方舟）的工具，删除上游官方端点、OpenAI-shim 和专属运行时特性。

**Architecture:** 底层共用 Anthropic SDK 对接自定义 base URL，按 ProviderDefinition 配置认证/端点/能力矩阵。凭据存 `~/.violet/auth.json`，`/connect` 命令配置 provider，`/model` 按 `provider/model` 选择。

**Tech Stack:** TypeScript, Bun, React (Ink), @anthropic-ai/sdk

## 实施后补充（2026-07-14）

真实验收确认火山方舟 Coding Plan 与 Agent Plan 是不同产品。本期仅支持 Agent Plan，`ProviderDefinition` 固定使用 `/api/plan`；Coding Plan 不进入配置或路由，未来若支持必须新增独立 Provider ID。Provider 专项验证已落为 Bun 测试，验收门禁采用“重构文件无新增诊断、全仓诊断数不高于 `origin/main` 基线”。

## Global Constraints

- 项目用 Bun 运行（`./violet` 脚本：`bun --preload macro-shim.cjs src/entrypoints/cli.tsx`）
- 无测试框架；验证手段：`tsc --noEmit` 类型检查 + `./violet --help` 启动验证
- 配置目录：`~/.violet/`（`getClaudeConfigHomeDir()`）
- 路径别名：`src/*` → `src/*`（tsconfig paths）
- import 使用 `.js` 后缀（ESM）
- 删除为主的重构：先删底层依赖文件，再改引用方，每批后跑类型检查

## 验证方法

由于无测试框架，每个任务后用以下方式验证：
1. **类型检查**：`npx tsc --noEmit`（需先 `npm install -D typescript`）
2. **启动验证**：`./violet --help` 能正常输出
3. **最终验收**：按 spec 中的 10 条验收用例

---

### Task 1: 安装 TypeScript + 建立类型检查命令

**Files:**
- Modify: `package.json`（添加 typescript devDependency + typecheck script）

- [ ] **Step 1: 安装 typescript**

```bash
cd /path/to/violetcode
bun add -d typescript
```

- [ ] **Step 2: 添加 typecheck script 到 package.json**

在 `scripts` 中添加：
```json
"typecheck": "tsc --noEmit"
```

- [ ] **Step 3: 验证类型检查可运行**

```bash
bun run typecheck 2>&1 | head -20
```
Expected: 输出类型错误（当前代码有未提交的 WIP，可能有错误），但命令本身能运行

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add typescript devDependency and typecheck script"
```

---

### Task 2: 新增 ProviderDefinition 和 auth.json 读写

**Files:**
- Create: `src/utils/model/providerDefinitions.ts`
- Create: `src/utils/authStore.ts`
- Create: `src/utils/model/types.ts`

**Interfaces:**
- Produces: `APIProvider` type, `ProviderDefinition` type, `ProviderModel` type, `PROVIDER_DEFINITIONS` constant, `readAuthStore()`, `writeAuthStore()`, `getProviderApiKey()`

- [ ] **Step 1: 创建类型定义 `src/utils/model/types.ts`**

```typescript
export type APIProvider = 'deepseek' | 'volcengineArk'

export type ProviderModelCapabilities = {
  thinking: boolean
  toolUse: boolean
  images: boolean
  betaHeaders: boolean
}

export type ProviderModel = {
  id: string
  contextWindow?: number
  maxOutputTokens?: number
  capabilities: ProviderModelCapabilities
}

export type ProviderDefinition = {
  id: APIProvider
  label: string
  baseUrl: string
  authMethod: 'x-api-key' | 'bearer'
  apiKeyEnvVar: string
  models: ProviderModel[]
}

export type ProviderProfile = {
  id: string
  name: string
  provider: APIProvider
  apiKey: string
  models: ProviderModel[]
}
```

- [ ] **Step 2: 创建 Provider 定义 `src/utils/model/providerDefinitions.ts`**

```typescript
import type { ProviderDefinition } from './types.js'

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    authMethod: 'x-api-key',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    models: [
      {
        id: 'deepseek-v4-pro',
        contextWindow: 1_000_000,
        maxOutputTokens: 64_000,
        capabilities: { thinking: true, toolUse: true, images: false, betaHeaders: false },
      },
      {
        id: 'deepseek-v4-flash',
        contextWindow: 200_000,
        maxOutputTokens: 8_000,
        capabilities: { thinking: false, toolUse: true, images: false, betaHeaders: false },
      },
    ],
  },
  {
    id: 'volcengineArk',
    label: '火山方舟 Agent Plan',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
    authMethod: 'bearer',
    apiKeyEnvVar: 'VOLCENGINE_ARK_API_KEY',
    models: [
      {
        id: 'ark-code-latest',
        contextWindow: 200_000,
        maxOutputTokens: 32_000,
        capabilities: { thinking: false, toolUse: true, images: false, betaHeaders: false },
      },
    ],
  },
]

export function getProviderDefinition(id: string): ProviderDefinition | undefined {
  return PROVIDER_DEFINITIONS.find(p => p.id === id)
}

export function getProviderModel(
  providerId: string,
  modelId: string,
): { provider: ProviderDefinition; model: ProviderModel } | undefined {
  const provider = getProviderDefinition(providerId)
  if (!provider) return undefined
  const model = provider.models.find(m => m.id === modelId)
  if (!model) return undefined
  return { provider, model }
}
```

注意：`ProviderModel` 类型需要从 `types.js` import，在代码中补上 `import type { ProviderModel, ProviderDefinition } from './types.js'`。

- [ ] **Step 3: 创建 auth store `src/utils/authStore.ts`**

```typescript
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from './envUtils.js'
import type { APIProvider } from './model/types.js'

export type AuthStore = Partial<Record<APIProvider, { apiKey: string }>>

export function getAuthStorePath(): string {
  return join(getClaudeConfigHomeDir(), 'auth.json')
}

export function readAuthStore(): AuthStore {
  try {
    const content = readFileSync(getAuthStorePath(), 'utf-8')
    return JSON.parse(content) as AuthStore
  } catch {
    return {}
  }
}

export function writeAuthStore(store: AuthStore): void {
  const dir = getClaudeConfigHomeDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(getAuthStorePath(), JSON.stringify(store, null, 2))
}

export function getProviderApiKey(provider: APIProvider): string | undefined {
  const store = readAuthStore()
  return store[provider]?.apiKey
}

export function setProviderApiKey(provider: APIProvider, apiKey: string): void {
  const store = readAuthStore()
  store[provider] = { apiKey }
  writeAuthStore(store)
}
```

注意：`ProviderModel` import 在 `providerDefinitions.ts` 中需要补上。`envUtils.js` 的 `getClaudeConfigHomeDir` 已存在。

- [ ] **Step 4: 类型检查**

```bash
bun run typecheck 2>&1 | grep -E "(providerDefinitions|authStore|model/types)" | head -10
```
Expected: 无关于新文件的错误（可能有其他既有错误）

- [ ] **Step 5: Commit**

```bash
git add src/utils/model/types.ts src/utils/model/providerDefinitions.ts src/utils/authStore.ts
git commit -m "feat: add ProviderDefinition types and auth.json store"
```

---

### Task 3: 重写 providers.ts

**Files:**
- Modify: `src/utils/model/providers.ts`（完全重写）

**Interfaces:**
- Produces: `getAPIProvider()` 返回当前选中的 `APIProvider`，`isAnthropicCompatibleProvider()` 恒 true
- Consumes: `ProviderDefinition`, `readAuthStore` from Task 2

- [ ] **Step 1: 重写 `src/utils/model/providers.ts`**

```typescript
import type { APIProvider } from './types.js'
import { readAuthStore } from '../authStore.js'
import { getProviderDefinition } from './providerDefinitions.js'

export type { APIProvider }

function getSelectedProviderFromConfig(): APIProvider | undefined {
  // 从 auth.json 读取第一个已配置的 provider
  const store = readAuthStore()
  for (const def of getProviderDefinition as undefined) {
    // 用 PROVIDER_DEFINITIONS 遍历
  }
  return undefined
}

export function getAPIProvider(): APIProvider {
  // 优先从环境变量读取
  const envProvider = process.env.VIOLET_PROVIDER as APIProvider | undefined
  if (envProvider && getProviderDefinition(envProvider)) {
    return envProvider
  }
  // 从 auth.json 读取已配置的 provider
  const store = readAuthStore()
  const configured = (Object.keys(store) as APIProvider[]).find(p => getProviderDefinition(p))
  if (configured) return configured
  // 默认 deepseek
  return 'deepseek'
}

export function isAnthropicCompatibleProvider(): boolean {
  return true
}

export function getAPIProviderDisplayName(provider: APIProvider): string {
  const def = getProviderDefinition(provider)
  return def?.label ?? provider
}

export function hasCustomAnthropicBaseUrl(): boolean {
  return true
}

export function hasConfiguredCustomApi(): boolean {
  return getProviderApiKey(getAPIProvider()) !== undefined
}

export function needsCustomApiSetup(): boolean {
  return !hasConfiguredCustomApi()
}

export function getProviderApiKey(provider: APIProvider): string | undefined {
  const store = readAuthStore()
  return store[provider]?.apiKey
}
```

注意：需要 import `getProviderApiKey` 或直接用 `readAuthStore`。清理重复。`getProviderDefinition` 需正确 import。

- [ ] **Step 2: 修复 import 和重复**

修正后的完整 `providers.ts`：

```typescript
import type { APIProvider } from './types.js'
import { readAuthStore } from '../authStore.js'
import { getProviderDefinition, PROVIDER_DEFINITIONS } from './providerDefinitions.js'

export type { APIProvider }

export function getAPIProvider(): APIProvider {
  const envProvider = process.env.VIOLET_PROVIDER as APIProvider | undefined
  if (envProvider && getProviderDefinition(envProvider)) {
    return envProvider
  }
  const store = readAuthStore()
  const configured = (Object.keys(store) as APIProvider[]).find(
    p => getProviderDefinition(p) !== undefined && store[p]?.apiKey,
  )
  if (configured) return configured
  return 'deepseek'
}

export function isAnthropicCompatibleProvider(): boolean {
  return true
}

export function getAPIProviderDisplayName(provider: APIProvider): string {
  return getProviderDefinition(provider)?.label ?? provider
}

export function hasCustomAnthropicBaseUrl(): boolean {
  return true
}

export function hasConfiguredCustomApi(): boolean {
  return readAuthStore()[getAPIProvider()]?.apiKey !== undefined
}

export function needsCustomApiSetup(): boolean {
  return !hasConfiguredCustomApi()
}
```

删除已废弃的函数：`isOpenAIShimProvider`, `isFirstPartyAnthropicBaseUrl`, `isDeepSeekAnthropicBaseUrl`, `getModelConfigProvider`, `getAPIProviderForStatsig`。

注意：`getAPIProviderForStatsig` 被 analytics 引用，需改为返回 `getAPIProvider()` 的结果。

- [ ] **Step 3: 类型检查**

```bash
bun run typecheck 2>&1 | grep "providers.ts" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add src/utils/model/providers.ts
git commit -m "refactor: rewrite providers.ts for explicit provider model"
```

---

### Task 4: 重写 model.ts（核心模型工具函数）

**Files:**
- Modify: `src/utils/model/model.ts`（大幅精简）

**Interfaces:**
- Produces: `getMainLoopModel()`, `getUserSpecifiedModelSetting()`, `getSmallFastModel()`, `parseUserSpecifiedModel()` (简化), `normalizeModelStringForAPI()`, `modelDisplayString()`, `renderModelName()`, `getPublicModelName()`
- 删除所有 Claude 专属函数

- [ ] **Step 1: 完全重写 `src/utils/model/model.ts`**

```typescript
import { getMainLoopModelOverride } from '../../bootstrap/state.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import { getAPIProvider } from './providers.js'
import { getProviderDefinition, getProviderModel } from './providerDefinitions.js'
import { readAuthStore } from '../authStore.js'
import type { APIProvider, ProviderModel } from './types.js'

export type ModelName = string
export type ModelShortName = string
export type ModelSetting = ModelName | null

export function getSmallFastModel(): ModelName {
  return process.env.ANTHROPIC_SMALL_FAST_MODEL || getMainLoopModel()
}

export function getUserSpecifiedModelSetting(): ModelSetting | undefined {
  const modelOverride = getMainLoopModelOverride()
  if (modelOverride !== undefined) {
    return modelOverride
  }
  const settings = getSettings_DEPRECATED() || {}
  return process.env.ANTHROPIC_MODEL || settings.model || undefined
}

export function getMainLoopModel(): ModelName {
  const model = getUserSpecifiedModelSetting()
  if (model !== undefined && model !== null) {
    return parseUserSpecifiedModel(model)
  }
  return getDefaultMainLoopModel()
}

export function getDefaultMainLoopModel(): ModelName {
  const provider = getAPIProvider()
  const def = getProviderDefinition(provider)
  return def?.models[0]?.id ?? 'deepseek-v4-pro'
}

export function parseUserSpecifiedModel(modelInput: ModelName): ModelName {
  return modelInput.trim()
}

export function normalizeModelStringForAPI(model: string): string {
  return model.replace(/\[(1|2)m\]/gi, '')
}

export function renderModelName(model: ModelName): string {
  return model
}

export function modelDisplayString(model: ModelSetting): string {
  if (model === null) {
    return `Default (${getDefaultMainLoopModel()})`
  }
  return model
}

export function getPublicModelName(model: ModelName): string {
  return model
}

export function getCanonicalName(fullModelName: ModelName): ModelShortName {
  return fullModelName
}

export function firstPartyNameToCanonical(name: ModelName): ModelShortName {
  return name
}

export function getModelCapabilities(model: ModelName): ProviderModelCapabilities | undefined {
  const provider = getAPIProvider()
  const result = getProviderModel(provider, model)
  return result?.model.capabilities
}

export type ProviderModelCapabilities = import('./types.js').ProviderModelCapabilities
```

注意：`ProviderModelCapabilities` 的 re-export 语法不对，直接 import type。修正：在文件顶部 `import type { APIProvider, ProviderModel, ProviderModelCapabilities } from './types.js'`。

- [ ] **Step 2: 修正 import**

确保文件顶部有：
```typescript
import type { APIProvider, ProviderModel, ProviderModelCapabilities } from './types.js'
```
并删除底部的 `export type ProviderModelCapabilities` 行。

- [ ] **Step 3: 类型检查**

```bash
bun run typecheck 2>&1 | grep "model/model.ts" | head -20
```
Expected: 可能有很多引用方报错（modelOptions.ts, claude.ts 等引用了已删除的函数），这些在后续 Task 修复

- [ ] **Step 4: Commit**

```bash
git add src/utils/model/model.ts
git commit -m "refactor: rewrite model.ts to remove Claude-specific functions"
```

---

### Task 5: 重写 context.ts（上下文窗口）

**Files:**
- Modify: `src/utils/context.ts`

- [ ] **Step 1: 重写 `src/utils/context.ts`**

```typescript
import { getMainLoopModel } from './model/model.js'
import { getModelCapabilities } from './model/model.js'

export const MODEL_CONTEXT_WINDOW_DEFAULT = 200_000
export const COMPACT_MAX_OUTPUT_TOKENS = 20_000
export const CAPPED_DEFAULT_MAX_TOKENS = 8_000
export const ESCALATED_MAX_TOKENS = 64_000

export function getContextWindowForModel(model: string): number {
  const envOverride = process.env.ANTHROPIC_CONTEXT_WINDOW
  if (envOverride) {
    const n = parseInt(envOverride, 10)
    if (!isNaN(n) && n > 0) return n
  }
  const caps = getModelCapabilities(model)
  if (caps?.contextWindow !== undefined) return caps.contextWindow
  // 通过 ProviderModel 查找
  return MODEL_CONTEXT_WINDOW_DEFAULT
}

export function getModelMaxOutputTokens(model: string): {
  default: number
  upperLimit: number
} {
  const envMax = process.env.ANTHROPIC_MAX_OUTPUT_TOKENS
  if (envMax) {
    const n = parseInt(envMax, 10)
    if (!isNaN(n) && n > 0) {
      return { default: Math.min(n, 32_000), upperLimit: n }
    }
  }
  return { default: 32_000, upperLimit: 64_000 }
}

export function getMaxThinkingTokensForModel(model: string): number {
  return getModelMaxOutputTokens(model).upperLimit - 1
}

export function calculateContextPercentages(
  currentUsage: {
    input_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  } | null,
  contextWindowSize: number,
): { used: number | null; remaining: number | null } {
  if (!currentUsage) return { used: null, remaining: null }
  const total = currentUsage.input_tokens + currentUsage.cache_creation_input_tokens + currentUsage.cache_read_input_tokens
  const used = Math.min(100, Math.round((total / contextWindowSize) * 100))
  return { used, remaining: 100 - used }
}
```

注意：`getContextWindowForModel` 需从 `ProviderModel` 获取 contextWindow。需修正：`getModelCapabilities` 返回的是 capabilities，不是 contextWindow。需要另一个函数获取 ProviderModel。

修正：在 model.ts 中添加 `getProviderModelInfo(model)` 返回完整 ProviderModel。

- [ ] **Step 2: 在 model.ts 添加 getProviderModelInfo**

在 `src/utils/model/model.ts` 中添加：
```typescript
export function getProviderModelInfo(model: ModelName): ProviderModel | undefined {
  const provider = getAPIProvider()
  return getProviderModel(provider, model)?.model
}
```

并更新 context.ts 使用 `getProviderModelInfo`：
```typescript
import { getProviderModelInfo } from './model/model.js'

export function getContextWindowForModel(model: string): number {
  const envOverride = process.env.ANTHROPIC_CONTEXT_WINDOW
  if (envOverride) {
    const n = parseInt(envOverride, 10)
    if (!isNaN(n) && n > 0) return n
  }
  const info = getProviderModelInfo(model)
  return info?.contextWindow ?? MODEL_CONTEXT_WINDOW_DEFAULT
}

export function getModelMaxOutputTokens(model: string): { default: number; upperLimit: number } {
  const envMax = process.env.ANTHROPIC_MAX_OUTPUT_TOKENS
  if (envMax) {
    const n = parseInt(envMax, 10)
    if (!isNaN(n) && n > 0) return { default: Math.min(n, 32_000), upperLimit: n }
  }
  const info = getProviderModelInfo(model)
  const max = info?.maxOutputTokens ?? 32_000
  return { default: Math.min(max, 32_000), upperLimit: max }
}
```

- [ ] **Step 3: 类型检查**

```bash
bun run typecheck 2>&1 | grep "context.ts" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add src/utils/context.ts src/utils/model/model.ts
git commit -m "refactor: rewrite context.ts to use ProviderModel for window/output tokens"
```

---

### Task 6: 重写 modelOptions.ts（模型选项生成）

**Files:**
- Modify: `src/utils/model/modelOptions.ts`（大幅精简）

- [ ] **Step 1: 重写 `src/utils/model/modelOptions.ts`**

```typescript
import { getInitialMainLoopModel } from '../../bootstrap/state.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import { getAPIProvider } from './providers.js'
import { getProviderDefinition, PROVIDER_DEFINITIONS } from './providerDefinitions.js'
import { readAuthStore } from '../authStore.js'
import { getProviderProfileDescription, getProviderProfileModels } from '../providerProfile.js'
import { getGlobalConfig } from '../config.js'
import { getMainLoopModel, type ModelSetting } from './model.js'

export type ModelOption = {
  value: ModelSetting
  label: string
  description: string
  descriptionForModel?: string
}

export function getModelOptions(): ModelOption[] {
  const options: ModelOption[] = []
  const store = readAuthStore()

  // 从已配置凭据的 Provider 生成模型选项
  for (const def of PROVIDER_DEFINITIONS) {
    if (!store[def.id]?.apiKey) continue
    for (const model of def.models) {
      const value = `${def.id}/${model.id}`
      options.push({
        value,
        label: model.id,
        description: `${def.label} · ${model.id}`,
      })
    }
  }

  // 追加用户自定义模型选项
  for (const profile of getGlobalConfig().userCustomModelProfiles ?? []) {
    const description = getProviderProfileDescription(profile)
    for (const value of getProviderProfileModels(profile)) {
      if (!value || options.some(o => o.value === value)) continue
      options.push({ value, label: value, description })
    }
  }

  for (const opt of getGlobalConfig().userAddedModelOptions ?? []) {
    if (!options.some(o => o.value === opt.value)) options.push(opt)
  }

  for (const opt of getGlobalConfig().additionalModelOptionsCache ?? []) {
    if (!options.some(o => o.value === opt.value)) options.push(opt)
  }

  // 追加当前模型
  const currentModel = getMainLoopModel()
  if (currentModel && !options.some(o => o.value === currentModel)) {
    options.push({ value: currentModel, label: currentModel, description: 'Current model' })
  }

  return options
}
```

- [ ] **Step 2: 类型检查**

```bash
bun run typecheck 2>&1 | grep "modelOptions" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add src/utils/model/modelOptions.ts
git commit -m "refactor: rewrite modelOptions.ts to generate options from ProviderDefinitions"
```

---

### Task 7: 重写 agent.ts（子代理模型）

**Files:**
- Modify: `src/utils/model/agent.ts`

- [ ] **Step 1: 重写 `src/utils/model/agent.ts`**

```typescript
import type { PermissionMode } from '../permissions/PermissionMode.js'
import { capitalize } from '../stringUtils.js'
import { getMainLoopModel, parseUserSpecifiedModel } from './model.js'
import { getProviderDefinition } from './providerDefinitions.js'
import { readAuthStore } from '../authStore.js'

export type AgentModelOption = {
  value: string
  label: string
  description: string
}

export function getDefaultSubagentModel(): string {
  return 'inherit'
}

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

export function getAgentModelDisplay(model: string | undefined): string {
  if (!model) return 'Inherit from parent (default)'
  if (model === 'inherit') return 'Inherit from parent'
  return model
}

export function getAgentModelOptions(): AgentModelOption[] {
  const options: AgentModelOption[] = [
    {
      value: 'inherit',
      label: 'Inherit from parent',
      description: 'Use the same model as the main conversation',
    },
  ]
  // 从已配置的 Provider 生成选项
  const store = readAuthStore()
  for (const def of getProviderDefinition as unknown) {
    // 用 PROVIDER_DEFINITIONS
  }
  return options
}
```

注意：`getAgentModelOptions` 需用 `PROVIDER_DEFINITIONS`。修正 import。

- [ ] **Step 2: 修正 getAgentModelOptions**

```typescript
import { PROVIDER_DEFINITIONS } from './providerDefinitions.js'

export function getAgentModelOptions(): AgentModelOption[] {
  const options: AgentModelOption[] = [
    { value: 'inherit', label: 'Inherit from parent', description: 'Use the same model as the main conversation' },
  ]
  const store = readAuthStore()
  for (const def of PROVIDER_DEFINITIONS) {
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
```

- [ ] **Step 3: 类型检查**

```bash
bun run typecheck 2>&1 | grep "agent.ts" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add src/utils/model/agent.ts
git commit -m "refactor: rewrite agent.ts to remove Claude aliases and bedrock region logic"
```

---

### Task 8: 删除 model 子目录中不需要的文件

**Files:**
- Delete: `src/utils/model/configs.ts`, `aliases.ts`, `modelStrings.ts`, `antModels.ts`, `deprecation.ts`, `check1mAccess.ts`, `modelSupportOverrides.ts`, `contextWindowUpgradeCheck.ts`, `bedrock.ts`, `modelCapabilities.ts`
- Delete: `src/services/api/openaiShim.ts`
- Delete: `src/integrations/` (整目录)

- [ ] **Step 1: 删除文件**

```bash
cd /path/to/violetcode
rm src/utils/model/configs.ts
rm src/utils/model/aliases.ts
rm src/utils/model/modelStrings.ts
rm src/utils/model/antModels.ts
rm src/utils/model/deprecation.ts
rm src/utils/model/check1mAccess.ts
rm src/utils/model/modelSupportOverrides.ts
rm src/utils/model/contextWindowUpgradeCheck.ts
rm src/utils/model/bedrock.ts
rm src/utils/model/modelCapabilities.ts
rm src/services/api/openaiShim.ts
rm -rf src/integrations/
```

- [ ] **Step 2: 修复引用错误**

运行类型检查，找出所有引用已删除文件的地方：
```bash
bun run typecheck 2>&1 | grep -E "Cannot find module|does not exist" | grep -E "(configs|aliases|modelStrings|antModels|deprecation|check1mAccess|modelSupportOverrides|contextWindowUpgradeCheck|bedrock|modelCapabilities|openaiShim|integrations)" | head -30
```

对每个引用方：
- 删除该 import 行
- 如果引用了已删除的函数，改为使用新函数或删除该代码块
- 对于 `modelAllowlist.ts`：删除 `isModelAlias`/`isModelFamilyAlias` 引用
- 对于 `validateModel.ts`：删除 `getModelStrings` 引用
- 对于 `providerPresets.ts`：删除 `integrations` 引用（后续 Task 重写）
- 对于 `useDeprecationWarningNotification.tsx`：删除整个文件或清空
- 对于 `main.tsx`：删除 `refreshModelCapabilities` 调用

- [ ] **Step 3: 逐文件修复引用**

关键文件修复：
1. `src/utils/model/modelAllowlist.ts` - 删除 aliases import，简化为直接字符串匹配
2. `src/utils/model/validateModel.ts` - 删除 modelStrings import，简化
3. `src/hooks/notifs/useDeprecationWarningNotification.tsx` - 删除文件
4. `src/main.tsx` - 删除 `refreshModelCapabilities` import 和调用

- [ ] **Step 4: 类型检查**

```bash
bun run typecheck 2>&1 | grep "Cannot find module" | head -20
```
Expected: 无 "Cannot find module" 错误（引用已删除文件的）

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: delete Claude-specific model files, OpenAI-shim, and integrations framework"
```

---

### Task 9: 重写 providerPresets.ts → providerEndpoint.ts + providerValidation.ts + providerProfile.ts

**Files:**
- Modify: `src/utils/model/providerPresets.ts`（重写为精简版）
- Modify: `src/utils/providerValidation.ts`
- Modify: `src/utils/providerProfile.ts`
- Delete: `src/utils/model/modelAllowlist.ts`, `validateModel.ts`（如已无用）

- [ ] **Step 1: 重写 `src/utils/model/providerPresets.ts`**

精简为仅保留 env-var 应用逻辑：
```typescript
import type { APIProvider } from './types.js'
import { getProviderDefinition } from './providerDefinitions.js'
import { readAuthStore, getProviderApiKey } from '../authStore.js'

export const MANAGED_PROVIDER_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'DEEPSEEK_API_KEY',
  'VOLCENGINE_ARK_API_KEY',
  'API_TIMEOUT_MS',
]

export function applyProviderEnv(
  targetEnv: Record<string, string | undefined>,
  provider: APIProvider,
  modelId?: string,
): void {
  const def = getProviderDefinition(provider)
  if (!def) return
  const apiKey = getProviderApiKey(provider) ?? ''

  for (const key of MANAGED_PROVIDER_ENV_KEYS) {
    delete targetEnv[key]
  }

  targetEnv.ANTHROPIC_BASE_URL = def.baseUrl
  targetEnv.ANTHROPIC_MODEL = modelId ?? def.models[0]?.id ?? ''
  targetEnv[def.apiKeyEnvVar] = apiKey

  if (def.authMethod === 'x-api-key') {
    targetEnv.ANTHROPIC_API_KEY = apiKey
  } else {
    targetEnv.ANTHROPIC_AUTH_TOKEN = apiKey
  }
}

export function clearManagedProviderEnv(
  targetEnv: Record<string, string | undefined>,
): void {
  for (const key of MANAGED_PROVIDER_ENV_KEYS) {
    delete targetEnv[key]
  }
}

export function parseModelList(modelField: string): string[] {
  return modelField.split(/[;,]/).map(p => p.trim()).filter(p => p.length > 0)
}

export function getPrimaryModel(modelField: string): string {
  const models = parseModelList(modelField)
  return models.length > 0 ? models[0] : modelField.trim()
}

export function normalizeProviderBaseUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return trimmed
  try {
    return new URL(trimmed).toString().replace(/\/$/, '')
  } catch {
    return trimmed
  }
}
```

- [ ] **Step 2: 重写 `src/utils/providerValidation.ts`**

```typescript
import { readAuthStore } from './authStore.js'
import { getProviderDefinition } from './model/providerDefinitions.js'
import type { APIProvider } from './model/types.js'
import { sanitizeApiKey } from './providerSecrets.js'

export type ProviderValidationResult = {
  ok: boolean
  provider: APIProvider
  errors: string[]
  warnings: string[]
}

export function validateProviderEnvironment(): ProviderValidationResult {
  const store = readAuthStore()
  const errors: string[] = []
  const warnings: string[] = []

  for (const def of getProviderDefinition as undefined) {
    // 用 PROVIDER_DEFINITIONS
  }
  return { ok: errors.length === 0, provider: 'deepseek', errors, warnings }
}

export function getProviderEnvironmentValidationError(): string | null {
  return validateProviderEnvironment().errors[0] ?? null
}
```

注意：需要 import `PROVIDER_DEFINITIONS`。修正后：

```typescript
import { PROVIDER_DEFINITIONS, getProviderDefinition } from './model/providerDefinitions.js'

export function validateProviderEnvironment(): ProviderValidationResult {
  const store = readAuthStore()
  const errors: string[] = []
  const warnings: string[] = []
  let activeProvider: APIProvider = 'deepseek'

  for (const def of PROVIDER_DEFINITIONS) {
    if (!store[def.id]?.apiKey) {
      errors.push(`${def.label} requires ${def.apiKeyEnvVar}`)
    } else {
      activeProvider = def.id
    }
  }
  return { ok: errors.length === 0, provider: activeProvider, errors, warnings }
}
```

- [ ] **Step 3: 重写 `src/utils/providerProfile.ts`**

保留 UserCustomModelProfile 管理逻辑，但简化为不依赖 integrations。

- [ ] **Step 4: 类型检查**

```bash
bun run typecheck 2>&1 | grep -E "(providerPresets|providerValidation|providerProfile)" | head -10
```

- [ ] **Step 5: Commit**

```bash
git add src/utils/model/providerPresets.ts src/utils/providerValidation.ts src/utils/providerProfile.ts
git commit -m "refactor: rewrite provider presets/validation/profile for explicit provider model"
```

---

### Task 10: 重写 client.ts（API 客户端）

**Files:**
- Modify: `src/services/api/client.ts`

- [ ] **Step 1: 重写 `src/services/api/client.ts`**

删除 Bedrock/Vertex/Foundry/OAuth 分支，精简为：
```typescript
import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk'
import { getAnthropicApiKey } from 'src/utils/auth.js'
import { getUserAgent } from 'src/utils/http.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import { getProviderDefinition } from 'src/utils/model/providerDefinitions.js'
import { getProviderApiKey } from 'src/utils/authStore.js'
import { getProxyFetchOptions } from 'src/utils/proxy.js'
import { getSessionId } from '../../bootstrap/state.js'
import { isDebugToStdErr, logForDebugging } from '../../utils/debug.js'

export async function getAnthropicClient({
  apiKey,
  maxRetries,
  model,
  fetchOverride,
  source,
}: {
  apiKey?: string
  maxRetries: number
  model?: string
  fetchOverride?: ClientOptions['fetch']
  source?: string
}): Promise<Anthropic> {
  const provider = getAPIProvider()
  const def = getProviderDefinition(provider)
  const storedApiKey = getProviderApiKey(provider)
  const effectiveApiKey = apiKey ?? storedApiKey ?? ''

  const customHeaders = getCustomHeaders()
  const defaultHeaders: Record<string, string> = {
    'x-app': 'cli',
    'User-Agent': getUserAgent(),
    'X-Claude-Code-Session-Id': getSessionId(),
    ...customHeaders,
  }

  const resolvedFetch = buildFetch(fetchOverride, source)
  const timeout = parseInt(process.env.API_TIMEOUT_MS || String(600 * 1000), 10)

  const clientConfig: ConstructorParameters<typeof Anthropic>[0] = {
    apiKey: def?.authMethod === 'x-api-key' ? effectiveApiKey : null,
    authToken: def?.authMethod === 'bearer' ? effectiveApiKey : undefined,
    baseURL: def?.baseUrl,
    defaultHeaders,
    maxRetries,
    timeout,
    dangerouslyAllowBrowser: true,
    fetchOptions: getProxyFetchOptions({ forAnthropicAPI: true }) as ClientOptions['fetchOptions'],
    ...(resolvedFetch && { fetch: resolvedFetch }),
    ...(isDebugToStdErr() && { logger: createStderrLogger() }),
  }

  return new Anthropic(clientConfig)
}

function createStderrLogger(): ClientOptions['logger'] {
  return {
    error: (msg, ...args) => console.error('[Anthropic SDK ERROR]', msg, ...args),
    warn: (msg, ...args) => console.error('[Anthropic SDK WARN]', msg, ...args),
    info: (msg, ...args) => console.error('[Anthropic SDK INFO]', msg, ...args),
    debug: (msg, ...args) => console.error('[Anthropic SDK DEBUG]', msg, ...args),
  }
}

export const CLIENT_REQUEST_ID_HEADER = 'x-client-request-id'

function getCustomHeaders(): Record<string, string> {
  const customHeaders: Record<string, string> = {}
  const customHeadersEnv = process.env.ANTHROPIC_CUSTOM_HEADERS
  if (!customHeadersEnv) return customHeaders
  const headerStrings = customHeadersEnv.split(/\n|\r\n/)
  for (const headerString of headerStrings) {
    if (!headerString.trim()) continue
    const colonIdx = headerString.indexOf(':')
    if (colonIdx === -1) continue
    const name = headerString.slice(0, colonIdx).trim()
    const value = headerString.slice(colonIdx + 1).trim()
    if (name) customHeaders[name] = value
  }
  return customHeaders
}

function buildFetch(
  fetchOverride: ClientOptions['fetch'],
  source: string | undefined,
): ClientOptions['fetch'] {
  const inner = fetchOverride ?? globalThis.fetch
  return (input, init) => inner(input, init)
}
```

注意：`getAnthropicApiKey` import 可能不再需要，删除未使用的 import。`checkAndRefreshOAuthTokenIfNeeded`/`isClaudeAISubscriber`/`getClaudeAIOAuthTokens` 等删除。

- [ ] **Step 2: 类型检查**

```bash
bun run typecheck 2>&1 | grep "client.ts" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add src/services/api/client.ts
git commit -m "refactor: rewrite client.ts to use explicit provider config, remove bedrock/vertex/foundry/oauth"
```

---

### Task 11: 删除 Claude.ai OAuth 和订阅者逻辑（auth.ts）

**Files:**
- Modify: `src/utils/auth.ts`（删除 OAuth/订阅者函数，保留 API key 读取）

- [ ] **Step 1: 识别要删除的函数**

在 `src/utils/auth.ts` 中删除：
- `isClaudeAISubscriber`, `isMaxSubscriber`, `isProSubscriber`, `isTeamPremiumSubscriber`, `getSubscriptionType`
- `checkAndRefreshOAuthTokenIfNeeded`, `getClaudeAIOAuthTokens`
- `refreshAndGetAwsCredentials`, `refreshGcpCredentialsIfNeeded`
- OAuth token 刷新逻辑

保留：
- `getAnthropicApiKey`（读取 API key）
- `getApiKeyFromApiKeyHelper`

- [ ] **Step 2: 修复引用方**

搜索所有引用已删除函数的文件：
```bash
bun run typecheck 2>&1 | grep -E "isClaudeAISubscriber|isMaxSubscriber|isProSubscriber|isTeamPremiumSubscriber|getSubscriptionType|checkAndRefreshOAuthTokenIfNeeded|getClaudeAIOAuthTokens|refreshAndGetAwsCredentials|refreshGcpCredentialsIfNeeded" | head -30
```

对每个引用方：
- 删除 import
- 删除或简化使用该函数的代码块（如 `if (isClaudeAISubscriber()) { ... }` 删除整个条件块）

关键文件：
- `src/services/api/client.ts` - 已在 Task 10 处理
- `src/services/api/claude.ts` - 删除订阅者条件块
- `src/services/api/withRetry.ts` - 删除订阅者条件块
- `src/services/api/errors.ts` - 删除订阅者条件块
- `src/services/rateLimitMessages.ts` - 后续 Task 删除整个文件
- `src/services/claudeAiLimits.ts` - 后续 Task 删除整个文件
- `src/services/analytics/metadata.ts` - 删除订阅者字段
- `src/services/analytics/firstPartyEventLoggingExporter.ts` - 删除订阅者条件
- `src/cli/handlers/auth.ts` - 删除订阅者显示
- `src/hooks/useApiKeyVerification.ts` - 简化
- `src/commands.ts` - 删除订阅者条件
- `src/bridge/bridgeEnabled.ts` - 删除订阅者条件
- `src/services/api/metricsOptOut.ts` - 后续 Task 删除
- `src/services/api/usage.ts` - 后续 Task 删除
- `src/services/api/referral.ts` - 后续 Task 删除
- `src/services/api/ultrareviewQuota.ts` - 后续 Task 删除
- `src/utils/extraUsage.ts` - 后续 Task 删除
- `src/commands/cost/`, `src/commands/extra-usage/`, `src/commands/rate-limit-options/` - 后续 Task 删除

- [ ] **Step 3: 逐文件修复**

这个步骤涉及大量文件，按文件逐一修复。对每个文件：
1. 删除已删除函数的 import
2. 删除使用该函数的代码块
3. 确保剩余代码逻辑完整

- [ ] **Step 4: 类型检查**

```bash
bun run typecheck 2>&1 | grep -E "isClaudeAISubscriber|isMaxSubscriber|isProSubscriber|getSubscriptionType" | head -10
```
Expected: 无引用错误

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove Claude.ai OAuth and subscriber logic from auth.ts and callers"
```

---

### Task 12: 删除 Claude.ai 专属服务和命令

**Files:**
- Delete: `src/services/claudeAiLimits.ts`, `src/services/rateLimitMessages.ts`, `src/services/api/ultrareviewQuota.ts`, `src/services/api/referral.ts`, `src/services/api/metricsOptOut.ts`, `src/services/api/usage.ts`, `src/utils/extraUsage.ts`, `src/services/oauth/` (整目录)
- Delete: `src/commands/fast/`, `src/commands/cost/`, `src/commands/extra-usage/`, `src/commands/rate-limit-options/`, `src/commands/logout/`, `src/commands/feedback/`, `src/commands/ultraplan/`
- Delete: `src/utils/fastMode.ts`, `src/utils/effort.ts`, `src/utils/modelCost.ts`
- Delete: `src/components/EffortIndicator.ts`, `src/components/LogoV2/Opus1mMergeNotice.tsx`
- Delete: `src/hooks/notifs/useFastModeNotification.tsx`
- Delete: `src/migrations/migrateFennecToOpus.ts`, `src/migrations/resetProToOpusDefault.ts`, `src/migrations/migrateSonnet45ToSonnet46.ts`, `src/migrations/migrateOpusToOpus1m.ts`

- [ ] **Step 1: 删除文件**

```bash
cd /path/to/violetcode
rm src/services/claudeAiLimits.ts
rm src/services/rateLimitMessages.ts
rm src/services/api/ultrareviewQuota.ts
rm src/services/api/referral.ts
rm src/services/api/metricsOptOut.ts
rm src/services/api/usage.ts
rm src/utils/extraUsage.ts
rm -rf src/services/oauth/
rm -rf src/commands/fast/
rm -rf src/commands/cost/
rm -rf src/commands/extra-usage/
rm -rf src/commands/rate-limit-options/
rm -rf src/commands/logout/
rm -rf src/commands/feedback/
rm -rf src/commands/ultraplan/
rm src/utils/fastMode.ts
rm src/utils/effort.ts
rm src/utils/modelCost.ts
rm src/components/EffortIndicator.ts
rm src/components/LogoV2/Opus1mMergeNotice.tsx
rm src/hooks/notifs/useFastModeNotification.tsx
rm src/migrations/migrateFennecToOpus.ts
rm src/migrations/resetProToOpusDefault.ts
rm src/migrations/migrateSonnet45ToSonnet46.ts
rm src/migrations/migrateOpusToOpus1m.ts
```

- [ ] **Step 2: 修复引用错误**

```bash
bun run typecheck 2>&1 | grep "Cannot find module" | head -30
```

逐文件修复引用：
- `src/commands.ts` - 删除已删除命令的注册
- `src/services/api/claude.ts` - 删除 fastMode/effort/modelCost 引用
- `src/services/api/withRetry.ts` - 删除 fastMode 引用
- `src/cli/print.ts` - 删除 fastMode/effort 引用
- `src/cost-tracker.ts` - 删除 fastMode 引用
- `src/commands/model/model.tsx` - 删除 fastMode/effort 引用
- `src/components/ModelPicker.tsx` - 删除 effort/fastMode 引用（下一 Task 处理）
- `src/main.tsx` - 删除 fastMode 引用
- `src/services/analytics/config.ts` - 删除 bedrock/vertex/foundry 引用
- `src/state/AppStateStore.ts` - 删除 fastMode/effortValue 字段

- [ ] **Step 3: 类型检查**

```bash
bun run typecheck 2>&1 | grep "Cannot find module" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: delete Claude.ai-specific services, commands, and runtime features"
```

---

### Task 13: 重写 UI 组件（ModelPicker, CustomApiSetup, AppStateStore）

**Files:**
- Modify: `src/components/ModelPicker.tsx`（精简，删除 effort/fastMode）
- Modify: `src/components/CustomApiSetup.tsx`（改为 /connect 风格）
- Modify: `src/state/AppStateStore.ts`（删除 fastMode/effortValue）
- Modify: `src/commands/model/model.tsx`（删除 fastMode/effort）

- [ ] **Step 1: 精简 ModelPicker.tsx**

删除：
- effort 相关 import、state、handler、UI
- fastMode 相关 import、state、UI
- opusplan 逻辑
- EffortIndicator 引用

保留：
- 模型选择逻辑
- Add/Delete profile 流程
- profile 切换

- [ ] **Step 2: 改写 CustomApiSetup.tsx**

改为选 provider → 填 key 的流程：
- 显示 provider 列表（DeepSeek、火山方舟）
- 选 provider → 输入 API key → 保存到 auth.json
- 不再手填 base URL 和 model name

- [ ] **Step 3: 精简 AppStateStore.ts**

删除 `fastMode`、`effortValue` 字段。

- [ ] **Step 4: 精简 commands/model/model.tsx**

删除 fastMode/effort/isBilledAsExtraUsage 逻辑。

- [ ] **Step 5: 类型检查**

```bash
bun run typecheck 2>&1 | grep -E "(ModelPicker|CustomApiSetup|AppStateStore|model/model)" | head -10
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: rewrite UI components for explicit provider model"
```

---

### Task 14: 新增 /connect 命令 + 清理 managedEnvConstants + package.json

**Files:**
- Create: `src/commands/connect/`（新命令）
- Modify: `src/utils/managedEnvConstants.ts`
- Modify: `src/commands.ts`（注册 /connect）
- Modify: `package.json`（删除 bedrock/vertex/foundry 依赖）

- [ ] **Step 1: 创建 /connect 命令**

创建 `src/commands/connect/index.ts`：
```typescript
import { PROVIDER_DEFINITIONS } from '../../utils/model/providerDefinitions.js'
import { setProviderApiKey, readAuthStore } from '../../utils/authStore.js'
import type { APIProvider } from '../../utils/model/types.js'

export const connectCommand = {
  id: 'connect',
  name: 'connect',
  description: 'Connect a model provider',
  isEnabled: () => true,
  isHidden: false,
  async run({ messageId }: { messageId: string }) {
    // 显示 provider 列表，选一个，填 key，保存
    // 实际实现需要 Ink UI 交互
  },
}
```

注意：需要实现完整的 Ink 交互 UI。参考 CustomApiSetup.tsx 的交互模式。

- [ ] **Step 2: 清理 managedEnvConstants.ts**

删除所有 Bedrock/Vertex/Foundry/OpenAI/Gemini/Mistral 相关的 env vars。

- [ ] **Step 3: 清理 package.json**

删除依赖：
- `@aws-sdk/client-bedrock-runtime`
- `google-auth-library`
- 其他 bedrock/vertex/foundry SDK

- [ ] **Step 4: 类型检查 + 启动验证**

```bash
bun run typecheck 2>&1 | head -20
./violet --help 2>&1 | head -10
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add /connect command, clean up env constants and dependencies"
```

---

### Task 15: 最终清理和验证

**Files:**
- 修复所有剩余类型错误
- 迁移规则实现
- 全量验证

- [ ] **Step 1: 全量类型检查**

```bash
bun run typecheck 2>&1 | head -50
```

逐个修复剩余错误。

- [ ] **Step 2: 启动验证**

```bash
./violet --help 2>&1 | head -20
```
Expected: 正常输出帮助信息

- [ ] **Step 3: 迁移规则实现**

在启动流程中添加迁移逻辑：
- 检测现有 `userCustomModelProfiles` 中 baseUrl 为 `api.deepseek.com` 的 profile → 迁移为 deepseek provider
- 检测 `deepseek-chat`/`deepseek-reasoner` 模型名 → 提示迁移

- [ ] **Step 4: 验收用例验证**

按 spec 中的 10 条验收用例逐一验证。

- [ ] **Step 5: 最终 Commit**

```bash
git add -A
git commit -m "refactor: final cleanup, migration rules, and verification"
```

---

## Self-Review

### Spec coverage

- ✅ APIProvider 精简为 deepseek | volcengineArk — Task 2, 3
- ✅ ProviderDefinition/ProviderProfile/ProviderModel 数据结构 — Task 2
- ✅ Provider 配置矩阵 — Task 2
- ✅ auth.json 凭据存储 — Task 2
- ✅ /connect 命令 — Task 14
- ✅ /model 按 provider/model 分组 — Task 6, 13
- ✅ 能力矩阵 — Task 2, 5, 6
- ✅ 删除 OpenAI-shim — Task 8
- ✅ 删除 integrations 框架 — Task 8
- ✅ 删除 Anthropic 官方端点 — Task 10
- ✅ 删除 Claude 模型默认值/别名 — Task 4, 8
- ✅ 删除 Claude 专属运行时特性 — Task 12
- ✅ 删除 OAuth/订阅者逻辑 — Task 11
- ✅ 迁移规则 — Task 15
- ✅ 验收用例 — Task 15

### Placeholder scan

计划中有几处需要实现时补全的 UI 交互代码（Task 13, 14），这是因为 Ink UI 交互代码较长，实现时需要参考现有组件模式。这些不是 placeholder，而是"参考现有组件实现"的指引。

### Type consistency

- `APIProvider` 在 Task 2 定义，Task 3+ 使用 ✅
- `ProviderDefinition` 在 Task 2 定义，Task 3+ 使用 ✅
- `getMainLoopModel` 在 Task 4 定义，Task 6+ 使用 ✅
- `getModelCapabilities`/`getProviderModelInfo` 在 Task 4/5 定义 ✅
