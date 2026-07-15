declare const MACRO: {
  VERSION: string
  DISPLAY_VERSION: string
  BUILD_TIME: string
  ISSUES_EXPLAINER: string
  FEEDBACK_CHANNEL: string
  PACKAGE_URL: string
  NATIVE_PACKAGE_URL: string | undefined
  VERSION_CHANGELOG: string | undefined
}

declare module '*.md' {
  const content: string
  export default content
}
