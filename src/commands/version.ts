import type { Command, LocalCommandCall } from '../types/command.js'

function getDisplayVersion(version: string): string {
  return version.startsWith('v') ? version : `v${version}`
}

const call: LocalCommandCall = async () => {
  const version = getDisplayVersion(MACRO.VERSION)
  return {
    type: 'text',
    value: MACRO.BUILD_TIME
      ? `${version} (built ${MACRO.BUILD_TIME})`
      : version,
  }
}

const version = {
  type: 'local',
  name: 'version',
  description:
    'Print the version this session is running (not what autoupdate downloaded)',
  isEnabled: () => process.env.USER_TYPE === 'ant',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default version
