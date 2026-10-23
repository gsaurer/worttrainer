// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileStore } from './store.js'

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
      return { ...identity, languagePreferences: data.languagePreferences, words: data.words, attempts: data.attempts, photoRounds: data.photoRounds }
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
  it('stores all practice data together, without credentials, identities or another account’s records', async () => {
    const word = await store.addWord(first, 'Straße', 'de')
    await store.addWord(second, 'private second word', 'en')
    await store.setLanguagePreferences(first, { enabled: ['de', 'fr'], defaultLanguage: 'fr' })
    const round = await store.createPhotoRound(first, [word.id])
    await store.advancePhotoRound(first, round.id, 1)
    await store.saveRecognition(first, round.id, { answers: [{ number: 1, text: 'Strasse', confidence: 0.9 }], warnings: [] })
    await store.reviewPhotoRound(first, round.id, [true])
    const index = await json(file)
    expect(index.version).toBe(3)
    expect(index.accounts).toEqual([
      { id: first, account: { email: 'first@example.test', ...credentials } },
      { id: second, account: { email: 'second@example.test', ...credentials } },
    ])
    const text = await readFile(practiceFile(first), 'utf8')
    const data = JSON.parse(text)
    expect(Object.keys(data).sort()).toEqual(['accountId', 'attempts', 'format', 'languagePreferences', 'photoRounds', 'schemaVersion', 'words'])
    expect(data).toMatchObject({
      format: 'worttrainer-account-data', schemaVersion: 1, accountId: first,
      languagePreferences: { enabled: ['de', 'fr'], defaultLanguage: 'fr' },
      words: [{ id: word.id, category: 'plus' }],
      attempts: [{ id: round.words[0].attemptId, correct: true }],
      photoRounds: [{ id: round.id, results: [true], recognition: { answers: [{ text: 'Strasse' }] } }],
    })
    for (const secret of [credentials.salt, credentials.passwordHash, tokenHash, 'first@example.test', 'second@example.test', 'private second word', second]) {
      expect(text).not.toContain(secret)
    }
    for (const practice of ['Straße', 'Strasse', 'languagePreferences', 'attempts', 'photoRounds']) {
      expect(await readFile(file, 'utf8')).not.toContain(practice)
    }
    expect((await readdir(join(directory, 'store.accounts'))).sort()).toEqual([`${first}.json`, `${second}.json`].sort())
    if (process.platform !== 'win32') {
      expect((await stat(practiceFile(first))).mode & 0o777).toBe(0o600)
      expect((await stat(join(directory, 'store.accounts'))).mode & 0o777).toBe(0o700)
    }
    const reopened = await FileStore.open(file)
    expect(reopened.exportData(first)).toMatchObject({
      schemaVersion: 2, words: data.words, attempts: data.attempts, rounds: data.photoRounds,
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
