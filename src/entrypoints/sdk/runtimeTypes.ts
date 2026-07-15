
import type { z } from 'zod/v4'
import type { Query, QueryOptions } from './query.js'

export type EffortLevel = 'low' | 'medium' | 'high' | 'max' | 'xhigh' | 'ultracode'

export type AnyZodRawShape = z.ZodRawShape

export type InferShape<Shape extends AnyZodRawShape> = z.infer<z.ZodObject<Shape>>

export type {
  ForkSessionOptions,
  ForkSessionResult,
  GetSessionInfoOptions,
  GetSessionMessagesOptions,
  ListSessionsOptions,
  SessionMessage,
  SessionMutationOptions,
} from './shared.js'

export type {
  SDKSession,
  SDKSessionOptions,
  SdkMcpToolDefinition,
} from './v2.js'

export type { Query, QueryOptions } from './query.js'

export type Options = QueryOptions

export type InternalOptions = Options & { [key: string]: unknown }

export type InternalQuery = Query & { [key: string]: unknown }
