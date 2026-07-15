/**
 * Shared analytics configuration
 *
 * Common logic for determining when analytics should be disabled
 * across all analytics systems (Datadog, 1P)
 */

/**
 * VioletCode 当前不收集产品分析数据。
 *
 * 后续若引入遥测，必须先提供独立的知情同意、字段说明和撤回入口，
 * 不能复用上游 VioletCode 的第一方事件通道。
 */
export function isAnalyticsDisabled(): boolean {
  return true
}

/**
 * Check if the feedback survey should be suppressed.
 *
 * Unlike isAnalyticsDisabled(), this does NOT block on 3P providers
 * (Bedrock/Vertex/Foundry). The survey is a local UI prompt with no
 * transcript data — enterprise customers capture responses via OTEL.
 */
export function isFeedbackSurveyDisabled(): boolean {
  return true
}
