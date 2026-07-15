
import type { APIError } from '@anthropic-ai/sdk'
import type {
  BetaContentBlock,
  BetaRawMessageStreamEvent,
  BetaToolUseBlock,
  BetaUsage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { UUID } from 'crypto'
import type { Progress } from '../Tool.js'
import type { Attachment } from '../utils/attachments.js'
import type { HookProgress } from './hooks.js'
import type { PermissionMode } from './permissions.js'

export type SystemMessageLevel =
  | 'info'
  | 'warning'
  | 'error'
  | 'suggestion'
  | 'debug'

export type MessageOrigin =
  | { kind: 'human' }
  | { kind: 'coordinator' }
  | { kind: 'task-notification' }
  | { kind: 'channel'; server: string }

export type PartialCompactDirection = 'up_to' | 'from'

export type CompactMetadata = {
  trigger: 'manual' | 'auto'
  preTokens: number
  userContext?: string
  messagesSummarized?: number
  preservedSegment?: {
    headUuid: UUID
    anchorUuid: UUID
    tailUuid: UUID
  }
  [key: string]: any
}

export type StopHookInfo = {
  command: string
  promptText?: string
  durationMs?: number
  [key: string]: any
}

export interface UserMessage<C = string | ContentBlockParam[]> {
  type: 'user'
  uuid: UUID
  timestamp: string
  message: {
    role: 'user'
    content: C
    [key: string]: any
  }
  isMeta?: boolean
  isVisibleInTranscriptOnly?: boolean
  isVirtual?: boolean
  isCompactSummary?: boolean
  isCollapseSummary?: boolean
  summarizeMetadata?: {
    messagesSummarized: number
    userContext?: string
    direction?: PartialCompactDirection
    [key: string]: any
  }
  toolUseResult?: unknown
  isAgentStepLimitToolResult?: boolean
  mcpMeta?: {
    _meta?: Record<string, unknown>
    structuredContent?: Record<string, unknown>
  }
  imagePasteIds?: number[]
  sourceToolAssistantUUID?: UUID
  sourceToolUseID?: string
  permissionMode?: PermissionMode
  origin?: MessageOrigin
  [key: string]: any
}

export type AssistantMessageContent<T = BetaContentBlock> = {
  role: 'assistant'
  content: T[]
  id: string
  model: string
  usage: BetaUsage
  type?: 'message'
  stop_reason?: any
  stop_sequence?: any
  container?: any
  context_management?: any
  [key: string]: any
}

export interface AssistantMessage<T = BetaContentBlock> {
  type: 'assistant'
  uuid: UUID
  timestamp: string
  message: AssistantMessageContent<T>
  requestId?: string
  apiError?: string
  error?: any
  errorDetails?: string
  isApiErrorMessage?: boolean
  isVirtual?: boolean
  isMeta?: boolean
  advisorModel?: string
  [key: string]: any
}

export interface AttachmentMessage<T = Attachment> {
  type: 'attachment'
  attachment: T
  uuid: UUID
  timestamp: string
  [key: string]: any
}

export interface ProgressMessage<T = Progress> {
  type: 'progress'
  data: T
  toolUseID: string
  parentToolUseID: string
  uuid: UUID
  timestamp: string
  [key: string]: any
}

interface SystemMessageBase {
  type: 'system'
  uuid: UUID
  timestamp: string
  level?: SystemMessageLevel
  isMeta?: boolean
  content?: string
  toolUseID?: string
  preventContinuation?: boolean
  [key: string]: any
}

export interface SystemInformationalMessage extends SystemMessageBase {
  subtype: 'informational'
  content: string
  isCollapseSummary?: boolean
}

export interface SystemPermissionRetryMessage extends SystemMessageBase {
  subtype: 'permission_retry'
  content: string
  commands: string[]
}

export interface SystemBridgeStatusMessage extends SystemMessageBase {
  subtype: 'bridge_status'
  content: string
  url: string
  upgradeNudge?: string
}

export interface SystemScheduledTaskFireMessage extends SystemMessageBase {
  subtype: 'scheduled_task_fire'
  content: string
}

export interface SystemStopHookSummaryMessage extends SystemMessageBase {
  subtype: 'stop_hook_summary'
  hookCount: number
  hookInfos: StopHookInfo[]
  hookErrors: string[]
  preventedContinuation: boolean
  stopReason?: string
  hasOutput: boolean
  hookLabel?: string
  totalDurationMs?: number
}

export interface SystemTurnDurationMessage extends SystemMessageBase {
  subtype: 'turn_duration'
  durationMs: number
  budgetTokens?: number
  budgetLimit?: number
  budgetNudges?: number
  messageCount?: number
}

export interface SystemAwaySummaryMessage extends SystemMessageBase {
  subtype: 'away_summary'
  content: string
}

export interface SystemMemorySavedMessage extends SystemMessageBase {
  subtype: 'memory_saved'
  writtenPaths: string[]
}

export interface SystemAgentsKilledMessage extends SystemMessageBase {
  subtype: 'agents_killed'
}

export interface SystemApiMetricsMessage extends SystemMessageBase {
  subtype: 'api_metrics'
  ttftMs: number
  otps: number
  isP50?: boolean
  hookDurationMs?: number
  turnDurationMs?: number
  toolDurationMs?: number
  classifierDurationMs?: number
  toolCount?: number
  hookCount?: number
  classifierCount?: number
  configWriteCount?: number
}

export interface SystemLocalCommandMessage extends SystemMessageBase {
  subtype: 'local_command'
  content: string
}

export interface SystemCompactBoundaryMessage extends SystemMessageBase {
  subtype: 'compact_boundary'
  compactMetadata: CompactMetadata
  logicalParentUuid?: UUID | null
}

export interface SystemMicrocompactBoundaryMessage extends SystemMessageBase {
  subtype: 'microcompact_boundary'
  content: string
  microcompactMetadata: {
    trigger: 'auto'
    preTokens: number
    tokensSaved: number
    compactedToolIds: string[]
    clearedAttachmentUUIDs: string[]
    [key: string]: any
  }
}

export interface SystemAPIErrorMessage extends SystemMessageBase {
  subtype: 'api_error'
  error: APIError
  cause?: Error
  retryInMs: number
  retryAttempt: number
  maxRetries: number
}

export interface SystemFileSnapshotMessage extends SystemMessageBase {
  subtype: 'file_snapshot'
  content: string
  snapshotFiles: { key: string; path: string; content: string }[]
}

export interface SystemThinkingMessage extends SystemMessageBase {
  subtype: 'thinking'
}

export interface SystemSnipBoundaryMessage extends SystemMessageBase {
  subtype: 'snip_boundary'
  content: string
  snipMetadata: {
    removedUuids: UUID[]
    [key: string]: any
  }
}

export type SystemMessage =
  | SystemInformationalMessage
  | SystemPermissionRetryMessage
  | SystemBridgeStatusMessage
  | SystemScheduledTaskFireMessage
  | SystemStopHookSummaryMessage
  | SystemTurnDurationMessage
  | SystemAwaySummaryMessage
  | SystemMemorySavedMessage
  | SystemAgentsKilledMessage
  | SystemApiMetricsMessage
  | SystemLocalCommandMessage
  | SystemCompactBoundaryMessage
  | SystemMicrocompactBoundaryMessage
  | SystemAPIErrorMessage
  | SystemFileSnapshotMessage
  | SystemThinkingMessage
  | SystemSnipBoundaryMessage

export type Message =
  | UserMessage
  | AssistantMessage
  | AttachmentMessage
  | ProgressMessage
  | SystemMessage

export interface StreamEvent {
  type: 'stream_event'
  event: BetaRawMessageStreamEvent
  ttftMs?: number
  [key: string]: any
}

export interface RequestStartEvent {
  type: 'stream_request_start'
  [key: string]: any
}

export interface TombstoneMessage {
  type: 'tombstone'
  message: Message
  [key: string]: any
}

export interface ToolUseSummaryMessage {
  type: 'tool_use_summary'
  summary: string
  precedingToolUseIds: string[]
  uuid: UUID
  timestamp: string
  [key: string]: any
}

export type HookResultMessage = AttachmentMessage | ProgressMessage<HookProgress>

export type NormalizedUserMessage = UserMessage<ContentBlockParam[]>

export type NormalizedAssistantMessage<T = BetaContentBlock> =
  AssistantMessage<T>

export type NormalizedMessage =
  | NormalizedUserMessage
  | NormalizedAssistantMessage
  | AttachmentMessage
  | ProgressMessage
  | SystemMessage

export interface GroupedToolUseMessage {
  type: 'grouped_tool_use'
  toolName: string
  messages: NormalizedAssistantMessage<BetaToolUseBlock>[]
  results: NormalizedUserMessage[]
  displayMessage: NormalizedAssistantMessage<BetaToolUseBlock>
  uuid: string
  timestamp: string
  messageId: string
  [key: string]: any
}

export type CollapsibleMessage =
  | NormalizedAssistantMessage
  | NormalizedUserMessage
  | GroupedToolUseMessage

export interface CollapsedReadSearchGroup {
  type: 'collapsed_read_search'
  searchCount: number
  readCount: number
  listCount: number
  replCount: number
  memorySearchCount: number
  memoryReadCount: number
  memoryWriteCount: number
  teamMemorySearchCount?: number
  teamMemoryReadCount?: number
  teamMemoryWriteCount?: number
  readFilePaths: string[]
  searchArgs: string[]
  latestDisplayHint?: string
  messages: CollapsibleMessage[]
  displayMessage: CollapsibleMessage
  uuid: UUID
  timestamp: string
  mcpCallCount?: number
  mcpServerNames?: string[]
  bashCount?: number
  gitOpBashCount?: number
  commits?: { sha: string; kind: any }[]
  pushes?: { branch: string }[]
  branches?: { ref: string; action: any }[]
  prs?: { number: number; url?: string; action: any }[]
  hookTotalMs?: number
  hookCount?: number
  hookInfos?: StopHookInfo[]
  relevantMemories?: { path: string; content: string; mtimeMs: number }[]
  [key: string]: any
}

export type RenderableMessage =
  | Exclude<NormalizedMessage, ProgressMessage>
  | GroupedToolUseMessage
  | CollapsedReadSearchGroup
