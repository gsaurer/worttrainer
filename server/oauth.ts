import express from 'express'
import { rateLimit } from 'express-rate-limit'
import OAuth2Server from '@node-oauth/oauth2-server'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { HttpError } from './errors.js'
import type { FileStore } from './store.js'

export const oauthScopes = ['words:read', 'words:write'] as const
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const secret = (prefix: string) => prefix + randomBytes(32).toString('base64url')
const fingerprint = (store: FileStore, accountId: string) => hash(store.account(accountId).passwordHash)
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const scopeSchema = z.array(z.enum(oauthScopes)).min(1).max(2)
const storedTokenSchema = z.object({ hash: hashSchema, expiresAt: z.number().int().positive() }).strict()
const clientSchema = z.object({
  id: z.uuid(), name: z.string().min(1).max(100), redirectUris: z.array(z.url()).min(1).max(5),
}).strict()
const grantSchema = z.object({
  id: z.uuid(), clientId: z.uuid(), accountId: z.uuid(), credentialHash: hashSchema,
  resource: z.url(), scopes: scopeSchema, createdAt: z.number().int().positive(),
  code: storedTokenSchema.extend({ challenge: z.string(), redirectUri: z.url() }).strict().optional(),
  access: storedTokenSchema.optional(), refresh: storedTokenSchema.optional(),
  usedRefreshHashes: z.array(hashSchema).max(64),
}).strict()
export const oauthStateSchema = z.object({
  clients: z.array(clientSchema).max(2000), grants: z.array(grantSchema).max(4000),
}).strict()
export type OAuthState = z.infer<typeof oauthStateSchema>
type Grant = z.infer<typeof grantSchema>

