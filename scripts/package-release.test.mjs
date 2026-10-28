import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { artifactName, packageRelease } from './package-release.mjs'

const roots = []
const commit = 'a'.repeat(40)

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'worttrainer-release-test-'))
  roots.push(root)
  const source = join(root, 'app')
  const output = join(root, 'release')
  for (const path of ['dist', 'dist-server/server', 'node_modules/example', 'data', 'server']) mkdirSync(join(source, path), { recursive: true })
  for (const path of ['dist/index.html', 'dist-server/server/index.js', 'node_modules/example/index.js', 'package.json', 'package-lock.json', '.env', 'data/store.json', 'server/index.ts']) writeFileSync(join(source, path), 'fixture')
  writeFileSync(join(source, 'dist/build-info.json'), JSON.stringify({ commit, dirty: false, buildId: 'b'.repeat(64) }))
  return { source, output }
}

it('packages only runtime files with matching provenance and a SHA-256 checksum', () => {
  const { source, output } = fixture()
  const archive = packageRelease(source, output, commit)
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean)
  expect(entries).toContain('dist-server/server/index.js')
  expect(entries).toContain('node_modules/example/index.js')
  expect(entries).toContain('release.json')
  expect(entries.some(entry => /(^|\/)(data|\.env|server\/index.ts)(\/|$)/.test(entry))).toBe(false)
  const manifest = JSON.parse(execFileSync('tar', ['-xOzf', archive, 'release.json'], { encoding: 'utf8' }))
  expect(manifest).toMatchObject({ format: 1, commit, nodeMajor: 22, arch: 'x64', platform: 'linux' })
  const digest = createHash('sha256').update(readFileSync(archive)).digest('hex')
  expect(readFileSync(`${archive}.sha256`, 'utf8')).toBe(`${digest}  ${artifactName}\n`)
})

it('refuses mismatched or dirty builds', () => {
  const { source, output } = fixture()
  expect(() => packageRelease(source, output, 'c'.repeat(40))).toThrow()
  writeFileSync(join(source, 'dist/build-info.json'), JSON.stringify({ commit, dirty: true }))
  expect(() => packageRelease(source, output, commit)).toThrow()
})

it('refuses missing compiled server files and malformed commits', () => {
  const { source, output } = fixture()
  expect(() => packageRelease(source, output, '../invalid')).toThrow()
  rmSync(join(source, 'dist-server/server/index.js'))
  expect(() => packageRelease(source, output, commit)).toThrow()
})