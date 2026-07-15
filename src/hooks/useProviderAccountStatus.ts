import { useEffect, useState } from 'react'
import {
  getInitialProviderAccountStatus,
  loadProviderAccountStatus,
  type ProviderAccountStatus,
} from '../services/providerAccountStatus.js'
import type { APIProvider } from '../utils/model/types.js'

export function useProviderAccountStatus(
  provider: APIProvider,
): ProviderAccountStatus {
  const [status, setStatus] = useState<ProviderAccountStatus>(() =>
    getInitialProviderAccountStatus(provider),
  )

  useEffect(() => {
    const controller = new AbortController()
    setStatus(getInitialProviderAccountStatus(provider))
    void loadProviderAccountStatus(provider, { signal: controller.signal }).then(
      nextStatus => {
        if (!controller.signal.aborted) setStatus(nextStatus)
      },
    )
    return () => controller.abort()
  }, [provider])

  return status
}
