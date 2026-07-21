import { stringWidth } from '../ink/stringWidth.js'
import type { ThemeSetting } from './theme.js'
import { truncate } from './format.js'

const SELECT_PREFIX_WIDTH = 5
const COMPACT_BREAKPOINT = 48

type ThemeOptionDefinition = {
  value: ThemeSetting
  label: string
  compactLabel: string
}

const THEME_OPTION_DEFINITIONS: ThemeOptionDefinition[] = [
  {
    value: 'auto',
    label: 'Auto (match terminal)',
    compactLabel: 'Auto',
  },
  { value: 'dark', label: 'Dark mode', compactLabel: 'Dark' },
  { value: 'light', label: 'Light mode', compactLabel: 'Light' },
  {
    value: 'dark-daltonized',
    label: 'Dark mode (colorblind-friendly)',
    compactLabel: 'Dark (colorblind)',
  },
  {
    value: 'light-daltonized',
    label: 'Light mode (colorblind-friendly)',
    compactLabel: 'Light (colorblind)',
  },
  {
    value: 'dark-ansi',
    label: 'Dark mode (ANSI colors only)',
    compactLabel: 'Dark (ANSI)',
  },
  {
    value: 'light-ansi',
    label: 'Light mode (ANSI colors only)',
    compactLabel: 'Light (ANSI)',
  },
]

export type ThemePickerLayout = {
  contentWidth: number
  heading: string
  options: { label: string; value: ThemeSetting }[]
}

/**
 * 所有标题、选项和差异预览都使用父布局提供的真实内容宽度，避免不同容器
 * 各自猜测终端内边距，并保证终端缩放后整组内容按同一口径重新排版。
 */
export function getThemePickerLayout(
  availableWidth: number,
  includeAuto: boolean,
): ThemePickerLayout {
  const contentWidth = Math.max(availableWidth, 1)
  const compact = contentWidth < COMPACT_BREAKPOINT
  const labelWidth = Math.max(contentWidth - SELECT_PREFIX_WIDTH, 1)
  const heading = truncate(
    compact
      ? 'Choose a terminal theme'
      : 'Choose the text style that looks best with your terminal',
    contentWidth,
  )

  const options = THEME_OPTION_DEFINITIONS.filter(
    option => includeAuto || option.value !== 'auto',
  ).map(option => {
    const label = compact ? option.compactLabel : option.label
    return {
      label: stringWidth(label) <= labelWidth ? label : truncate(label, labelWidth),
      value: option.value,
    }
  })

  return { contentWidth, heading, options }
}
