import type { SearchProviderId } from '../../../utils/model/types.js'

export type SearchInput = {
  query: string
  allowedDomains?: string[]
  blockedDomains?: string[]
}

export type SearchHit = {
  title: string
  url: string
  description?: string
  publishedDate?: string
}

export type SearchProviderOutput = {
  hits: SearchHit[]
  providerName: string
  durationSeconds: number
  requestId?: string
}

export interface SearchProvider {
  readonly id: SearchProviderId
  readonly label: string
  isConfigured(): boolean
  search(
    input: SearchInput,
    signal?: AbortSignal,
  ): Promise<SearchProviderOutput>
}
