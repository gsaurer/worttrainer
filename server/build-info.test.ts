// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { build } from 'vite'
import { createBuildInfo } from './build-info'
import { buildInfoSchema } from '../shared/status'
import manifest from '../package.json' with { type: 'json' }

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'worttrainer-build-'))
  for (const folder of ['server', 'shared', 'src', 'public']) await mkdir(join(directory, folder))
  for (const file of ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.server.json', 'index.html', 'Dockerfile']) await writeFile(join(directory, file), file)
  vi.stubEnv('BUILD_COMMIT', '')
  vi.stubEnv('BUILD_DIRTY', '')
})
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }) })

describe('build identity', () => {
  it('identifies source changes without Git and never hashes runtime data or root environment secrets', async () => {
    const first = createBuildInfo(directory)
    expect(first).toMatchObject({ version: manifest.version, commit: null, dirty: null })
    expect(first.buildId).toMatch(/^[a-f0-9]{64}$/)
    expect(Number.isNaN(Date.parse(first.builtAt))).toBe(false)
    await writeFile(join(directory, '.env'), 'PRIVATE_KEY=test-only')
    await mkdir(join(directory, 'data'))
    await writeFile(join(directory, 'data', 'store.json'), '{"private":"test-only"}')
    expect(createBuildInfo(directory).buildId).toBe(first.buildId)
    await writeFile(join(directory, 'src', 'example.ts'), 'export const updated = true')
    expect(createBuildInfo(directory).buildId).not.toBe(first.buildId)
  })

  it('accepts explicit container build revisions and validates their shape', () => {
    vi.stubEnv('BUILD_COMMIT', 'a'.repeat(40))
    vi.stubEnv('BUILD_DIRTY', 'true')
    expect(createBuildInfo(directory)).toMatchObject({ commit: 'a'.repeat(40), dirty: true })
    vi.stubEnv('BUILD_COMMIT', 'not-a-commit')
    expect(() => createBuildInfo(directory)).toThrow()
    vi.stubEnv('BUILD_COMMIT', 'a'.repeat(40))
    vi.stubEnv('BUILD_DIRTY', 'invalid')
    expect(() => createBuildInfo(directory)).toThrow('BUILD_DIRTY must be true or false.')
  })

  it('reads the production build artifact once instead of reporting a changing source checkout', async () => {
    const expected = createBuildInfo(directory)
    await mkdir(join(directory, 'dist'))
    await writeFile(join(directory, 'dist', 'build-info.json'), JSON.stringify(expected))
    vi.stubEnv('NODE_ENV', 'production')
    vi.resetModules()
    const { loadBuildInfo } = await import('./build-info')
    expect(loadBuildInfo(directory)).toEqual(expected)
    await writeFile(join(directory, 'dist', 'build-info.json'), JSON.stringify({ ...expected, version: '9.0.0' }))
    expect(loadBuildInfo(directory)).toEqual(expected)
  })

  it('does not silently invent a production version when its build artifact is missing or invalid', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.resetModules()
    const { loadBuildInfo } = await import('./build-info')
    expect(() => loadBuildInfo(directory)).toThrow()
    await mkdir(join(directory, 'dist'))
    await writeFile(join(directory, 'dist', 'build-info.json'), '{"version":"incomplete"}')
    expect(() => loadBuildInfo(directory)).toThrow()
  })

  it('emits the same build metadata into production JavaScript and the backend artifact', async () => {
    const result = await build({
      configFile: resolve('vite.config.ts'), logLevel: 'silent',
      build: { write: false, outDir: join(directory, 'output'), rollupOptions: { input: 'status-build-smoke', preserveEntrySignatures: 'strict' } },
      plugins: [{ name: 'status-build-smoke', resolveId: id => id === 'status-build-smoke' ? '\0status-build-smoke' : undefined, load: id => id === '\0status-build-smoke' ? 'export const identity = __BUILD_INFO__' : undefined }],
    })
    if ('on' in result) throw new Error('Expected a one-shot build, not a watcher.')
    const outputs = Array.isArray(result) ? result : [result]
    const output = outputs.flatMap(item => item.output)
    const artifact = output.find(item => item.type === 'asset' && item.fileName === 'build-info.json')
    if (!artifact || artifact.type !== 'asset') throw new Error('Expected build-info.json.')
    const metadata = buildInfoSchema.parse(JSON.parse(typeof artifact.source === 'string' ? artifact.source : Buffer.from(artifact.source).toString('utf8')))
    const javascript = output.filter(item => item.type === 'chunk').map(item => item.code).join('\n')
    expect(javascript).toContain(metadata.buildId)
    expect(javascript).toContain(metadata.builtAt)
    expect(javascript).not.toContain('__BUILD_INFO__')
  }, 15_000)
})