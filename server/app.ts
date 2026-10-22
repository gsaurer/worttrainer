import express, { type ErrorRequestHandler, type Request, type Response } from 'express'
import { rateLimit } from 'express-rate-limit'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { resolve } from 'node:path'
import { z } from 'zod'
import { validateWord, type AuthState } from '../shared/model.js'
import { FileStore, parentEmailSchema } from './store.js'
import { hashPassword, verifyPassword } from './passwords.js'
import { HttpError } from './errors.js'

export type AppOptions = {
  store: FileStore
  origin: string
  secureCookie: boolean
  production?: boolean
  setupToken: string
  setupExpiresAt: number
  trustProxy?: boolean
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
    if (options.production) res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
    next()
  })
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers.origin !== options.origin) return next(new HttpError(403, 'Request origin is not allowed. Open the app at its configured address.'))
      if (!req.is('application/json')) return next(new HttpError(415, 'Send requests as application/json.'))
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
    return !!token && store.hasSession(digest(token))
  }
  const requireAuth: express.RequestHandler = (req, _res, next) => {
    next(authenticated(req) ? undefined : new HttpError(401, 'Please sign in to your parent account.'))
  }
  function setCookie(res: Response, token: string, maxAge = maxAgeSeconds) {
    res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${options.secureCookie ? '; Secure' : ''}`)
  }
  function newSession() {
    const token = randomBytes(32).toString('base64url')
    return { token, stored: { tokenHash: digest(token), expiresAt: Date.now() + maxAgeSeconds * 1000 } }
  }
  function authState(req: Request): AuthState {
    const signedIn = authenticated(req)
    const account = store.account
    return {
      authenticated: signedIn,
      setupRequired: !account,
      emailMigrationRequired: !!account && !('email' in account),
      email: signedIn && account && 'email' in account ? account.email : null,
    }
  }

  app.get('/api/health', (_req, res) => { res.json({ ok: true }) })
  app.get('/api/session', (req, res) => { res.json(authState(req)) })
  app.post('/api/setup', authLimiter, async (req, res) => {
    if (store.account) throw new HttpError(409, 'The parent account is already configured.')
    const input = parse(z.object({ email: parentEmailSchema, password, setupToken: z.string().max(128) }).strict(), req.body)
    if (Date.now() > options.setupExpiresAt ||
        !timingSafeEqual(Buffer.from(digest(input.setupToken), 'hex'), Buffer.from(digest(options.setupToken), 'hex'))) {
      throw new HttpError(403, 'Invalid or expired setup code. Use the setup link printed by the server, or restart it for a fresh link.')
    }
    const account = { email: input.email, ...await withPasswordWork(() => hashPassword(input.password)) }
    const session = newSession()
    await store.initialize(account, session.stored)
    setCookie(res, session.token)
    res.status(201).json({ authenticated: true, setupRequired: false, emailMigrationRequired: false, email: account.email } satisfies AuthState)
  })
  app.post('/api/login', authLimiter, async (req, res) => {
    const input = parse(z.object({ email: parentEmailSchema, password: z.string().min(1).max(128) }).strict(), req.body)
    const account = store.account
    if (!account) throw new HttpError(409, 'Create the parent account with the server’s setup link first.')
    const validPassword = await withPasswordWork(() => verifyPassword(input.password, account))
    if (!validPassword || ('email' in account && input.email !== account.email)) throw new HttpError(401, 'The email or password is incorrect.')
    const session = newSession()
    if ('email' in account) await store.addSession(session.stored, account.passwordHash)
    else await store.migrateEmail(input.email, session.stored, account.passwordHash)
    setCookie(res, session.token)
    res.json({ authenticated: true, setupRequired: false, emailMigrationRequired: false, email: input.email } satisfies AuthState)
  })
  app.post('/api/logout', async (req, res) => {
    const token = sessionToken(req)
    if (token && authenticated(req)) await store.removeSession(digest(token))
    setCookie(res, '', 0)
    res.status(204).end()
  })
  app.post('/api/password', requireAuth, authLimiter, async (req, res) => {
    const input = parse(z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }).strict(), req.body)
    const account = store.account!
    const updated = await withPasswordWork(async () => {
      if (!await verifyPassword(input.currentPassword, account)) throw new HttpError(401, 'The current password is incorrect.')
      return hashPassword(input.newPassword)
    })
    const session = newSession()
    await store.changePassword(updated, session.stored, account.passwordHash)
    setCookie(res, session.token)
    res.status(204).end()
  })

  app.get('/api/words', requireAuth, (_req, res) => { res.json(store.words) })
  app.post('/api/words', requireAuth, async (req, res) => {
    const input = parse(z.object({
      text: z.string().refine(value => validateWord(value) === null, 'Enter a word with 1–80 characters and no line breaks or control characters.').transform(value => value.trim()),
      language: z.enum(['de', 'en']),
    }).strict(), req.body)
    res.status(201).json(await store.addWord(input.text, input.language))
  })
  app.delete('/api/words/:id', requireAuth, async (req, res) => {
    const id = parse(z.uuid(), req.params.id)
    await store.deleteWord(id)
    res.status(204).end()
  })
  app.post('/api/practice', requireAuth, async (req, res) => {
    const input = parse(z.object({ wordId: z.uuid(), correct: z.boolean(), attemptId: z.uuid() }).strict(), req.body)
    res.json(await store.mark(input.wordId, input.correct, input.attemptId))
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
