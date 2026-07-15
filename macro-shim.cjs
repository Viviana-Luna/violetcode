const fs = require('fs')
const path = require('path')

function tryReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function readPackagedVersion() {
  const candidates = [
    path.join(__dirname, 'package.json'),
    path.join(__dirname, 'package', 'package.json'),
    path.join(__dirname, '..', 'package', 'package.json'),
  ]

  for (const pkgPath of candidates) {
    const pkg = tryReadJson(pkgPath)
    if (pkg) {
      return {
        version: pkg.version || '0.0.0',
        packageName: pkg.name || 'violet-code',
      }
    }
  }

  return {
    version: '0.0.0',
    packageName: 'violet-code',
  }
}

const packaged = readPackagedVersion()

globalThis.MACRO = new Proxy(
  {
    VERSION: packaged.version,
    PACKAGE_URL: packaged.packageName,
    NATIVE_PACKAGE_URL: packaged.packageName,
    FEEDBACK_CHANNEL: 'the Violet Code issue tracker',
    ISSUES_EXPLAINER: 'file an issue in the Violet Code issue tracker',
    BUILD_TIME: '',
  },
  {
    get(target, prop) {
      if (prop in target) {
        return target[prop]
      }
      return ''
    },
  },
)
