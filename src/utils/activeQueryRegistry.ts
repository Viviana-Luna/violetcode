type ActiveQueryEntry = {
  controller: AbortController
  promise: Promise<unknown>
}

export type ActiveQueryDrainResult = 'drained' | 'timeout'

const activeQueries = new Map<number, ActiveQueryEntry>()
let nextQueryId = 0

/**
 * 从请求分发阶段开始登记查询，并返回幂等的完成回调。
 * 这覆盖 onQuery 尚未建立网络流、但退出已经发生的短暂窗口。
 */
export function registerActiveQuery(
  controller: AbortController,
): () => void {
  const queryId = ++nextQueryId
  let resolveCompletion: (() => void) | undefined
  const completion = new Promise<void>(resolve => {
    resolveCompletion = resolve
  })
  activeQueries.set(queryId, { controller, promise: completion })

  let completed = false
  return () => {
    if (completed) return
    completed = true
    activeQueries.delete(queryId)
    resolveCompletion?.()
  }
}

/**
 * 登记仍可能持有网络流或原生响应缓冲区的主查询。
 * 返回值保持原 Promise 的结果和异常语义，只在 finally 中移除登记。
 */
export function trackActiveQuery<T>(
  controller: AbortController,
  promise: Promise<T>,
): Promise<T> {
  const complete = registerActiveQuery(controller)
  return promise.finally(complete)
}

/** 请求所有活动查询停止；已经取消的 controller 不会重复触发。 */
export function abortAllActiveQueries(reason: unknown = 'shutdown'): void {
  for (const { controller } of activeQueries.values()) {
    if (!controller.signal.aborted) {
      controller.abort(reason)
    }
  }
}

/**
 * 等待登记表真正清空。循环读取快照，保证 drain 期间短暂登记的查询也被纳入。
 */
export async function drainActiveQueries(
  timeoutMs: number,
): Promise<ActiveQueryDrainResult> {
  const deadline = Date.now() + Math.max(0, timeoutMs)
  while (activeQueries.size > 0) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) return 'timeout'

    const settled = Promise.allSettled(
      [...activeQueries.values()].map(entry => entry.promise),
    ).then(() => true)
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<false>(resolve => {
      timeoutId = setTimeout(() => resolve(false), remainingMs)
    })
    const completed = await Promise.race([settled, timedOut])
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    if (!completed) return 'timeout'
  }
  return 'drained'
}

export function hasActiveQueries(): boolean {
  return activeQueries.size > 0
}

/** 仅供测试在用例之间清理模块级状态。 */
export function resetActiveQueriesForTesting(): void {
  activeQueries.clear()
  nextQueryId = 0
}
