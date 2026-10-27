import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import manifest from '../package.json' with { type: 'json' }
import { buildInfoSchema, type BuildInfo } from '../shared/status.js'

function git(args: string[], root: string) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 2000, windowsHide: true }).trim() }
  catch { return null }
}

export function createBuildInfo(root = process.cwd()): BuildInfo {
  const hash = createHash('sha256')
  function include(path: string) {
    hash.update(path.replaceAll('\\', '/')).update('\0')
    const entries = readdirSync(join(root, path), { withFileTypes: true }).sort((first, second) => first.name.localeCompare(second.name, 'en'))
    for (const entry of entries) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) include(child)
      else if (entry.isFile()) hash.update(child.replaceAll('\\', '/')).update('\0').update(readFileSync(join(root, child))).update('\0')
    }
  }
  for (const directory of ['server', 'shared', 'src', 'public']) include(directory)
  for (const file of ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.server.json', 'index.html', 'Dockerfile']) {
    hash.update(file).update('\0').update(readFileSync(join(root, file))).update('\0')
  }
  const commit = process.env.BUILD_COMMIT || git(['rev-parse', 'HEAD'], root)
  const changes = git(['status', '--porcelain'], root)
  const dirty = process.env.BUILD_DIRTY || null
  if (dirty !== null && dirty !== 'true' && dirty !== 'false') throw new Error('BUILD_DIRTY must be true or false.')
  return buildInfoSchema.parse({ version: manifest.version, buildId: hash.digest('hex'), commit, dirty: dirty === null ? changes === null ? null : changes.length > 0 : dirty === 'true', builtAt: new Date().toISOString() })
}

let current: BuildInfo | undefined

export function loadBuildInfo(root = process.cwd()) {
  return current ??= process.env.NODE_ENV === 'production'
    ? buildInfoSchema.parse(JSON.parse(readFileSync(resolve(root, 'dist/build-info.json'), 'utf8')))
    : createBuildInfo(root)
}