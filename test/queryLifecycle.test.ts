import { afterEach, describe, expect, test } from 'bun:test'
import { Stream } from '@anthropic-ai/sdk/streaming'

import { releaseStreamController } from '../src/services/api/streamResourceLifecycle.js'
import {
  abortAllActiveQueries,
  drainActiveQueries,
  hasActiveQueries,
  resetActiveQueriesForTesting,
  trackActiveQuery,
} from '../src/utils/activeQueryRegistry.js'
import { QueryGuard } from '../src/utils/QueryGuard.js'
import { resolveQueryInterruptAction } from '../src/utils/queryInterruptAction.js'

afterEach(() => {
  resetActiveQueriesForTesting()
})

describe('主查询取消生命周期', () => {
  test('取消期间保持活动，所有者结束后才恢复空闲', async () => {
    const guard = new QueryGuard()
    expect(guard.reserve()).toBe(true)
    expect(guard.requestCancel()).toBe(true)
    expect(guard.isActive).toBe(true)
    expect(guard.isCancelling).toBe(true)
    expect(guard.reserve()).toBe(false)

    const generation = guard.tryStart()
    expect(generation).not.toBeNull()
    expect(guard.isCancelling).toBe(true)

    let idleReached = false
    const idlePromise = guard.waitForIdle().then(() => {
      idleReached = true
    })
    await Promise.resolve()
    expect(idleReached).toBe(false)

    expect(guard.end(generation!)).toBe(true)
    await idlePromise
    expect(guard.isActive).toBe(false)
    expect(guard.isCancelling).toBe(false)
  })

  test('活动请求注册器会先中止并等待查询真正完成', async () => {
    const controller = new AbortController()
    let finishQuery: (() => void) | undefined
    const query = new Promise<void>(resolve => {
      finishQuery = resolve
    })
    const tracked = trackActiveQuery(controller, query)

    abortAllActiveQueries('shutdown')
    expect(controller.signal.aborted).toBe(true)
    expect(hasActiveQueries()).toBe(true)

    let drained = false
    const drainPromise = drainActiveQueries(1000).then(result => {
      drained = true
      return result
    })
    await Promise.resolve()
    expect(drained).toBe(false)

    finishQuery?.()
    await tracked
    expect(await drainPromise).toBe('drained')
    expect(hasActiveQueries()).toBe(false)
  })

  test('取消排空期间再次按 Ctrl+C 会进入等待式退出', () => {
    expect(
      resolveQueryInterruptAction({
        isQueryCancelling: true,
        canCancelRunningTask: false,
        hasQueuedCommands: false,
      }),
    ).toBe('exit-after-cancel')
    expect(
      resolveQueryInterruptAction({
        isQueryCancelling: false,
        canCancelRunningTask: true,
        hasQueuedCommands: false,
      }),
    ).toBe('cancel')
  })
})

describe('流资源单一所有权', () => {
  function createFakeStream(initiallyAborted = false) {
    let aborted = initiallyAborted
    let abortCount = 0
    return {
      stream: {
        controller: {
          signal: {
            get aborted() {
              return aborted
            },
          },
          abort() {
            abortCount += 1
            aborted = true
          },
        },
      },
      get abortCount() {
        return abortCount
      },
    }
  }

  test('自然完成的流不执行额外 abort', () => {
    const resource = createFakeStream()
    releaseStreamController(resource.stream, true)
    expect(resource.abortCount).toBe(0)
  })

  test('未完成流最多 abort 一次，外部已取消时不重复释放', () => {
    const resource = createFakeStream()
    releaseStreamController(resource.stream, false)
    releaseStreamController(resource.stream, false)
    expect(resource.abortCount).toBe(1)

    const externallyAborted = createFakeStream(true)
    releaseStreamController(externallyAborted.stream, false)
    expect(externallyAborted.abortCount).toBe(0)
  })

  test('内存延迟 SSE 在取消后可以排空且不会重复取消响应体', async () => {
    const encoder = new TextEncoder()
    let bodyCancelCount = 0
    let heartbeat: ReturnType<typeof setInterval> | undefined
    const controller = new AbortController()
    const body = new ReadableStream<Uint8Array>({
      start(bodyController) {
        bodyController.enqueue(
          encoder.encode(
            'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_local","type":"message","role":"assistant","content":[],"model":"local-test","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
          ),
        )
        heartbeat = setInterval(() => {
          bodyController.enqueue(
            encoder.encode('event: ping\ndata: {"type":"ping"}\n\n'),
          )
        }, 20)
        heartbeat.unref?.()
        controller.signal.addEventListener(
          'abort',
          () => {
            bodyController.error(
              new DOMException('本地测试请求已取消', 'AbortError'),
            )
          },
          { once: true },
        )
      },
      cancel() {
        bodyCancelCount += 1
        if (heartbeat !== undefined) clearInterval(heartbeat)
      },
    })
    const response = new Response(body, {
      headers: { 'content-type': 'text/event-stream' },
    })

    try {
      const stream = Stream.fromSSEResponse<{
        type: string
      }>(response, controller)
      let sawFirstEvent: (() => void) | undefined
      const firstEvent = new Promise<void>(resolve => {
        sawFirstEvent = resolve
      })
      const consuming = (async () => {
        try {
          for await (const _event of stream) {
            sawFirstEvent?.()
          }
        } finally {
          releaseStreamController(stream, false)
        }
      })()
      const tracked = trackActiveQuery(controller, consuming)

      await Promise.race([
        firstEvent,
        Bun.sleep(1000).then(() => {
          throw new Error('本地 SSE 未在限定时间内开始流式响应')
        }),
      ])
      abortAllActiveQueries('shutdown')
      expect(await drainActiveQueries(1000)).toBe('drained')
      await tracked
      expect(bodyCancelCount).toBeLessThanOrEqual(1)
      expect(hasActiveQueries()).toBe(false)
    } finally {
      if (heartbeat !== undefined) clearInterval(heartbeat)
    }
  })
})
