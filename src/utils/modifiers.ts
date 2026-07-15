import {
  isModifierPressed as nativeIsModifierPressed,
  prewarm as prewarmNativeModifiers,
} from '../../vendor/modifiers-napi-src/index.js'

export type ModifierKey = 'shift' | 'command' | 'control' | 'option'

let prewarmed = false

/**
 * Pre-warm the native module by loading it in advance.
 * Call this early to avoid delay on first use.
 */
export function prewarmModifiers(): void {
  if (prewarmed || process.platform !== 'darwin') {
    return
  }
  prewarmed = true
  // 仓库内适配器负责加载发行包原生模块，并为源码开发环境提供安全降级。
  prewarmNativeModifiers()
}

/**
 * Check if a specific modifier key is currently pressed (synchronous).
 */
export function isModifierPressed(modifier: ModifierKey): boolean {
  if (process.platform !== 'darwin') {
    return false
  }
  return nativeIsModifierPressed(modifier)
}
