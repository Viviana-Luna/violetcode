export type AbortableStreamResource = {
  controller: {
    signal: { aborted: boolean }
    abort: () => void
  }
}

/**
 * 释放尚未自然消费完成的 SDK 流。
 * SDK controller 同时拥有 fetch 和响应 body，不能再并发调用 body.cancel()。
 */
export function releaseStreamController(
  stream: AbortableStreamResource | undefined,
  completed: boolean,
): void {
  if (!stream || completed || stream.controller.signal.aborted) return
  stream.controller.abort()
}
