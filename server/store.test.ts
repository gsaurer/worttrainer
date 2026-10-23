// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileStore } from './store.js'
import { wordResources } from './word-resources.js'

let directory: string
let file: string
let store: FileStore
let first: string
let second: string
const credentials = { salt: '11'.repeat(16), passwordHash: '22'.repeat(64) }
const tokenHash = '33'.repeat(32)
const practiceFile = (id: string, name = 'store') => join(directory, `${name}.accounts`, `${id}.json`)
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'))

async function versionTwo() {
  const index = await json(file)
  return {
    ...index, version: 2,
    accounts: await Promise.all(index.accounts.map(async (identity: { id: string; account: object }) => {
      const data = await json(practiceFile(identity.id))
      return { ...identity, languagePreferences: data.languagePreferences, words: data.words, attempts: data.attempts, photoRounds: data.challenges }
    })),
  }
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'worttrainer-storage-'))
  file = join(directory, 'store.json')
  store = await FileStore.open(file)
  first = randomUUID()
  second = randomUUID()
  await store.register({ email: 'first@example.test', ...credentials }, { accountId: first, tokenHash, expiresAt: Date.now() + 60_000 })
  await store.register({ email: 'second@example.test', ...credentials }, { accountId: second, tokenHash: '44'.repeat(32), expiresAt: Date.now() + 60_000 })
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('one private practice file per account', () => {
  it('remembers only added list sections and their owned words across imports and restarts', async () => {
    const resource = wordResources[0]
    const section = resource.sections[0]
    const existing = await store.addWord(first, section.entries[0].word, resource.language)
    const unrelated = await store.addWord(first, 'Private unrelated spelling', resource.language)
    await store.mark(first, existing.id, true, randomUUID())
    const before = store.exportData(first)
    await store.importWordResource(first, resource.id, [section.id], true)
    const [list] = store.addedWordLists(first)
    expect(list).toMatchObject({ resourceId: resource.id, title: resource.title, language: resource.language, sectionIds: [section.id] })
    expect(list.wordIds).toContain(existing.id)
    expect(list.wordIds).not.toContain(unrelated.id)
    expect(list.wordIds).toHaveLength(new Set(section.entries.map(entry => entry.word.toLowerCase())).size)
    expect(store.words(first).find(word => word.id === existing.id)).toEqual(before.words.find(word => word.id === existing.id))
    expect(store.exportData(first).attempts).toEqual(before.attempts)
    expect(store.addedWordLists(second)).toEqual([])
    await store.importWordResource(first, resource.id, [section.id], true)
    expect(store.addedWordLists(first)).toEqual([list])
    const reopened = await FileStore.open(file)
    expect(reopened.addedWordLists(first)).toEqual([list])
    expect(reopened.exportData(first).wordLists).toEqual([list])
  })

  it('backs up version-two files without inferring imported lists from matching words', async () => {
    const resource = wordResources[0]
    const word = await store.addWord(first, resource.sections[0].entries[0].word, resource.language)
    await store.mark(first, word.id, true, randomUUID())
    const target = practiceFile(first)
    const legacy = await json(target)
    legacy.schemaVersion = 2
    delete legacy.wordLists
    const source = JSON.stringify(legacy, null, 2)
    await writeFile(target, source)
    const reopened = await FileStore.open(file)
    expect(reopened.addedWordLists(first)).toEqual([])
    expect(reopened.words(first)).toEqual(legacy.words)
    expect(reopened.exportData(first).attempts).toEqual(legacy.attempts)
    expect(await readFile(`${target}.v2.bak`, 'utf8')).toBe(source)
    expect(await json(target)).toMatchObject({ schemaVersion: 3, wordLists: [] })
    expect((await FileStore.open(file)).addedWordLists(first)).toEqual([])
    expect(await readFile(`${target}.v2.bak`, 'utf8')).toBe(source)
  })

  it('unions added sections and removes deleted words from list membership', async () => {
    const resource = wordResources.find(resource => resource.id === 'everyday-english')!
    const [firstSection, secondSection] = resource.sections
    await store.importWordResource(first, resource.id, [firstSection.id], false)
    const initial = store.addedWordLists(first)[0]
    await store.importWordResource(first, resource.id, [secondSection.id], false)
    const expanded = store.addedWordLists(first)[0]
    expect(expanded.sectionIds).toEqual([firstSection.id, secondSection.id])
    expect(expanded.wordIds).toEqual(expect.arrayContaining(initial.wordIds))
    expect(expanded.wordIds).toHaveLength(new Set([...firstSection.entries, ...secondSection.entries].map(entry => entry.word.toLowerCase())).size)
    await store.deleteWord(first, initial.wordIds[0])
    expect(store.addedWordLists(first)[0].wordIds).not.toContain(initial.wordIds[0])
    expect((await FileStore.open(file)).addedWordLists(first)).toEqual(store.addedWordLists(first))
  })

  it('rejects list members owned by another account without rewriting the source file', async () => {
    const resource = wordResources[0]
    await store.importWordResource(first, resource.id, [resource.sections[0].id], true)
    const foreign = await store.addWord(second, 'Private word', resource.language)
    const target = practiceFile(first)
    const data = await json(target)
    data.wordLists[0].wordIds.push(foreign.id)
    const source = JSON.stringify(data)
    await writeFile(target, source)
    await expect(FileStore.open(file)).rejects.toThrow()
    expect(await readFile(target, 'utf8')).toBe(source)
  })

  it('migrates legacy account history to challenge naming with an exact backup', async () => {
    const word = await store.addWord(first, 'Straße', 'de')
    const challenge = await store.createChallenge(first, [word.id])
    await store.advanceChallenge(first, challenge.id, 1, { fromIndex: 0, elapsedMs: 5000, intervalSeconds: 5, automatic: false, action: 'next' })
    await store.saveRecognition(first, challenge.id, { answers: [{ number: 1, text: word.text, confidence: 0.9 }], warnings: [] }, { dataUrl: 'data:image/jpeg;base64,aGVsbG8=', uploadedAt: '2026-10-23T10:00:00Z', evaluatedAt: '2026-10-23T10:00:01Z' })
    await store.reviewChallenge(first, challenge.id, [true], { method: 'photo', spellings: [word.text] })
    const before = store.exportData(first)
    const target = practiceFile(first)
    const source = JSON.stringify({
      format: 'worttrainer-account-data', schemaVersion: 1, accountId: first,
      languagePreferences: before.languagePreferences, websiteLanguage: before.websiteLanguage,
      words: before.words, attempts: before.attempts, photoRounds: before.challenges,
    })
    await writeFile(target, source)
    const migrated = await FileStore.open(file)
    expect(migrated.exportData(first)).toMatchObject({ words: before.words, attempts: before.attempts })
    expect(migrated.challenges(first)).toEqual(before.challenges)
    expect(await readFile(`${target}.v1.bak`, 'utf8')).toBe(source)
    const current = await json(target)
    expect(current.schemaVersion).toBe(3)
    expect(current.challenges).toEqual(before.challenges)
    expect(current).not.toHaveProperty('photoRounds')
    const persisted = await readFile(target, 'utf8')
    await FileStore.open(file)
    expect(await readFile(target, 'utf8')).toBe(persisted)
    expect(await readFile(`${target}.v1.bak`, 'utf8')).toBe(source)
  })

  it('refuses conflicting legacy challenge fields without rewriting account data', async () => {
    const target = practiceFile(first)
    const source = JSON.stringify({ ...await json(target), schemaVersion: 1, photoRounds: [] })
    await writeFile(target, source)
    await expect(FileStore.open(file)).rejects.toThrow(target)
    expect(await readFile(target, 'utf8')).toBe(source)
    expect(await readdir(join(directory, 'store.accounts'))).not.toContain(`${first}.json.v1.bak`)
  })

  it('refuses a conflicting legacy account backup without replacing either file', async () => {
    const target = practiceFile(first)
    const { challenges, ...data } = await json(target)
    const source = JSON.stringify({ ...data, schemaVersion: 1, photoRounds: challenges })
    await writeFile(target, source)
    await writeFile(`${target}.v1.bak`, 'different backup')
    await expect(FileStore.open(file)).rejects.toThrow(target)
    expect(await readFile(target, 'utf8')).toBe(source)
    expect(await readFile(`${target}.v1.bak`, 'utf8')).toBe('different backup')
  })

  it('stores all practice data together, without credentials, identities or another account’s records', async () => {
    const word = await store.addWord(first, 'Straße', 'de')
    await store.addWord(second, 'private second word', 'en')
    await store.setLanguagePreferences(first, { enabled: ['de', 'fr'], defaultLanguage: 'fr' })
    const challenge = await store.createChallenge(first, [word.id])
    await store.advanceChallenge(first, challenge.id, 1, { fromIndex: 0, elapsedMs: 5000, intervalSeconds: 5, automatic: false, action: 'next' })
    await store.saveRecognition(first, challenge.id, { answers: [{ number: 1, text: 'Strasse', confidence: 0.9 }], warnings: [] }, { dataUrl: 'data:image/jpeg;base64,aGVsbG8=', uploadedAt: '2026-10-23T10:00:00Z', evaluatedAt: '2026-10-23T10:00:01Z' })
    await store.reviewChallenge(first, challenge.id, [true], { method: 'photo', spellings: ['Strasse'] })
    const index = await json(file)
    expect(index.version).toBe(3)
    expect(index.accounts).toEqual([
      { id: first, account: { email: 'first@example.test', ...credentials } },
      { id: second, account: { email: 'second@example.test', ...credentials } },
    ])
    const text = await readFile(practiceFile(first), 'utf8')
    const data = JSON.parse(text)
    expect(Object.keys(data).sort()).toEqual(['accountId', 'attempts', 'challenges', 'format', 'languagePreferences', 'schemaVersion', 'websiteLanguage', 'wordLists', 'words'])
    expect(data).toMatchObject({
      format: 'worttrainer-account-data', schemaVersion: 3, accountId: first,
      languagePreferences: { enabled: ['de', 'fr'], defaultLanguage: 'fr' },
      words: [{ id: word.id, category: 'new' }],
      attempts: [{ id: challenge.words[0].attemptId, correct: true }],
      challenges: [{ id: challenge.id, results: [true], recognition: { answers: [{ text: 'Strasse' }] } }],
    })
    for (const secret of [credentials.salt, credentials.passwordHash, tokenHash, 'first@example.test', 'second@example.test', 'private second word', second]) {
      expect(text).not.toContain(secret)
    }
    for (const practice of ['Straße', 'Strasse', 'languagePreferences', 'attempts', 'challenges']) {
      expect(await readFile(file, 'utf8')).not.toContain(practice)
    }
    expect((await readdir(join(directory, 'store.accounts'))).sort()).toEqual([`${first}.json`, `${second}.json`].sort())
    if (process.platform !== 'win32') {
      expect((await stat(practiceFile(first))).mode & 0o777).toBe(0o600)
      expect((await stat(join(directory, 'store.accounts'))).mode & 0o777).toBe(0o700)
    }
    const reopened = await FileStore.open(file)
    expect(reopened.exportData(first)).toMatchObject({
      schemaVersion: 5, websiteLanguage: 'en', words: data.words, attempts: data.attempts, challenges: data.challenges, wordLists: [],
      languagePreferences: data.languagePreferences, statistics: { correct: 1, accuracy: 100 },
    })
    expect(reopened.sessionAccount(tokenHash)).toBe(first)
  })

  it('rewrites only the affected file for practice, authentication and shared quota changes', async () => {
    const indexBefore = await stat(file, { bigint: true })
    const secondBefore = await stat(practiceFile(second), { bigint: true })
    await Promise.all([
      store.addWord(first, 'Baum', 'de'),
      store.setLanguagePreferences(first, { enabled: ['fr', 'de'], defaultLanguage: 'fr' }),
    ])
    expect((await stat(file, { bigint: true })).ino).toBe(indexBefore.ino)
    expect((await stat(practiceFile(second), { bigint: true })).ino).toBe(secondBefore.ino)
    expect(await json(practiceFile(first))).toMatchObject({
      words: [{ text: 'Baum' }], languagePreferences: { defaultLanguage: 'fr' },
    })
    const practiceBefore = await readFile(practiceFile(first), 'utf8')
    const practiceStat = await stat(practiceFile(first), { bigint: true })
    await store.recoverPassword(first, { salt: '55'.repeat(16), passwordHash: '66'.repeat(64) })
    await store.reserveOcr(450)
    expect(await readFile(practiceFile(first), 'utf8')).toBe(practiceBefore)
    expect((await stat(practiceFile(first), { bigint: true })).ino).toBe(practiceStat.ino)
    expect((await stat(practiceFile(second), { bigint: true })).ino).toBe(secondBefore.ino)
    const reopened = await FileStore.open(file)
    expect(reopened.account(first).passwordHash).toBe('66'.repeat(64))
    expect(reopened.words(first)).toHaveLength(1)
    expect(reopened.languagePreferences(first).defaultLanguage).toBe('fr')
    expect(reopened.sessionAccount(tokenHash)).toBeNull()
    expect(reopened.ocrUsage().used).toBe(1)
  })

  it('does not publish failed account writes, removes temporary files, and releases the write queue', async () => {
    const target = practiceFile(first)
    const source = await readFile(target, 'utf8')
    await rename(target, `${target}.saved`)
    await mkdir(target)
    await expect(store.addWord(first, 'not saved', 'de')).rejects.toThrow()
    expect(store.words(first)).toEqual([])
    expect(await readFile(`${target}.saved`, 'utf8')).toBe(source)
    expect((await readdir(join(directory, 'store.accounts'))).some(name => name.endsWith('.tmp'))).toBe(false)
    await rmdir(target)
    await rename(`${target}.saved`, target)
    await store.addWord(first, 'saved retry', 'de')
    expect((await FileStore.open(file)).words(first)[0].text).toBe('saved retry')
  })

  it('publishes new identities only after their account file, and safely retries a failed index write', async () => {
    const id = randomUUID()
    const account = { email: 'new@example.test', ...credentials }
    const session = { accountId: id, tokenHash: '77'.repeat(32), expiresAt: Date.now() + 60_000 }
    const original = await readFile(file, 'utf8')
    await rename(file, `${file}.saved`)
    await mkdir(file)
    await expect(store.register(account, session)).rejects.toThrow()
    expect(store.findAccount(account.email)).toBeNull()
    expect(store.sessionAccount(session.tokenHash)).toBeNull()
    expect((await json(practiceFile(id))).accountId).toBe(id)
    expect(await readFile(`${file}.saved`, 'utf8')).toBe(original)
    expect((await readdir(directory)).some(name => name.endsWith('.tmp'))).toBe(false)
    await rmdir(file)
    await rename(`${file}.saved`, file)
    expect((await FileStore.open(file)).findAccount(account.email)).toBeNull()
    await store.register(account, session)
    const reopened = await FileStore.open(file)
    expect(reopened.findAccount(account.email)?.id).toBe(id)
    expect(reopened.words(id)).toEqual([])
  })

  it('rejects missing, malformed and mismatched account files instead of resetting private data', async () => {
    const target = practiceFile(first)
    const original = await readFile(target, 'utf8')
    const index = await readFile(file, 'utf8')
    for (const content of ['{broken', JSON.stringify({ ...JSON.parse(original), accountId: second }), JSON.stringify({ ...JSON.parse(original), schemaVersion: 99 })]) {
      await writeFile(target, content)
      await expect(FileStore.open(file)).rejects.toThrow(target)
      expect(await readFile(target, 'utf8')).toBe(content)
      expect(await readFile(file, 'utf8')).toBe(index)
    }
    await rm(target)
    await expect(FileStore.open(file)).rejects.toThrow(target)
    expect(await readFile(file, 'utf8')).toBe(index)
    await writeFile(target, original)
    await rm(file)
    await expect(FileStore.open(file)).rejects.toThrow('Missing account index')
    expect(await readFile(target, 'utf8')).toBe(original)
  })

  it('migrates version 2 with exact backups and preserves account IDs, passwords, history, sessions and quota', async () => {
    const word = await store.addWord(first, 'bonjour', 'en')
    await store.mark(first, word.id, false, randomUUID())
    await store.setLanguagePreferences(first, { enabled: ['fr', 'en'], defaultLanguage: 'fr' })
    await store.reserveOcr(450)
    const source = JSON.stringify(await versionTwo())
    const legacy = join(directory, 'old.json')
    await writeFile(legacy, source)
    const migrated = await FileStore.open(legacy)
    expect(await readFile(`${legacy}.v2.bak`, 'utf8')).toBe(source)
    expect((await json(legacy)).version).toBe(3)
    expect(migrated.words(first)).toEqual(store.words(first))
    expect(migrated.languagePreferences(first)).toEqual(store.languagePreferences(first))
    expect(migrated.exportData(first).attempts).toEqual(store.exportData(first).attempts)
    expect(migrated.account(first)).toEqual(store.account(first))
    expect(migrated.sessionAccount(tokenHash)).toBe(first)
    expect(migrated.ocrUsage()).toEqual(store.ocrUsage())
    expect(migrated.words(second)).toEqual([])
    const indexBefore = await readFile(legacy, 'utf8')
    await FileStore.open(legacy)
    expect(await readFile(legacy, 'utf8')).toBe(indexBefore)
    if (process.platform !== 'win32') expect((await stat(`${legacy}.v2.bak`)).mode & 0o777).toBe(0o600)
  })

  it('resumes a partial migration without overwriting staged account data', async () => {
    const source = JSON.stringify(await versionTwo())
    const legacy = join(directory, 'partial.json')
    await writeFile(legacy, source)
    await mkdir(practiceFile(second, 'partial'), { recursive: true })
    await expect(FileStore.open(legacy)).rejects.toThrow('no data has been reset')
    expect(await readFile(legacy, 'utf8')).toBe(source)
    expect(await readFile(`${legacy}.v2.bak`, 'utf8')).toBe(source)
    const staged = await readFile(practiceFile(first, 'partial'), 'utf8')
    await rmdir(practiceFile(second, 'partial'))
    const migrated = await FileStore.open(legacy)
    expect(migrated.findAccount('first@example.test')?.id).toBe(first)
    expect(await readFile(practiceFile(first, 'partial'), 'utf8')).toBe(staged)
    expect((await json(legacy)).version).toBe(3)
  })

  it('refuses conflicting backups and account files without replacing either copy', async () => {
    const source = JSON.stringify(await versionTwo())
    const legacy = join(directory, 'conflict.json')
    await writeFile(legacy, source)
    await writeFile(`${legacy}.v2.bak`, 'different backup')
    await expect(FileStore.open(legacy)).rejects.toThrow('backup differs')
    expect(await readFile(`${legacy}.v2.bak`, 'utf8')).toBe('different backup')
    expect(await readFile(legacy, 'utf8')).toBe(source)
    await writeFile(`${legacy}.v2.bak`, source)
    await mkdir(join(directory, 'conflict.accounts'))
    const conflicting = { ...await json(practiceFile(first)), languagePreferences: { enabled: ['fr'], defaultLanguage: 'fr' } }
    const text = JSON.stringify(conflicting)
    await writeFile(practiceFile(first, 'conflict'), text)
    await expect(FileStore.open(legacy)).rejects.toThrow('differs from the migration')
    expect(await readFile(practiceFile(first, 'conflict'), 'utf8')).toBe(text)
    expect(await readFile(legacy, 'utf8')).toBe(source)
  })
})
