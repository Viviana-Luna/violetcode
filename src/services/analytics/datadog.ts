/**
 * 原 VioletCode 第一方 Datadog 通道不适用于 DeepSeek 与火山方舟。
 * 保留无副作用的兼容入口，避免调用方承担 Provider 分支。
 */
export async function initializeDatadog(): Promise<boolean> {
  return false
}

export async function shutdownDatadog(): Promise<void> {}

export async function trackDatadogEvent(
  _eventName: string,
  _properties: { [key: string]: boolean | number | undefined },
): Promise<void> {}
