import { useEffect, useState } from 'react'

export type ClaudeAILimits = {
  status?: string
  isUsingOverage?: boolean
  resetsAt?: number
  rateLimitType?: string
}

const currentLimits: ClaudeAILimits = {}
const statusListeners = new Set<(limits: ClaudeAILimits) => void>()

export function useClaudeAiLimits(): ClaudeAILimits {
  const [limits, setLimits] = useState<ClaudeAILimits>({ ...currentLimits })

  useEffect(() => {
    const listener = (newLimits: ClaudeAILimits) => {
      setLimits({ ...newLimits })
    }
    statusListeners.add(listener)

    return () => {
      statusListeners.delete(listener)
    }
  }, [])

  return limits
}
