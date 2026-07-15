const FALLBACK_SECRET_ENV_KEYS: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'DEEPSEEK_API_KEY',
  'EXA_API_KEY',
  'MINIMAX_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_API_KEYS',
  'OPENAI_AUTH_HEADER_VALUE',
  'CODEX_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_ACCESS_TOKEN',
  'MISTRAL_API_KEY',
  'XAI_API_KEY',
]

let cachedKnownSecretKeys: readonly string[] | null = null

export function getKnownProviderSecretEnvKeys(): readonly string[] {
  if (cachedKnownSecretKeys) {
    return cachedKnownSecretKeys
  }
  cachedKnownSecretKeys = Object.freeze([...FALLBACK_SECRET_ENV_KEYS])
  return cachedKnownSecretKeys
}

export type SecretValueSource = Partial<
  Record<string, string | undefined>
>

export function sanitizeApiKey(
  key: string | null | undefined,
): string | undefined {
  if (!key) {
    return undefined
  }
  const trimmed = key.trim()
  if (!trimmed || trimmed === 'SUA_CHAVE') {
    return undefined
  }
  return trimmed
}

const SECRET_PREFIX_PATTERNS = [
  /^sk-/,
  /^sk-ant-/,
  /^AIza/,
  /^ghp_/,
  /^gho_/,
  /^ghu_/,
  /^ghs_/,
  /^ghr_/,
  /^github_pat_/,
]

const SECRET_PREFIX_SUBSTRING_PATTERN =
  /(?:sk-ant-|sk-|AIza|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9._-]{8,}/g
const JWT_SUBSTRING_PATTERN =
  /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g

function hasLowerUpperDigit(value: string): boolean {
  let hasLower = false
  let hasUpper = false
  let hasDigit = false

  for (const ch of value) {
    if (ch >= 'a' && ch <= 'z') hasLower = true
    else if (ch >= 'A' && ch <= 'Z') hasUpper = true
    else if (ch >= '0' && ch <= '9') hasDigit = true
  }

  return hasLower && hasUpper && hasDigit
}

function looksLikeOpaqueToken(value: string): boolean {
  if (value.length < 24) return false
  if (value.includes('://')) return false
  if (value.includes(' ')) return false
  if (value.includes('/')) return false

  if (/^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(value)) {
    return true
  }

  for (const ch of value) {
    const allowed =
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= '0' && ch <= '9') ||
      ch === '-' ||
      ch === '_'
    if (!allowed) return false
  }

  return value
    .split(/[-_]+/)
    .some(segment => segment.length >= 16 && hasLowerUpperDigit(segment))
}

function looksLikeSecretValue(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false

  for (const pattern of SECRET_PREFIX_PATTERNS) {
    if (pattern.test(trimmed)) return true
  }

  return looksLikeOpaqueToken(trimmed)
}

function isSecretEnvKey(
  key: string,
  knownKeys: ReadonlySet<string>,
): boolean {
  return (
    knownKeys.has(key) ||
    key.endsWith('_API_KEY') ||
    key.endsWith('_AUTH_HEADER_VALUE') ||
    key.endsWith('_PASSWORD') ||
    key.endsWith('_SECRET') ||
    key.endsWith('_SECRET_ACCESS_KEY') ||
    key.endsWith('_SECRET_KEY') ||
    key.endsWith('_TOKEN')
  )
}

function collectSecretValues(
  sources: Array<SecretValueSource | null | undefined>,
): string[] {
  const knownKeys = new Set(getKnownProviderSecretEnvKeys())
  const values = new Set<string>()

  for (const source of sources) {
    if (!source) continue

    for (const key of Object.keys(source)) {
      if (!isSecretEnvKey(key, knownKeys)) continue

      const value = sanitizeApiKey(source[key])
      if (value) {
        values.add(value)
        for (const part of value.split(',')) {
          const trimmedPart = sanitizeApiKey(part)
          if (trimmedPart) values.add(trimmedPart)
        }
      }
    }
  }

  return [...values]
}

export function maskSecretForDisplay(
  value: string | null | undefined,
): string | undefined {
  const sanitized = sanitizeApiKey(value)
  if (!sanitized) return undefined

  if (sanitized.length <= 8) {
    return 'configured'
  }

  return `${sanitized.slice(0, 3)}...${sanitized.slice(-3)}`
}

export function redactSecretValueForDisplay(
  value: string | null | undefined,
  ...sources: Array<SecretValueSource | null | undefined>
): string | undefined {
  if (!value) return undefined

  const trimmed = value.trim()
  if (!trimmed) return value

  const secretValues = collectSecretValues(sources)
  if (secretValues.includes(trimmed) || looksLikeSecretValue(trimmed)) {
    return maskSecretForDisplay(trimmed) ?? 'configured'
  }

  return trimmed
}

export function redactSecretSubstringsForDisplay(
  value: string | null | undefined,
  ...sources: Array<SecretValueSource | null | undefined>
): string | undefined {
  if (!value) return undefined

  let redacted = value
  const secretValues = collectSecretValues(sources).sort(
    (a, b) => b.length - a.length,
  )
  for (const secretValue of secretValues) {
    const mask = maskSecretForDisplay(secretValue) ?? 'configured'
    redacted = redacted.split(secretValue).join(mask)
  }

  redacted = redacted.replace(
    SECRET_PREFIX_SUBSTRING_PATTERN,
    match => maskSecretForDisplay(match) ?? 'configured',
  )
  redacted = redacted.replace(
    JWT_SUBSTRING_PATTERN,
    match => maskSecretForDisplay(match) ?? 'configured',
  )

  return redacted
}

export function sanitizeProviderConfigValue(
  value: string | null | undefined,
  ...sources: Array<SecretValueSource | null | undefined>
): string | undefined {
  if (!value) return undefined

  const trimmed = value.trim()
  if (!trimmed) return undefined

  const secretValues = collectSecretValues(sources)
  if (secretValues.includes(trimmed) || looksLikeSecretValue(trimmed)) {
    return undefined
  }

  return trimmed
}
