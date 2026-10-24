// @vitest-environment node
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { FileStore } from './store.js'
import { resourceCatalogSchema, wordResources } from './word-resources.js'

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

describe('centrally managed word resources', () => {
  it('loads every server-defined word list from an individual JSON configuration', async () => {
    const directory = new URL('./word-lists/', import.meta.url)
    const files = (await readdir(directory)).filter(file => file.endsWith('.json')).sort()
    const configurations = await Promise.all(files.map(async file => JSON.parse(await readFile(new URL(file, directory), 'utf8'))))
    expect(files).toEqual(wordResources.map(resource => `${resource.id}.json`).sort())
    expect(files).toContain('more-book-3.json')
    expect(resourceCatalogSchema.parse(configurations)).toEqual(wordResources)
  })

  const bookUnits = [
    { unit: 1, count: 40, firstWord: 'to give sth. a try', lastWord: 'Me neither.', untranslated: 7 },
    { unit: 2, count: 42, firstWord: 'to buy sth.', lastWord: 'to try out', untranslated: 7 },
    { unit: 3, count: 54, firstWord: 'to get to (the airport)', lastWord: 'to recommend', untranslated: 19 },
    { unit: 4, count: 46, firstWord: 'poisonous', lastWord: 'politician', untranslated: 9 },
    { unit: 5, count: 41, firstWord: 'to be unlucky', lastWord: 'seriously', untranslated: 8 },
    { unit: 6, count: 45, firstWord: 'park', lastWord: 'to sign', untranslated: 11 },
    { unit: 7, count: 34, firstWord: 'to fall out with sb.', lastWord: 'unwell', untranslated: 6 },
    { unit: 8, count: 47, firstWord: 'to invent', lastWord: 'to support', untranslated: 8 },
    { unit: 9, count: 39, firstWord: 'to dye your hair', lastWord: 'to sort out', untranslated: 16 },
    { unit: 10, count: 53, firstWord: 'to hand out leaflets', lastWord: 'organisation', untranslated: 12 },
    { unit: 11, count: 37, firstWord: 'canyon', lastWord: 'totally', untranslated: 8 },
    { unit: 12, count: 50, firstWord: 'drought', lastWord: 'to collapse', untranslated: 16 },
    { unit: 13, count: 34, firstWord: 'to make up your mind', lastWord: 'to wrap', untranslated: 6 },
    { unit: 14, count: 37, firstWord: 'to plan a trip', lastWord: 'crash', untranslated: 10 },
  ]
  it.each(bookUnits)('offers and imports only MORE! Book 3 Unit $unit', async ({ unit, count, firstWord, lastWord, untranslated = 0 }) => {
    const resources = resourceCatalogSchema.parse((await get('/api/word-resources').expect(200)).body)
    const resource = resources.find(resource => resource.id === 'more-book-3')
    expect(resource).toBeDefined()
    expect(resource?.title).toBe('MORE! Book 3')
    expect(resource?.language).toBe('en')
    expect(resource?.sections.map(section => section.id)).toEqual(bookUnits.map(({ unit }) => `unit-${unit}`))
    const section = resource?.sections.find(section => section.id === `unit-${unit}`)
    expect(section?.title).toBe(`Unit ${unit}`)
    expect(section?.entries).toHaveLength(count)
    expect(section?.entries[0].word).toBe(firstWord)
    expect(section?.entries.at(-1)?.word).toBe(lastWord)
    expect(section?.entries.every(entry => entry.sentence.length > 0 && entry.translations.length <= 1 && entry.translations.every(translation => translation.language === 'de'))).toBe(true)
    expect(section?.entries.filter(entry => entry.translations.length === 0)).toHaveLength(untranslated)
    expect(store.words(first.id)).toEqual([])
    const input = { resourceId: 'more-book-3', sectionIds: [`unit-${unit}`], enableLanguage: false }
    await post('/api/word-resources/import', input).expect(200).expect({ added: count, existing: 0, language: 'en' })
    expect(store.words(first.id).map(word => word.text)).toEqual(section?.entries.map(entry => entry.word))
    expect(store.practiceWordLists(first.id)[0].sections).toEqual([{
      id: `unit-${unit}`, title: `Unit ${unit}`, wordIds: store.words(first.id).map(word => word.id),
    }])
    await post('/api/word-resources/import', input).expect(200).expect({ added: 0, existing: count, language: 'en' })
    expect(store.words(second.id)).toEqual([])
  })

  it('imports the complete MORE! Book 3 without duplicating shared words or resetting progress', async () => {
    const resource = wordResources.find(resource => resource.id === 'more-book-3')!
    await post('/api/word-resources/import', {
      resourceId: resource.id, sectionIds: ['unit-7'], enableLanguage: false,
    }).expect(200).expect({ added: 34, existing: 0, language: 'en' })
    const sharedWord = store.words(first.id).find(word => word.text === 'to move')!
    await store.mark(first.id, sharedWord.id, true, randomUUID())
    const before = store.words(first.id).find(word => word.id === sharedWord.id)
    const entries = resource.sections.flatMap(section => section.entries)
    expect(entries).toHaveLength(599)
    const unique = new Set(entries.map(entry => entry.word.toLowerCase())).size
    expect(unique).toBe(597)
    const input = { resourceId: resource.id, sectionIds: resource.sections.map(section => section.id), enableLanguage: false }
    await post('/api/word-resources/import', input).expect(200).expect({ added: unique - 34, existing: 34, language: 'en' })
    expect(store.words(first.id)).toHaveLength(unique)
    expect(store.words(first.id).find(word => word.id === sharedWord.id)).toEqual(before)
    expect(store.exportData(first.id).attempts).toHaveLength(1)
    const list = store.practiceWordLists(first.id)[0]
    expect(list.sections).toHaveLength(14)
    for (const sectionId of ['unit-7', 'unit-13']) {
      expect(list.sections.find(section => section.id === sectionId)?.wordIds).toContain(sharedWord.id)
    }
    const sharedActivity = store.words(first.id).find(word => word.text === 'to try out')!
    for (const sectionId of ['unit-2', 'unit-8']) {
      expect(list.sections.find(section => section.id === sectionId)?.wordIds).toContain(sharedActivity.id)
    }
    await post('/api/word-resources/import', input).expect(200).expect({ added: 0, existing: unique, language: 'en' })
    expect(store.words(second.id)).toEqual([])
  })

  it.each([
    { unit: 4, previousPageLast: 'cuddly', nextPageFirst: 'cub' },
    { unit: 5, previousPageLast: 'to believe in superstitions', nextPageFirst: 'alarm clock' },
    { unit: 6, previousPageLast: 'shopping centre', nextPageFirst: 'stadium' },
    { unit: 8, previousPageLast: 'invention', nextPageFirst: 'crowd' },
    { unit: 10, previousPageLast: 'compromise', nextPageFirst: 'Good point.' },
  ])('merges continuation pages in order into a single Unit $unit section', ({ unit, previousPageLast, nextPageFirst }) => {
    const sections = wordResources.find(resource => resource.id === 'more-book-3')?.sections.filter(section => section.id === `unit-${unit}`)
    expect(sections).toHaveLength(1)
    const words = sections?.[0].entries.map(entry => entry.word) ?? []
    const boundary = words.indexOf(previousPageLast)
    expect(boundary).toBeGreaterThanOrEqual(0)
    expect(words.slice(boundary, boundary + 2)).toEqual([previousPageLast, nextPageFirst])
  })

  it.each([
    { id: 'demo-deutsche-stolperwoerter', language: 'de' },
    { id: 'demo-english-spelling-traps', language: 'en' },
  ])('offers 50 unique spelling-trap words in the $language demo list', async ({ id, language }) => {
    const resources = wordResources.filter(resource => resource.id === id)
    expect(resources).toHaveLength(1)
    const resource = resources[0]
    expect(resource.language).toBe(language)
    expect(resource.sections).toHaveLength(5)
    expect(resource.sections.every(section => section.entries.length === 10)).toBe(true)
    const entries = resource.sections.flatMap(section => section.entries)
    expect(entries).toHaveLength(50)
    expect(new Set(entries.map(entry => entry.word.toLocaleLowerCase(language))).size).toBe(50)
    await post('/api/word-resources/import', {
      resourceId: id, sectionIds: resource.sections.map(section => section.id), enableLanguage: false,
    }).expect(200).expect({ added: 50, existing: 0, language })
    expect(store.words(first.id)).toHaveLength(50)
  })

  it('validates resources, sections, sentences and multilingual translations', () => {
    expect(resourceCatalogSchema.parse(wordResources)).toEqual(wordResources)
    const resource = wordResources[0]
    expect(resourceCatalogSchema.safeParse([resource, resource]).success).toBe(false)
    expect(resourceCatalogSchema.safeParse([{ ...resource, sections: [resource.sections[0], resource.sections[0]] }]).success).toBe(false)
    expect(resourceCatalogSchema.safeParse([{ ...resource, language: 'unknown' }]).success).toBe(false)
    const entry = resource.sections[0].entries[0]
    for (const invalid of [{ ...entry, word: 'two\nlines' }, { ...entry, sentence: '' }, { ...entry, translations: [{ language: 'unknown', word: 'test' }] }]) {
      expect(resourceCatalogSchema.safeParse([{ ...resource, sections: [{ ...resource.sections[0], entries: [invalid] }] }]).success).toBe(false)
    }
  })

  it('imports selected sections privately, preserves existing progress and survives retry and restart', async () => {
    const existing = await store.addWord(first.id, 'BOOK', 'en')
    await store.mark(first.id, existing.id, true, randomUUID())
    const before = store.words(first.id)[0]
    const otherFile = join(directory, 'store.accounts', `${second.id}.json`)
    const otherBefore = await readFile(otherFile, 'utf8')
    const indexBefore = await readFile(file, 'utf8')
    const catalog = (await get('/api/word-resources').expect(200)).body
    expect(catalog).toEqual(wordResources)
    const input = { resourceId: 'everyday-english', sectionIds: ['at-school'], enableLanguage: false }
    await post('/api/word-resources/import', input).expect(200).expect({ added: 4, existing: 1, language: 'en' })
    await post('/api/word-resources/import', input).expect(200).expect({ added: 0, existing: 5, language: 'en' })
    const lists = (await get('/api/word-lists').expect(200)).body
    expect(lists).toEqual([{
      resourceId: 'everyday-english', title: expect.any(String), language: 'en', sectionIds: ['at-school'],
      wordIds: expect.arrayContaining([existing.id]),
      sections: [{ id: 'at-school', title: expect.any(String), wordIds: expect.arrayContaining([existing.id]) }],
    }])
    expect(lists[0].wordIds).toHaveLength(5)
    expect(lists[0].sections[0].wordIds).toHaveLength(5)
    await get('/api/word-lists', second.cookie).expect(200).expect([])
    expect((await get(`/api/word-lists?accountId=${second.id}`)).body).toEqual(lists)
    const reopened = await FileStore.open(file)
    expect(reopened.practiceWordLists(first.id)).toEqual(lists)
    expect(reopened.words(first.id)).toHaveLength(5)
    expect(reopened.words(first.id).find(word => word.id === existing.id)).toEqual(before)
    expect(reopened.words(first.id).some(word => word.text === 'house')).toBe(false)
    expect(reopened.exportData(first.id).attempts).toHaveLength(1)
    expect(reopened.exportData(first.id).words).toEqual(reopened.words(first.id))
    expect(reopened.words(second.id)).toEqual([])
    expect(await readFile(otherFile, 'utf8')).toBe(otherBefore)
    expect(await readFile(file, 'utf8')).toBe(indexBefore)
  })

  it('requires explicit language enablement and keeps concurrent imports duplicate-free', async () => {
    const input = { resourceId: 'premiers-mots', sectionIds: ['a-la-maison', 'dans-le-jardin'], enableLanguage: false }
    await post('/api/word-resources/import', input).expect(409)
    expect(store.words(first.id)).toEqual([])
    expect(store.languagePreferences(first.id).enabled).not.toContain('fr')
    const responses = await Promise.all([post('/api/word-resources/import', { ...input, enableLanguage: true }), post('/api/word-resources/import', { ...input, enableLanguage: true })])
    expect(responses.map(response => response.status)).toEqual([200, 200])
    expect(responses.reduce((total, response) => total + response.body.added, 0)).toBe(10)
    expect(store.words(first.id)).toHaveLength(10)
    expect(store.words(first.id).every(word => word.language === 'fr' && word.category === 'new')).toBe(true)
    expect(store.languagePreferences(first.id)).toEqual({ enabled: ['de', 'en', 'fr'], defaultLanguage: 'de' })
    expect(store.languagePreferences(second.id).enabled).not.toContain('fr')
  })

  it('rejects unauthenticated, forged, invalid, foreign-section and cross-origin imports without writes', async () => {
    const input = { resourceId: 'everyday-english', sectionIds: ['at-school'], enableLanguage: false }
    const accountFile = join(directory, 'store.accounts', `${first.id}.json`)
    const before = await readFile(accountFile, 'utf8')
    await request(app).get('/api/word-resources').expect(401)
    await request(app).get('/api/word-lists').expect(401)
    await post('/api/word-resources/import', input, '').expect(401)
    await request(app).post('/api/word-resources/import').set('Origin', 'https://untrusted.example').set('Cookie', first.cookie).send(input).expect(403)
    await post('/api/word-resources/import', { ...input, resourceId: 'missing' }).expect(404)
    for (const invalid of [
      { ...input, sectionIds: [] }, { ...input, sectionIds: ['at-school', 'at-school'] },
      { ...input, sectionIds: ['a-la-maison'] }, { ...input, sectionIds: ['at-school', 'missing'] },
      { ...input, accountId: second.id }, { ...input, words: [{ word: 'forged' }] },
      { ...input, enableLanguage: 'yes' },
    ]) await post('/api/word-resources/import', invalid).expect(400)
    expect(await readFile(accountFile, 'utf8')).toBe(before)
  })
})

