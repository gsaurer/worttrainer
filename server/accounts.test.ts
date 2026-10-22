// @vitest-environment node
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { hashPassword } from './passwords.js'
import { FileStore } from './store.js'
import type { PhotoRound, Word } from '../shared/model.js'

const origin = 'http://localhost:5173'
const password = 'a private account test passphrase'
let credentials: Awaited<ReturnType<typeof hashPassword>>
let directory: string
let store: FileStore
let app: ReturnType<typeof createApp>
let first: Awaited<ReturnType<typeof seed>>
let second: Awaited<ReturnType<typeof seed>>
let word: Word
let round: PhotoRound

function session(accountId: string) {
  const token = randomBytes(32).toString('base64url')
  return { cookie: `worttrainer_session=${token}`, stored: { accountId, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: Date.now() + 60_000 } }
}
async function seed(email: string) {
  const id = randomUUID()
  const login = session(id)
  await store.register({ email, ...credentials }, login.stored)
  return { id, email, ...login }
}
function cookieFrom(response: request.Response) {
  const cookies: unknown = response.headers['set-cookie']
  if (!Array.isArray(cookies) || typeof cookies[0] !== 'string') throw new Error('Expected a session cookie.')
  return cookies[0].split(';')[0]
}
const post = (path: string, body: object, cookie = second.cookie) =>
  request(app).post(path).set('Origin', origin).set('Cookie', cookie).send(body)
const remove = (path: string) =>
  request(app).delete(path).set('Origin', origin).set('Cookie', second.cookie).send({})
const words = (cookie: string) => request(app).get('/api/words').set('Cookie', cookie)

