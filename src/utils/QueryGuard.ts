/**
 * 与 React `useSyncExternalStore` 兼容的同步查询生命周期状态机。
 *
 * 执行状态为 idle、dispatching、running，取消意图单独记录。
 * 取消不会提前回到 idle；只有查询所有者完成 finally 后才能释放 guard，
 * 从而避免分发阶段、网络流和下一条主查询相互重叠。
 */
import { createSignal } from './signal.js'

export class QueryGuard {
  private _status: 'idle' | 'dispatching' | 'running' = 'idle'
  private _cancelRequested = false
  private _generation = 0
  private _changed = createSignal()

  /** 为队列分发预留 guard；仅允许 idle → dispatching。 */
  reserve(): boolean {
    if (this._status !== 'idle') return false
    this._status = 'dispatching'
    this._cancelRequested = false
    this._notify()
    return true
  }

  /** 队列没有可处理内容时取消预留；仅允许 dispatching → idle。 */
  cancelReservation(): void {
    if (this._status !== 'dispatching') return
    this._status = 'idle'
    this._cancelRequested = false
    this._notify()
  }

  /** 开始查询并返回代次；已有运行中查询时返回 null。 */
  tryStart(): number | null {
    if (this._status === 'running') return null
    if (this._status === 'idle') {
      this._cancelRequested = false
    }
    this._status = 'running'
    ++this._generation
    this._notify()
    return this._generation
  }

  /** 结束指定代次；只有当前所有者可以完成清理并回到 idle。 */
  end(generation: number): boolean {
    if (this._generation !== generation) return false
    if (this._status !== 'running') return false
    this._status = 'idle'
    this._cancelRequested = false
    this._notify()
    return true
  }

  /**
   * 标记当前查询正在取消，但继续占用 guard，直到查询所有者在 finally 中调用 end。
   * 这样不会在网络流仍释放时提前启动下一条主查询。
   */
  requestCancel(): boolean {
    if (this._status === 'idle') return false
    if (this._cancelRequested) return true
    this._cancelRequested = true
    this._notify()
    return true
  }

  /** dispatching 与 running 都属于活动状态。 */
  get isActive(): boolean {
    return this._status !== 'idle'
  }

  get isCancelling(): boolean {
    return this._status !== 'idle' && this._cancelRequested
  }

  get generation(): number {
    return this._generation
  }

  /** 等待当前查询所有者完成最终清理。 */
  waitForIdle(): Promise<void> {
    if (!this.isActive) return Promise.resolve()
    return new Promise(resolve => {
      const unsubscribe = this.subscribe(() => {
        if (this.isActive) return
        unsubscribe()
        resolve()
      })
    })
  }

  /** 订阅状态变化；引用保持稳定，可安全作为 effect 依赖。 */
  subscribe = this._changed.subscribe

  /** 提供给 useSyncExternalStore 的活动状态快照。 */
  getSnapshot = (): boolean => {
    return this._status !== 'idle'
  }

  private _notify(): void {
    this._changed.emit()
  }
}
