// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { FeatureFlags } from './feature-flags.js'
import { FileStore } from './store.js'
import { hashPassword } from './passwords.js'
import type { Word } from '../shared/model.js'

const origin = 'http://localhost:5173'
const password = 'a long private test passphrase'
let directory: string
let store: FileStore
let app: ReturnType<typeof createApp>
let cookie: string
let accountId: string

function cookieFrom(response: request.Response) {
  const cookies: unknown = response.headers['set-cookie']
  if (!Array.isArray(cookies) || typeof cookies[0] !== 'string') throw new Error('Expected a session cookie.')
  return cookies[0].split(';')[0]
}

const options = () => ({ store, origin, secureCookie: false })
const post = (path: string, body: object, session = cookie) => request(app).post(path).set('Origin', origin).set('Cookie', session ?? '').send(body)

async function add(text = 'Schmetterling', language = 'de'): Promise<Word> {
  const response = await post('/api/words', { text, language }).expect(201)
  return response.body as Word
}

async function mark(wordId: string, correct: boolean, attemptId = randomUUID()): Promise<Word> {
  return (await post('/api/practice', { wordId, correct, attemptId }).expect(200)).body as Word
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'worttrainer-'))
  store = await FileStore.open(join(directory, 'store.json'))
  app = createApp(options())
}, 15_000)
afterAll(async () => { await rm(directory, { recursive: true, force: true }) })
beforeEach(() => { app = createApp(options()) })

