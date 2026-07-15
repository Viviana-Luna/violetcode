export type QueryInterruptAction = 'exit-after-cancel' | 'cancel' | 'none'

/**
 * 解析主查询收到 Ctrl+C 时的动作。
 * 第二次 Ctrl+C 即使发生在 drain 完成前，也必须进入等待式退出流程。
 */
export function resolveQueryInterruptAction({
  isQueryCancelling,
  canCancelRunningTask,
  hasQueuedCommands,
}: {
  isQueryCancelling: boolean
  canCancelRunningTask: boolean
  hasQueuedCommands: boolean
}): QueryInterruptAction {
  if (isQueryCancelling) return 'exit-after-cancel'
  if (canCancelRunningTask || hasQueuedCommands) return 'cancel'
  return 'none'
}
