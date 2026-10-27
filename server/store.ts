import { chmod, copyFile, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { nextProgress, challengeStatistics, validateWord, type AccountDataExport, type Category, type Language, type LanguagePreferences, type WebsiteLanguage, type Word } from '../shared/model.js'
import { initialLanguagePreferences } from '../shared/languages.js'
import { languagePreferencesSchema, languageSchema, websiteLanguageSchema } from './languages.js'
import { HttpError } from './errors.js'
import { challengeSchema, recognitionSchema } from './challenge-schema.js'
import { wordResources } from './word-resources.js'
import { mistakeReportSchema } from './words.js'
import type { NavigationTiming, PhotoRecognition, Challenge, ChallengeCheckInput, ChallengePhoto, AddedWordList, PracticeWordList, PracticeAttempt } from '../shared/model.js'
import { oauthStateSchema, type OAuthState } from './oauth.js'

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
  progressOverride: z.object({ category: z.enum(['new', 'plus', 'minus']), afterAttemptId: z.uuid().nullable() }).strict().optional(),
}).strict().refine(word => word.consecutive_mistakes < 2 || word.category === 'minus')
const oldSessionSchema = z.object({ tokenHash: z.string().regex(/^[0-9a-f]{64}$/), expiresAt: z.number().int().positive() }).strict()
const sessionSchema = oldSessionSchema.extend({ accountId: z.uuid() }).strict()
const wordListsSchema = z.array(z.object({
  resourceId: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  language: languageSchema,
  sectionIds: z.array(z.string().min(1).max(120)).min(1).refine(ids => new Set(ids).size === ids.length),
  wordIds: z.array(z.uuid()).refine(ids => new Set(ids).size === ids.length),
}).strict())
const collectionShape = {
  words: z.array(wordSchema),
  attempts: z.array(z.object({ id: z.uuid(), wordId: z.uuid(), correct: z.boolean(), createdAt: z.string().datetime(), spelling: z.string().trim().min(1).max(1000).optional(), deletedAt: z.string().datetime().optional() }).strict()),
  challenges: z.array(challengeSchema).default([]),
  wordLists: wordListsSchema.default([]),
}
const usageSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).nullable(), used: z.number().int().min(0) }).strict().default({ month: null, used: 0 })
function validateCollection(data: { words: Word[]; attempts: { id: string; wordId: string }[]; challenges: Challenge[]; wordLists: AddedWordList[] }, context: z.RefinementCtx) {
  const wordIds = new Set(data.words.map(word => word.id))
  if (wordIds.size !== data.words.length ||
      new Set(data.words.map(word => `${word.language}:${word.text.toLowerCase()}`)).size !== data.words.length ||
      new Set(data.attempts.map(attempt => attempt.id)).size !== data.attempts.length ||
      data.attempts.some(attempt => !wordIds.has(attempt.wordId)) ||
      new Set(data.challenges.map(challenge => challenge.id)).size !== data.challenges.length ||
      data.challenges.some(challenge => challenge.words.some(word => !wordIds.has(word.id))) ||
      new Set(data.wordLists.map(list => list.resourceId)).size !== data.wordLists.length ||
      data.wordLists.some(list => list.wordIds.some(id => !data.words.some(word => word.id === id && word.language === list.language))) ||
      new Set(data.challenges.flatMap(challenge => challenge.words.map(word => word.attemptId))).size !== data.challenges.reduce((count, challenge) => count + challenge.words.length, 0)) {
    context.addIssue({ code: 'custom', message: 'Inconsistent stored data.' })
  }
}
const legacyStoreSchema = z.object({
  version: z.literal(1), account: accountSchema.nullable(), ...collectionShape,
  sessions: z.array(oldSessionSchema), ocrUsage: usageSchema,
}).strict().superRefine((data, context) => {
  validateCollection(data, context)
  if (!data.account && (data.words.length || data.attempts.length || data.sessions.length || data.challenges.length || data.wordLists.length || data.ocrUsage.used)) {
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
  oauth: oauthStateSchema.default({ clients: [], grants: [] }),
}).strict().superRefine(validateOwnership)
const oldStoreSchema = stateSchema.safeExtend({ version: z.literal(2) })
const indexSchema = z.object({
  version: z.literal(3),
  accounts: z.array(z.object({ id: z.uuid(), account: accountSchema }).strict()),
  sessions: z.array(sessionSchema), ocrUsage: usageSchema,
  oauth: oauthStateSchema.default({ clients: [], grants: [] }),
}).strict().superRefine(validateOwnership)
function migrateLegacyCollection(value: unknown) {
  if (typeof value !== 'object' || value === null || !('photoRounds' in value) || 'challenges' in value) return value
  const { photoRounds, ...data } = value
  return { ...data, challenges: photoRounds }
}

const accountFileSchema = z.preprocess(value => {
  const data = migrateLegacyCollection(value)
  return typeof data === 'object' && data !== null && 'schemaVersion' in data && (data.schemaVersion === 1 || data.schemaVersion === 2)
    ? { ...data, schemaVersion: 3, wordLists: 'wordLists' in data ? data.wordLists : [] }
    : data
}, z.object({
  format: z.literal('worttrainer-account-data'), schemaVersion: z.literal(3),
  accountId: z.uuid(), languagePreferences: languagePreferencesSchema,
  websiteLanguage: websiteLanguageSchema.default('en'),
  ...collectionShape,
  wordLists: wordListsSchema,
}).strict().superRefine(validateCollection))

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
    format: 'worttrainer-account-data', schemaVersion: 3, accountId: data.id,
    languagePreferences: data.languagePreferences,
    websiteLanguage: data.websiteLanguage,
    words: data.words, attempts: data.attempts, challenges: data.challenges, wordLists: data.wordLists,
  }
}