beforeAll(async () => { credentials = await hashPassword(password) }, 15_000)
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'worttrainer-accounts-'))
  store = await FileStore.open(join(directory, 'store.json'))
  first = await seed('first@example.com')
  second = await seed('second@example.com')
  word = await store.addWord(first.id, 'Straße', 'de')
  await store.mark(first.id, word.id, false, randomUUID())
  round = await store.createPhotoRound(first.id, [word.id])
  await store.advancePhotoRound(first.id, round.id, 1)
  await store.saveRecognition(first.id, round.id, { answers: [{ number: 1, text: 'Strasse', confidence: 0.99 }], warnings: [] })
  app = createApp({ store, origin, secureCookie: false })
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('independent private accounts', () => {
  it('registers a new empty collection without changing any existing account', async () => {
    const original = store.words(first.id)
    const response = await post('/api/signup', { email: ' NEW@example.com ', password }, '').expect(201)
    expect(response.body).toEqual({ authenticated: true, emailMigrationRequired: false, email: 'new@example.com' })
    expect((await words(cookieFrom(response)).expect(200)).body).toEqual([])
    expect((await request(app).get('/api/photo-rounds').set('Cookie', cookieFrom(response)).expect(200)).body.rounds).toEqual([])
    expect(store.words(first.id)).toEqual(original)
    expect(store.photoRounds(first.id)).toHaveLength(1)
    expect((await words(first.cookie).expect(200)).body).toEqual(original)
  }, 15_000)

  it('serializes concurrent case-insensitive registrations without duplicate accounts', async () => {
    const responses = await Promise.all([
      post('/api/signup', { email: 'same@example.com', password }, ''),
      post('/api/signup', { email: ' SAME@EXAMPLE.COM ', password }, ''),
    ])
    expect(responses.map(response => response.status).sort()).toEqual([201, 409])
    const disk = JSON.parse(await readFile(join(directory, 'store.json'), 'utf8'))
    expect(disk.accounts).toHaveLength(3)
    const success = responses.find(response => response.status === 201)
    if (!success) throw new Error('Expected one successful registration.')
    expect((await words(cookieFrom(success)).expect(200)).body).toEqual([])
  }, 15_000)

  it('rejects every foreign word and sheet mutation without exposing or altering private data', async () => {
    app = createApp({ store, origin, secureCookie: false, ocr: { endpoint: 'https://test.cognitiveservices.azure.com', key: 'test-only-key', monthlyLimit: 450 } })
    const original = store.words(first.id)
    expect((await words(second.cookie).expect(200)).body).toEqual([])
    expect((await request(app).get('/api/words').query({ accountId: first.id }).set('Cookie', second.cookie).expect(200)).body).toEqual([])
    expect((await request(app).get('/api/photo-rounds').set('Cookie', second.cookie).expect(200)).body.rounds).toEqual([])
    await post('/api/words', { text: 'word', language: 'en', accountId: first.id }).expect(400)
    await post('/api/photo-rounds', { wordIds: [word.id] }).expect(409)
    await post('/api/photo-rounds', { wordIds: [randomUUID()] }).expect(409)
    await post('/api/practice', { wordId: word.id, correct: true, attemptId: randomUUID() }).expect(404)
    await remove(`/api/words/${word.id}`).expect(404)
    await post(`/api/photo-rounds/${round.id}/advance`, { nextIndex: 1 }).expect(404)
    await post(`/api/photo-rounds/${round.id}/review`, { results: [true] }).expect(404)
    await request(app).post(`/api/photo-rounds/${round.id}/photo`).set('Origin', origin)
      .set('Cookie', second.cookie).set('Content-Type', 'image/png').send(Buffer.from('not a photo')).expect(404)
    await remove(`/api/photo-rounds/${round.id}`).expect(404)
    expect(store.words(first.id)).toEqual(original)
    expect(store.photoRound(first.id, round.id).recognition?.answers[0].text).toBe('Strasse')
    expect(store.photoRound(first.id, round.id).reviewedAt).toBeNull()
    expect(store.ocrUsage().used).toBe(0)
  })

  it('keeps duplicate spellings, retries, progress, and deletion independent', async () => {
    const ownWord = (await post('/api/words', { text: word.text, language: word.language }).expect(201)).body as Word
    const attemptId = randomUUID()
    const firstResult = { wordId: word.id, correct: true, attemptId }
    const secondResult = { wordId: ownWord.id, correct: false, attemptId }
    await post('/api/practice', firstResult, first.cookie).expect(200)
    await post('/api/practice', secondResult).expect(200)
    await post('/api/practice', firstResult, first.cookie).expect(200)
    await post('/api/practice', secondResult).expect(200)
    expect(store.words(first.id)[0]).toMatchObject({ category: 'plus', consecutive_mistakes: 0 })
    expect(store.words(second.id)[0]).toMatchObject({ category: 'new', consecutive_mistakes: 1 })
    const disk = JSON.parse(await readFile(join(directory, 'store.json'), 'utf8'))
    expect(disk.accounts[0].attempts).toHaveLength(2)
    expect(disk.accounts[1].attempts).toHaveLength(1)
    await remove(`/api/words/${ownWord.id}`).expect(204)
    expect(store.words(second.id)).toEqual([])
    expect(store.words(first.id)).toHaveLength(1)
    expect(store.photoRounds(first.id)).toHaveLength(1)
  })

  it('scopes password changes, recovery, credentials, and session revocation to the selected account', async () => {
    await post('/api/login', { email: 'unknown@example.com', password }, '').expect(401)
    const response = await post('/api/password', { currentPassword: password, newPassword: 'a new first account passphrase' }, first.cookie).expect(204)
    const updated = cookieFrom(response)
    await words(first.cookie).expect(401)
    await words(updated).expect(200)
    await words(second.cookie).expect(200)
    await post('/api/login', { email: first.email, password }, '').expect(401)
    await post('/api/login', { email: second.email, password }, '').expect(200)
    await store.recoverPassword(first.id, credentials)
    await words(updated).expect(401)
    await words(second.cookie).expect(200)
    const recovered = await post('/api/login', { email: first.email, password }, '').expect(200)
    expect((await words(cookieFrom(recovered)).expect(200)).body).toEqual(store.words(first.id))
    expect(store.photoRounds(first.id)).toHaveLength(1)
  }, 15_000)

  it('retains up to twenty sessions per account, without evicting another account', async () => {
    for (let i = 0; i < 21; i++) await store.addSession(session(first.id).stored, credentials.passwordHash)
    expect(store.sessionAccount(first.stored.tokenHash)).toBeNull()
    expect(store.sessionAccount(second.stored.tokenHash)).toBe(second.id)
    const disk = JSON.parse(await readFile(join(directory, 'store.json'), 'utf8'))
    expect(disk.sessions.filter((item: { accountId: string }) => item.accountId === first.id)).toHaveLength(20)
    expect(disk.sessions.filter((item: { accountId: string }) => item.accountId === second.id)).toHaveLength(1)
  })

  it('shares the persistent OCR ceiling across accounts, rather than granting each a new budget', async () => {
    await store.reserveOcr(1)
    const firstStatus = await request(app).get('/api/photo-rounds').set('Cookie', first.cookie).expect(200)
    const secondStatus = await request(app).get('/api/photo-rounds').set('Cookie', second.cookie).expect(200)
    expect(firstStatus.body.ocr.used).toBe(1)
    expect(secondStatus.body.ocr.used).toBe(1)
    store = await FileStore.open(join(directory, 'store.json'))
    await expect(store.reserveOcr(1)).rejects.toThrow('exhausted')
  })
})

