import express, { type ErrorRequestHandler, type Request, type Response } from 'express'
import { rateLimit } from 'express-rate-limit'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { z } from 'zod'
import { validateWord, type AuthState } from '../shared/model.js'
import { FileStore, parentEmailSchema } from './store.js'
import { hashPassword, verifyPassword } from './passwords.js'
import { HttpError } from './errors.js'
import { normalizePhoto, readAzurePhoto, type OcrOptions } from './ocr.js'

export type AppOptions = {
  store: FileStore
  origin: string
  secureCookie: boolean
  production?: boolean
  trustProxy?: boolean
  ocr?: OcrOptions
}

const cookieName = 'worttrainer_session'
const maxAgeSeconds = 7 * 24 * 60 * 60
const password = z.string().min(12, 'Use a password with at least 12 characters.').max(128, 'Keep the password to 128 characters or fewer.')
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

function sessionToken(req: Request) {
  const token = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1)
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new HttpError(400, result.error.issues[0]?.message ?? 'Invalid input.')
  return result.data
}

export function createApp(options: AppOptions) {
  const { store } = options
  const app = express()
  app.disable('x-powered-by')
  if (options.trustProxy) app.set('trust proxy', 1)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Frame-Options', 'DENY')
    if (options.production) res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
    next()
  })
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers.origin !== options.origin) return next(new HttpError(403, 'Request origin is not allowed. Open the app at its configured address.'))
      const photoUpload = req.method === 'POST' && /^\/photo-rounds\/[0-9a-f-]+\/photo$/.test(req.path)
      if (photoUpload ? !req.is(['image/jpeg', 'image/png']) : !req.is('application/json')) {
        return next(new HttpError(415, photoUpload ? 'Upload one JPEG or PNG photo.' : 'Send requests as application/json.'))
      }
    }
    next()
  })
  app.use(express.json({ limit: '16kb', strict: true }))

  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Wait 15 minutes and try again.' } })
  let passwordWork = 0
  async function withPasswordWork<T>(operation: () => Promise<T>): Promise<T> {
    if (passwordWork >= 2) throw new HttpError(429, 'Sign-in is busy. Try again in a moment.')
    passwordWork++
    try { return await operation() }
    finally { passwordWork-- }
  }

  function authenticated(req: Request) {
    const token = sessionToken(req)
    return token ? store.sessionAccount(digest(token)) : null
  }
  function accountId(req: Request) {
    const id = authenticated(req)
    if (!id) throw new HttpError(401, 'Please sign in to your account.')
    return id
  }
  const requireAuth: express.RequestHandler = (req, _res, next) => {
    next(authenticated(req) ? undefined : new HttpError(401, 'Please sign in to your parent account.'))
  }
  function setCookie(res: Response, token: string, maxAge = maxAgeSeconds) {
    res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${options.secureCookie ? '; Secure' : ''}`)
  }
  function newSession(accountId: string = randomUUID()) {
    const token = randomBytes(32).toString('base64url')
    return { token, stored: { tokenHash: digest(token), accountId, expiresAt: Date.now() + maxAgeSeconds * 1000 } }
  }
  function authState(req: Request): AuthState {
    const signedIn = authenticated(req)
    const account = signedIn ? store.account(signedIn) : null
    return {
      authenticated: !!signedIn,
      emailMigrationRequired: !!account && !('email' in account),
      email: signedIn && account && 'email' in account ? account.email : null,
    }
  }

  app.get('/api/health', (_req, res) => { res.json({ ok: true }) })
  app.get('/api/session', (req, res) => { res.json(authState(req)) })
  app.get('/api/export', requireAuth, (req, res) => {
    const data = store.exportData(accountId(req))
    res.setHeader('Content-Disposition', `attachment; filename="worttrainer-${data.exportedAt.slice(0, 10)}.json"`)
    res.json(data)
  })
  app.post('/api/setup', (_req, _res) => {
    throw new HttpError(410, 'Setup tokens are no longer needed. Reload the app and choose Create account.')
  })
  app.post('/api/signup', authLimiter, async (req, res) => {
    const input = parse(z.object({ email: parentEmailSchema, password }).strict(), req.body)
    const account = { email: input.email, ...await withPasswordWork(() => hashPassword(input.password)) }
    const session = newSession()
    await store.register(account, session.stored)
    setCookie(res, session.token)
    res.status(201).json({ authenticated: true, emailMigrationRequired: false, email: account.email } satisfies AuthState)
  })
  app.post('/api/login', authLimiter, async (req, res) => {
    const input = parse(z.object({ email: parentEmailSchema, password: z.string().min(1).max(128) }).strict(), req.body)
    const record = store.findAccount(input.email) ?? store.legacyAccount
    const credentials = record?.account ?? { salt: '00'.repeat(16), passwordHash: '00'.repeat(64) }
    const validPassword = await withPasswordWork(() => verifyPassword(input.password, credentials))
    if (!record || !validPassword) throw new HttpError(401, 'The email or password is incorrect.')
    const session = newSession(record.id)
    if ('email' in record.account) await store.addSession(session.stored, record.account.passwordHash)
    else await store.migrateEmail(input.email, session.stored, record.account.passwordHash)
    setCookie(res, session.token)
    res.json({ authenticated: true, emailMigrationRequired: false, email: input.email } satisfies AuthState)
  })
  app.post('/api/logout', async (req, res) => {
    const token = sessionToken(req)
    if (token && authenticated(req)) await store.removeSession(digest(token))
    setCookie(res, '', 0)
    res.status(204).end()
  })
  app.post('/api/password', requireAuth, authLimiter, async (req, res) => {
    const input = parse(z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }).strict(), req.body)
    const account = store.account(accountId(req))
    const updated = await withPasswordWork(async () => {
      if (!await verifyPassword(input.currentPassword, account)) throw new HttpError(401, 'The current password is incorrect.')
      return hashPassword(input.newPassword)
    })
    const session = newSession(accountId(req))
    await store.changePassword(updated, session.stored, account.passwordHash)
    setCookie(res, session.token)
    res.status(204).end()
  })

  app.get('/api/words', requireAuth, (req, res) => { res.json(store.words(accountId(req))) })
  app.post('/api/words', requireAuth, async (req, res) => {
    const input = parse(z.object({
      text: z.string().refine(value => validateWord(value) === null, 'Enter a word with 1–80 characters and no line breaks or control characters.').transform(value => value.trim()),
      language: z.enum(['de', 'en']),
    }).strict(), req.body)
    res.status(201).json(await store.addWord(accountId(req), input.text, input.language))
  })
  app.delete('/api/words/:id', requireAuth, async (req, res) => {
    const id = parse(z.uuid(), req.params.id)
    await store.deleteWord(accountId(req), id)
    res.status(204).end()
  })
  app.post('/api/practice', requireAuth, async (req, res) => {
    const input = parse(z.object({ wordId: z.uuid(), correct: z.boolean(), attemptId: z.uuid() }).strict(), req.body)
    res.json(await store.mark(accountId(req), input.wordId, input.correct, input.attemptId))
  })
  app.get('/api/photo-rounds', requireAuth, (req, res) => {
    res.json({ rounds: store.photoRounds(accountId(req)), ocr: { enabled: !!options.ocr, ...store.ocrUsage(), limit: options.ocr?.monthlyLimit ?? 450 } })
  })
  app.post('/api/photo-rounds', requireAuth, async (req, res) => {
    const input = parse(z.object({ wordIds: z.array(z.uuid()).min(1).max(100, 'Use at most 100 words on one numbered sheet.') }).strict(), req.body)
    res.status(201).json(await store.createPhotoRound(accountId(req), input.wordIds))
  })
  app.post('/api/photo-rounds/:id/advance', requireAuth, async (req, res) => {
    const id = parse(z.uuid(), req.params.id)
    const input = parse(z.object({ nextIndex: z.number().int().min(1).max(100) }).strict(), req.body)
    res.json(await store.advancePhotoRound(accountId(req), id, input.nextIndex))
  })
  let photoReading = false
  const photoLimiter = rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Please wait a minute before sending another photo.' } })
  const photoAvailable: express.RequestHandler = (_req, _res, next) => {
    next(options.ocr ? undefined : new HttpError(503, 'Automatic photo reading needs an Azure Free/F0 endpoint and key. You can still review the sheet manually.'))
  }
  app.post('/api/photo-rounds/:id/photo', requireAuth, photoAvailable, photoLimiter, express.raw({ type: ['image/jpeg', 'image/png'], limit: '4mb' }), async (req, res) => {
    const id = parse(z.uuid(), req.params.id)
    const owner = accountId(req)
    const round = store.photoRound(owner, id)
    if (!round.writtenAt || round.reviewedAt) throw new HttpError(409, 'Finish writing first. A reviewed sheet cannot be read again.')
    if (photoReading) throw new HttpError(429, 'Another photo is being read. Please wait and try again.')
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, 'Choose a JPEG or PNG photo first.')
    photoReading = true
    try {
      const image = await normalizePhoto(req.body)
      await store.reserveOcr(options.ocr!.monthlyLimit)
      const recognition = await readAzurePhoto(image, round.words[0].language, round.words.length, options.ocr!)
      res.json(await store.saveRecognition(owner, id, recognition))
    } finally { photoReading = false }
  })
  app.post('/api/photo-rounds/:id/review', requireAuth, async (req, res) => {
    const id = parse(z.uuid(), req.params.id)
    const input = parse(z.object({ results: z.array(z.boolean()).min(1).max(100) }).strict(), req.body)
    res.json(await store.reviewPhotoRound(accountId(req), id, input.results))
  })
  app.delete('/api/photo-rounds/:id', requireAuth, async (req, res) => {
    await store.deletePhotoRound(accountId(req), parse(z.uuid(), req.params.id))
    res.status(204).end()
  })
  app.use('/api', (_req, _res, next) => { next(new HttpError(404, 'Unknown API endpoint.')) })
  if (options.production) {
    app.use(express.static(resolve('dist'), { index: 'index.html', setHeaders: res => { res.setHeader('Cache-Control', 'no-cache') } }))
  }
  const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof HttpError) { res.status(error.status).json({ error: error.message }); return }
    if (error instanceof SyntaxError && 'body' in error) { res.status(400).json({ error: 'Invalid JSON request.' }); return }
    if (error instanceof Error && 'type' in error && error.type === 'entity.too.large') { res.status(413).json({ error: 'Request is too large.' }); return }
    console.error('Request failed', error)
    res.status(500).json({ error: 'The server could not save or load your data. Please retry; check the server logs if this continues.' })
  }
  app.use(handleError)
  return app
}
