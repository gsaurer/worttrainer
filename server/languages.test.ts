// @vitest-environment node
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { FileStore } from './store.js'

const origin = 'http://localhost:5173'
let directory: string
let file: string
let store: FileStore
let app: ReturnType<typeof createApp>
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
const post = (path: string, body: object, cookie = first.cookie) => request(app).post(path).set('Origin', origin).set('Cookie', cookie).send(body)
const get = (path: string, cookie = first.cookie) => request(app).get(path).set('Cookie', cookie)

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'worttrainer-languages-'))
  file = join(directory, 'store.json')
  store = await FileStore.open(file)
  first = await seed('first@example.test')
  second = await seed('second@example.test')
  app = createApp({ store, origin, secureCookie: false })
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('account language preferences', () => {
  it('saves the website language in only its account file and syncs it in sessions and exports after restart', async () => {
    const word = await store.addWord(first.id, 'beautiful', 'en')
    const round = await store.createPhotoRound(first.id, [word.id])
    const indexBefore = await readFile(file, 'utf8')
    const otherFile = join(directory, 'store.accounts', `${second.id}.json`)
    const otherBefore = await readFile(otherFile, 'utf8')
    await post('/api/website-language', { websiteLanguage: 'de' }).expect(200).expect({ websiteLanguage: 'de' })
    expect((await get('/api/session')).body.websiteLanguage).toBe('de')
    expect((await get('/api/session', second.cookie)).body.websiteLanguage).toBe('en')
    expect(await readFile(file, 'utf8')).toBe(indexBefore)
    expect(await readFile(otherFile, 'utf8')).toBe(otherBefore)
    const reopened = await FileStore.open(file)
    app = createApp({ store: reopened, origin, secureCookie: false })
    expect((await get('/api/session')).body.websiteLanguage).toBe('de')
    expect((await get('/api/export')).body).toMatchObject({
      schemaVersion: 3, websiteLanguage: 'de',
      languagePreferences: { enabled: ['de', 'en'], defaultLanguage: 'de' },
      words: [word], rounds: [round], attempts: [],
    })
    await post('/api/website-language', { websiteLanguage: 'en' }).expect(200)
    expect((await FileStore.open(file)).websiteLanguage(first.id)).toBe('en')
  })

  it('rejects unauthenticated, cross-origin, unknown language and owner-forging website settings without writing', async () => {
    const accountFile = join(directory, 'store.accounts', `${first.id}.json`)
    const before = await readFile(accountFile, 'utf8')
    await post('/api/website-language', { websiteLanguage: 'de' }, '').expect(401)
    await request(app).post('/api/website-language').set('Origin', 'https://untrusted.example').set('Cookie', first.cookie)
      .send({ websiteLanguage: 'de' }).expect(403)
    for (const input of [{}, { websiteLanguage: 'fr' }, { websiteLanguage: 'DE' }, { websiteLanguage: null }, { websiteLanguage: 'de', accountId: second.id }]) {
      await post('/api/website-language', input).expect(400)
    }
    expect(await readFile(accountFile, 'utf8')).toBe(before)
    expect(store.websiteLanguage(first.id)).toBe('en')
  })

  it('opens older account files in English without rewriting them, and refuses malformed saved website settings', async () => {
    const word = await store.addWord(first.id, 'Straße', 'de')
    const accountFile = join(directory, 'store.accounts', `${first.id}.json`)
    const data = JSON.parse(await readFile(accountFile, 'utf8'))
    delete data.websiteLanguage
    const legacy = JSON.stringify(data)
    await writeFile(accountFile, legacy)
    const reopened = await FileStore.open(file)
    expect(reopened.websiteLanguage(first.id)).toBe('en')
    expect(reopened.words(first.id)).toEqual([word])
    expect(await readFile(accountFile, 'utf8')).toBe(legacy)
    await reopened.setWebsiteLanguage(first.id, 'de')
    expect(JSON.parse(await readFile(accountFile, 'utf8')).websiteLanguage).toBe('de')
    const invalid = JSON.stringify({ ...data, websiteLanguage: 'fr' })
    await writeFile(accountFile, invalid)
    await expect(FileStore.open(file)).rejects.toThrow('no data has been reset')
    expect(await readFile(accountFile, 'utf8')).toBe(invalid)
  })

  it('persists only the signed-in account’s languages, including after restart and in the private export', async () => {
    await request(app).get('/api/languages').expect(401)
    await post('/api/languages', { enabled: ['fr'], defaultLanguage: 'fr' }, '').expect(401)
    await request(app).post('/api/languages').set('Origin', 'https://untrusted.example').set('Cookie', first.cookie)
      .send({ enabled: ['fr'], defaultLanguage: 'fr' }).expect(403)
    const preferences = { enabled: ['fr', 'da'], defaultLanguage: 'fr' }
    await post('/api/languages', preferences).expect(200).expect(preferences)
    expect((await get('/api/languages', second.cookie)).body).toEqual({ enabled: ['de', 'en'], defaultLanguage: 'de' })
    expect((await get(`/api/languages?accountId=${second.id}`)).body).toEqual(preferences)
    const reopened = await FileStore.open(file)
    expect(reopened.languagePreferences(first.id)).toEqual(preferences)
    expect(reopened.languagePreferences(second.id)).toEqual({ enabled: ['de', 'en'], defaultLanguage: 'de' })
    expect((await get('/api/export')).body).toMatchObject({ schemaVersion: 3, websiteLanguage: 'en', languagePreferences: preferences })
    const clone = reopened.languagePreferences(first.id)
    clone.enabled.push('en')
    expect(reopened.languagePreferences(first.id)).toEqual(preferences)
  })

  it('rejects invalid, duplicate, empty, unknown, disabled-default and owner-forging settings without writing them', async () => {
    const before = await readFile(file, 'utf8')
    const practiceBefore = await readFile(join(directory, 'store.accounts', `${first.id}.json`), 'utf8')
    for (const input of [
      { enabled: [], defaultLanguage: 'de' },
      { enabled: ['de', 'de'], defaultLanguage: 'de' },
      { enabled: ['xx'], defaultLanguage: 'xx' },
      { enabled: ['de'], defaultLanguage: 'fr' },
      { enabled: ['fr'], defaultLanguage: 'fr', accountId: second.id },
    ]) await post('/api/languages', input).expect(400)
    expect(await readFile(file, 'utf8')).toBe(before)
    expect(await readFile(join(directory, 'store.accounts', `${first.id}.json`), 'utf8')).toBe(practiceBefore)
  })

  it('supports new languages end to end and preserves disabled-language words, reviews, history and progress', async () => {
    await post('/api/words', { text: 'papillon', language: 'fr' }).expect(409)
    await post('/api/languages', { enabled: ['de', 'fr'], defaultLanguage: 'fr' }).expect(200)
    const word = (await post('/api/words', { text: 'papillon', language: 'fr' }).expect(201)).body
    const round = (await post('/api/photo-rounds', { wordIds: [word.id] }).expect(201)).body
    expect(round.words[0]).toMatchObject({ text: 'papillon', language: 'fr' })
    await post('/api/languages', { enabled: ['de'], defaultLanguage: 'de' }).expect(200)
    await post('/api/words', { text: 'bonjour', language: 'fr' }).expect(409)
    await post('/api/photo-rounds', { wordIds: [word.id] }).expect(409)
    await post(`/api/photo-rounds/${round.id}/advance`, { nextIndex: 1 }).expect(200)
    await post(`/api/photo-rounds/${round.id}/review`, { results: [true] }).expect(200)
    const reopened = await FileStore.open(file)
    expect(reopened.words(first.id)).toEqual([expect.objectContaining({ id: word.id, language: 'fr', category: 'plus' })])
    expect(reopened.photoRound(first.id, round.id).results).toEqual([true])
    const exported = reopened.exportData(first.id)
    expect(exported.attempts).toHaveLength(1)
    expect(exported.statistics).toMatchObject({ correct: 1, accuracy: 100 })
    await post('/api/languages', { enabled: ['fr'], defaultLanguage: 'fr' }).expect(200)
    expect((await get('/api/words')).body[0].id).toBe(word.id)
    await post('/api/photo-rounds', { wordIds: [word.id] }).expect(201)
  })

  it('migrates older version-2 accounts with Deutsch/English defaults and preserves their original data', async () => {
    const word = await store.addWord(first.id, 'Straße', 'de')
    const round = await store.createPhotoRound(first.id, [word.id])
    const data = JSON.parse(await readFile(file, 'utf8'))
    data.version = 2
    for (const account of data.accounts) {
      const practice = JSON.parse(await readFile(join(directory, 'store.accounts', `${account.id}.json`), 'utf8'))
      Object.assign(account, { words: practice.words, attempts: practice.attempts, photoRounds: practice.photoRounds })
    }
    const legacy = JSON.stringify(data)
    const oldFile = join(directory, 'legacy.json')
    await writeFile(oldFile, legacy)
    const reopened = await FileStore.open(oldFile)
    expect(reopened.languagePreferences(first.id)).toEqual({ enabled: ['de', 'en'], defaultLanguage: 'de' })
    expect(reopened.words(first.id)).toEqual([word])
    expect(reopened.photoRounds(first.id)).toEqual([round])
    expect(await readFile(`${oldFile}.v2.bak`, 'utf8')).toBe(legacy)
    await reopened.setLanguagePreferences(first.id, { enabled: ['de', 'fr'], defaultLanguage: 'fr' })
    expect((await FileStore.open(oldFile)).words(first.id)).toEqual([word])
  })

  it('does not replace a store containing malformed saved language preferences', async () => {
    const target = join(directory, 'store.accounts', `${first.id}.json`)
    const data = JSON.parse(await readFile(target, 'utf8'))
    data.languagePreferences = { enabled: [], defaultLanguage: 'de' }
    const invalid = JSON.stringify(data)
    await writeFile(target, invalid)
    await expect(FileStore.open(file)).rejects.toThrow('no data has been reset')
    expect(await readFile(target, 'utf8')).toBe(invalid)
  })
})
