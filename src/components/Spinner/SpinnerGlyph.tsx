import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { getSpinnerFrames } from './utils.js'

const SPINNER_FRAMES = getSpinnerFrames()
const REDUCED_MOTION_GLYPH = '✥'

type Props = {
  frame: number
  reducedMotion?: boolean
}

/**
 * 使用固定单字符帧表现花朵展开与收拢，保持原状态行的稳定宽度。
 * 图标始终使用 VioletCode 品牌紫色；错误语义由明确错误消息承担。
 */
export function SpinnerGlyph({
  frame,
  reducedMotion = false,
}: Props): React.ReactNode {
  const spinnerChar = reducedMotion
    ? REDUCED_MOTION_GLYPH
    : SPINNER_FRAMES[frame % SPINNER_FRAMES.length]

  return (
    <Box flexWrap="wrap" height={1} width={2}>
      <Text color="brand">{spinnerChar}</Text>
    </Box>
  )
}
