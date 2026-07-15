import { describe, expect, test } from 'bun:test'
import { InputEvent } from '../src/ink/events/input-event.js'
import {
  INITIAL_STATE,
  parseMultipleKeypresses,
  type ParsedKey,
} from '../src/ink/parse-keypress.js'
import { isModifierPressed } from '../src/utils/modifiers.js'

function parseKeyboardInput(input: string): InputEvent {
  const [events] = parseMultipleKeypresses({ ...INITIAL_STATE }, input)
  const parsed = events[0]
  if (!parsed || parsed.kind !== 'key') {
    throw new Error(`未解析到键盘事件：${JSON.stringify(input)}`)
  }
  return new InputEvent(parsed as ParsedKey)
}

describe('终端回车键兼容', () => {
  test('CR 序列触发提交键', () => {
    expect(parseKeyboardInput('\r').key.return).toBe(true)
  })

  test('LF 序列同样触发提交键', () => {
    expect(parseKeyboardInput('\n').key.return).toBe(true)
  })

  test('缺少可选原生修饰键模块时不会阻断 Apple Terminal 回车', () => {
    expect(() => isModifierPressed('shift')).not.toThrow()
    expect(isModifierPressed('shift')).toBe(false)
  })
})
