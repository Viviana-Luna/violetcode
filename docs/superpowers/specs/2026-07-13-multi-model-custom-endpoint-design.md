# 多模型支持：显式 Provider + 能力矩阵

日期：2026-07-13
状态：已验收

## 实施进度（2026-07-14）

已完成 Provider 模型身份、双凭据路由、`auth.json` 权限与损坏保护、`/connect`、`/model`、方舟自定义模型、旧配置迁移、请求能力矩阵及 12 项专项自动化测试。当前全仓 TypeScript 诊断为 1619 条，低于同环境 `origin/main` 基线的 1682 条，且不存在按文件新增诊断。

真实 API 已验证 DeepSeek 流式、thinking 和工具调用，以及火山方舟 Agent Plan 的流式和工具调用。验收确认方舟 Coding Plan 与 Agent Plan 是不同产品，本期仅支持 Agent Plan；Coding Plan 不进入 Provider 定义、配置界面或请求路由。

## 修订说明

v1 采用「单一 custom 端点」方案。v2 改为「两个显式 Provider + 能力矩阵」，理由：
- 不同 Provider 的认证方式、端点、模型能力差异大，单一 custom 端点无法表达
- 显式 Provider 让 `/model` 选择更清晰，预置模型减少用户配置负担
- `ProviderDefinition` 结构保留扩展性，后续增加 MiniMax、智谱等只需新增适配描述

## 背景与目标

VioletCode 源自上游终端编码助手，曾包含大量未完成的多 Provider 代码：OpenAI-shim 转译层、vendor/gateway/anthropic-proxy 描述符框架，以及上游官方端点、企业云端点、模型别名、OAuth 订阅体系、fastMode、effort 和 1M context 等专属运行时特性。

**目标**：将 VioletCode 改造为支持两个显式 Provider（DeepSeek、火山方舟）的工具，底层共用 Anthropic SDK，但认证、端点、模型能力分别配置。首期删除所有官方 Anthropic 端点（firstParty/Bedrock/Vertex/Foundry）和 Claude.ai OAuth。`custom` 暂不开放给用户，但 `ProviderDefinition` 结构保留扩展能力。

参考 opencode 的 `/connect` + `/models` 模式：选 provider → 填 key → 模型自动出现。

## 架构总览

### `APIProvider` 类型

```ts
type APIProvider = 'deepseek' | 'volcengineArk'
```

首期仅两个显式 Provider。`custom` 类型保留在 `ProviderDefinition` 扩展结构中但不对用户开放。

### Provider 配置矩阵

| Provider | API 入口 | Base URL | 认证方式 | 凭据 env var | 模型策略 |
|---|---|---|---|---|---|
| DeepSeek | Anthropic API | `https://api.deepseek.com/anthropic` | `X-Api-Key`（Anthropic SDK 原生 `apiKey`） | `DEEPSEEK_API_KEY` | 预置 `deepseek-v4-pro`、`deepseek-v4-flash` |
| 火山方舟 Agent Plan | Agent Plan | `https://ark.cn-beijing.volces.com/api/plan` | `Authorization: Bearer`（Anthropic SDK `authToken`） | `VOLCENGINE_ARK_API_KEY` | 自由输入，预置 `ark-code-latest` |

注意：DeepSeek 的 `deepseek-chat`、`deepseek-reasoner` 将于 2026-07-24 停用，不能再作为默认模型。

### 核心数据结构

```ts
type ProviderProfile = {
  id: string
  name: string
  provider: APIProvider
  apiKey: string
  models: ProviderModel[]
}

type ProviderModel = {
  id: string
  contextWindow?: number
  maxOutputTokens?: number
  defaultMaxOutputTokens?: number
  capabilities?: {
    thinking: boolean
    toolUse: boolean
    images: boolean
    betaHeaders: boolean
  }
}

type ProviderDefinition = {
  id: APIProvider
  label: string
  baseUrl: string
  authMethod: 'x-api-key' | 'bearer'
  apiKeyEnvVar: string
  models: ProviderModel[]
  allowCustomModels: boolean
  unknownModelDefaults?: Omit<ProviderModel, 'id'>
}
```

### 模型选择

- `/model` 以 `{ provider, modelId }` 选择，允许不同 Provider 使用同名模型
- 模型 ID 格式：`provider/model-id`（如 `deepseek/deepseek-v4-pro`、`volcengineArk/ark-code-latest`）
- 模型加载优先级：`--model` flag → 上次用的 → 第一个可用
- `small_model`：轻量任务（标题生成等）用单独模型，默认回退到主模型