function indexData(state: State): z.input<typeof indexSchema> {
  return {
    version: 3, accounts: state.accounts.map(({ id, account }) => ({ id, account })),
    sessions: state.sessions, ocrUsage: state.ocrUsage,
    ...(state.oauth.clients.length || state.oauth.grants.length ? { oauth: state.oauth } : {}),
  }
}

function missing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export async function writeJson(file: string, data: unknown) {
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
  const raw: unknown = JSON.parse(text)
  const existing = accountFileSchema.parse(raw)
  if (!isDeepStrictEqual(existing, privateData(data))) {
    throw new Error(`Existing account data ${target} differs from the migration or registration. Preserve both files before retrying; neither has been replaced.`)
  }
  if (typeof raw === 'object' && raw !== null && 'schemaVersion' in raw && (raw.schemaVersion === 1 || raw.schemaVersion === 2)) {
    await preserveBackup(target, text, raw.schemaVersion)
    await writeJson(target, existing)
  }
  await chmod(target, 0o600)
}

function owned(state: State, accountId: string): AccountData {
  const account = state.accounts.find(account => account.id === accountId)
  if (!account) throw new HttpError(401, 'This account is unavailable. Please sign in again.')
  return account
}

function wordView(word: Word): Word {
  const view = { ...word }
  delete view.progressOverride
  return view
}