describe('account language preferences', () => {
  it('saves the website language in only its account file and syncs it in sessions and exports after restart', async () => {
    const word = await store.addWord(first.id, 'beautiful', 'en')
    const challenge = await store.createChallenge(first.id, [word.id])
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
      schemaVersion: 5, websiteLanguage: 'de',
      languagePreferences: { enabled: ['de', 'en'], defaultLanguage: 'de' },
      words: [word], challenges: [challenge], attempts: [],
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
    expect((await get('/api/export')).body).toMatchObject({ schemaVersion: 5, websiteLanguage: 'en', languagePreferences: preferences })
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
    const challenge = (await post('/api/challenges', { wordIds: [word.id] }).expect(201)).body
    expect(challenge.words[0]).toMatchObject({ text: 'papillon', language: 'fr' })
    await post('/api/languages', { enabled: ['de'], defaultLanguage: 'de' }).expect(200)
    await post('/api/words', { text: 'bonjour', language: 'fr' }).expect(409)
    await post('/api/challenges', { wordIds: [word.id] }).expect(409)
    await post(`/api/challenges/${challenge.id}/advance`, { nextIndex: 1, fromIndex: 0, elapsedMs: 5000, intervalSeconds: 5, automatic: false, action: 'next' }).expect(200)
    await post(`/api/challenges/${challenge.id}/review`, { results: [true], check: { method: 'manual', spellings: ['papillon'] } }).expect(200)
    const reopened = await FileStore.open(file)
    expect(reopened.words(first.id)).toEqual([expect.objectContaining({ id: word.id, language: 'fr', category: 'new' })])
    expect(reopened.challenge(first.id, challenge.id).results).toEqual([true])
    const exported = reopened.exportData(first.id)
    expect(exported.attempts).toHaveLength(1)
    expect(exported.statistics).toMatchObject({ correct: 1, accuracy: 100 })
    await post('/api/languages', { enabled: ['fr'], defaultLanguage: 'fr' }).expect(200)
    expect((await get('/api/words')).body[0].id).toBe(word.id)
    await post('/api/challenges', { wordIds: [word.id] }).expect(201)
  })

  it('migrates older version-2 accounts with Deutsch/English defaults and preserves their original data', async () => {
    const word = await store.addWord(first.id, 'Straße', 'de')
    const challenge = await store.createChallenge(first.id, [word.id])
    const data = JSON.parse(await readFile(file, 'utf8'))
    data.version = 2
    for (const account of data.accounts) {
      const practice = JSON.parse(await readFile(join(directory, 'store.accounts', `${account.id}.json`), 'utf8'))
      Object.assign(account, { words: practice.words, attempts: practice.attempts, challenges: practice.challenges })
    }
    const legacy = JSON.stringify(data)
    const oldFile = join(directory, 'legacy.json')
    await writeFile(oldFile, legacy)
    const reopened = await FileStore.open(oldFile)
    expect(reopened.languagePreferences(first.id)).toEqual({ enabled: ['de', 'en'], defaultLanguage: 'de' })
    expect(reopened.words(first.id)).toEqual([word])
    expect(reopened.challenges(first.id)).toEqual([challenge])
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
