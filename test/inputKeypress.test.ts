import { describe, expect, test } from 'bun:test'
import { InputEvent } from '../src/ink/events/input-event.js'
import {
  INITIAL_STATE,
  parseMultipleKeypresses,
  type KeyParseOptions,
  type KeyParseState,
  type ParsedInput,
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

function parseInput(
  input: string,
  options?: KeyParseOptions,
): ParsedInput[] {
  const [events] = parseMultipleKeypresses(
    { ...INITIAL_STATE },
    input,
    options,
  )
  return events
}

function parseInputChunks(
  chunks: string[],
  options?: KeyParseOptions,
  flush = false,
): ParsedInput[] {
  let state: KeyParseState = { ...INITIAL_STATE }
  const events: ParsedInput[] = []

  for (const chunk of chunks) {
    const [nextEvents, nextState] = parseMultipleKeypresses(
      state,
      chunk,
      options,
    )
    events.push(...nextEvents)
    state = nextState
  }

  if (flush) {
    const [nextEvents] = parseMultipleKeypresses(state, null, options)
    events.push(...nextEvents)
  }

  return events
}

const SPLIT_AMBIGUOUS_ESCAPE: KeyParseOptions = {
  splitAmbiguousEscapeSequences: true,
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

describe('Escape 输入与 ANSI 序列分流', () => {
  test('查询期间合包的 Escape 与后续文本都不会丢失', () => {
    const events = parseInput('\x1b/exit', SPLIT_AMBIGUOUS_ESCAPE)

    expect(events[0]).toMatchObject({ kind: 'key', name: 'escape' })
    expect(
      events
        .slice(1)
        .map(event => event.sequence)
        .join(''),
    ).toBe('/exit')
  })

  test('查询期间跨 chunk 的 Escape 与后续文本都不会丢失', () => {
    const events = parseInputChunks(
      ['\x1b', '/exit'],
      SPLIT_AMBIGUOUS_ESCAPE,
    )

    expect(events[0]).toMatchObject({ kind: 'key', name: 'escape' })
    expect(
      events
        .slice(1)
        .map(event => event.sequence)
        .join(''),
    ).toBe('/exit')
  })

  test('查询期间 timeout flush 仍按 Escape 与后续文本解释', () => {
    const events = parseInputChunks(
      ['\x1b', '/'],
      SPLIT_AMBIGUOUS_ESCAPE,
      true,
    )

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ kind: 'key', name: 'escape' })
    expect(events[1]).toMatchObject({ kind: 'key', sequence: '/' })
  })

  test('单独 Escape 在 timeout flush 后仍是取消键', () => {
    const events = parseInputChunks(
      ['\x1b'],
      SPLIT_AMBIGUOUS_ESCAPE,
      true,
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'key', name: 'escape' })
  })

  test('未启用歧义处理时仍保留 Alt/Meta 组合键语义', () => {
    const events = parseInput('\x1ba')

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'key',
      meta: true,
      sequence: '\x1ba',
    })

    const crossChunkEvents = parseInputChunks(['\x1b', 'a'])
    expect(crossChunkEvents).toHaveLength(1)
    expect(crossChunkEvents[0]).toMatchObject({
      kind: 'key',
      meta: true,
      sequence: '\x1ba',
    })
  })

  test('焦点事件和方向键保持为完整 CSI 序列', () => {
    const focusOut = parseInput('\x1b[O', SPLIT_AMBIGUOUS_ESCAPE)
    const arrowDown = parseInput('\x1b[B', SPLIT_AMBIGUOUS_ESCAPE)

    expect(focusOut).toHaveLength(1)
    expect(focusOut[0]).toMatchObject({
      kind: 'key',
      sequence: '\x1b[O',
    })
    expect(arrowDown).toHaveLength(1)
    expect(arrowDown[0]).toMatchObject({
      kind: 'key',
      name: 'down',
      sequence: '\x1b[B',
    })
  })

  test('功能键保持为完整 SS3 序列', () => {
    const events = parseInput('\x1bOP', SPLIT_AMBIGUOUS_ESCAPE)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'key',
      name: 'f1',
      sequence: '\x1bOP',
    })
  })

  test('OSC、DCS 与 APC 结构化序列不会被误判为取消键', () => {
    const osc = parseInput(
      '\x1b]11;rgb:0000/0000/0000\x07',
      SPLIT_AMBIGUOUS_ESCAPE,
    )
    const xtversion = parseInput(
      '\x1bP>|xterm.js(5.5.0)\x1b\\',
      SPLIT_AMBIGUOUS_ESCAPE,
    )
    const apc = parseInput(
      '\x1b_application-message\x1b\\',
      SPLIT_AMBIGUOUS_ESCAPE,
    )

    expect(osc).toEqual([
      {
        kind: 'response',
        sequence: '\x1b]11;rgb:0000/0000/0000\x07',
        response: {
          type: 'osc',
          code: 11,
          data: 'rgb:0000/0000/0000',
        },
      },
    ])
    expect(xtversion).toEqual([
      {
        kind: 'response',
        sequence: '\x1bP>|xterm.js(5.5.0)\x1b\\',
        response: { type: 'xtversion', name: 'xterm.js(5.5.0)' },
      },
    ])
    expect(apc).toHaveLength(1)
    expect(apc[0]).toMatchObject({
      kind: 'key',
      sequence: '\x1b_application-message\x1b\\',
    })
  })

  test('跨 chunk 的 CSI 与 SS3 序列等待完成后再解析', () => {
    const focusOut = parseInputChunks(
      ['\x1b', '[O'],
      SPLIT_AMBIGUOUS_ESCAPE,
    )
    const arrowDown = parseInputChunks(
      ['\x1b', '[B'],
      SPLIT_AMBIGUOUS_ESCAPE,
    )
    const f1 = parseInputChunks(['\x1b', 'OP'], SPLIT_AMBIGUOUS_ESCAPE)

    expect(focusOut).toHaveLength(1)
    expect(focusOut[0]).toMatchObject({
      kind: 'key',
      sequence: '\x1b[O',
    })
    expect(arrowDown).toHaveLength(1)
    expect(arrowDown[0]).toMatchObject({
      kind: 'key',
      name: 'down',
      sequence: '\x1b[B',
    })
    expect(f1).toHaveLength(1)
    expect(f1[0]).toMatchObject({
      kind: 'key',
      name: 'f1',
      sequence: '\x1bOP',
    })
  })

  test('跨 chunk 的 OSC、DCS 与 APC 序列保持完整', () => {
    const osc = parseInputChunks(
      ['\x1b', ']11;rgb:0000/0000/0000\x07'],
      SPLIT_AMBIGUOUS_ESCAPE,
    )
    const xtversion = parseInputChunks(
      ['\x1b', 'P>|xterm.js(5.5.0)\x1b\\'],
      SPLIT_AMBIGUOUS_ESCAPE,
    )
    const apc = parseInputChunks(
      ['\x1b', '_application-message\x1b\\'],
      SPLIT_AMBIGUOUS_ESCAPE,
    )

    expect(osc).toHaveLength(1)
    expect(osc[0]).toMatchObject({
      kind: 'response',
      sequence: '\x1b]11;rgb:0000/0000/0000\x07',
      response: { type: 'osc', code: 11 },
    })
    expect(xtversion).toHaveLength(1)
    expect(xtversion[0]).toMatchObject({
      kind: 'response',
      sequence: '\x1bP>|xterm.js(5.5.0)\x1b\\',
      response: { type: 'xtversion', name: 'xterm.js(5.5.0)' },
    })
    expect(apc).toHaveLength(1)
    expect(apc[0]).toMatchObject({
      kind: 'key',
      sequence: '\x1b_application-message\x1b\\',
    })
  })

  test('括号粘贴中的 Escape 序列保持为原始文本', () => {
    const events = parseInputChunks(
      ['\x1b[200~', '\x1b/exit\x1b[O', '\x1b[201~'],
      SPLIT_AMBIGUOUS_ESCAPE,
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'key',
      isPasted: true,
      sequence: '\x1b/exit\x1b[O',
    })
  })
})