describe('real self-hosted authentication and JSON persistence', () => {
  it('disables analytics by default without relaxing the production CSP', async () => {
    const server = createApp({ ...options(), production: true })
    const response = await request(server).get('/api/analytics').expect(200).expect('Cache-Control', 'no-store')
    expect(response.body).toEqual({ umami: null })
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(response.headers['content-security-policy']).toContain("script-src 'self';")
    expect(response.headers['content-security-policy']).toContain("connect-src 'self';")
  })

  it('exposes only configured public analytics settings and permits only its tracker origin', async () => {
    const umami = { scriptUrl: 'https://stats.example.com:8443/custom-script.js', websiteId: 'c3fea621-d611-41f0-98a7-a648659b4cc7' }
    const features = await FeatureFlags.open(join(directory, 'store.json'))
    const refresh = vi.spyOn(features, 'refresh')
    const server = createApp({ ...options(), production: true, umami, features })
    const response = await request(server).get('/api/analytics').expect(200).expect('Cache-Control', 'no-store')
    expect(response.body).toEqual({ umami })
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(refresh).not.toHaveBeenCalled()
    expect(response.headers['content-security-policy']).toBe("default-src 'self'; script-src 'self' https://stats.example.com:8443; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://stats.example.com:8443; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
    const health = await request(server).get('/api/health').expect(200)
    expect(health.headers['content-security-policy']).toBe(response.headers['content-security-policy'])
  })

  it('serves public uncached status and both build identities without accessing account features', async () => {
    const build = { version: '0.1.0', buildId: 'b'.repeat(64), commit: 'a'.repeat(40), dirty: false, builtAt: '2026-10-27T10:00:00.000Z' }
    const features = await FeatureFlags.open(join(directory, 'store.json'))
    const refresh = vi.spyOn(features, 'refresh')
    const server = createApp({ ...options(), build, features })
    const response = await request(server).get('/api/status').expect(200).expect('Content-Type', /json/).expect('Cache-Control', 'no-store')
    expect(response.body).toEqual({ status: 'ok', backend: build, frontend: build, startedAt: expect.any(String), uptimeSeconds: expect.any(Number) })
    expect(Number.isNaN(Date.parse(response.body.startedAt))).toBe(false)
    expect(response.body.uptimeSeconds).toBeGreaterThanOrEqual(0)
    expect(response.headers['set-cookie']).toBeUndefined()
    const repeated = await request(server).get('/api/status').expect(200)
    expect(repeated.body.startedAt).toBe(response.body.startedAt)
    expect(refresh).not.toHaveBeenCalled()
    await request(app).get('/api/health').expect(200).expect({ ok: true })
  })

  it('allows normal signup without a setup token and protects all collection endpoints', async () => {
    expect((await request(app).get('/api/session')).body).toEqual({ authenticated: false, emailMigrationRequired: false, email: null })
    await request(app).get('/api/words').expect(401)
    await post('/api/words', { text: 'word', language: 'en' }, '').expect(401)
    await post('/api/setup', {}, '').expect(410)
    const response = await post('/api/signup', { email: ' Parent@Example.com ', password, websiteLanguage: 'de' }, '').expect(201)
    const account = store.findAccount('parent@example.com')
    if (!account) throw new Error('Expected registered account.')
    accountId = account.id
    cookie = cookieFrom(response)
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly')
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Strict')
    expect(response.body).toEqual({ authenticated: true, emailMigrationRequired: false, email: 'parent@example.com', websiteLanguage: 'de', onboardingRequired: true })
    const saved = await readFile(join(directory, 'store.json'), 'utf8')
    expect(saved).not.toContain(password)
    expect(saved).not.toContain(cookie.split('=')[1])
    expect(saved).toContain('passwordHash')
    await post('/api/signup', { email: 'PARENT@example.com', password }).expect(409)
  }, 15_000)

  it('validates passwords, persists sessions, and logs out only that session', async () => {
    await post('/api/login', { email: 'parent@example.com', password: 'incorrect' }, '').expect(401)
    await post('/api/login', { email: 'stranger@example.com', password }, '').expect(401)
    const response = await post('/api/login', { email: ' PARENT@example.COM ', password }, '').expect(200)
    expect(response.body.websiteLanguage).toBe('de')
    const second = cookieFrom(response)
    await request(app).get('/api/session').set('Cookie', second).expect(200).expect(({ body }) => { expect(body).toMatchObject({ authenticated: true, websiteLanguage: 'de' }) })
    await post('/api/logout', {}, second).expect(204)
    await request(app).get('/api/words').set('Cookie', second).expect(401)
    await request(app).get('/api/words').set('Cookie', cookie).expect(200)
    const tokenHash = createHash('sha256').update(cookie.split('=')[1]).digest('hex')
    expect(store.sessionAccount(tokenHash)).toBe(accountId)
    expect(store.sessionAccount(tokenHash, Date.now() + 8 * 24 * 60 * 60 * 1000)).toBeNull()
  }, 15_000)

  it('rejects cross-origin writes, malformed JSON, oversized bodies, and forged fields', async () => {
    await request(app).post('/api/words').set('Cookie', cookie).set('Origin', 'https://untrusted.example').send({ text: 'bad', language: 'en' }).expect(403)
    await request(app).post('/api/words').set('Cookie', cookie).send({ text: 'bad', language: 'en' }).expect(403)
    await request(app).post('/api/words').set('Origin', origin).set('Cookie', cookie).set('Content-Type', 'text/plain').send('word').expect(415)
    await request(app).post('/api/words').set('Origin', origin).set('Cookie', cookie).set('Content-Type', 'application/json').send('{broken').expect(400)
    await post('/api/words', { text: 'a'.repeat(20_000), language: 'en' }).expect(413)
    await post('/api/words', { text: 'word', language: 'en', category: 'plus' }).expect(400)
    await post('/api/words', { text: 'word', language: 'xx' }).expect(400)
    await post('/api/words', { text: 'word', language: 'fr' }).expect(409)
    for (const text of ['', ' ', 'a\nb', 'a'.repeat(81)]) await post('/api/words', { text, language: 'en' }).expect(400)
  })

  it('rejects compressed JSON and photo bodies without changing data and keeps serving requests', async () => {
    const before = store.words(accountId)
    const body = Buffer.from(JSON.stringify({ text: 'compressed', language: 'en' }))
    const features = await FeatureFlags.open(join(directory, 'store.json'))
    vi.spyOn(features, 'enabled').mockImplementation(flag => flag === 'challenge-auto-check')
    const server = createApp({ ...options(), features, ocr: { endpoint: 'https://test.cognitiveservices.azure.com', key: 'test-only-key', monthlyLimit: 450 } }).listen(0, '127.0.0.1')
    try {
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Expected a temporary HTTP port.')
      for (const [encoding, compressed] of [
        ['gzip', gzipSync(body)], ['deflate', deflateSync(body)], ['br', brotliCompressSync(body)],
      ] as const) {
        for (const [path, contentType] of [['/api/words', 'application/json'], [`/api/challenges/${randomUUID()}/photo`, 'image/jpeg']]) {
          const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
            method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': contentType, 'Content-Encoding': encoding },
            body: new Uint8Array(compressed),
          })
          expect(response.status).toBe(415)
          expect(await response.json()).toEqual({ error: 'Compressed request bodies are not supported.' })
          await request(server).get('/api/health').expect(200).expect({ ok: true })
        }
      }
      expect(store.words(accountId)).toEqual(before)
    } finally {
      await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()) })
    }
  })

  it('starts words in Default with no attempt, normalizes edges and prevents same-language duplicates', async () => {
    const word = await add('  Schmetterling  ')
    expect(word).toMatchObject({ text: 'Schmetterling', category: 'new', consecutive_mistakes: 0, last_practiced_at: null })
    await post('/api/words', { text: 'schmetterling', language: 'de' }).expect(409)
    await add('Schmetterling', 'en')
    const saved = JSON.parse(await readFile(join(directory, 'store.accounts', `${accountId}.json`), 'utf8'))
    expect(saved.attempts).toHaveLength(0)
  })

  it('applies every confirmed category transition, including first mistake while in plus', async () => {
    const word = await add('Straße')
    expect(await mark(word.id, false)).toMatchObject({ category: 'new', consecutive_mistakes: 1 })
    expect(await mark(word.id, false)).toMatchObject({ category: 'minus', consecutive_mistakes: 2 })
    expect(await mark(word.id, false)).toMatchObject({ category: 'minus', consecutive_mistakes: 2 })
    expect(await mark(word.id, true)).toMatchObject({ category: 'minus', consecutive_mistakes: 0 })
    store = await FileStore.open(join(directory, 'store.json'))
    app = createApp(options())
    expect(await mark(word.id, true)).toMatchObject({ category: 'minus', consecutive_mistakes: 0 })
    expect(await mark(word.id, true)).toMatchObject({ category: 'plus', consecutive_mistakes: 0 })
    expect(await mark(word.id, false)).toMatchObject({ category: 'new', consecutive_mistakes: 1 })
    expect(await mark(word.id, true)).toMatchObject({ category: 'new', consecutive_mistakes: 0 })
    expect(await mark(word.id, true)).toMatchObject({ category: 'new', consecutive_mistakes: 0 })
    expect(await mark(word.id, true)).toMatchObject({ category: 'plus', consecutive_mistakes: 0 })
    expect(await mark(word.id, false)).toMatchObject({ category: 'new', consecutive_mistakes: 1 })
    expect(await mark(word.id, false)).toMatchObject({ category: 'minus', consecutive_mistakes: 2 })
  })

  it('serializes simultaneous device answers and deduplicates simultaneous retries', async () => {
    const word = await add('concurrent', 'en')
    await Promise.all([mark(word.id, false), mark(word.id, false)])
    expect(store.words(accountId).find(item => item.id === word.id)).toMatchObject({ category: 'minus', consecutive_mistakes: 2 })
    const correctAttemptId = randomUUID()
    await Promise.all([mark(word.id, true, correctAttemptId), mark(word.id, true, correctAttemptId)])
    expect(store.words(accountId).find(item => item.id === word.id)).toMatchObject({ category: 'minus', consecutive_mistakes: 0 })
    await mark(word.id, true)
    expect(store.words(accountId).find(item => item.id === word.id)).toMatchObject({ category: 'minus', consecutive_mistakes: 0 })
    await mark(word.id, true)
    const attemptId = randomUUID()
    await Promise.all([mark(word.id, false, attemptId), mark(word.id, false, attemptId)])
    expect(store.words(accountId).find(item => item.id === word.id)).toMatchObject({ category: 'new', consecutive_mistakes: 1 })
    await post('/api/practice', { wordId: word.id, correct: true, attemptId }).expect(409)
  })

  it('keeps words, outcomes, hashed sessions, and retry identifiers across a fresh server/store instance', async () => {
    const word = await add('persistent', 'en')
    const attemptId = randomUUID()
    await mark(word.id, false, attemptId)
    store = await FileStore.open(join(directory, 'store.json'))
    app = createApp(options())
    await request(app).get('/api/words').set('Cookie', cookie).expect(200)
    expect(await mark(word.id, false, attemptId)).toMatchObject({ category: 'new', consecutive_mistakes: 1 })
    expect(await mark(word.id, false)).toMatchObject({ category: 'minus', consecutive_mistakes: 2 })
    const disk = JSON.parse(await readFile(join(directory, 'store.accounts', `${accountId}.json`), 'utf8')) as { words: Word[] }
    expect(disk.words.find(item => item.id === word.id)).toMatchObject({ category: 'minus', consecutive_mistakes: 2 })
  })

  it('removes attempt history when a word is deleted and rejects further marks', async () => {
    const word = await add('delete me', 'en')
    await mark(word.id, false)
    await request(app).delete(`/api/words/${word.id}`).set('Origin', origin).set('Cookie', cookie).send({}).expect(204)
    await post('/api/practice', { wordId: word.id, correct: true, attemptId: randomUUID() }).expect(404)
    const disk = JSON.parse(await readFile(join(directory, 'store.accounts', `${accountId}.json`), 'utf8')) as { attempts: { wordId: string }[] }
    expect(disk.attempts.some(attempt => attempt.wordId === word.id)).toBe(false)
  })

  it('changes password, rotates the cookie, and revokes old sessions and old credentials', async () => {
    const response = await post('/api/password', { currentPassword: password, newPassword: 'a different strong passphrase' }).expect(204)
    await request(app).get('/api/words').set('Cookie', cookie).expect(401)
    cookie = cookieFrom(response)
    await request(app).get('/api/words').set('Cookie', cookie).expect(200)
    await post('/api/login', { email: 'parent@example.com', password }, '').expect(401)
    await post('/api/login', { email: 'parent@example.com', password: 'a different strong passphrase' }, '').expect(200)
    expect(store.account(accountId)).toHaveProperty('email', 'parent@example.com')
  }, 15_000)

  it('never overwrites a corrupt or unsupported store with an empty collection', async () => {
    const file = join(directory, 'broken.json')
    await writeFile(file, '{not valid JSON')
    await expect(FileStore.open(file)).rejects.toThrow('no data has been reset')
    expect(await readFile(file, 'utf8')).toBe('{not valid JSON')
    await writeFile(file, '{"version":99}')
    await expect(FileStore.open(file)).rejects.toThrow('no data has been reset')
  })

  it('recovers a forgotten password without deleting words or leaving active sessions', async () => {
    const wordsBefore = store.words(accountId)
    await store.recoverPassword(accountId, await hashPassword('a recovered secure passphrase'))
    expect(store.words(accountId)).toEqual(wordsBefore)
    await request(app).get('/api/words').set('Cookie', cookie).expect(401)
    await post('/api/login', { email: 'parent@example.com', password: 'a recovered secure passphrase' }, '').expect(200)
  }, 15_000)

  it('rate-limits repeated login attempts', async () => {
    const limited = createApp(options())
    for (let i = 0; i < 10; i++) await request(limited).post('/api/login').set('Origin', origin).send({}).expect(400)
    await request(limited).post('/api/login').set('Origin', origin).send({}).expect(429)
  })

  it('rejects malformed emails for signup and sign-in without creating an account', async () => {
    const fresh = await FileStore.open(join(directory, 'email-validation.json'))
    const validationApp = createApp({ ...options(), store: fresh })
    for (const email of ['parent', 'parent@', 'a'.repeat(255) + '@example.com']) {
      await request(validationApp).post('/api/signup').set('Origin', origin).send({ email, password }).expect(400)
      await request(validationApp).post('/api/login').set('Origin', origin).send({ email, password }).expect(400)
    }
    expect(fresh.findAccount('parent@example.com')).toBeNull()
  })

  it('migrates an existing username only after password verification, preserving data and revoking old sessions', async () => {
    const file = join(directory, 'legacy.json')
    const disk = JSON.parse(await readFile(join(directory, 'store.json'), 'utf8'))
    const oldSessions = [{ tokenHash: createHash('sha256').update(cookie.split('=')[1]).digest('hex'), expiresAt: Date.now() + 60_000 }]
    const account = store.account(accountId)
    const data = JSON.parse(await readFile(join(directory, 'store.accounts', `${accountId}.json`), 'utf8'))
    await writeFile(file, JSON.stringify({ version: 1, words: data.words, attempts: data.attempts, challenges: data.challenges, ocrUsage: disk.ocrUsage, sessions: oldSessions, account: { username: 'old-parent', salt: account.salt, passwordHash: account.passwordHash } }))
    const legacy = await FileStore.open(file)
    const legacyApp = createApp({ ...options(), store: legacy })
    expect((await request(legacyApp).get('/api/session')).body).toEqual({ authenticated: false, emailMigrationRequired: false, email: null })
    const legacyId = legacy.sessionAccount(oldSessions[0].tokenHash)
    if (!legacyId) throw new Error('Expected migrated legacy session.')
    expect((await request(legacyApp).get('/api/session').set('Cookie', cookie)).body).toEqual({ authenticated: true, emailMigrationRequired: true, email: null, websiteLanguage: 'en', onboardingRequired: false })
    await request(legacyApp).get('/api/words').set('Cookie', cookie).expect(200)
    const newcomer = await request(legacyApp).post('/api/signup').set('Origin', origin)
      .send({ email: 'new@example.com', password: 'another independent account passphrase' }).expect(201)
    expect((await request(legacyApp).get('/api/words').set('Cookie', cookieFrom(newcomer)).expect(200)).body).toEqual([])
    expect(legacy.words(legacyId)).toEqual(data.words)
    await request(legacyApp).post('/api/login').set('Origin', origin).send({ email: 'parent@example.com', password: 'incorrect' }).expect(401)
    expect(legacy.account(legacyId)).toHaveProperty('username', 'old-parent')
    const response = await request(legacyApp).post('/api/login').set('Origin', origin)
      .send({ email: ' Parent@Example.com ', password: 'a recovered secure passphrase' }).expect(200)
    expect(response.body).toEqual({ authenticated: true, emailMigrationRequired: false, email: 'parent@example.com', websiteLanguage: 'en', onboardingRequired: false })
    const saved = JSON.parse(await readFile(file, 'utf8'))
    const practice = JSON.parse(await readFile(join(directory, 'legacy.accounts', `${legacyId}.json`), 'utf8'))
    expect(practice.words).toEqual(data.words)
    expect(practice.attempts).toEqual(data.attempts)
    expect(saved.accounts[0].account).not.toHaveProperty('username')
    expect(saved.accounts[0].account.passwordHash).toBe(account.passwordHash)
    expect(saved.sessions).toHaveLength(2)
    const migratedSession = saved.sessions.find((session: { accountId: string }) => session.accountId === legacyId)
    if (!migratedSession) throw new Error('Expected the original account’s replacement session.')
    expect(migratedSession.tokenHash).not.toEqual(oldSessions[0].tokenHash)
    await request(legacyApp).get('/api/words').set('Cookie', cookie).expect(401)
    const restored = await FileStore.open(file)
    expect(restored.account(legacyId)).toHaveProperty('email', 'parent@example.com')
    expect(restored.words(legacyId)).toEqual(store.words(accountId))
    await request(legacyApp).get('/api/words').set('Cookie', cookieFrom(response)).expect(200)
    expect((await request(legacyApp).get('/api/words').set('Cookie', cookieFrom(newcomer)).expect(200)).body).toEqual([])
    await expect(legacy.migrateEmail('different@example.com', migratedSession, account.passwordHash)).rejects.toThrow('already been set')
  }, 15_000)
})
