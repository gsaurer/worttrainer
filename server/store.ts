import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { nextProgress, validateWord, type Language, type Word } from '../shared/model.js'
import { HttpError } from './errors.js'

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
  language: z.enum(['de', 'en']),
  category: z.enum(['new', 'plus', 'minus']),
  consecutive_mistakes: z.number().int().min(0).max(2),
  created_at: z.string().datetime(),
  last_practiced_at: z.string().datetime().nullable(),
}).strict().refine(word => (word.category === 'minus') === (word.consecutive_mistakes === 2))
const sessionSchema = z.object({ tokenHash: z.string().regex(/^[0-9a-f]{64}$/), expiresAt: z.number().int().positive() }).strict()
const storeSchema = z.object({
  version: z.literal(1),
  account: accountSchema.nullable(),
  words: z.array(wordSchema),
  attempts: z.array(z.object({ id: z.uuid(), wordId: z.uuid(), correct: z.boolean(), createdAt: z.string().datetime() }).strict()),
  sessions: z.array(sessionSchema),
}).strict().superRefine((data, context) => {
  const wordIds = new Set(data.words.map(word => word.id))
  if (wordIds.size !== data.words.length ||
      new Set(data.words.map(word => `${word.language}:${word.text.toLowerCase()}`)).size !== data.words.length ||
      new Set(data.attempts.map(attempt => attempt.id)).size !== data.attempts.length ||
      data.attempts.some(attempt => !wordIds.has(attempt.wordId)) ||
      (!data.account && (data.words.length || data.attempts.length || data.sessions.length))) {
    context.addIssue({ code: 'custom', message: 'Inconsistent stored data.' })
  }
})

export type Account = z.infer<typeof accountSchema>
export type StoredSession = z.infer<typeof sessionSchema>
type State = z.infer<typeof storeSchema>

export class FileStore {
  private tail: Promise<void> = Promise.resolve()
  private constructor(private file: string, private state: State) {}

  static async open(file: string) {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 })
    try {
      const text = await readFile(file, 'utf8')
      return new FileStore(file, storeSchema.parse(JSON.parse(text)))
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw new Error(`Cannot read data store ${file}. Restore a valid backup; the file has not been overwritten.`, { cause: error })
      }
      return new FileStore(file, { version: 1, account: null, words: [], attempts: [], sessions: [] })
    }
  }

  get account() { return this.state.account ? { ...this.state.account } : null }
  get words(): Word[] { return structuredClone(this.state.words) }

  hasSession(tokenHash: string, now = Date.now()) {
    return this.state.sessions.some(session => session.tokenHash === tokenHash && session.expiresAt > now)
  }

  private transaction<T>(change: (state: State) => T): Promise<T> {
    const operation = this.tail.then(async () => {
      const draft = structuredClone(this.state)
      const result = change(draft)
      const temp = `${this.file}.${randomUUID()}.tmp`
      try {
        const handle = await open(temp, 'wx', 0o600)
        try {
          await handle.writeFile(JSON.stringify(draft, null, 2) + '\n', 'utf8')
          await handle.sync()
        } finally {
          await handle.close()
        }
        await rename(temp, this.file)
      } catch (error) {
        await rm(temp, { force: true })
        throw error
      }
      this.state = draft
      return structuredClone(result)
    })
    // Release the queue after failure; the caller still receives the rejection.
    this.tail = operation.then(() => undefined, () => undefined)
    return operation
  }

  initialize(account: z.infer<typeof emailAccountSchema>, session: StoredSession) {
    return this.transaction(state => {
      if (state.account) throw new HttpError(409, 'The parent account is already configured.')
      state.account = account
      state.sessions = [session]
    })
  }

  addSession(session: StoredSession, expectedPasswordHash: string) {
    return this.transaction(state => {
      if (state.account?.passwordHash !== expectedPasswordHash) throw new HttpError(401, 'Credentials changed. Please sign in again.')
      state.sessions = [...state.sessions.filter(item => item.expiresAt > Date.now()).slice(-19), session]
    })
  }

  removeSession(tokenHash: string) {
    return this.transaction(state => {
      state.sessions = state.sessions.filter(session => session.tokenHash !== tokenHash)
    })
  }

  migrateEmail(email: string, session: StoredSession, expectedPasswordHash: string) {
    return this.transaction(state => {
      if (state.account?.passwordHash !== expectedPasswordHash) throw new HttpError(401, 'Credentials changed. Please sign in again.')
      if ('email' in state.account) throw new HttpError(409, 'The parent email has already been set. Sign in again with that email.')
      state.account = { email, salt: state.account.salt, passwordHash: state.account.passwordHash }
      state.sessions = [session]
    })
  }

  changePassword(credentials: z.infer<typeof credentialsSchema>, session: StoredSession, expectedPasswordHash: string) {
    return this.transaction(state => {
      if (state.account?.passwordHash !== expectedPasswordHash) throw new HttpError(401, 'Credentials changed. Please sign in again.')
      state.account = { ...state.account, ...credentials }
      state.sessions = [session]
    })
  }

  recoverPassword(credentials: { salt: string; passwordHash: string }) {
    return this.transaction(state => {
      if (!state.account) throw new Error('No parent account is configured.')
      state.account = { ...state.account, ...credentials }
      state.sessions = []
    })
  }

  addWord(text: string, language: Language) {
    return this.transaction(state => {
      if (state.words.some(word => word.language === language && word.text.toLowerCase() === text.toLowerCase())) {
        throw new HttpError(409, 'That word is already in this language’s collection.')
      }
      const word: Word = { id: randomUUID(), text, language, category: 'new', consecutive_mistakes: 0, created_at: new Date().toISOString(), last_practiced_at: null }
      state.words.unshift(word)
      return word
    })
  }

  deleteWord(id: string) {
    return this.transaction(state => {
      if (!state.words.some(word => word.id === id)) throw new HttpError(404, 'Word not found. Sync your collection and try again.')
      state.words = state.words.filter(word => word.id !== id)
      state.attempts = state.attempts.filter(attempt => attempt.wordId !== id)
    })
  }

  mark(wordId: string, correct: boolean, attemptId: string) {
    return this.transaction(state => {
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
