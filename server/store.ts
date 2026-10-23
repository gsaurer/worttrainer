import { chmod, copyFile, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { nextProgress, roundStatistics, validateWord, type AccountDataExport, type Language, type LanguagePreferences, type WebsiteLanguage, type Word } from '../shared/model.js'
import { initialLanguagePreferences } from '../shared/languages.js'
import { languagePreferencesSchema, languageSchema, websiteLanguageSchema } from './languages.js'
import { HttpError } from './errors.js'
import { photoRoundSchema, recognitionSchema } from './photo-schema.js'
import type { PhotoRecognition, PhotoRound } from '../shared/model.js'

export const parentEmailSchema = z.string().trim().toLowerCase().email('Enter a valid parent email address.').max(254)
const credentialsSchema = z.object({
  salt: z.string().regex(/^[0-9a-f]{32}$/),
  passwordHash: z.string().regex(/^[0-9a-f]{128}$/),
})
const emailAccountSchema = credentialsSchema.extend({ email: parentEmailSchema }).strict()
const legacyAccountSchema = credentialsSchema.extend({
  username: z.string().regex(/^[a-zA-Z0-9._-]{3,40}$/),
}).strict()
const accountSchema = z.union([emailAccountSchema, legacyAccountSchema])
const wordSchema = z.object({
  id: z.uuid(),
  text: z.string().refine(value => validateWord(value) === null && value.trim() === value),
  language: languageSchema,
  category: z.enum(['new', 'plus', 'minus']),
  consecutive_mistakes: z.number().int().min(0).max(2),
  created_at: z.string().datetime(),
  last_practiced_at: z.string().datetime().nullable(),
}).strict().refine(word => (word.category === 'minus') === (word.consecutive_mistakes === 2))
const oldSessionSchema = z.object({ tokenHash: z.string().regex(/^[0-9a-f]{64}$/), expiresAt: z.number().int().positive() }).strict()
const sessionSchema = oldSessionSchema.extend({ accountId: z.uuid() }).strict()
const collectionShape = {
  words: z.array(wordSchema),
  attempts: z.array(z.object({ id: z.uuid(), wordId: z.uuid(), correct: z.boolean(), createdAt: z.string().datetime() }).strict()),
  photoRounds: z.array(photoRoundSchema).default([]),
}
const usageSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).nullable(), used: z.number().int().min(0) }).strict().default({ month: null, used: 0 })
function validateCollection(data: { words: Word[]; attempts: { id: string; wordId: string }[]; photoRounds: PhotoRound[] }, context: z.RefinementCtx) {
  const wordIds = new Set(data.words.map(word => word.id))
  if (wordIds.size !== data.words.length ||
      new Set(data.words.map(word => `${word.language}:${word.text.toLowerCase()}`)).size !== data.words.length ||
      new Set(data.attempts.map(attempt => attempt.id)).size !== data.attempts.length ||
      data.attempts.some(attempt => !wordIds.has(attempt.wordId)) ||
      new Set(data.photoRounds.map(round => round.id)).size !== data.photoRounds.length ||
      data.photoRounds.some(round => round.words.some(word => !wordIds.has(word.id))) ||
      new Set(data.photoRounds.flatMap(round => round.words.map(word => word.attemptId))).size !== data.photoRounds.reduce((count, round) => count + round.words.length, 0)) {
    context.addIssue({ code: 'custom', message: 'Inconsistent stored data.' })
  }
}
const legacyStoreSchema = z.object({
  version: z.literal(1), account: accountSchema.nullable(), ...collectionShape,
  sessions: z.array(oldSessionSchema), ocrUsage: usageSchema,
}).strict().superRefine((data, context) => {
  validateCollection(data, context)
  if (!data.account && (data.words.length || data.attempts.length || data.sessions.length || data.photoRounds.length || data.ocrUsage.used)) {
    context.addIssue({ code: 'custom', message: 'Unowned stored data.' })
  }
})
const accountDataSchema = z.object({ id: z.uuid(), account: accountSchema, websiteLanguage: websiteLanguageSchema.default('en'), languagePreferences: languagePreferencesSchema.default(initialLanguagePreferences), ...collectionShape }).strict().superRefine(validateCollection)
function validateOwnership(data: { accounts: { id: string; account: Account }[]; sessions: StoredSession[] }, context: z.RefinementCtx) {
  const ids = new Set(data.accounts.map(account => account.id))
  const emails = data.accounts.flatMap(item => 'email' in item.account ? [item.account.email] : [])
  if (ids.size !== data.accounts.length || new Set(emails).size !== emails.length ||
      data.accounts.filter(item => 'username' in item.account).length > 1 ||
      data.sessions.some(session => !ids.has(session.accountId)) ||
      new Set(data.sessions.map(session => session.tokenHash)).size !== data.sessions.length) {
    context.addIssue({ code: 'custom', message: 'Inconsistent account ownership.' })
  }
}
const stateSchema = z.object({
  accounts: z.array(accountDataSchema), sessions: z.array(sessionSchema), ocrUsage: usageSchema,
}).strict().superRefine(validateOwnership)
const oldStoreSchema = stateSchema.safeExtend({ version: z.literal(2) })
const indexSchema = z.object({
  version: z.literal(3),
  accounts: z.array(z.object({ id: z.uuid(), account: accountSchema }).strict()),
  sessions: z.array(sessionSchema), ocrUsage: usageSchema,
}).strict().superRefine(validateOwnership)
const accountFileSchema = z.object({
  format: z.literal('worttrainer-account-data'), schemaVersion: z.literal(1),
  accountId: z.uuid(), languagePreferences: languagePreferencesSchema,
  websiteLanguage: websiteLanguageSchema.default('en'),
  ...collectionShape,
}).strict().superRefine(validateCollection)

