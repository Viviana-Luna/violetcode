import type { RGBColor as RGBColorString } from '../../ink/styles.js'
import type { RGBColor as RGBColorType, SpinnerMode } from './types.js'

export function getDefaultCharacters(): string[] {
  return ['·', '✢', '✣', '✤', '✥']
}

export function getSpinnerFrames(): string[] {
  const openingFrames = getDefaultCharacters()
  return [
    ...openingFrames,
    ...openingFrames.slice(1, -1).reverse(),
  ]
}

/**
 * 主状态文案按真实模式映射；任务主题和调用方显式文案仍具有更高优先级，
 * 本映射只替代原来的随机英文动词兜底。
 */
export function getSpinnerModeText(mode: SpinnerMode): string {
  switch (mode) {
    case 'requesting':
      return '请求连接'
    case 'responding':
      return '生成回复'
    case 'thinking':
      return '模型思考'
    case 'tool-input':
      return '准备工具'
    case 'tool-use':
      return '执行工具'
    default:
      return '处理中'
  }
}

// Interpolate between two RGB colors
export function interpolateColor(
  color1: RGBColorType,
  color2: RGBColorType,
  t: number, // 0 to 1
): RGBColorType {
  return {
    r: Math.round(color1.r + (color2.r - color1.r) * t),
    g: Math.round(color1.g + (color2.g - color1.g) * t),
    b: Math.round(color1.b + (color2.b - color1.b) * t),
  }
}

// Convert RGB object to rgb() color string for Text component
export function toRGBColor(color: RGBColorType): RGBColorString {
  return `rgb(${color.r},${color.g},${color.b})`
}

// HSL hue (0-360) to RGB, using voice-mode waveform parameters (s=0.7, l=0.6).
export function hueToRgb(hue: number): RGBColorType {
  const h = ((hue % 360) + 360) % 360
  const s = 0.7
  const l = 0.6
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

const RGB_CACHE = new Map<string, RGBColorType | null>()

export function parseRGB(colorStr: string): RGBColorType | null {
  const cached = RGB_CACHE.get(colorStr)
  if (cached !== undefined) return cached

  const match = colorStr.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/)
  const result = match
    ? {
        r: parseInt(match[1]!, 10),
        g: parseInt(match[2]!, 10),
        b: parseInt(match[3]!, 10),
      }
    : null
  RGB_CACHE.set(colorStr, result)
  return result
}
