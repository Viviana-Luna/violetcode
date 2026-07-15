import type { SearchProviderId } from '../../../utils/model/types.js'
import { exaSearchProvider } from './exa.js'
import type { SearchProvider } from './types.js'

const SEARCH_PROVIDERS: Record<SearchProviderId, SearchProvider> = {
  exa: exaSearchProvider,
}

export function getSearchProvider(
  provider: SearchProviderId,
): SearchProvider {
  return SEARCH_PROVIDERS[provider]
}

export type {
  SearchHit,
  SearchInput,
  SearchProvider,
  SearchProviderOutput,
} from './types.js'
