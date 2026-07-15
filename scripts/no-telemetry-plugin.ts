import type { BunPlugin } from 'bun'

// 公开构建不包含上游遥测、反馈上传和旧自动更新网络路径。
const stubs: Record<string, string> = {
  'utils/autoUpdater': `
export async function assertMinVersion() {}
export async function getMaxVersion() { return undefined; }
export async function getMaxVersionMessage() { return undefined; }
export function shouldSkipVersion() { return true; }
export function getLockFilePath() { return '/tmp/violet-update.disabled.lock'; }
export async function checkGlobalInstallPermissions() { return { hasPermissions: false, npmPrefix: null }; }
export async function getLatestVersion() { return null; }
export async function getNpmDistTags() { return { latest: null, stable: null }; }
export async function getLatestVersionFromGcs() { return null; }
export async function getGcsDistTags() { return { latest: null, stable: null }; }
export async function getVersionHistory() { return []; }
export async function installGlobalPackage() { return 'success'; }
`,
  'utils/plugins/fetchTelemetry': `
export function logPluginFetch() {}
export function classifyFetchError() { return 'disabled'; }
`,
  'components/FeedbackSurvey/submitTranscriptShare': `
export async function submitTranscriptShare() { return { success: false }; }
`,
  'services/internalLogging': `
export async function logPermissionContextForAnts() {}
export const getContainerId = async () => null;
`,
  'services/api/dumpPrompts': `
export function createDumpPromptsFetch() { return undefined; }
export function getDumpPromptsPath() { return ''; }
export function getLastApiRequests() { return []; }
export function clearApiRequestCache() {}
export function clearDumpState() {}
export function clearAllDumpState() {}
export function addApiRequestToCache() {}
`,
  'utils/undercover': `
export function isUndercover() { return false; }
export function getUndercoverInstructions() { return ''; }
export function shouldShowUndercoverAutoNotice() { return false; }
`,
  'types/generated/events_mono/claude_code/v1/claude_code_internal_event': `
export const ClaudeCodeInternalEvent = {
  fromJSON: value => value,
  toJSON: value => value,
  create: value => value ?? {},
  fromPartial: value => value ?? {},
};
`,
  'types/generated/events_mono/growthbook/v1/growthbook_experiment_event': `
export const GrowthbookExperimentEvent = {
  fromJSON: value => value,
  toJSON: value => value,
  create: value => value ?? {},
  fromPartial: value => value ?? {},
};
`,
  'types/generated/events_mono/common/v1/auth': `
export const PublicApiAuth = {
  fromJSON: value => value,
  toJSON: value => value,
  create: value => value ?? {},
  fromPartial: value => value ?? {},
};
`,
  'types/generated/google/protobuf/timestamp': `
export const Timestamp = {
  fromJSON: value => value,
  toJSON: value => value,
  create: value => value ?? {},
  fromPartial: value => value ?? {},
};
`,
}

function escapePath(modulePath: string): string {
  return modulePath
    .replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
    .replace(/\//g, '[/\\\\]')
}

export const noTelemetryPlugin: BunPlugin = {
  name: 'violet-no-telemetry',
  setup(build) {
    for (const [modulePath, contents] of Object.entries(stubs)) {
      const filter = new RegExp(`${escapePath(modulePath)}\\.(ts|js)$`)
      build.onLoad({ filter }, () => ({ contents, loader: 'js' }))
    }
  },
}
