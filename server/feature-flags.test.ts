// @vitest-environment node
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { FeatureFlags } from './feature-flags.js'
import { FileStore } from './store.js'
import * as ocr from './ocr.js'

const origin = 'http://localhost:5173'
let directory: string
let dataFile: string
let flagsFile: string
let store: FileStore
let first: Awaited<ReturnType<typeof seed>>
let second: Awaited<ReturnType<typeof seed>>

async function seed(email: string) {
  const id = randomUUID()
  const token = randomBytes(32).toString('base64url')
  await store.register({ email, salt: '11'.repeat(16), passwordHash: '22'.repeat(64) }, {
    accountId: id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: Date.now() + 60_000,
  })
  return { id, cookie: `worttrainer_session=${token}` }
}
const write = (flags: object) => writeFile(flagsFile, JSON.stringify({ flags }))

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'worttrainer-flags-'))
  dataFile = join(directory, 'store.json')
  flagsFile = join(directory, 'store.feature-flags.json')
  store = await FileStore.open(dataFile)
  first = await seed('first@example.test')
  second = await seed('second@example.test')
})
afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }) })

describe('feature flags', () => {
  it('has no flags without a file and never creates one', async () => {
    const flags = await FeatureFlags.open(dataFile, store)
    expect(flags.forAccount(first.id)).toEqual([])
    expect(flags.enabled('anything', first.id)).toBe(false)
    await expect(import('node:fs/promises').then(fs => fs.stat(flagsFile))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('enables a flag for everyone or only for listed account emails and IDs', async () => {
    await write({
      'for-everyone': { all: true },
      'by-email': { accounts: [' First@Example.test '] },
      'by-id': { accounts: [second.id.toUpperCase()] },
      'off': { all: false },
      'unlisted': {},
    })
    const flags = await FeatureFlags.open(dataFile, store)
    expect(flags.forAccount(first.id)).toEqual(['by-email', 'for-everyone'])
    expect(flags.forAccount(second.id)).toEqual(['by-id', 'for-everyone'])
    expect(flags.enabled('off', first.id)).toBe(false)
    expect(flags.enabled('unknown', first.id)).toBe(false)
  })

  it('applies edits without a restart and keeps the last valid flags after a bad edit', async () => {
    await write({ beta: { accounts: ['first@example.test'] } })
    const flags = await FeatureFlags.open(dataFile, store)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(flags.enabled('beta', first.id)).toBe(true)
    await write({ beta: { all: true }, extra: { all: true } })
    await flags.refresh(Date.now() + 2000)
    expect(flags.forAccount(second.id)).toEqual(['beta', 'extra'])
    await writeFile(flagsFile, '{ broken')
    await flags.refresh(Date.now() + 4000)
    expect(flags.forAccount(second.id)).toEqual(['beta', 'extra'])
    expect(log).toHaveBeenCalledOnce()
    expect(String(log.mock.calls[0][0])).toContain('Keeping the previous flags')
    await flags.refresh(Date.now() + 6000)
    expect(log).toHaveBeenCalledOnce()
    await rm(flagsFile)
    await flags.refresh(Date.now() + 8000)
    expect(flags.forAccount(first.id)).toEqual([])
  })

  it.each([
    ['unknown top-level key', { flags: {}, extra: true }],
    ['uppercase name', { flags: { Beta: { all: true } } }],
    ['unknown flag key', { flags: { beta: { everyone: true } } }],
    ['non-boolean all', { flags: { beta: { all: 'yes' } } }],
    ['invalid account', { flags: { beta: { accounts: ['not an account'] } } }],
  ])('refuses to start with an invalid file: %s', async (_name, content) => {
    await writeFile(flagsFile, JSON.stringify(content))
    await expect(FeatureFlags.open(dataFile, store)).rejects.toThrow(flagsFile)
  })

  it('includes only the signed-in account’s flags in its session', async () => {
    await write({ shared: { all: true }, private: { accounts: ['first@example.test'] } })
    const app = createApp({ store, origin, secureCookie: false, features: await FeatureFlags.open(dataFile, store) })
    expect((await request(app).get('/api/session').set('Cookie', first.cookie).expect(200)).body.features).toEqual(['private', 'shared'])
    expect((await request(app).get('/api/session').set('Cookie', second.cookie).expect(200)).body.features).toEqual(['shared'])
    expect((await request(app).get('/api/session').expect(200)).body).not.toHaveProperty('features')
  })

  it('gates document endpoints on the server, including per-account activation', async () => {
    await write({ 'document-check': { accounts: ['first@example.test'] } })
    const flags = await FeatureFlags.open(dataFile, store)
    const app = createApp({ store, origin, secureCookie: false, features: flags })
    for (const cookie of [undefined, second.cookie]) {
      const send = (path: string) => {
        const operation = request(app).post(path).set('Origin', origin)
        return cookie ? operation.set('Cookie', cookie) : operation
      }
      await send('/api/documents/words').send({ language: 'en', words: ['beautiful'] }).expect(cookie ? 404 : 401)
      await send('/api/documents/photo?language=en').set('Content-Type', 'image/jpeg').send(Buffer.from('photo')).expect(cookie ? 404 : 401)
    }
    await request(app).post('/api/documents/photo?language=en').set('Origin', origin).set('Cookie', first.cookie).set('Content-Type', 'image/jpeg').send(Buffer.from('photo')).expect(503)
    expect(store.ocrUsage().used).toBe(0)
    await rm(flagsFile)
    await flags.refresh(Date.now() + 2000)
    await request(app).post('/api/documents/words').set('Origin', origin).set('Cookie', first.cookie).send({ language: 'en', words: ['beautiful'] }).expect(404)
  })

  it('gates challenge auto checking independently and before OCR for each account', async () => {
    await write({ 'document-check': { all: true }, 'challenge-auto-check': { accounts: ['first@example.test'] } })
    const flags = await FeatureFlags.open(dataFile, store)
    const normalize = vi.spyOn(ocr, 'normalizePhoto').mockResolvedValue(Buffer.from('normalized'))
    const read = vi.spyOn(ocr, 'readAzurePhoto').mockResolvedValue({ answers: [{ number: 1, text: 'beautiful', confidence: 0.9 }], warnings: [] })
    const options = { store, origin, secureCookie: false, ocr: { endpoint: 'https://example.cognitiveservices.azure.com', key: 'test', monthlyLimit: 5 } }
    const app = createApp({ ...options, features: flags })
    const prepare = async (owner: string) => {
      const word = await store.addWord(owner, 'beautiful', 'en')
      const challenge = await store.createChallenge(owner, [word.id])
      await store.advanceChallenge(owner, challenge.id, 1, { fromIndex: 0, elapsedMs: 5000, intervalSeconds: 5, automatic: false, action: 'next' })
      return challenge.id
    }
    const firstChallenge = await prepare(first.id)
    const secondChallenge = await prepare(second.id)
    const upload = (id: string, cookie?: string, target = app) => {
      const operation = request(target).post(`/api/challenges/${id}/photo`).set('Origin', origin).set('Content-Type', 'image/jpeg')
      return (cookie ? operation.set('Cookie', cookie) : operation).send(Buffer.from('photo'))
    }
    await upload(firstChallenge).expect(401)
    await upload(secondChallenge, second.cookie).expect(404)
    await upload(firstChallenge, first.cookie, createApp(options)).expect(404)
    expect(normalize).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    expect(store.ocrUsage().used).toBe(0)
    expect((await request(app).get('/api/challenges').set('Cookie', second.cookie).expect(200)).body.ocr.enabled).toBe(false)
    expect((await request(app).get('/api/challenges').set('Cookie', first.cookie).expect(200)).body.ocr.enabled).toBe(true)
    await upload(firstChallenge, first.cookie).expect(200)
    expect(read).toHaveBeenCalledOnce()
    expect(store.ocrUsage().used).toBe(1)
    expect(store.exportData(second.id).attempts).toEqual([])
    expect(store.challenge(second.id, secondChallenge).recognition).toBeNull()
    await write({ 'document-check': { all: true } })
    await flags.refresh(Date.now() + 2000)
    await upload(firstChallenge, first.cookie).expect(404)
    expect(read).toHaveBeenCalledOnce()
    expect((await request(app).get('/api/challenges').set('Cookie', first.cookie).expect(200)).body.ocr.enabled).toBe(false)
  })

  it('adds reviewed words atomically without duplicates, changed progress or account leakage', async () => {
    await write({ 'document-check': { all: true } })
    const app = createApp({ store, origin, secureCookie: false, features: await FeatureFlags.open(dataFile, store) })
    const existing = await store.addWord(first.id, 'beautiful', 'en')
    await store.mark(first.id, existing.id, false, randomUUID())
    const before = store.exportData(first.id)
    const add = () => request(app).post('/api/documents/words').set('Origin', origin).set('Cookie', first.cookie).send({ language: 'en', words: ['beautiful', 'Flower', 'flower'] })
    const results = await Promise.all([add().expect(200), add().expect(200)])
    expect(results.map(result => result.body.added).sort()).toEqual([0, 1])
    expect(store.words(first.id)).toHaveLength(2)
    expect(store.words(first.id).find(word => word.id === existing.id)).toEqual(before.words[0])
    expect(store.exportData(first.id).attempts).toEqual(before.attempts)
    expect(store.exportData(first.id).challenges).toEqual([])
    expect(store.words(second.id)).toEqual([])
    const reopened = await FileStore.open(dataFile)
    expect(reopened.words(first.id)).toEqual(store.words(first.id))
    await request(app).post('/api/documents/words').set('Origin', origin).set('Cookie', first.cookie).send({ language: 'fr', words: ['bonjour'] }).expect(400)
    await request(app).post('/api/documents/words').set('Origin', origin).set('Cookie', first.cookie).send({ language: 'en', words: ['valid', 'bad\nword'] }).expect(400)
    expect(store.words(first.id)).toHaveLength(2)
  })

  it('reads full document text using shared OCR quota without creating a challenge or saving the photo', async () => {
    await write({ 'document-check': { all: true } })
    const normalize = vi.spyOn(ocr, 'normalizePhoto').mockResolvedValue(Buffer.from('normalized'))
    const read = vi.spyOn(ocr, 'readAzureDocument').mockResolvedValue('A beautifull flower.')
    const app = createApp({ store, origin, secureCookie: false, features: await FeatureFlags.open(dataFile, store), ocr: { endpoint: 'https://example.cognitiveservices.azure.com', key: 'test', monthlyLimit: 1 } })
    const upload = (language = 'en') => request(app).post(`/api/documents/photo?language=${language}`).set('Origin', origin).set('Cookie', first.cookie).set('Content-Type', 'image/jpeg').send(Buffer.from('photo'))
    await upload('fr').expect(400)
    expect(normalize).not.toHaveBeenCalled()
    const response = await upload().expect(200)
    expect(response.body.possibleMistakes[0]).toMatchObject({ word: 'beautifull', suggestions: expect.arrayContaining(['beautiful']) })
    expect(store.ocrUsage().used).toBe(1)
    expect(store.exportData(first.id)).toMatchObject({ words: [], attempts: [], challenges: [] })
    await upload().expect(429)
    expect(read).toHaveBeenCalledOnce()
  })

  it('rejects compressed or invalid photos and disabled languages without spending OCR quota', async () => {
    await write({ 'document-check': { all: true } })
    await store.setLanguagePreferences(first.id, { enabled: ['en'], defaultLanguage: 'en' })
    const read = vi.spyOn(ocr, 'readAzureDocument')
    const app = createApp({ store, origin, secureCookie: false, features: await FeatureFlags.open(dataFile, store), ocr: { endpoint: 'https://example.cognitiveservices.azure.com', key: 'test', monthlyLimit: 5 } })
    const upload = (language: string) => request(app).post(`/api/documents/photo?language=${language}`).set('Origin', origin).set('Cookie', first.cookie).set('Content-Type', 'image/jpeg')
    await upload('de').send(Buffer.from('photo')).expect(409)
    await upload('en').set('Content-Encoding', 'gzip').send(gzipSync(Buffer.from('photo'))).expect(415)
    await upload('en').send(Buffer.from('not an image')).expect(400)
    await request(app).post('/api/documents/words').set('Origin', origin).set('Cookie', first.cookie).send({ language: 'de', words: ['Haus'] }).expect(409)
    expect(store.ocrUsage().used).toBe(0)
    expect(read).not.toHaveBeenCalled()
  })

  it('rejects concurrent readings and releases the busy guard after a provider failure', async () => {
    await write({ 'document-check': { all: true } })
    vi.spyOn(ocr, 'normalizePhoto').mockResolvedValue(Buffer.from('normalized'))
    let started!: () => void
    let fail!: (error: Error) => void
    const reading = new Promise<string>((_resolve, reject) => { fail = reject })
    const began = new Promise<void>(resolve => { started = resolve })
    vi.spyOn(ocr, 'readAzureDocument').mockImplementationOnce(() => { started(); return reading }).mockResolvedValue('A beautiful flower.')
    const app = createApp({ store, origin, secureCookie: false, features: await FeatureFlags.open(dataFile, store), ocr: { endpoint: 'https://example.cognitiveservices.azure.com', key: 'test', monthlyLimit: 5 } })
    const upload = () => request(app).post('/api/documents/photo?language=en').set('Origin', origin).set('Cookie', first.cookie).set('Content-Type', 'image/jpeg').send(Buffer.from('photo'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const firstUpload = upload().then(response => response)
    await began
    await upload().expect(429)
    fail(new Error('provider unavailable'))
    expect((await firstUpload).status).toBe(500)
    expect(log).toHaveBeenCalled()
    await upload().expect(200)
    expect(store.ocrUsage().used).toBe(2)
  })
})
