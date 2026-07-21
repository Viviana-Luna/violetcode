import { useRef } from 'react'

// Hook for the low-weight "still waiting" state when tokens stop flowing.
// Driven by the parent's animation clock time instead of independent intervals,
// so it slows down when the terminal is blurred.
// 无新 Token 15 秒后才进入等待态：DeepSeek、火山方舟等 Provider 常见的
// 首 Token 延迟远超旧阈值（3 秒）；等待态只追加低权重提示，不使用错误红。
const STALL_THRESHOLD_MS = 15_000

export function useStalledAnimation(
  time: number,
  currentResponseLength: number,
  hasActiveTools = false,
  reducedMotion = false,
): {
  isStalled: boolean
  stalledIntensity: number
} {
  const lastTokenTime = useRef(time)
  const lastResponseLength = useRef(currentResponseLength)
  const mountTime = useRef(time)
  const stalledIntensityRef = useRef(0)
  const lastSmoothTime = useRef(time)

  // Reset timer when new tokens arrive (check actual length change)
  if (currentResponseLength > lastResponseLength.current) {
    lastTokenTime.current = time
    lastResponseLength.current = currentResponseLength
    stalledIntensityRef.current = 0
    lastSmoothTime.current = time
  }

  // Derive time since last token from animation clock
  let timeSinceLastToken: number
  if (hasActiveTools) {
    timeSinceLastToken = 0
    lastTokenTime.current = time
  } else if (currentResponseLength > 0) {
    timeSinceLastToken = time - lastTokenTime.current
  } else {
    timeSinceLastToken = time - mountTime.current
  }

  // Calculate stalled intensity based on time since last token
  const isStalled = timeSinceLastToken > STALL_THRESHOLD_MS && !hasActiveTools
  const intensity = isStalled
    ? Math.min((timeSinceLastToken - STALL_THRESHOLD_MS) / 2000, 1) // Fade over 2 seconds
    : 0

  // Smooth intensity transition driven by animation frame ticks
  if (!reducedMotion && (intensity > 0 || stalledIntensityRef.current > 0)) {
    const dt = time - lastSmoothTime.current
    if (dt >= 50) {
      const steps = Math.floor(dt / 50)
      let current = stalledIntensityRef.current
      for (let i = 0; i < steps; i++) {
        const diff = intensity - current
        if (Math.abs(diff) < 0.01) {
          current = intensity
          break
        }
        current += diff * 0.1
      }
      stalledIntensityRef.current = current
      lastSmoothTime.current = time
    }
  } else {
    stalledIntensityRef.current = intensity
    lastSmoothTime.current = time
  }

  // When reducedMotion is enabled, use instant intensity change
  const effectiveIntensity = reducedMotion
    ? intensity
    : stalledIntensityRef.current

  return { isStalled, stalledIntensity: effectiveIntensity }
}