export function createOAuth(store: FileStore, origin: string) {
  const resource = `${origin}/api/mcp`
  const requestSchema = z.object({
    client_id: z.uuid(), response_type: z.literal('code'), redirect_uri: z.url().max(2048),
    state: z.string().min(1).max(2048).regex(/^[\x20-\x7e]+$/),
    scope: z.string().max(100).default(oauthScopes.join(' ')),
    code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code_challenge_method: z.literal('S256'),
    resource: z.literal(resource).optional(),
  })
  type Pending = { query: z.infer<typeof requestSchema>; expiresAt: number; accountId?: string }
  const pending = new Map<string, Pending>()
  const validGrant = (grant: Grant) => store.hasAccount(grant.accountId) && fingerprint(store, grant.accountId) === grant.credentialHash && grant.resource === resource
  const findClient = (id: string) => store.oauthState().clients.find(client => client.id === id)
  const clientData = (id: string): OAuth2Server.Client | null => {
    const client = findClient(id)
    return client ? { id, redirectUris: client.redirectUris, grants: ['authorization_code', 'refresh_token'] } : null
  }
  const userData = (grant: Grant) => ({ id: grant.accountId, grantId: grant.id, credentialHash: grant.credentialHash })
  const grantForUser = (user: OAuth2Server.User) => {
    const grant = store.oauthState().grants.find(item => item.id === user.grantId)
    if (!grant || !validGrant(grant) || grant.accountId !== user.id || grant.credentialHash !== user.credentialHash) throw new OAuth2Server.InvalidGrantError('The connection expired or was disconnected. Please connect again.')
    return grant
  }
  const engine = new OAuth2Server({
    requirePKCE: true, authorizationCodeLifetime: 120, accessTokenLifetime: 3600,
    refreshTokenLifetime: 30 * 24 * 60 * 60, alwaysIssueNewRefreshToken: true,
    requireClientAuthentication: { authorization_code: false, refresh_token: false },
    model: {
      getClient: async (id, clientSecret) => clientSecret ? null : clientData(id),
      generateAccessToken: async () => secret('wtr_access_'),
      generateRefreshToken: async () => secret('wtr_refresh_'),
      generateAuthorizationCode: async () => secret('wtr_code_'),
      validateRedirectUri: async (uri, client) => Array.isArray(client.redirectUris) && client.redirectUris.includes(uri),
      validateScope: async (_user, _client, scopes) => scopes?.length && scopes.every(scope => (oauthScopes as readonly string[]).includes(scope)) ? [...new Set(scopes)] : false,
      getAccessToken: async () => null,
      saveAuthorizationCode: async (code, client, user) => {
        const grant: Grant = {
          id: randomUUID(), clientId: client.id, accountId: user.id, credentialHash: user.credentialHash,
          resource, scopes: scopeSchema.parse(code.scope), createdAt: Date.now(), usedRefreshHashes: [],
          code: { hash: hash(code.authorizationCode), expiresAt: code.expiresAt.getTime(), challenge: code.codeChallenge!, redirectUri: code.redirectUri },
        }
        await store.oauthTransaction(state => {
          if (!validGrant(grant)) throw new OAuth2Server.InvalidGrantError('Please sign in again.')
          state.grants = state.grants.filter(item => validGrant(item) && (item.refresh?.expiresAt ?? item.code?.expiresAt ?? 0) > Date.now())
          if (state.grants.filter(item => item.accountId === user.id).length >= 30) throw new HttpError(409, 'Disconnect an existing app before connecting another.')
          state.grants.push(grant)
        })
        return { ...code, client, user: userData(grant) }
      },
      getAuthorizationCode: async code => {
        const grant = store.oauthState().grants.find(item => item.code?.hash === hash(code))
        if (!grant?.code || !validGrant(grant)) return null
        return {
          authorizationCode: code, expiresAt: new Date(grant.code.expiresAt), redirectUri: grant.code.redirectUri,
          codeChallenge: grant.code.challenge, codeChallengeMethod: 'S256', scope: grant.scopes,
          client: clientData(grant.clientId)!, user: userData(grant),
        }
      },
      revokeAuthorizationCode: async code => store.oauthTransaction(state => {
        const grant = state.grants.find(item => item.id === code.user.grantId && item.code?.hash === hash(code.authorizationCode))
        if (!grant || !validGrant(grant)) return false
        delete grant.code
        return true
      }),
      getRefreshToken: async token => {
        const digest = hash(token)
        const grant = store.oauthState().grants.find(item => item.refresh?.hash === digest)
        if (!grant?.refresh || !validGrant(grant)) {
          if (store.oauthState().grants.some(item => item.usedRefreshHashes.includes(digest))) {
            await store.oauthTransaction(state => { state.grants = state.grants.filter(item => !item.usedRefreshHashes.includes(digest)) })
          }
          return null
        }
        return { refreshToken: token, refreshTokenExpiresAt: new Date(grant.refresh.expiresAt), scope: grant.scopes, client: clientData(grant.clientId)!, user: userData(grant) }
      },
      revokeToken: async token => store.oauthTransaction(state => {
        const grant = state.grants.find(item => item.id === token.user.grantId && item.refresh?.hash === hash(token.refreshToken))
        if (!grant || !validGrant(grant)) return false
        grant.usedRefreshHashes = [...grant.usedRefreshHashes, grant.refresh!.hash].slice(-64)
        delete grant.refresh
        return true
      }),
      saveToken: async (token, client, user) => {
        await store.oauthTransaction(state => {
          const checked = grantForUser(user)
          const grant = state.grants.find(item => item.id === checked.id)!
          if (grant.clientId !== client.id) throw new OAuth2Server.InvalidGrantError('The client does not match the connection.')
          grant.scopes = scopeSchema.parse(token.scope)
          grant.access = { hash: hash(token.accessToken), expiresAt: token.accessTokenExpiresAt!.getTime() }
          grant.refresh = { hash: hash(token.refreshToken!), expiresAt: token.refreshTokenExpiresAt!.getTime() }
        })
        return { ...token, accessToken: z.string().parse(token.accessToken), client, user }
      },
    } satisfies OAuth2Server.AuthorizationCodeModel & OAuth2Server.RefreshTokenModel,
  })

  function readPending(id: unknown) {
    if (typeof id !== 'string') throw new HttpError(400, 'The connection request is invalid. Start again from your chat app.')
    const entry = pending.get(hash(id))
    if (!entry || entry.expiresAt <= Date.now()) throw new HttpError(400, 'The connection request expired. Start again from your chat app.')
    return entry
  }
  const protocol = express.Router()
  protocol.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    if (req.headers.origin && req.headers.origin !== origin) return next(new HttpError(403, 'Request origin is not allowed.'))
    next()
  })
  const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false })
  protocol.get('/authorize', limiter, (req, res) => {
    const parsed = requestSchema.safeParse(req.query)
    if (!parsed.success) throw new HttpError(400, 'Invalid OAuth request. Use authorization code, S256 PKCE and the Worttrainer MCP resource.')
    const query = parsed.data
    const client = findClient(query.client_id)
    if (!client?.redirectUris.includes(query.redirect_uri)) throw new HttpError(400, 'The callback does not match the registered app.')
    if (!scopeSchema.safeParse([...new Set(query.scope.split(' '))]).success) throw new HttpError(400, 'Request only the supported Worttrainer permissions.')
    for (const [id, entry] of pending) if (entry.expiresAt <= Date.now()) pending.delete(id)
    if (pending.size >= 1000) throw new HttpError(429, 'Too many pending connections. Please try again later.')
    const id = secret('')
    pending.set(hash(id), { query, expiresAt: Date.now() + 10 * 60_000 })
    res.redirect(303, `/?oauth_request=${encodeURIComponent(id)}`)
  })
  protocol.post('/register', rateLimit({ windowMs: 60 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }), express.json({ limit: '16kb', inflate: false }), async (req, res) => {
    const parsed = z.object({
      client_name: z.string().trim().min(1).max(100).optional(),
      redirect_uris: z.array(z.url().max(2048).refine(uri => {
        const url = new URL(uri)
        return url.protocol === 'https:' && !url.username && !url.password && !url.hash
      })).min(1).max(5),
      token_endpoint_auth_method: z.literal('none').default('none'),
      grant_types: z.array(z.enum(['authorization_code', 'refresh_token'])).default(['authorization_code', 'refresh_token']),
      response_types: z.array(z.literal('code')).default(['code']),
    }).safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_client_metadata', error_description: 'Use HTTPS callback URLs, authorization_code with PKCE, and token_endpoint_auth_method none.' })
    const input = parsed.data
    const client = { id: randomUUID(), name: input.client_name ?? new URL(input.redirect_uris[0]).hostname, redirectUris: input.redirect_uris }
    await store.oauthTransaction(state => {
      if (state.clients.length >= 2000) throw new HttpError(429, 'Client registration is full. Contact the server owner.')
      state.clients.push(client)
    })
    return res.status(201).json({ client_id: client.id, client_name: client.name, redirect_uris: client.redirectUris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] })
  })
  protocol.post('/token', limiter, express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 20, inflate: false }), async (req, res) => {
    if (!req.is('application/x-www-form-urlencoded')) return res.status(415).json({ error: 'invalid_request' })
    if (req.body.resource !== undefined && req.body.resource !== resource) return res.status(400).json({ error: 'invalid_target' })
    if (!['authorization_code', 'refresh_token'].includes(req.body.grant_type)) return res.status(400).json({ error: 'unsupported_grant_type' })
    const response = new OAuth2Server.Response()
    try {
      await engine.token(new OAuth2Server.Request(req), response)
      res.setHeader('Pragma', 'no-cache')
      return res.status(response.status ?? 200).json(response.body)
    } catch (error) {
      if (!(error instanceof OAuth2Server.OAuthError) || error.code >= 500) throw new HttpError(500, 'The connection could not be completed. Please try again.')
      return res.status(error.code).json({ error: error.name, error_description: error.message })
    }
  })
  protocol.post('/revoke', limiter, express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 10, inflate: false }), async (req, res) => {
    const parsed = z.object({ token: z.string().min(1).max(200), client_id: z.uuid() }).safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
    const digest = hash(parsed.data.token)
    await store.oauthTransaction(state => {
      state.grants = state.grants.filter(grant => grant.clientId !== parsed.data.client_id || (grant.access?.hash !== digest && grant.refresh?.hash !== digest))
    })
    return res.status(200).json({})
  })

  return {
    protocol,
    details(id: unknown, accountId: string) {
      const entry = readPending(id)
      entry.accountId = accountId
      const client = findClient(entry.query.client_id)!
      const account = store.account(accountId)
      return { clientName: client.name, clientOrigin: new URL(entry.query.redirect_uri).origin, scopes: entry.query.scope.split(' '), accountEmail: 'email' in account ? account.email : account.username }
    },
    async decide(id: string, approve: boolean, accountId: string) {
      const entry = readPending(id)
      if (entry.accountId !== accountId) throw new HttpError(403, 'The signed-in account changed. Review the connection again.')
      pending.delete(hash(id))
      const redirect = new URL(entry.query.redirect_uri)
      if (approve) {
        const response = new OAuth2Server.Response()
        const code = await engine.authorize(new OAuth2Server.Request({ method: 'GET', headers: {}, query: entry.query, body: {} }), response, {
          authenticateHandler: { handle: async () => ({ id: accountId, credentialHash: fingerprint(store, accountId) }) },
        })
        redirect.searchParams.set('code', code.authorizationCode)
      } else redirect.searchParams.set('error', 'access_denied')
      redirect.searchParams.set('state', entry.query.state)
      redirect.searchParams.set('iss', origin)
      return { redirect: redirect.href }
    },
    connections(accountId: string) {
      return {
        endpoint: resource,
        connections: store.oauthState().grants.filter(grant => grant.accountId === accountId && validGrant(grant) && (grant.refresh?.expiresAt ?? 0) > Date.now()).map(grant => {
          const client = findClient(grant.clientId)!
          return { id: grant.id, clientName: client.name, clientOrigin: new URL(client.redirectUris[0]).origin, scopes: grant.scopes, createdAt: new Date(grant.createdAt).toISOString() }
        }),
      }
    },
    async disconnect(accountId: string, id: string) {
      await store.oauthTransaction(state => { state.grants = state.grants.filter(grant => grant.accountId !== accountId || grant.id !== id) })
    },
    access(token: string) {
      const grant = store.oauthState().grants.find(item => item.access?.hash === hash(token))
      return grant && validGrant(grant) && grant.access!.expiresAt > Date.now() ? { accountId: grant.accountId, scopes: grant.scopes } : null
    },
  }
}

export type OAuthService = ReturnType<typeof createOAuth>