### 能力矩阵（首期配置）

**DeepSeek**（按官方能力配置）：

| 模型 | contextWindow | maxOutputTokens | thinking | toolUse | images | betaHeaders |
|---|---|---|---|---|---|---|
| deepseek-v4-pro | 1,000,000 | 384,000（安全默认 64,000） | true | true | false | false |
| deepseek-v4-flash | 1,000,000 | 384,000（安全默认 8,000） | true | true | false | false |

DeepSeek 可按官方能力配置 1M 上下文、thinking 和 tool use；图片、文档等默认关闭。参考 [DeepSeek Anthropic 兼容矩阵](https://api-docs.deepseek.com/guides/anthropic_api)。

**火山方舟**（保守配置，经真实测试后再逐项打开）：

| 模型 | contextWindow | maxOutputTokens | thinking | toolUse | images | betaHeaders |
|---|---|---|---|---|---|---|
| ark-code-latest | 200,000 | 32,000 | false | true | false | false |

本期只适配火山方舟 [Agent Plan](https://docs.volcengine.com/docs/82379/2373740?lang=zh) 的 Anthropic Messages 兼容接入方式。Coding Plan 视为独立产品，未来若支持必须新增独立 Provider ID、凭据和能力定义。未知方舟 Agent Plan 模型统一采用 200K 上下文、32K 输出、thinking 关闭、tool use 开启、images/beta headers 关闭的保守能力；仅在真实流式响应与工具调用验证后再逐项打开。

## 移除项

### ① OpenAI-shim & integrations 框架

- 删除 `src/services/api/openaiShim.ts`
- 删除 `src/integrations/`（整目录）
- 删除 `APIProvider` 中的 `openai`/`gemini`/`mistral`，删除 `isOpenAIShimProvider()`
- 删除 `client.ts` 中 shim 分支
- 删除 `managedEnvConstants.ts` 中 `OPENAI_*`/`GEMINI_*`/`MISTRAL_*` 环境变量

### ② Anthropic 官方 & 企业端点（首期全删）

- 删除 `APIProvider` 中的 `firstParty`/`bedrock`/`vertex`/`foundry`，类型收敛为 `deepseek` | `volcengineArk`
- 删除 `client.ts` 中 bedrock/vertex/foundry 分支与 OAuth/Claude.ai 订阅者分支，仅留 `new Anthropic({ baseURL, apiKey | authToken, ... })`
- 删除 `isFirstPartyAnthropicBaseUrl()`、`isDeepSeekAnthropicBaseUrl()`
- 删除 `auth.ts` 中 OAuth/Claude.ai 订阅类型判定（`isClaudeAISubscriber`、`isMaxSubscriber`、`isProSubscriber`、`isTeamPremiumSubscriber`、`getSubscriptionType`）及其在 `claude.ts`/`withRetry`/`errors`/`rateLimitMessages`/`claudeAiLimits`/`usage`/`referral`/`ultrareviewQuota`/`metricsOptOut`/`extraUsage` 等的调用点
- 删除 `CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY` 在 `withRetry`/`errors`/`tokenEstimation`/`apiPreconnect`/`analytics/config`/`main.tsx`/`commands/logout`/`swarm/spawnUtils` 等的分支
- 删除 bedrock/vertex/foundry 专属 env vars 与 SDK 动态 import（`@anthropic-ai/bedrock-sdk`、`@anthropic-ai/vertex-sdk`、`@anthropic-ai/foundry-sdk`、`google-auth-library`、`@aws-sdk/client-bedrock-runtime`、`@azure/identity`）

### ③ Claude 模型默认值 & 别名

- 删除 `src/utils/model/` 下：`configs.ts`、`aliases.ts`、`modelStrings.ts`、`antModels.ts`、`deprecation.ts`、`check1mAccess.ts`、`modelSupportOverrides.ts`、`contextWindowUpgradeCheck.ts`、`bedrock.ts`、`modelCapabilities.ts`、`agent.ts`
- 重写 `model.ts`：删除 `getDefaultOpusModel`/`getDefaultSonnetModel`/`getDefaultHaikuModel`、`getBestModel`、`isNonCustomOpusModel`、`isOpus1mMergeEnabled`、`getPublicModelDisplayName`、`getMarketingNameForModel`、`firstPartyNameToCanonical`、`getCanonicalName`、`parseUserSpecifiedModel` 的别名解析分支、`resolveSkillModelOverride`、`isLegacyOpusFirstParty`、`isLegacyModelRemapEnabled`、`getRuntimeMainLoopModel` 的 opusplan/haiku-plan 分支
- 保留 `model.ts` 中：`getMainLoopModel`（直接读当前选中模型，无别名解析）、`getUserSpecifiedModelSetting`、`normalizeModelStringForAPI`、`modelDisplayString`、`renderModelName`（简化为返回模型名本身）、`getPublicModelName`（简化为返回 `Claude ({model})` 或直接返回 model 名）
- `getSmallFastModel` 改为读 `small_model` 配置（存于 GlobalConfig，格式 `provider/model`）或回退到主模型（不再有 getDefaultHaikuModel 兜底）
- `parseUserSpecifiedModel` 简化为：原样返回（保留大小写，仅做 trim），不再做别名映射
- skill 的 `model:` frontmatter 直接透传，不再做别名解析（`resolveSkillModelOverride` 删除后调用点改为直接使用 frontmatter 值）
- `ProviderModel.capabilities.betaHeaders`：控制是否在请求中附加 `anthropic-beta` 头（如 prompt caching、1M context 等 Anthropic 专属 beta）。首期 DeepSeek 和火山方舟均设为 `false`，避免向非 Anthropic 端点发送不支持的 beta 头
- 重写 `modelOptions.ts`：删除所有 Claude 模型选项函数；`getModelOptions` 从已注册的 `ProviderDefinition` 生成模型列表
- 重写 `context.ts`：删除 `has1mContext`、`is1mContextDisabled`、`modelSupports1M`、`getSonnet1mExpTreatmentEnabled`、`getContextWindowForModel` 的 1M/ant 分支、`getModelMaxOutputTokens` 的 Claude 模型分支；上下文窗口和 max output 改为从 `ProviderModel` 的 `contextWindow`/`maxOutputTokens` 读取，未配置时用默认值
- 删除 1M context 在 `betas.ts`/`extraUsage.ts`/`modelOptions.ts` 的引用；`betas.ts` 中 `CONTEXT_1M_BETA_HEADER` 相关分支删除，skill `model:` frontmatter 直接透传
- 删除 migrations：`migrateFennecToOpus.ts`、`resetProToOpusDefault.ts`、`migrateSonnet45ToSonnet46.ts`、`migrateOpusToOpus1m.ts`
- 重写 `modelAllowlist.ts`：删除别名/家族别名逻辑，保留基本 allowlist 过滤
- 删除 `validateModel.ts` 中 Claude 模型字符串引用

### ④ Claude 专属运行时特性

- 删除 `src/utils/fastMode.ts`、`src/utils/effort.ts`、`src/utils/modelCost.ts`
- 删除 `src/components/EffortIndicator.ts`、`src/components/LogoV2/Opus1mMergeNotice.tsx`
- 从 `src/services/api/claude.ts`、`src/services/api/withRetry.ts`、`src/cli/print.ts`、`src/cost-tracker.ts` 剥离 fastMode/effort 引用
- 删除 Claude.ai 专属命令目录：`src/commands/fast/`、`src/commands/cost/`、`src/commands/extra-usage/`、`src/commands/rate-limit-options/`、`src/commands/logout/`、`src/commands/feedback/`、`src/commands/ultraplan/`
- 删除 `src/services/claudeAiLimits.ts`、`src/services/rateLimitMessages.ts`、`src/services/api/ultrareviewQuota.ts`、`src/services/api/referral.ts`、`src/services/api/metricsOptOut.ts`、`src/services/api/usage.ts`、`src/utils/extraUsage.ts`
- 删除 `src/services/oauth/`（整个 OAuth 客户端目录）
- `src/commands.ts` 中移除 Claude.ai 专属命令注册
- `src/commands/insights.ts` 移除 `getDefaultOpusModel` 依赖
- `src/commands/model/model.tsx` 保留但移除 fastMode/effort/isBilledAsExtraUsage 逻辑
- 删除 `src/hooks/notifs/useFastModeNotification.tsx` 等 fastMode 相关 hook

## 保留项与新增项

### 保留并精简

- `providerProfile.ts` — 命名为 `providerRegistry.ts`，管理 `ProviderProfile` 和 `ProviderDefinition`
- `providerSecrets.ts` — API key 脱敏
- `providerValidation.ts` — 按 `ProviderDefinition` 校验
- `CustomApiSetup.tsx` → 改为 `/connect` 风格：选 provider → 填 key → 模型自动出现（不再手填 base URL）
- `ModelPicker.tsx` — `/model` 选择器，按 `provider/model` 分组显示；删除 effort/fastMode/opusplan 逻辑
- `model.ts` 精简版、`modelOptions.ts` 精简版、`providers.ts` 精简版
- `config.ts` 中 `userCustomModelProfiles`/`activeProviderProfileId`/`customApiKeyResponses`/`env` 等配置字段保留

### 新增

- `~/.violet/auth.json` — 凭据存储（与 config 分离），参考 opencode 的 `auth.json` 模式
  ```json
  {
    "deepseek": { "apiKey": "sk-..." },
    "volcengineArk": { "apiKey": "Bearer-..." }
  }
  ```
- `src/utils/model/providerDefinitions.ts` — 两个 Provider 的静态定义
- `src/utils/model/providerRegistry.ts`（原 `providerProfile.ts`）— Provider 注册、profile 管理、env 应用
- `/connect` 命令（新增）— 选 provider → 填 key → 保存到 auth.json

### 环境变量（最终保留）

- `DEEPSEEK_API_KEY` — DeepSeek 凭据
- `VOLCENGINE_ARK_API_KEY` — 火山方舟凭据
- `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` — 运行时由 provider registry 设置
- `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` — 运行时由 provider registry 设置（按 provider 的 authMethod）
- `ANTHROPIC_SMALL_FAST_MODEL` — 后台任务模型（用户可设；默认回退到主模型）
- `small_model` 配置项（存于 GlobalConfig，格式 `provider/model`）— 轻量任务模型
- `ANTHROPIC_CUSTOM_HEADERS` — 自定义请求头
- `API_TIMEOUT_MS` — 请求超时

## 数据流

```
启动
 ├─ 读 ~/.violet/auth.json，确定哪些 provider 已配置凭据
 ├─ 读 config 中上次选中的 provider/model
 ├─ 若无任何 provider 配置 → /connect 向导引导选 provider + 填 key
 ├─ 从 ProviderDefinition 生成 ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL
 └─ getAPIProvider() 返回当前选中的 provider

请求 (claude.ts → client.ts)
 ├─ getAnthropicClient(): new Anthropic({ baseURL, apiKey | authToken, ... })
 ├─ model = getMainLoopModel()  // 当前选中的 model id
 ├─ 从 ProviderModel.capabilities 决定是否发送 thinking、images、beta headers
 └─ Anthropic SDK 原生发送 messages + tools → 端点返回 Anthropic 格式流
     └─ MCP / function calling / thinking 原生工作，无需转译

/model 切换
 ├─ getModelOptions(): 从已注册 ProviderDefinition 生成 provider/model 列表
 ├─ 选模型 → 更新 config 中选中项 + 应用 env
 └─ /connect: 选 provider → 填 key → 保存 auth.json → 模型自动出现
```

## 迁移规则

- 现有 `userCustomModelProfiles` 中 baseUrl 为 `https://api.deepseek.com/anthropic` 的 profile → 自动迁移为 `deepseek` provider + 对应 apiKey 存入 auth.json
- 其他 baseUrl 的 profile → 保留为 `custom`（首期不可用，提示用户重新 /connect）
- 现有 `ANTHROPIC_API_KEY` env var → 若匹配 DeepSeek 格式则迁移为 `DEEPSEEK_API_KEY`
- `deepseek-chat`、`deepseek-reasoner` 模型名 → 提示用户迁移到 `deepseek-v4-pro` 或 `deepseek-v4-flash`

## UI 行为

### `/connect` 命令（新增，参考 opencode）

- 显示 provider 列表：DeepSeek、火山方舟
- 选 provider → 输入 API key → 保存到 `~/.violet/auth.json`
- 配置后该 provider 的模型自动出现在 `/model` 中

### `/model` 选择器（ModelPicker.tsx 精简后）

- 按 `provider/model` 分组显示模型
- 选项来源：已配置凭据的 `ProviderDefinition` 的模型列表
- 删除：effort 切换、fastMode 提示、opusplan、模型家族升级提示、EffortIndicator

### `CustomApiSetup.tsx` → `/connect` 风格

- 选 provider → 填 key → 完成（不再手填 base URL 和 model name）
- “火山方舟 Agent Plan”固定使用 `/api/plan`，不展示 Coding Plan 或端点选择
- 占位符用对应 provider 的 key 格式提示

### 删除的 UI 入口

`/fast`、`/cost`、`/extra-usage`、`/logout`、`/feedback`、`/ultraplan`、`/rate-limit-options` 命令及其注册、快捷键、通知 hook。

### 状态字段（AppStateStore.ts）

删除 `fastMode`、`effortValue`；`mainLoopModel` 保留，改为存储 `provider/model` 格式。

## 验收用例

1. **首次启动**：无任何配置 → `/connect` 向导出现 → 选 DeepSeek → 填 key → 进入主界面，默认选 `deepseek/deepseek-v4-pro`
2. **/connect 火山方舟**：`/connect` → 选“火山方舟 Agent Plan” → 填 key → `volcengineArk/ark-code-latest` 出现在 `/model`
3. **/model 切换**：`/model` → 显示两个 provider 的所有模型 → 切换到 `volcengineArk/ark-code-latest` → 后续请求用火山方舟
4. **DeepSeek 流式响应**：发一条消息 → 确认流式输出正常
5. **DeepSeek 工具调用**：发一条需要 bash 工具的消息 → 确认 tool use 正常
6. **DeepSeek thinking**：选 `deepseek-v4-pro` → 发复杂问题 → 确认 thinking 块正常
7. **火山方舟保守能力**：选 `ark-code-latest` → 确认固定路由到 `/api/plan`，且不发送 thinking/beta headers（按能力矩阵）
8. **迁移**：已有 `deepseek-chat` profile → 启动 → 提示迁移到 `deepseek-v4-pro`
9. **回归**：`/fast`、`/cost` 等命令不再出现；`/status` 不显示 Claude.ai 订阅信息
10. **类型检查**：本次重构文件无新增诊断；全仓诊断数不得高于同环境 `origin/main` 基线

## 风险与缓解

- **风险**：50+ 文件改动易遗漏引用导致编译失败。
  **缓解**：按依赖顺序分批改（底层 model utils → providers → client → 上层 commands/UI），每批后跑 `tsc --noEmit`。
- **风险**：`auth.ts`（1997 行）改动面大。
  **缓解**：只删 OAuth/订阅者函数及其调用点，保留 API key/auth token 读取逻辑。
- **风险**：`claude.ts`（核心 API 循环）改动可能影响请求。
  **缓解**：只删 fastMode/effort 的条件分支，保留 messages 循环主逻辑。
- **风险**：火山方舟能力矩阵保守配置可能误判能力。
  **缓解**：首期关闭 thinking/images/betaHeaders，经真实测试后再逐项打开。
- **风险**：`package.json` 中 bedrock/vertex/foundry 依赖删除可能影响构建。
  **缓解**：删除依赖后跑 `npm install` 确认 lockfile 正常。

## 实现顺序（概要，详细计划由 writing-plans 产出）

1. 新增 `providerDefinitions.ts`（两个 Provider 静态定义）+ `auth.json` 读写
2. 重写 `providerRegistry.ts`（原 `providerProfile.ts`）+ `providerValidation.ts` + `providerSecrets.ts`
3. 底层 model utils（删除 configs/aliases/modelStrings 等，重写 model.ts/modelOptions.ts/context.ts）
4. providers.ts 精简 + `client.ts`（精简为单一 Anthropic 客户端，按 provider 配置 baseURL/auth）
5. auth.ts（删除 OAuth/订阅者逻辑）
6. core API loop（claude.ts/withRetry.ts/errors.ts 剥离 fastMode/effort/订阅者，加入能力矩阵判定）
7. 删除 Claude.ai 专属服务（claudeAiLimits/rateLimitMessages/ultrareviewQuota/referral/metricsOptOut/usage/extraUsage/oauth）
8. 删除 Claude.ai 专属命令（fast/cost/extra-usage/rate-limit-options/logout/feedback/ultraplan）
9. 新增 `/connect` 命令 + 改写 `CustomApiSetup.tsx` + `ModelPicker.tsx` + `AppStateStore.ts` + `commands.ts`
10. managedEnvConstants.ts + package.json（清理 env vars 与依赖）
11. 删除 migrations + 迁移规则实现
12. 全量 `tsc --noEmit` + 启动验证 + 验收用例
