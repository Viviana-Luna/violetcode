import { getSearchServiceApiKey } from '../../../utils/authStore.js'
import type { SearchHit, SearchInput, SearchProvider } from './types.js'

export const EXA_SEARCH_ENDPOINT = 'https://api.exa.ai/search'
export const EXA_SEARCH_TIMEOUT_MS = 20_000
export const EXA_SEARCH_RESULT_LIMIT = 10
export const EXA_HIGHLIGHT_MAX_CHARACTERS = 1_200

type FetchImplementation = typeof globalThis.fetch

type ExaSearchProviderOptions = {
  fetchImpl?: FetchImplementation
  timeoutMs?: number
  getApiKey?: () => string | undefined
}

function createAbortError(): Error {
  const error = new Error('网页搜索已取消。')
  error.name = 'AbortError'
  return error
}

function unverifiedError(message: string): Error {
  return new Error(`${message} 本次时效性信息未验证。`)
}

function normalizeDomain(value: string): string | undefined {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return undefined
  try {
    return new URL(
      normalized.includes('://') ? normalized : `https://${normalized}`,
    ).hostname
  } catch {
    return undefined
  }
}

function normalizeDomains(values: string[] | undefined): string[] | undefined {
  if (!values?.length) return undefined
  const domains = [
    ...new Set(values.map(normalizeDomain).filter(Boolean)),
  ] as string[]
  return domains.length > 0 ? domains : undefined
}

function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

function applyDomainFilters(
  hits: SearchHit[],
  allowedDomains: string[] | undefined,
  blockedDomains: string[] | undefined,
): SearchHit[] {
  return hits.filter(hit => {
    const host = new URL(hit.url).hostname.toLowerCase()
    if (blockedDomains?.some(domain => hostMatchesDomain(host, domain))) {
      return false
    }
    if (
      allowedDomains?.length &&
      !allowedDomains.some(domain => hostMatchesDomain(host, domain))
    ) {
      return false
    }
    return true
  })
}

function normalizeExaHit(value: unknown): SearchHit | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  if (typeof record.url !== 'string') return undefined

  let url: URL
  try {
    url = new URL(record.url)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined

  const title =
    typeof record.title === 'string' && record.title.trim()
      ? record.title.trim()
      : url.toString()
  const highlights = Array.isArray(record.highlights)
    ? record.highlights.filter(
        (highlight): highlight is string => typeof highlight === 'string',
      )
    : []
  const description = highlights
    .join('\n')
    .trim()
    .slice(0, EXA_HIGHLIGHT_MAX_CHARACTERS)
  const publishedDate =
    typeof record.publishedDate === 'string' && record.publishedDate.trim()
      ? record.publishedDate.trim()
      : undefined

  return {
    title: title.slice(0, 500),
    url: url.toString(),
    ...(description ? { description } : {}),
    ...(publishedDate ? { publishedDate } : {}),
  }
}

function normalizeExaResponse(
  value: unknown,
  allowedDomains: string[] | undefined,
  blockedDomains: string[] | undefined,
): { hits: SearchHit[]; requestId?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw unverifiedError('Exa 返回了无效响应。')
  }
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.results)) {
    throw unverifiedError('Exa 响应缺少搜索结果。')
  }

  const seenUrls = new Set<string>()
  const hits: SearchHit[] = []
  for (const rawHit of record.results) {
    const hit = normalizeExaHit(rawHit)
    if (!hit || seenUrls.has(hit.url)) continue
    seenUrls.add(hit.url)
    hits.push(hit)
  }

  const requestId =
    typeof record.requestId === 'string' && record.requestId.trim()
      ? record.requestId.trim()
      : undefined
  return {
    hits: applyDomainFilters(hits, allowedDomains, blockedDomains),
    ...(requestId ? { requestId } : {}),
  }
}

function createHttpError(status: number): Error {
  if (status === 401 || status === 403) {
    return unverifiedError(
      'Exa API Key 无效或没有搜索权限，请通过 /connect 配置或检查 Exa 网页搜索凭据。',
    )
  }
  if (status === 429) {
    return unverifiedError('Exa 配额不足或请求过于频繁。')
  }
  if (status >= 500) {
    return unverifiedError('Exa 搜索服务暂时不可用。')
  }
  return unverifiedError(`Exa 搜索请求失败（HTTP ${status}）。`)
}

export function createExaSearchProvider(
  options: ExaSearchProviderOptions = {},
): SearchProvider {
  const fetchImpl =
    options.fetchImpl ??
    ((input, init) => globalThis.fetch(input, init))
  const timeoutMs = options.timeoutMs ?? EXA_SEARCH_TIMEOUT_MS
  const getApiKey = options.getApiKey ?? (() => getSearchServiceApiKey('exa'))

  return {
    id: 'exa',
    label: 'Exa',
    isConfigured() {
      return Boolean(getApiKey()?.trim())
    },
    async search(input, signal) {
      const apiKey = getApiKey()?.trim()
      if (!apiKey) {
        throw unverifiedError(
          '尚未配置 Exa API Key，请通过 /connect 配置 Exa 网页搜索。',
        )
      }
      if (signal?.aborted) throw createAbortError()

      const allowedDomains = normalizeDomains(input.allowedDomains)
      const blockedDomains = normalizeDomains(input.blockedDomains)
      if (allowedDomains?.length && blockedDomains?.length) {
        throw unverifiedError('同一次搜索不能同时设置允许域名和屏蔽域名。')
      }

      const requestController = new AbortController()
      let timedOut = false
      const abortFromCaller = () => requestController.abort()
      signal?.addEventListener('abort', abortFromCaller, { once: true })
      const timeout = setTimeout(() => {
        timedOut = true
        requestController.abort()
      }, timeoutMs)

      const requestBody = {
        query: input.query,
        type: 'auto',
        numResults: EXA_SEARCH_RESULT_LIMIT,
        contents: {
          highlights: {
            query: input.query,
            maxCharacters: EXA_HIGHLIGHT_MAX_CHARACTERS,
          },
        },
        ...(allowedDomains ? { includeDomains: allowedDomains } : {}),
        ...(blockedDomains ? { excludeDomains: blockedDomains } : {}),
      }

      const startTime = performance.now()
      try {
        const response = await fetchImpl(EXA_SEARCH_ENDPOINT, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
          },
          body: JSON.stringify(requestBody),
          signal: requestController.signal,
        })
        if (!response.ok) throw createHttpError(response.status)

        const normalized = normalizeExaResponse(
          await response.json(),
          allowedDomains,
          blockedDomains,
        )
        return {
          ...normalized,
          providerName: 'Exa',
          durationSeconds: (performance.now() - startTime) / 1_000,
        }
      } catch (error) {
        if (signal?.aborted) throw createAbortError()
        if (timedOut) {
          throw unverifiedError(`Exa 搜索超时（${timeoutMs / 1_000} 秒）。`)
        }
        if (
          error instanceof Error &&
          error.message.includes('本次时效性信息未验证')
        ) {
          throw error
        }
        const message = error instanceof Error ? error.message : String(error)
        throw unverifiedError(`Exa 搜索请求失败：${message}`)
      } finally {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', abortFromCaller)
      }
    },
  }
}

export const exaSearchProvider = createExaSearchProvider()
