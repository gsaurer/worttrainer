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
import type { Challenge, Word } from '../shared/model.js'

const origin = 'http://localhost:5173'
const password = 'a private account test passphrase'
let credentials: Awaited<ReturnType<typeof hashPassword>>
let directory: string
let store: FileStore
let app: ReturnType<typeof createApp>
let first: Awaited<ReturnType<typeof seed>>
let second: Awaited<ReturnType<typeof seed>>
let word: Word
let challenge: Challenge

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
  challenge = await store.createChallenge(first.id, [word.id])
  await store.advanceChallenge(first.id, challenge.id, 1, { fromIndex: 0, elapsedMs: 5000, intervalSeconds: 5, automatic: false, action: 'next' })
  await store.saveRecognition(first.id, challenge.id, { answers: [{ number: 1, text: 'Strasse', confidence: 0.99 }], warnings: [] }, { dataUrl: 'data:image/jpeg;base64,aGVsbG8=', uploadedAt: '2026-10-23T10:00:00Z', evaluatedAt: '2026-10-23T10:00:01Z' })
  app = createApp({ store, origin, secureCookie: false })
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('independent private accounts', () => {
  it('exports one coherent complete account snapshot without credentials or another account’s data', async () => {
    await request(app).get('/api/export').expect(401)
    await store.reviewChallenge(first.id, challenge.id, [true], { method: 'photo', spellings: ['Strasse'] })
    const response = await request(app).get('/api/export').query({ accountId: second.id }).set('Cookie', first.cookie).expect(200)
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="worttrainer-\d{4}-\d{2}-\d{2}\.json"$/)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toMatchObject({
      format: 'worttrainer-account-export', schemaVersion: 5, websiteLanguage: 'en',
      languagePreferences: { enabled: ['de', 'en'], defaultLanguage: 'de' },
      account: { id: first.id, email: first.email },
      words: [{ id: word.id, text: word.text, category: 'new' }],
      challenges: [{ id: challenge.id, results: [true], recognition: { answers: [{ text: 'Strasse' }] } }],
      statistics: { correct: 1, incorrect: 0, accuracy: 100 },
    })
    expect(Number.isFinite(Date.parse(response.body.exportedAt))).toBe(true)
    expect(response.body.attempts).toHaveLength(2)
    expect(response.body.attempts[1]).toMatchObject({ wordId: word.id, id: challenge.words[0].attemptId, correct: true })
    expect(Object.keys(response.body).sort()).toEqual(['account', 'attempts', 'challenges', 'exportedAt', 'format', 'languagePreferences', 'schemaVersion', 'statistics', 'websiteLanguage', 'wordLists', 'words'])
    expect(Object.keys(response.body.account).sort()).toEqual(['email', 'id'])
    for (const secret of [credentials.salt, credentials.passwordHash, first.stored.tokenHash, second.email, second.id]) {
      expect(response.text).not.toContain(secret)
    }
    const own = await request(app).get('/api/export').set('Cookie', second.cookie).expect(200)
    expect(own.body).toMatchObject({ account: { id: second.id }, words: [], attempts: [], challenges: [], statistics: { accuracy: null } })
    expect(own.text).not.toContain(first.email)
    const snapshot = store.exportData(first.id)
    snapshot.words[0].text = 'changed copy'
    expect(store.words(first.id)[0].text).toBe(word.text)
    await store.removeSession(first.stored.tokenHash)
    await request(app).get('/api/export').set('Cookie', first.cookie).expect(401)
  })

  it('registers a new empty collection without changing any existing account', async () => {
    const original = store.words(first.id)
    const response = await post('/api/signup', { email: ' NEW@example.com ', password }, '').expect(201)
    expect(response.body).toEqual({ authenticated: true, emailMigrationRequired: false, email: 'new@example.com', websiteLanguage: 'en', onboardingRequired: true })
    expect((await words(cookieFrom(response)).expect(200)).body).toEqual([])
    expect((await request(app).get('/api/challenges').set('Cookie', cookieFrom(response)).expect(200)).body.challenges).toEqual([])
    expect(store.words(first.id)).toEqual(original)
    expect(store.challenges(first.id)).toHaveLength(1)
    expect((await words(first.cookie).expect(200)).body).toEqual(original)
  }, 15_000)

  it.each(['de', 'en'])('completes first setup with ten existing %s demo words, once and privately', async language => {
    const original = store.exportData(first.id)
    await post('/api/onboarding', { language, source: 'demo' }, '').expect(401)
    const response = await post('/api/onboarding', { language, source: 'demo' }).expect(200)
    expect(response.body).toHaveLength(10)
    expect(response.body.every((entry: Word) => entry.language === language && entry.category === 'new' && entry.last_practiced_at === null)).toBe(true)
    expect(store.languagePreferences(second.id)).toEqual({ enabled: [language], defaultLanguage: language })
    expect((await request(app).get('/api/session').set('Cookie', second.cookie)).body.onboardingRequired).toBe(false)
    const retried = await post('/api/onboarding', { language, source: 'demo' }).expect(200)
    expect(retried.body).toEqual(response.body)
    const reopened = await FileStore.open(join(directory, 'store.json'))
    const restarted = createApp({ store: reopened, origin, secureCookie: false })
    expect((await request(restarted).get('/api/session').set('Cookie', second.cookie)).body.onboardingRequired).toBe(false)
    expect(reopened.words(second.id)).toHaveLength(10)
    expect(store.exportData(first.id)).toMatchObject({ words: original.words, attempts: original.attempts, challenges: original.challenges })
    expect(store.challenges(second.id)).toEqual([])
  })

  it('validates ten personal words before changing setup and preserves existing account data', async () => {
    const entries = ['beautiful', 'because', 'friend', 'people', 'different', 'enough', 'thought', 'through', 'which', 'where']
    await post('/api/onboarding', { language: 'fr', source: 'demo' }).expect(400)
    await post('/api/onboarding', { language: 'en', source: 'custom', words: entries.slice(1) }).expect(400)
    await post('/api/onboarding', { language: 'en', source: 'custom', words: entries.map(() => 'duplicate') }).expect(400)
    await post('/api/onboarding', { language: 'en', source: 'custom', words: [...entries.slice(1), 'bad\nword'] }).expect(400)
    await post('/api/onboarding', { language: 'en', source: 'demo', accountId: first.id }).expect(400)
    expect(store.words(second.id)).toEqual([])
    expect(store.languagePreferences(second.id)).toEqual({ enabled: ['de', 'en'], defaultLanguage: 'de' })
    const response = await post('/api/onboarding', { language: 'en', source: 'custom', words: entries }).expect(200)
    expect(response.body.map((entry: Word) => entry.text)).toEqual(entries)
    const file = join(directory, 'store.accounts', `${second.id}.json`)
    const saved = JSON.parse(await readFile(file, 'utf8'))
    delete saved.onboardingRequired
    await writeFile(file, JSON.stringify(saved))
    const reopened = await FileStore.open(join(directory, 'store.json'))
    const existing = createApp({ store: reopened, origin, secureCookie: false })
    expect((await request(existing).get('/api/session').set('Cookie', second.cookie)).body.onboardingRequired).toBe(false)
    expect(reopened.words(second.id).map(entry => entry.text)).toEqual(entries)
  })

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
    expect((await request(app).get('/api/challenges').set('Cookie', second.cookie).expect(200)).body.challenges).toEqual([])
    await post('/api/words', { text: 'word', language: 'en', accountId: first.id }).expect(400)
    await post('/api/challenges', { wordIds: [word.id] }).expect(409)
    await post('/api/challenges', { wordIds: [randomUUID()] }).expect(409)
    await post('/api/practice', { wordId: word.id, correct: true, attemptId: randomUUID() }).expect(404)
    await remove(`/api/words/${word.id}`).expect(404)
    await post(`/api/challenges/${challenge.id}/advance`, { nextIndex: 1, fromIndex: 0, elapsedMs: 5000, intervalSeconds: 5, automatic: false, action: 'next' }).expect(404)
    await post(`/api/challenges/${challenge.id}/review`, { results: [true], check: { method: 'manual', spellings: [word.text] } }).expect(404)
    await request(app).post(`/api/challenges/${challenge.id}/photo`).set('Origin', origin)
      .set('Cookie', second.cookie).set('Content-Type', 'image/png').send(Buffer.from('not a photo')).expect(404)
    await remove(`/api/challenges/${challenge.id}`).expect(404)
    expect(store.words(first.id)).toEqual(original)
    expect(store.challenge(first.id, challenge.id).recognition?.answers[0].text).toBe('Strasse')
    expect(store.challenge(first.id, challenge.id).reviewedAt).toBeNull()
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
    expect(store.words(first.id)[0]).toMatchObject({ category: 'new', consecutive_mistakes: 0 })
    expect(store.words(second.id)[0]).toMatchObject({ category: 'new', consecutive_mistakes: 1 })
    const firstData = JSON.parse(await readFile(join(directory, 'store.accounts', `${first.id}.json`), 'utf8'))
    const secondData = JSON.parse(await readFile(join(directory, 'store.accounts', `${second.id}.json`), 'utf8'))
    expect(firstData.attempts).toHaveLength(2)
    expect(secondData.attempts).toHaveLength(1)
    await remove(`/api/words/${ownWord.id}`).expect(204)
    expect(store.words(second.id)).toEqual([])
    expect(store.words(first.id)).toHaveLength(1)
    expect(store.challenges(first.id)).toHaveLength(1)
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
    expect(store.challenges(first.id)).toHaveLength(1)
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
    const firstStatus = await request(app).get('/api/challenges').set('Cookie', first.cookie).expect(200)
    const secondStatus = await request(app).get('/api/challenges').set('Cookie', second.cookie).expect(200)
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
    const bucket = JSON.parse(await readFile(join(directory, 'store.accounts', `${first.id}.json`), 'utf8'))
    const oldSession = { tokenHash: first.stored.tokenHash, expiresAt: first.stored.expiresAt }
    const legacy = { version: 1, account: disk.accounts[0].account, words: bucket.words, attempts: bucket.attempts, challenges: bucket.challenges, sessions: [oldSession], ocrUsage: { month: new Date().toISOString().slice(0, 7), used: 449 } }
    const source = JSON.stringify(legacy)
    await writeFile(file, source)
    store = await FileStore.open(file)
    const owner = store.findAccount(first.email)
    if (!owner) throw new Error('Expected original account after migration.')
    expect(store.sessionAccount(first.stored.tokenHash)).toBe(owner.id)
    expect(store.words(owner.id)).toEqual(bucket.words)
    expect(store.challenges(owner.id)).toEqual(bucket.challenges)
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
    expect(migrated.version).toBe(3)
    const practice = JSON.parse(await readFile(join(directory, 'legacy.accounts', `${owner.id}.json`), 'utf8'))
    expect(practice.attempts).toEqual(bucket.attempts)
    expect(migrated.accounts[0].account).toEqual(disk.accounts[0].account)
    expect(store.ocrUsage().used).toBe(449)
  }, 15_000)

  it('never overwrites a different backup, but can resume using the matching original', async () => {
    const file = join(directory, 'empty-v1.json')
    const source = JSON.stringify({ version: 1, account: null, words: [], attempts: [], sessions: [] })
    await writeFile(file, source)
    await writeFile(`${file}.v1.bak`, 'older backup')
    await expect(FileStore.open(file)).rejects.toThrow('no data has been reset')
    expect(await readFile(file, 'utf8')).toBe(source)
    expect(await readFile(`${file}.v1.bak`, 'utf8')).toBe('older backup')
    await writeFile(`${file}.v1.bak`, source)
    const migrated = await FileStore.open(file)
    expect(migrated.legacyAccount).toBeNull()
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ version: 3, accounts: [], sessions: [], ocrUsage: { month: null, used: 0 } })
    expect(await readFile(`${file}.v1.bak`, 'utf8')).toBe(source)
  })

  it('rejects orphaned sessions, duplicate emails, and foreign history without replacing stored data', async () => {
    const file = join(directory, 'bad-ownership.json')
    const valid = JSON.parse(await readFile(join(directory, 'store.json'), 'utf8'))
    valid.version = 2
    for (const account of valid.accounts) {
      const data = JSON.parse(await readFile(join(directory, 'store.accounts', `${account.id}.json`), 'utf8'))
      Object.assign(account, { languagePreferences: data.languagePreferences, words: data.words, attempts: data.attempts, challenges: data.challenges })
    }
    for (const corrupt of [
      () => { const data = structuredClone(valid); data.sessions[0].accountId = randomUUID(); return data },
      () => { const data = structuredClone(valid); data.accounts[1].account.email = data.accounts[0].account.email; return data },
      () => { const data = structuredClone(valid); data.accounts[1].attempts = data.accounts[0].attempts; return data },
    ]) {
      const source = JSON.stringify(corrupt())
      await writeFile(file, source)
      await expect(FileStore.open(file)).rejects.toThrow('no data has been reset')
      expect(await readFile(file, 'utf8')).toBe(source)
    }
  })
})