describe('safe versioned ownership migration', () => {
  it('preserves the original account, sessions, history, recognition, and shared quota when other users register', async () => {
    const file = join(directory, 'legacy.json')
    const disk = JSON.parse(await readFile(join(directory, 'store.json'), 'utf8'))
    const bucket = disk.accounts[0]
    const oldSession = { tokenHash: first.stored.tokenHash, expiresAt: first.stored.expiresAt }
    const legacy = { version: 1, account: bucket.account, words: bucket.words, attempts: bucket.attempts, photoRounds: bucket.photoRounds, sessions: [oldSession], ocrUsage: { month: new Date().toISOString().slice(0, 7), used: 449 } }
    const source = JSON.stringify(legacy)
    await writeFile(file, source)
    store = await FileStore.open(file)
    const owner = store.findAccount(first.email)
    if (!owner) throw new Error('Expected original account after migration.')
    expect(store.sessionAccount(first.stored.tokenHash)).toBe(owner.id)
    expect(store.words(owner.id)).toEqual(bucket.words)
    expect(store.photoRounds(owner.id)).toEqual(bucket.photoRounds)
    expect(store.ocrUsage().used).toBe(449)
    expect(await readFile(`${file}.v1.bak`, 'utf8')).toBe(source)
    if (process.platform !== 'win32') expect((await stat(`${file}.v1.bak`)).mode & 0o777).toBe(0o600)
    app = createApp({ store, origin, secureCookie: false })
    const response = await post('/api/signup', { email: 'new@example.com', password }, '').expect(201)
    expect((await words(cookieFrom(response)).expect(200)).body).toEqual([])
    expect((await words(first.cookie).expect(200)).body).toEqual(bucket.words)
    store = await FileStore.open(file)
    expect(store.findAccount(first.email)?.id).toBe(owner.id)
    expect(store.sessionAccount(first.stored.tokenHash)).toBe(owner.id)
    const migrated = JSON.parse(await readFile(file, 'utf8'))
    expect(migrated.version).toBe(2)
    expect(migrated.accounts[0].attempts).toEqual(bucket.attempts)
    expect(migrated.accounts[0].account).toEqual(bucket.account)
    expect(store.ocrUsage().used).toBe(449)
  }, 15_000)

  it('never overwrites a different backup, but can resume using the matching original', async () => {
    const file = join(directory, 'empty-v1.json')
    const source = JSON.stringify({ version: 1, account: null, words: [], attempts: [], sessions: [] })
    await writeFile(file, source)
    await writeFile(`${file}.v1.bak`, 'older backup')
    await expect(FileStore.open(file)).rejects.toThrow('has not been overwritten')
    expect(await readFile(file, 'utf8')).toBe(source)
    expect(await readFile(`${file}.v1.bak`, 'utf8')).toBe('older backup')
    await writeFile(`${file}.v1.bak`, source)
    const migrated = await FileStore.open(file)
    expect(migrated.legacyAccount).toBeNull()
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ version: 2, accounts: [], sessions: [], ocrUsage: { month: null, used: 0 } })
    expect(await readFile(`${file}.v1.bak`, 'utf8')).toBe(source)
  })

  it('rejects orphaned sessions, duplicate emails, and foreign history without replacing stored data', async () => {
    const file = join(directory, 'bad-ownership.json')
    const valid = JSON.parse(await readFile(join(directory, 'store.json'), 'utf8'))
    for (const corrupt of [
      () => { const data = structuredClone(valid); data.sessions[0].accountId = randomUUID(); return data },
      () => { const data = structuredClone(valid); data.accounts[1].account.email = data.accounts[0].account.email; return data },
      () => { const data = structuredClone(valid); data.accounts[1].attempts = data.accounts[0].attempts; return data },
    ]) {
      const source = JSON.stringify(corrupt())
      await writeFile(file, source)
      await expect(FileStore.open(file)).rejects.toThrow('has not been overwritten')
      expect(await readFile(file, 'utf8')).toBe(source)
    }
  })
})
