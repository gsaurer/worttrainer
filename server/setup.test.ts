// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { FileStore } from './store.js'
import { setupConfiguration } from './setup.js'

const origin = 'https://words.example.com'
const token = 'test-only-configured-token-'.repeat(2)
const password = 'a long test-only passphrase'
let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'worttrainer-setup-')) })
afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }) })

describe('first-install setup configuration', () => {
  it('keeps configured tokens stable across restarts without a clock expiry', () => {
    const settings = setupConfiguration({ SETUP_TOKEN: token }, 1_000)
    expect(settings).toEqual({ setupToken: token, setupExpiresAt: null })
    expect(setupConfiguration({ SETUP_TOKEN: token }, 10_000_000)).toEqual(settings)
  })

  it('enforces the configured token boundaries and rejects unsafe placeholders', () => {
    expect(setupConfiguration({ SETUP_TOKEN: 'a'.repeat(32) }).setupToken).toHaveLength(32)
    expect(setupConfiguration({ SETUP_TOKEN: 'a'.repeat(128) }).setupToken).toHaveLength(128)
    for (const value of ['a'.repeat(31), 'a'.repeat(129), 'a b'.repeat(16), '<paste your token here>'.repeat(2)]) {
      expect(() => setupConfiguration({ SETUP_TOKEN: value })).toThrow('SETUP_TOKEN')
    }
  })

  it('preserves random 15-minute links when the optional setting is absent or empty', () => {
    const generated = setupConfiguration({}, 1_000)
    expect(generated.setupToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(generated.setupExpiresAt).toBe(901_000)
    const next = setupConfiguration({ SETUP_TOKEN: '' }, 1_000)
    expect(next.setupToken).not.toBe(generated.setupToken)
    expect(next.setupExpiresAt).toBe(901_000)
  })

  it('accepts a configured token hours later, refuses wrong tokens, and consumes setup permanently', async () => {
    const file = join(directory, 'store.json')
    const settings = setupConfiguration({ SETUP_TOKEN: token })
    const store = await FileStore.open(file)
    const options = { store, origin, secureCookie: true, ...settings }
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 60 * 60 * 1000)
    const app = createApp(options)
    const post = (setupToken: string) => request(app).post('/api/setup').set('Origin', origin).send({ email: 'parent@example.com', password, setupToken })
    await post('wrong-token').expect(403)
    expect(store.account).toBeNull()
    await post(token).expect(201)
    const saved = await readFile(file, 'utf8')
    expect(saved).not.toContain(token)
    expect(JSON.stringify((await request(app).get('/api/session')).body)).not.toContain(token)
    const restarted = createApp({ ...options, store: await FileStore.open(file), ...setupConfiguration({ SETUP_TOKEN: token }) })
    await request(restarted).post('/api/setup').set('Origin', origin).send({ email: 'another@example.com', password, setupToken: token }).expect(409)
  }, 15_000)

  it('still rejects expired generated links and tokens from a previous restart', async () => {
    const store = await FileStore.open(join(directory, 'store.json'))
    const expired = setupConfiguration({}, Date.now() - 15 * 60 * 1000 - 1)
    const app = createApp({ store, origin, secureCookie: true, ...expired })
    await request(app).post('/api/setup').set('Origin', origin).send({ email: 'parent@example.com', password, setupToken: expired.setupToken }).expect(403)
    const fresh = setupConfiguration({})
    const restarted = createApp({ store, origin, secureCookie: true, ...fresh })
    await request(restarted).post('/api/setup').set('Origin', origin).send({ email: 'parent@example.com', password, setupToken: expired.setupToken }).expect(403)
    await request(restarted).post('/api/setup').set('Origin', origin).send({ email: 'parent@example.com', password, setupToken: fresh.setupToken }).expect(201)
  }, 15_000)
})