export type Account = z.infer<typeof accountSchema>
export type StoredSession = z.infer<typeof sessionSchema>
type State = z.infer<typeof stateSchema>
type AccountData = z.infer<typeof accountDataSchema>

function accountDirectory(file: string) {
  return join(dirname(file), `${basename(file, extname(file))}.accounts`)
}

function accountFile(file: string, id: string) {
  return join(accountDirectory(file), `${z.uuid().parse(id)}.json`)
}

function privateData(data: AccountData): z.infer<typeof accountFileSchema> {
  return {
    format: 'worttrainer-account-data', schemaVersion: 1, accountId: data.id,
    languagePreferences: data.languagePreferences,
    websiteLanguage: data.websiteLanguage,
    words: data.words, attempts: data.attempts, photoRounds: data.photoRounds,
  }
}

function indexData(state: State): z.infer<typeof indexSchema> {
  return {
    version: 3, accounts: state.accounts.map(({ id, account }) => ({ id, account })),
    sessions: state.sessions, ocrUsage: state.ocrUsage,
  }
}

function missing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function writeJson(file: string, data: unknown) {
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    const handle = await open(temp, 'wx', 0o600)
    try {
      await handle.writeFile(JSON.stringify(data, null, 2) + '\n', 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

async function preserveBackup(file: string, text: string, version: 1 | 2) {
  const backup = `${file}.v${version}.bak`
  try { await copyFile(file, backup, constants.COPYFILE_EXCL) }
  catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    if (await readFile(backup, 'utf8') !== text) throw new Error(`The existing version-${version} backup differs from the source. Preserve both files before retrying migration.`)
  }
  await chmod(backup, 0o600)
}

async function ensureAccountFile(file: string, data: AccountData) {
  const target = accountFile(file, data.id)
  await mkdir(accountDirectory(file), { recursive: true, mode: 0o700 })
  let text: string
  try { text = await readFile(target, 'utf8') }
  catch (error) {
    if (!missing(error)) throw error
    await writeJson(target, privateData(data))
    return
  }
  if (!isDeepStrictEqual(accountFileSchema.parse(JSON.parse(text)), privateData(data))) {
    throw new Error(`Existing account data ${target} differs from the migration or registration. Preserve both files before retrying; neither has been replaced.`)
  }
  await chmod(target, 0o600)
}

function owned(state: State, accountId: string): AccountData {
  const account = state.accounts.find(account => account.id === accountId)
  if (!account) throw new HttpError(401, 'This account is unavailable. Please sign in again.')
  return account
}

export class FileStore {
  private tail: Promise<void> = Promise.resolve()
  private constructor(private file: string, private state: State) {}

  static async open(file: string): Promise<FileStore> {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 })
    let text: string
    try { text = await readFile(file, 'utf8') }
    catch (error) {
      if (missing(error)) {
        let entries: string[] = []
        try { entries = await readdir(accountDirectory(file)) }
        catch (error) { if (!missing(error)) throw error }
        if (entries.length) throw new Error(`Missing account index ${file}, but account data exists. Restore the index from a matching backup; no data has been reset.`)
        const state: State = { accounts: [], sessions: [], ocrUsage: { month: null, used: 0 } }
        await writeJson(file, indexData(state))
        return new FileStore(file, state)
      }
      throw new Error(`Cannot read data store ${file}. Restore a valid backup; the file has not been overwritten.`, { cause: error })
    }
    try {
      const raw: unknown = JSON.parse(text)
      if (typeof raw === 'object' && raw !== null && 'version' in raw && raw.version === 1) {
        const old = legacyStoreSchema.parse(raw)
        const id = randomUUID()
        const state = oldStoreSchema.parse({
          version: 2,
          accounts: old.account ? [{ id, account: old.account, words: old.words, attempts: old.attempts, photoRounds: old.photoRounds }] : [],
          sessions: old.sessions.map(session => ({ ...session, accountId: id })),
          ocrUsage: old.ocrUsage,
        })
        await preserveBackup(file, text, 1)
        // Persist the generated owner ID before splitting files, so retries keep it.
        await writeJson(file, state)
        return await FileStore.open(file)
      }
      if (typeof raw === 'object' && raw !== null && 'version' in raw && raw.version === 2) {
        const old = oldStoreSchema.parse(raw)
        const state: State = { accounts: old.accounts, sessions: old.sessions, ocrUsage: old.ocrUsage }
        await preserveBackup(file, text, 2)
        for (const account of state.accounts) await ensureAccountFile(file, account)
        // Publish the index only after every complete account file is durable.
        await writeJson(file, indexData(state))
        console.info('Migrated to separate private account files; original backup:', `${file}.v2.bak`)
        return new FileStore(file, state)
      }
      const index = indexSchema.parse(raw)
      const accounts: AccountData[] = []
      for (const identity of index.accounts) {
        const target = accountFile(file, identity.id)
        let data: z.infer<typeof accountFileSchema>
        try {
          data = accountFileSchema.parse(JSON.parse(await readFile(target, 'utf8')))
          if (data.accountId !== identity.id) throw new Error('The account file belongs to a different account.')
        } catch (error) {
          throw new Error(`Cannot read private account data ${target}. Restore its matching backup.`, { cause: error })
        }
        accounts.push({ ...identity, websiteLanguage: data.websiteLanguage, languagePreferences: data.languagePreferences, words: data.words, attempts: data.attempts, photoRounds: data.photoRounds })
      }
      return new FileStore(file, stateSchema.parse({ accounts, sessions: index.sessions, ocrUsage: index.ocrUsage }))
    } catch (error) {
      throw new Error(`Cannot read data store ${file}. Restore a valid backup; no data has been reset. ${error instanceof Error ? error.message : 'Storage operation failed.'}`, { cause: error })
    }
  }

  account(accountId: string) { return { ...owned(this.state, accountId).account } }
  findAccount(email: string) {
    const item = this.state.accounts.find(item => 'email' in item.account && item.account.email === email)
    return item ? { id: item.id, account: { ...item.account } } : null
  }
  get legacyAccount() {
    const item = this.state.accounts.find(item => 'username' in item.account)
    return item ? { id: item.id, account: { ...item.account } } : null
  }
  words(accountId: string): Word[] { return structuredClone(owned(this.state, accountId).words) }
  photoRounds(accountId: string): PhotoRound[] { return structuredClone(owned(this.state, accountId).photoRounds) }
  languagePreferences(accountId: string): LanguagePreferences { return structuredClone(owned(this.state, accountId).languagePreferences) }
  websiteLanguage(accountId: string): WebsiteLanguage { return owned(this.state, accountId).websiteLanguage }

  setWebsiteLanguage(accountId: string, language: WebsiteLanguage) {
    return this.accountTransaction(accountId, state => {
      state.websiteLanguage = websiteLanguageSchema.parse(language)
      return state.websiteLanguage
    })
  }

  setLanguagePreferences(accountId: string, preferences: LanguagePreferences) {
    return this.accountTransaction(accountId, state => {
      state.languagePreferences = languagePreferencesSchema.parse(preferences)
      return state.languagePreferences
    })
  }

  exportData(accountId: string): AccountDataExport {
    const data = owned(this.state, accountId)
    return structuredClone({
      format: 'worttrainer-account-export', schemaVersion: 3, exportedAt: new Date().toISOString(),
      account: { id: data.id, ...('email' in data.account ? { email: data.account.email } : { username: data.account.username }) },
      websiteLanguage: data.websiteLanguage, languagePreferences: data.languagePreferences, words: data.words, attempts: data.attempts, rounds: data.photoRounds,
      statistics: roundStatistics(data.photoRounds),
    })
  }

  photoRound(accountId: string, id: string): PhotoRound {
    const round = owned(this.state, accountId).photoRounds.find(round => round.id === id)
    if (!round) throw new HttpError(404, 'Photo round not found.')
    return structuredClone(round)
  }

  ocrUsage(month = new Date().toISOString().slice(0, 7)) {
    return { month, used: this.state.ocrUsage.month === month ? this.state.ocrUsage.used : 0 }
  }

  reserveOcr(limit: number, month = new Date().toISOString().slice(0, 7)) {
    return this.transaction(state => {
      if (state.ocrUsage.month !== month) state.ocrUsage = { month, used: 0 }
      if (state.ocrUsage.used >= limit) throw new HttpError(429, 'The monthly photo-reading budget is exhausted. Review this sheet manually; no paid fallback is used.')
      // Reserve before contacting Azure; uncertain failures and retries still count.
      state.ocrUsage.used++
    })
  }

  createPhotoRound(accountId: string, wordIds: string[]) {
    return this.accountTransaction(accountId, state => {
      if (!wordIds.length || wordIds.length > 100 || new Set(wordIds).size !== wordIds.length) {
        throw new HttpError(400, 'Choose 1–100 distinct words for one numbered sheet.')
      }
      const words = wordIds.map(id => {
        const word = state.words.find(word => word.id === id)
        if (!word) throw new HttpError(409, 'A selected word was deleted. Sync and start again.')
        return { id: word.id, text: word.text, language: word.language, attemptId: randomUUID() }
      })
      if (new Set(words.map(word => word.language)).size !== 1) throw new HttpError(400, 'Choose one language for each sheet.')
      if (!state.languagePreferences.enabled.includes(words[0].language)) throw new HttpError(409, 'This language is disabled. Enable it in Languages before starting a new round.')
      const round: PhotoRound = { id: randomUUID(), startedAt: new Date().toISOString(), writtenAt: null, reviewedAt: null, nextIndex: 0, words, recognition: null, results: null }
      state.photoRounds.unshift(round)
      return round
    })
  }

  advancePhotoRound(accountId: string, id: string, nextIndex: number) {
    return this.accountTransaction(accountId, state => {
      const round = state.photoRounds.find(round => round.id === id)
      if (!round) throw new HttpError(404, 'Photo round not found.')
      if (nextIndex === round.nextIndex) return round
      if (round.reviewedAt || nextIndex !== round.nextIndex + 1 || nextIndex > round.words.length) throw new HttpError(409, 'This sheet changed on another device. Reopen it to continue.')
      round.nextIndex = nextIndex
      if (nextIndex === round.words.length) round.writtenAt = new Date().toISOString()
      return round
    })
  }

  saveRecognition(accountId: string, id: string, recognition: PhotoRecognition) {
    return this.accountTransaction(accountId, state => {
      const round = state.photoRounds.find(round => round.id === id)
      if (!round) throw new HttpError(404, 'Photo round not found.')
      if (!round.writtenAt || round.reviewedAt) throw new HttpError(409, 'Finish writing before reading a photo; reviewed sheets cannot be changed.')
      round.recognition = recognitionSchema.parse(recognition)
      return photoRoundSchema.parse(round)
    })
  }

  reviewPhotoRound(accountId: string, id: string, results: boolean[]) {
    return this.accountTransaction(accountId, state => {
      const round = state.photoRounds.find(round => round.id === id)
      if (!round) throw new HttpError(404, 'Photo round not found.')
      if (!round.writtenAt || results.length !== round.words.length) throw new HttpError(400, 'Finish the sheet and explicitly mark every answer.')
      if (round.results) {
        if (round.results.some((correct, index) => correct !== results[index])) throw new HttpError(409, 'This sheet was already saved with different results. Reopen it to see the saved answers.')
        return round
      }
      const now = new Date().toISOString()
      round.words.forEach((snapshot, index) => {
        const word = state.words.find(word => word.id === snapshot.id)
        if (!word) throw new HttpError(409, 'A word in this sheet was deleted. No answers were saved; start a new round.')
        Object.assign(word, nextProgress(word, results[index]), { last_practiced_at: now })
        state.attempts.push({ id: snapshot.attemptId, wordId: word.id, correct: results[index], createdAt: now })
      })
      round.results = results
      round.reviewedAt = now
      return round
    })
  }

  deletePhotoRound(accountId: string, id: string) {
    return this.accountTransaction(accountId, state => {
      if (!state.photoRounds.some(round => round.id === id)) throw new HttpError(404, 'Photo round not found.')
      state.photoRounds = state.photoRounds.filter(round => round.id !== id)
    })
  }

  sessionAccount(tokenHash: string, now = Date.now()) {
    return this.state.sessions.find(session => session.tokenHash === tokenHash && session.expiresAt > now)?.accountId ?? null
  }

  private accountTransaction<T>(accountId: string, change: (account: AccountData) => T) {
    return this.transaction(state => change(owned(state, accountId)),
      state => writeJson(accountFile(this.file, accountId), privateData(owned(state, accountId))))
  }

  private transaction<T>(change: (state: State) => T, persist = (state: State) => writeJson(this.file, indexData(state))): Promise<T> {
    const operation = this.tail.then(async () => {
      const draft = structuredClone(this.state)
      const result = change(draft)
      const checked = stateSchema.parse(draft)
      await persist(checked)
      this.state = checked
      return structuredClone(result)
    })
    // Release the queue after failure; the caller still receives the rejection.
    this.tail = operation.then(() => undefined, () => undefined)
    return operation
  }

  register(account: z.infer<typeof emailAccountSchema>, session: StoredSession, websiteLanguage: WebsiteLanguage = 'en') {
    return this.transaction(state => {
      if (state.accounts.some(item => 'email' in item.account && item.account.email === account.email)) throw new HttpError(409, 'This email is already registered. Sign in instead.')
      state.accounts.push({ id: session.accountId, account, websiteLanguage, languagePreferences: initialLanguagePreferences(), words: [], attempts: [], photoRounds: [] })
      state.sessions.push(session)
    }, async state => {
      await ensureAccountFile(this.file, owned(state, session.accountId))
      await writeJson(this.file, indexData(state))
    })
  }

  addSession(session: StoredSession, expectedPasswordHash: string) {
    return this.transaction(state => {
      if (owned(state, session.accountId).account.passwordHash !== expectedPasswordHash) throw new HttpError(401, 'Credentials changed. Please sign in again.')
      const active = state.sessions.filter(item => item.expiresAt > Date.now())
      state.sessions = [...active.filter(item => item.accountId !== session.accountId), ...active.filter(item => item.accountId === session.accountId).slice(-19), session]
    })
  }

  removeSession(tokenHash: string) {
    return this.transaction(state => {
      state.sessions = state.sessions.filter(session => session.tokenHash !== tokenHash)
    })
  }

  migrateEmail(email: string, session: StoredSession, expectedPasswordHash: string) {
    return this.transaction(state => {
      const data = owned(state, session.accountId)
      if (data.account.passwordHash !== expectedPasswordHash) throw new HttpError(401, 'Credentials changed. Please sign in again.')
      if ('email' in data.account) throw new HttpError(409, 'The parent email has already been set. Sign in again with that email.')
      if (state.accounts.some(item => 'email' in item.account && item.account.email === email)) throw new HttpError(409, 'This email is already registered. Choose a different email for the older account.')
      data.account = { email, salt: data.account.salt, passwordHash: data.account.passwordHash }
      state.sessions = [...state.sessions.filter(item => item.accountId !== data.id), session]
    })
  }

  changePassword(credentials: z.infer<typeof credentialsSchema>, session: StoredSession, expectedPasswordHash: string) {
    return this.transaction(state => {
      const data = owned(state, session.accountId)
      if (data.account.passwordHash !== expectedPasswordHash) throw new HttpError(401, 'Credentials changed. Please sign in again.')
      data.account = { ...data.account, ...credentials }
      state.sessions = [...state.sessions.filter(item => item.accountId !== data.id), session]
    })
  }

  recoverPassword(accountId: string, credentials: { salt: string; passwordHash: string }) {
    return this.transaction(state => {
      const data = owned(state, accountId)
      data.account = { ...data.account, ...credentials }
      state.sessions = state.sessions.filter(item => item.accountId !== accountId)
    })
  }

  addWord(accountId: string, text: string, language: Language) {
    return this.accountTransaction(accountId, state => {
      if (!state.languagePreferences.enabled.includes(language)) throw new HttpError(409, 'This language is disabled. Enable it in Languages before adding words.')
      if (state.words.some(word => word.language === language && word.text.toLowerCase() === text.toLowerCase())) {
        throw new HttpError(409, 'That word is already in this language’s collection.')
      }
      const word: Word = { id: randomUUID(), text, language, category: 'new', consecutive_mistakes: 0, created_at: new Date().toISOString(), last_practiced_at: null }
      state.words.unshift(word)
      return word
    })
  }

  deleteWord(accountId: string, id: string) {
    return this.accountTransaction(accountId, state => {
      if (!state.words.some(word => word.id === id)) throw new HttpError(404, 'Word not found. Sync your collection and try again.')
      state.words = state.words.filter(word => word.id !== id)
      state.attempts = state.attempts.filter(attempt => attempt.wordId !== id)
      // Remove snapshots/recognized handwriting for a deleted word as well.
      state.photoRounds = state.photoRounds.filter(round => !round.words.some(word => word.id === id))
    })
  }

  mark(accountId: string, wordId: string, correct: boolean, attemptId: string) {
    return this.accountTransaction(accountId, state => {
      const word = state.words.find(word => word.id === wordId)
      if (!word) throw new HttpError(404, 'Word not found. Sync your collection and try again.')
      const existing = state.attempts.find(attempt => attempt.id === attemptId)
      if (existing) {
        if (existing.wordId !== wordId || existing.correct !== correct) throw new HttpError(409, 'This attempt ID already belongs to another answer.')
        return { ...word }
      }
      Object.assign(word, nextProgress(word, correct), { last_practiced_at: new Date().toISOString() })
      state.attempts.push({ id: attemptId, wordId, correct, createdAt: word.last_practiced_at! })
      return { ...word }
    })
  }
}
