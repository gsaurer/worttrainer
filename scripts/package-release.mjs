import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const artifactName = 'worttrainer-linux-x64.tar.gz'
const runtimePaths = ['dist', 'dist-server', 'node_modules', 'package.json', 'package-lock.json']

export function packageRelease(source, output, commit) {
  assert.match(commit, /^[a-f0-9]{40}$/)
  for (const path of runtimePaths) statSync(join(source, path))
  assert.ok(statSync(join(source, 'dist-server/server/index.js')).size > 0)
  assert.ok(statSync(join(source, 'dist/index.html')).size > 0)
  const build = JSON.parse(readFileSync(join(source, 'dist/build-info.json'), 'utf8'))
  assert.equal(build.commit, commit)
  assert.equal(build.dirty, false)
  assert.match(String(build.buildId), /^[a-f0-9]{64}$/)
  const temporary = mkdtempSync(join(tmpdir(), 'worttrainer-package-'))
  try {
    writeFileSync(join(temporary, 'release.json'), JSON.stringify({
      format: 1, commit, buildId: build.buildId,
      platform: 'linux', arch: 'x64', nodeMajor: 22, libc: 'glibc', minGlibc: '2.36',
    }) + '\n')
    mkdirSync(output, { recursive: true })
    const archive = join(output, artifactName)
    execFileSync('tar', ['-czf', archive, '-C', source, ...runtimePaths, '-C', temporary, 'release.json'])
    const digest = createHash('sha256').update(readFileSync(archive)).digest('hex')
    writeFileSync(`${archive}.sha256`, `${digest}  ${artifactName}\n`)
    return archive
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(packageRelease(resolve(process.argv[2]), resolve(process.argv[3]), process.argv[4]))
}