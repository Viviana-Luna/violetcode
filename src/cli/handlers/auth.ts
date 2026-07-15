/**
 * 旧 VioletCode OAuth CLI 的兼容边界。
 * Provider 凭据统一由 /connect 和 auth.json 管理，旧入口不得再写入令牌。
 */
function unsupportedOAuthError(): Error {
  return new Error('VioletCode 已停用 VioletCode OAuth，请运行 /connect 配置 Provider API Key。')
}

export async function installOAuthTokens(_tokens: unknown): Promise<void> {
  throw unsupportedOAuthError()
}

export async function authLogin(_options: unknown): Promise<void> {
  throw unsupportedOAuthError()
}

export async function authStatus(_options: unknown): Promise<void> {
  throw unsupportedOAuthError()
}

export async function authLogout(): Promise<void> {
  throw unsupportedOAuthError()
}