function replayProgress(word: Word, attempts: PracticeAttempt[]) {
  const replay: Word = { ...word, category: 'new', consecutive_mistakes: 0, last_practiced_at: null }
  const prior: PracticeAttempt[] = []
  const override = () => Object.assign(replay, { category: word.progressOverride!.category, consecutive_mistakes: 0 })
  if (word.progressOverride?.afterAttemptId === null) override()
  for (const attempt of attempts) {
    if (attempt.wordId !== word.id) continue
    if (!attempt.deletedAt) {
      Object.assign(replay, nextProgress(replay, attempt.correct, prior), { last_practiced_at: attempt.createdAt })
      prior.push(attempt)
    }
    if (word.progressOverride?.afterAttemptId === attempt.id) override()
  }
  Object.assign(word, { category: replay.category, consecutive_mistakes: replay.consecutive_mistakes, last_practiced_at: replay.last_practiced_at })
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
        const state: State = { accounts: [], sessions: [], ocrUsage: { month: null, used: 0 }, oauth: { clients: [], grants: [] } }
        await writeJson(file, indexData(state))
        return new FileStore(file, state)
      }
      throw new Error(`Cannot read data store ${file}. Restore a valid backup; the file has not been overwritten.`, { cause: error })
    }
    try {
      const raw: unknown = JSON.parse(text)
      if (typeof raw === 'object' && raw !== null && 'version' in raw && raw.version === 1) {
        const old = legacyStoreSchema.parse(migrateLegacyCollection(raw))
        const id = randomUUID()
        const state = oldStoreSchema.parse({
          version: 2,
          accounts: old.account ? [{ id, account: old.account, words: old.words, attempts: old.attempts, challenges: old.challenges, wordLists: old.wordLists }] : [],
          sessions: old.sessions.map(session => ({ ...session, accountId: id })),
          ocrUsage: old.ocrUsage,
        })
        await preserveBackup(file, text, 1)
        // Persist the generated owner ID before splitting files, so retries keep it.
        await writeJson(file, state)
        return await FileStore.open(file)
      }
      if (typeof raw === 'object' && raw !== null && 'version' in raw && raw.version === 2) {
        const old = oldStoreSchema.parse({
          ...raw,
          accounts: 'accounts' in raw && Array.isArray(raw.accounts) ? raw.accounts.map(migrateLegacyCollection) : undefined,
        })
        const state: State = { accounts: old.accounts, sessions: old.sessions, ocrUsage: old.ocrUsage, oauth: old.oauth }
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
          const text = await readFile(target, 'utf8')
          const raw: unknown = JSON.parse(text)
          data = accountFileSchema.parse(raw)
          if (data.accountId !== identity.id) throw new Error('The account file belongs to a different account.')
          if (typeof raw === 'object' && raw !== null && 'schemaVersion' in raw && (raw.schemaVersion === 1 || raw.schemaVersion === 2)) {
            await preserveBackup(target, text, raw.schemaVersion)
            await writeJson(target, data)
          }
        } catch (error) {
          throw new Error(`Cannot read private account data ${target}. Restore its matching backup.`, { cause: error })
        }
        accounts.push({ ...identity, websiteLanguage: data.websiteLanguage, languagePreferences: data.languagePreferences, words: data.words, attempts: data.attempts, challenges: data.challenges, wordLists: data.wordLists })
      }
      return new FileStore(file, stateSchema.parse({ accounts, sessions: index.sessions, ocrUsage: index.ocrUsage, oauth: index.oauth }))
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
  words(accountId: string): Word[] { return owned(this.state, accountId).words.map(wordView) }
  hasAccount(accountId: string): boolean { return this.state.accounts.some(account => account.id === accountId) }
  addedWordLists(accountId: string): AddedWordList[] { return structuredClone(owned(this.state, accountId).wordLists) }
  practiceWordLists(accountId: string): PracticeWordList[] {
    const state = owned(this.state, accountId)
    return this.addedWordLists(accountId).map(list => {
      const resource = wordResources.find(resource => resource.id === list.resourceId && resource.language === list.language)
      const memberIds = new Set(list.wordIds)
      const memberWords = state.words.filter(word => word.language === list.language && memberIds.has(word.id))
      return { ...list, sections: (resource?.sections ?? []).filter(section => list.sectionIds.includes(section.id)).map(section => {
        const spellings = new Set(section.entries.map(entry => entry.word.toLowerCase()))
        return { id: section.id, title: section.title, wordIds: memberWords.filter(word => spellings.has(word.text.toLowerCase())).map(word => word.id) }
      }) }
    })
  }
  challenges(accountId: string): Challenge[] { return structuredClone(owned(this.state, accountId).challenges.filter(challenge => !challenge.deletedAt)) }
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
      format: 'worttrainer-account-export', schemaVersion: 5, exportedAt: new Date().toISOString(),
      account: { id: data.id, ...('email' in data.account ? { email: data.account.email } : { username: data.account.username }) },
      websiteLanguage: data.websiteLanguage, languagePreferences: data.languagePreferences, words: data.words, attempts: data.attempts, challenges: data.challenges, wordLists: data.wordLists,
      statistics: challengeStatistics(data.challenges),
    })
  }

  challenge(accountId: string, id: string): Challenge {
    const challenge = owned(this.state, accountId).challenges.find(challenge => challenge.id === id && !challenge.deletedAt)
    if (!challenge) throw new HttpError(404, 'Challenge not found.')
    return structuredClone(challenge)
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

  createChallenge(accountId: string, wordIds: string[]) {
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
      if (!state.languagePreferences.enabled.includes(words[0].language)) throw new HttpError(409, 'This language is disabled. Enable it in Languages before starting a new challenge.')
      const challenge = challengeSchema.parse({ id: randomUUID(), startedAt: new Date().toISOString(), writtenAt: null, reviewedAt: null, nextIndex: 0, words, recognition: null, results: null, telemetry: [], check: null, photo: null })
      state.challenges.unshift(challenge)
      return challenge
    })
  }

  advanceChallenge(accountId: string, id: string, nextIndex: number, timing: NavigationTiming) {
    return this.accountTransaction(accountId, state => {
      const challenge = state.challenges.find(challenge => challenge.id === id && !challenge.deletedAt)
      if (!challenge) throw new HttpError(404, 'Challenge not found.')
      if (timing.fromIndex !== challenge.nextIndex) throw new HttpError(409, 'This sheet changed on another device. Reopen it to continue.')
      if (challenge.writtenAt || challenge.reviewedAt || Math.abs(nextIndex - challenge.nextIndex) > 1 || nextIndex < 0 || nextIndex > challenge.words.length) throw new HttpError(409, 'This sheet changed on another device. Reopen it to continue.')
      const now = new Date().toISOString()
      const telemetry = challenge.telemetry
      if (telemetry.length >= 10000) throw new HttpError(409, 'This sheet changed on another device. Reopen it to continue.')
      telemetry.push({
        fromIndex: challenge.nextIndex, toIndex: nextIndex, recordedAt: now,
        elapsedMs: timing.elapsedMs,
        intervalSeconds: timing.intervalSeconds, automatic: timing.automatic,
        action: timing.action,
      })
      challenge.nextIndex = nextIndex
      if (nextIndex === challenge.words.length) challenge.writtenAt = now
      return challenge
    })
  }

  saveRecognition(accountId: string, id: string, recognition: PhotoRecognition, photo: ChallengePhoto) {
    return this.accountTransaction(accountId, state => {
      const challenge = state.challenges.find(challenge => challenge.id === id && !challenge.deletedAt)
      if (!challenge) throw new HttpError(404, 'Challenge not found.')
      if (!challenge.writtenAt || challenge.reviewedAt) throw new HttpError(409, 'Finish writing before reading a photo; reviewed sheets cannot be changed.')
      challenge.recognition = recognitionSchema.parse(recognition)
      challenge.photo = photo
      return challengeSchema.parse(challenge)
    })
  }

  reviewChallenge(accountId: string, id: string, results: boolean[], check: ChallengeCheckInput) {
    return this.accountTransaction(accountId, state => {
      const challenge = state.challenges.find(challenge => challenge.id === id && !challenge.deletedAt)
      if (!challenge) throw new HttpError(404, 'Challenge not found.')
      if (!challenge.writtenAt || results.length !== challenge.words.length) throw new HttpError(400, 'Finish the sheet and explicitly mark every answer.')
      if (check.spellings.length !== challenge.words.length || (check.method === 'photo' && !challenge.recognition)) throw new HttpError(400, 'Finish the sheet and explicitly mark every answer.')
      if (challenge.results) {
        if (challenge.results.some((correct, index) => correct !== results[index]) || !isDeepStrictEqual(check, { method: challenge.check!.method, spellings: challenge.check!.spellings })) throw new HttpError(409, 'This sheet was already saved with different results. Reopen it to see the saved answers.')
        return challenge
      }
      const now = new Date().toISOString()
      challenge.words.forEach((snapshot, index) => {
        const word = state.words.find(word => word.id === snapshot.id)
        if (!word) throw new HttpError(409, 'A word in this sheet was deleted. No answers were saved; start a new challenge.')
        Object.assign(word, nextProgress(word, results[index], state.attempts), { last_practiced_at: now })
        state.attempts.push({ id: snapshot.attemptId, wordId: word.id, correct: results[index], createdAt: now })
      })
      challenge.results = results
      challenge.reviewedAt = now
      challenge.check = { ...check, evaluatedAt: now }
      return challenge
    })
  }

  deleteChallenge(accountId: string, id: string, removePractice = false) {
    return this.accountTransaction(accountId, state => {
      const challenge = state.challenges.find(challenge => challenge.id === id)
      if (!challenge) throw new HttpError(404, 'Challenge not found.')
      const now = new Date().toISOString()
      challenge.deletedAt ??= now
      if (removePractice) {
        const ids = new Set(challenge.words.map(word => word.attemptId))
        const affected = new Set<string>()
        for (const attempt of state.attempts) {
          if (!ids.has(attempt.id) || attempt.deletedAt) continue
          attempt.deletedAt = now
          affected.add(attempt.wordId)
        }
        for (const word of state.words) {
          if (affected.has(word.id)) replayProgress(word, state.attempts)
        }
      }
      return challenge.writtenAt
    })
  }

  sessionAccount(tokenHash: string, now = Date.now()) {
    return this.state.sessions.find(session => session.tokenHash === tokenHash && session.expiresAt > now)?.accountId ?? null
  }

  oauthState(): OAuthState { return structuredClone(this.state.oauth) }

  oauthTransaction<T>(change: (state: OAuthState) => T): Promise<T> {
    return this.transaction(state => change(state.oauth))
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
      state.accounts.push({ id: session.accountId, account, websiteLanguage, languagePreferences: initialLanguagePreferences(), words: [], attempts: [], challenges: [], wordLists: [] })
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

  importDocumentWords(accountId: string, words: string[], language: Language) {
    return this.accountTransaction(accountId, state => {
      if (!state.languagePreferences.enabled.includes(language)) throw new HttpError(409, 'This language is disabled. Enable it in Languages before adding words.')
      const unique = new Map(words.map(text => [text.toLowerCase(), text]))
      const existing = new Set(state.words.filter(word => word.language === language).map(word => word.text.toLowerCase()))
      const added = [...unique].filter(([key]) => !existing.has(key)).map(([, text]): Word => ({
        id: randomUUID(), text, language, category: 'new', consecutive_mistakes: 0,
        created_at: new Date().toISOString(), last_practiced_at: null,
      }))
      state.words.unshift(...added)
      return { added: added.length, existing: unique.size - added.length, language }
    })
  }

  importWordResource(accountId: string, resourceId: string, sectionIds: string[], enableLanguage: boolean) {
    const resource = wordResources.find(item => item.id === resourceId)
    if (!resource) throw new HttpError(404, 'Word list not found.')
    if (!sectionIds.length || new Set(sectionIds).size !== sectionIds.length || sectionIds.some(id => !resource.sections.some(section => section.id === id))) {
      throw new HttpError(400, 'Choose valid sections from this word list.')
    }
    return this.accountTransaction(accountId, state => {
      if (!state.languagePreferences.enabled.includes(resource.language)) {
        if (!enableLanguage) throw new HttpError(409, 'Enable this word list language before adding words.')
        state.languagePreferences.enabled.push(resource.language)
      }
      const entries = resource.sections.filter(section => sectionIds.includes(section.id)).flatMap(section => section.entries)
      const unique = new Map(entries.map(entry => [entry.word.toLowerCase(), entry.word]))
      const existing = new Set(state.words.filter(word => word.language === resource.language).map(word => word.text.toLowerCase()))
      const added = [...unique].filter(([key]) => !existing.has(key)).map(([, text]): Word => ({
        id: randomUUID(), text, language: resource.language, category: 'new', consecutive_mistakes: 0,
        created_at: new Date().toISOString(), last_practiced_at: null,
      }))
      state.words.unshift(...added)
      const wordIds = state.words.filter(word => word.language === resource.language && unique.has(word.text.toLowerCase())).map(word => word.id)
      const list = state.wordLists.find(list => list.resourceId === resource.id)
      if (list) {
        list.title = resource.title
        list.sectionIds = [...new Set([...list.sectionIds, ...sectionIds])]
        list.wordIds = [...new Set([...list.wordIds, ...wordIds])]
      } else {
        state.wordLists.push({ resourceId: resource.id, title: resource.title, language: resource.language, sectionIds: [...sectionIds], wordIds })
      }
      return { added: added.length, existing: unique.size - added.length, language: resource.language }
    })
  }

  deleteWord(accountId: string, id: string) {
    return this.accountTransaction(accountId, state => {
      if (!state.words.some(word => word.id === id)) throw new HttpError(404, 'Word not found. Sync your collection and try again.')
      state.words = state.words.filter(word => word.id !== id)
      for (const list of state.wordLists) list.wordIds = list.wordIds.filter(wordId => wordId !== id)
      state.attempts = state.attempts.filter(attempt => attempt.wordId !== id)
      // Remove snapshots/recognized handwriting for a deleted word as well.
      state.challenges = state.challenges.filter(challenge => !challenge.words.some(word => word.id === id))
    })
  }

  moveWord(accountId: string, wordId: string, category: Category) {
    return this.accountTransaction(accountId, state => {
      const word = state.words.find(word => word.id === wordId)
      if (!word) throw new HttpError(404, 'Word not found. Sync your collection and try again.')
      if (word.category !== category) Object.assign(word, {
        category, consecutive_mistakes: 0,
        progressOverride: { category, afterAttemptId: state.attempts.filter(attempt => attempt.wordId === wordId).at(-1)?.id ?? null },
      })
      return wordView(word)
    })
  }

  recordMistakes(accountId: string, input: z.input<typeof mistakeReportSchema>) {
    const { reportId, language, words: entries } = mistakeReportSchema.parse(input)
    return this.accountTransaction(accountId, state => {
      const previous = state.challenges.find(challenge => challenge.id === reportId)
      if (previous) {
        if (previous.deletedAt) throw new HttpError(409, 'This report was deleted. Use a fresh report ID for a new report.')
        if (previous.words[0].attemptId !== reportId || previous.words.length !== entries.length ||
            previous.words.some((word, index) => word.language !== language || word.text.toLowerCase() !== entries[index].correctWord.toLowerCase() ||
              previous.results?.[index] !== false || previous.check?.spellings[index] !== (entries[index].wrongSpelling ?? null))) {
          throw new HttpError(409, 'This report ID already belongs to different results. Use a fresh report ID for a new report.')
        }
        return { reportId, words: previous.words.map(snapshot => wordView(state.words.find(word => word.id === snapshot.id)!)) }
      }
      if (state.attempts.some(attempt => attempt.id === reportId) || state.challenges.some(challenge => challenge.words.some(word => word.attemptId === reportId))) {
        throw new HttpError(409, 'This report ID already belongs to saved practice. Use a fresh report ID for a new report.')
      }
      if (!state.languagePreferences.enabled.includes(language)) {
        throw new HttpError(409, 'This language is disabled. Enable it in Languages before recording a new report.')
      }
      const now = new Date().toISOString()
      const words = entries.map(entry => {
        const existing = state.words.find(word => word.language === language && word.text.toLowerCase() === entry.correctWord.toLowerCase())
        if (existing) return existing
        const word: Word = {
          id: randomUUID(), text: entry.correctWord, language, category: 'new', consecutive_mistakes: 0,
          created_at: now, last_practiced_at: null,
        }
        state.words.unshift(word)
        return word
      })
      const snapshots = words.map((word, index) => {
        const attemptId = index === 0 ? reportId : randomUUID()
        const spelling = entries[index].wrongSpelling
        Object.assign(word, nextProgress(word, false, state.attempts), { last_practiced_at: now })
        state.attempts.push({ id: attemptId, wordId: word.id, correct: false, createdAt: now, ...(spelling === undefined ? {} : { spelling }) })
        return { id: word.id, text: word.text, language, attemptId }
      })
      state.challenges.unshift(challengeSchema.parse({
        id: reportId, startedAt: now, writtenAt: now, reviewedAt: now, nextIndex: words.length,
        words: snapshots, results: words.map(() => false), telemetry: [], recognition: null, photo: null,
        check: { method: 'manual', spellings: entries.map(entry => entry.wrongSpelling ?? null), evaluatedAt: now },
      }))
      return { reportId, words: words.map(wordView) }
    })
  }

  mark(accountId: string, wordId: string, correct: boolean, attemptId: string, spelling?: string) {
    return this.accountTransaction(accountId, state => {
      const word = state.words.find(word => word.id === wordId)
      if (!word) throw new HttpError(404, 'Word not found. Sync your collection and try again.')
      const existing = state.attempts.find(attempt => attempt.id === attemptId)
      if (existing) {
        if (existing.deletedAt) throw new HttpError(409, 'This attempt was deleted. Use a fresh attempt ID for a new result.')
        if (existing.wordId !== wordId || existing.correct !== correct || existing.spelling !== spelling) throw new HttpError(409, 'This attempt ID already belongs to another answer.')
        return wordView(word)
      }
      Object.assign(word, nextProgress(word, correct, state.attempts), { last_practiced_at: new Date().toISOString() })
      state.attempts.push({ id: attemptId, wordId, correct, createdAt: word.last_practiced_at!, ...(spelling === undefined ? {} : { spelling }) })
      return wordView(word)
    })
  }
}
