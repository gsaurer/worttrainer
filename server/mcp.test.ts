// @vitest-environment node
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { FileStore } from './store.js'

const origin = 'http://localhost:5182'
const host = 'localhost:5182'
const digest = (token: string) => createHash('sha256').update(token).digest('hex')
let directory: string
let store: FileStore
let app: ReturnType<typeof createApp>
let firstId: string
let secondId: string
let cookie: string
let secondCookie: string

async function register(email: string) {
  const id = randomUUID()
  const token = randomBytes(32).toString('base64url')
  await store.register({ email, salt: '00'.repeat(16), passwordHash: '00'.repeat(64) }, {
    accountId: id, tokenHash: digest(token), expiresAt: Date.now() + 60_000,
  })
  return { id, cookie: `worttrainer_session=${token}` }
}

async function issue(session = cookie) {
  const response = await request(app).post('/api/mcp/token').set('Origin', origin).set('Cookie', session).send({}).expect(201)
  expect(response.headers['cache-control']).toBe('no-store')
  return response.body.token as string
}

function rpc(token: string, method: string, params: object = {}) {
  return request(app).post('/api/mcp').set('Host', host)
    .set('Authorization', `Bearer ${token}`).set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method, params })
}

function call(token: string, name: string, args: object) {
  return rpc(token, 'tools/call', { name, arguments: args })
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'worttrainer-mcp-'))
  store = await FileStore.open(join(directory, 'store.json'))
  const first = await register('first@example.test')
  const second = await register('second@example.test')
  firstId = first.id
  secondId = second.id
  cookie = first.cookie
  secondCookie = second.cookie
  app = createApp({ store, origin, secureCookie: false })
})

afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

async function startOAuth(scope = 'words:read words:write', redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect') {
  const registered = await request(app).post('/api/oauth/register').send({ client_name: 'ChatGPT', redirect_uris: [redirectUri] }).expect(201)
  const verifier = randomBytes(32).toString('base64url')
  const query = {
    client_id: registered.body.client_id as string, response_type: 'code', redirect_uri: redirectUri,
    state: randomBytes(16).toString('base64url'), scope,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: `${origin}/api/mcp`,
  }
  const started = await request(app).get('/api/oauth/authorize').query(query).expect(303)
  const id = new URL(started.headers.location, origin).searchParams.get('oauth_request')!
  return { query, id, verifier }
}

async function consentOAuth(flow: Awaited<ReturnType<typeof startOAuth>>, session = cookie) {
  await request(app).get('/api/oauth/request').query({ id: flow.id }).set('Cookie', session).expect(200)
  const consent = await request(app).post('/api/oauth/consent').set('Origin', origin).set('Cookie', session).send({ id: flow.id, approve: true }).expect(200)
  const redirect = new URL(consent.body.redirect)
  const registeredRedirect = new URL(flow.query.redirect_uri)
  expect(redirect.origin + redirect.pathname).toBe(registeredRedirect.origin + registeredRedirect.pathname)
  expect(redirect.searchParams.get('state')).toBe(flow.query.state)
  expect(redirect.searchParams.get('iss')).toBe(origin)
  return { grant_type: 'authorization_code', client_id: flow.query.client_id, code: redirect.searchParams.get('code')!, code_verifier: flow.verifier, redirect_uri: flow.query.redirect_uri, resource: flow.query.resource }
}

describe('web connector OAuth', () => {
  it('dynamically registers the VS Code desktop and web callbacks together', async () => {
    const redirectUris = ['http://127.0.0.1:33418', 'https://vscode.dev/redirect']
    const response = await request(app).post('/api/oauth/register').send({
      client_name: 'Visual Studio Code', redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
    }).expect(201)
    expect(response.body).toMatchObject({ client_name: 'Visual Studio Code', redirect_uris: redirectUris, token_endpoint_auth_method: 'none' })
    expect(store.oauthState().clients).toContainEqual({ id: response.body.client_id, name: 'Visual Studio Code', redirectUris })
  })

  it.each(['http://127.0.0.1:33418', 'http://[::1]:33418'])('completes the native PKCE flow with loopback callback %s and rejects an unregistered port', async redirectUri => {
    const flow = await startOAuth('words:read words:write', redirectUri)
    const otherPort = new URL(redirectUri)
    otherPort.port = '33419'
    await request(app).get('/api/oauth/authorize').query({ ...flow.query, redirect_uri: otherPort.href }).expect(400)
    const exchange = await consentOAuth(flow)
    const token = await request(app).post('/api/oauth/token').type('form').send(exchange).expect(200)
    expect(token.body).toMatchObject({ token_type: 'Bearer', scope: 'words:read words:write' })
    await rpc(token.body.access_token, 'tools/list').expect(200)
  })

  it('links the consenting account through PKCE, persists only hashes, and reads and adds its words', async () => {
    const flow = await startOAuth()
    await request(app).get('/api/oauth/request').query({ id: flow.id }).expect(401)
    const details = await request(app).get('/api/oauth/request').query({ id: flow.id }).set('Cookie', cookie).expect(200)
    expect(details.body).toEqual({ clientName: 'ChatGPT', clientOrigin: 'https://chatgpt.com', scopes: ['words:read', 'words:write'], accountEmail: 'first@example.test' })
    await store.addWord(secondId, 'private other account', 'en')
    const exchange = await consentOAuth(flow)
    const token = await request(app).post('/api/oauth/token').type('form').send(exchange).expect(200)
    expect(token.body).toMatchObject({ token_type: 'Bearer', scope: 'words:read words:write' })
    expect(token.body.access_token).toMatch(/^wtr_access_[A-Za-z0-9_-]{43}$/)
    expect(token.body.refresh_token).toMatch(/^wtr_refresh_[A-Za-z0-9_-]{43}$/)
    await call(token.body.access_token, 'worttrainer_add_word', { text: 'butterfly', language: 'en' }).expect(200)
    const words = await call(token.body.access_token, 'worttrainer_get_words', {}).expect(200)
    expect(words.body.result.structuredContent.words.map((word: { text: string }) => word.text)).toEqual(['butterfly'])
    const text = await readFile(join(directory, 'store.json'), 'utf8')
    for (const value of [token.body.access_token, token.body.refresh_token, exchange.code]) expect(text).not.toContain(value)
    store = await FileStore.open(join(directory, 'store.json'))
    app = createApp({ store, origin, secureCookie: false })
    await call(token.body.access_token, 'worttrainer_get_words', {}).expect(200)
    await request(app).get('/api/words').set('Cookie', `worttrainer_session=${token.body.access_token}`).expect(401)
    await request(app).post('/api/oauth/token').type('form').send(exchange).expect(400)
  })

  it('allows a read-only grant without permitting writes', async () => {
    const word = await store.addWord(firstId, 'butterfly', 'en')
    const before = store.exportData(firstId)
    const flow = await startOAuth('words:read')
    const exchange = await consentOAuth(flow)
    const token = await request(app).post('/api/oauth/token').type('form').send(exchange).expect(200)
    await call(token.body.access_token, 'worttrainer_get_words', {}).expect(200)
    const denied = await call(token.body.access_token, 'worttrainer_add_word', { text: 'unauthorized', language: 'en' }).expect(200)
    expect(denied.body.result).toMatchObject({ isError: true })
    expect(denied.body.result._meta['mcp/www_authenticate'][0]).toContain('words:write')
    for (const [name, args] of [
      ['worttrainer_move_word', { wordId: word.id, category: 'minus' }],
      ['worttrainer_record_mistake', { wordId: word.id, attemptId: randomUUID(), spelling: 'buterfly' }],
      ['worttrainer_record_challenge', { language: 'en', words: [{ correctWord: 'butterfly', correct: true }, { correctWord: 'unauthorized', correct: false }] }],
    ] as const) {
      const response = await call(token.body.access_token, name, args).expect(200)
      expect(response.body.result.isError).toBe(true)
      expect(response.body.result._meta['mcp/www_authenticate'][0]).toContain('words:write')
    }
    expect(store.words(firstId)).toEqual(before.words)
    expect(store.exportData(firstId).attempts).toEqual(before.attempts)
    expect(store.challenges(firstId)).toEqual(before.challenges)
  })

  it('requires same-origin explicit consent and preserves state when the user declines', async () => {
    const flow = await startOAuth()
    await request(app).get('/api/oauth/request').query({ id: flow.id }).set('Cookie', cookie).expect(200)
    await request(app).post('/api/oauth/consent').set('Origin', origin).send({ id: flow.id, approve: true }).expect(401)
    await request(app).post('/api/oauth/consent').set('Cookie', cookie).send({ id: flow.id, approve: true }).expect(403)
    await request(app).post('/api/oauth/consent').set('Origin', origin).set('Cookie', secondCookie).send({ id: flow.id, approve: true }).expect(403)
    const denied = await request(app).post('/api/oauth/consent').set('Origin', origin).set('Cookie', cookie).send({ id: flow.id, approve: false }).expect(200)
    const callback = new URL(denied.body.redirect)
    expect(callback.searchParams.get('error')).toBe('access_denied')
    expect(callback.searchParams.get('code')).toBeNull()
    expect(callback.searchParams.get('state')).toBe(flow.query.state)
    expect(callback.searchParams.get('iss')).toBe(origin)
    expect(store.oauthState().grants).toEqual([])
    await request(app).get('/api/oauth/request').query({ id: flow.id }).set('Cookie', cookie).expect(400)
  })

  it('rejects unsafe registration, unregistered redirects, invalid resources, plain PKCE and unsupported scopes', async () => {
    for (const uri of [
      'http://evil.example/callback', 'javascript:alert(1)', 'https://evil.example/callback#fragment', 'https://user:password@evil.example/callback',
      'http://127.0.0.1.evil.example:33418', 'http://127.0.0.1@evil.example:33418', 'http://evil.example@127.0.0.1:33418',
      'http://localhost:33418', 'http://192.168.10.5:33418', 'http://0.0.0.0:33418', 'http://[::2]:33418',
      'http://127.0.0.1:33418/#fragment', 'http://user:password@[::1]:33418',
    ]) {
      await request(app).post('/api/oauth/register').send({ redirect_uris: [uri] }).expect(400)
    }
    const flow = await startOAuth()
    for (const change of [
      { redirect_uri: 'https://evil.example/callback' }, { resource: 'https://other.example/api/mcp' },
      { code_challenge_method: 'plain' }, { code_challenge: '' }, { scope: 'account:delete' }, { response_type: 'token' },
    ]) await request(app).get('/api/oauth/authorize').query({ ...flow.query, ...change }).expect(400)
    expect(store.oauthState().grants).toEqual([])
    const exchange = await consentOAuth(flow)
    await request(app).post('/api/oauth/token').type('form').send({ ...exchange, resource: 'https://other.example/api/mcp' }).expect(400)
    await request(app).post('/api/oauth/token').type('form').send(exchange).expect(200)
  })

  it('rejects incorrect PKCE and callback proofs and consumes codes once even under concurrency', async () => {
    const wrongProof = await consentOAuth(await startOAuth())
    await request(app).post('/api/oauth/token').type('form').send({ ...wrongProof, code_verifier: randomBytes(32).toString('base64url') }).expect(400)
    await request(app).post('/api/oauth/token').type('form').send(wrongProof).expect(400)
    const wrongCallback = await consentOAuth(await startOAuth())
    await request(app).post('/api/oauth/token').type('form').send({ ...wrongCallback, redirect_uri: 'https://evil.example/callback' }).expect(400)
    const exchange = await consentOAuth(await startOAuth())
    const results = await Promise.all([request(app).post('/api/oauth/token').type('form').send(exchange), request(app).post('/api/oauth/token').type('form').send(exchange)])
    expect(results.map(result => result.status).sort()).toEqual([200, 400])
  })

  it('rotates refresh tokens, rejects scope escalation, and revokes the connection on reuse', async () => {
    const flow = await startOAuth('words:read')
    const issued = await request(app).post('/api/oauth/token').type('form').send(await consentOAuth(flow)).expect(200)
    const refresh = { grant_type: 'refresh_token', client_id: flow.query.client_id, refresh_token: issued.body.refresh_token, resource: flow.query.resource }
    await request(app).post('/api/oauth/token').type('form').send({ ...refresh, scope: 'words:read words:write' }).expect(400)
    const rotated = await request(app).post('/api/oauth/token').type('form').send(refresh).expect(200)
    expect(rotated.body.refresh_token).not.toBe(issued.body.refresh_token)
    await rpc(issued.body.access_token, 'tools/list').expect(401)
    await rpc(rotated.body.access_token, 'tools/list').expect(200)
    await request(app).post('/api/oauth/token').type('form').send(refresh).expect(400)
    await rpc(rotated.body.access_token, 'tools/list').expect(401)
  })

  it('rejects malformed token requests and binds token exchange and revocation to the registered client', async () => {
    await request(app).post('/api/oauth/token').type('form').expect(400)
    await request(app).post('/api/oauth/token').send({ grant_type: 'authorization_code' }).expect(415)
    const flow = await startOAuth()
    const otherFlow = await startOAuth()
    const exchange = await consentOAuth(flow)
    await request(app).post('/api/oauth/token').type('form').send({ ...exchange, client_id: otherFlow.query.client_id }).expect(400)
    const issued = await request(app).post('/api/oauth/token').type('form').send(exchange).expect(200)
    const refresh = { grant_type: 'refresh_token', client_id: flow.query.client_id, refresh_token: issued.body.refresh_token }
    await request(app).post('/api/oauth/token').type('form').send({ ...refresh, client_id: otherFlow.query.client_id }).expect(400)
    await request(app).post('/api/oauth/revoke').type('form').send({ token: issued.body.access_token, client_id: otherFlow.query.client_id }).expect(200)
    await rpc(issued.body.access_token, 'tools/list').expect(200)
    await request(app).post('/api/oauth/revoke').type('form').send({ token: issued.body.refresh_token, client_id: flow.query.client_id }).expect(200)
    await rpc(issued.body.access_token, 'tools/list').expect(401)
    await request(app).post('/api/oauth/token').type('form').send(refresh).expect(400)
  })

  it('lists and disconnects only owned connections, revokes both tokens, and preserves word progress', async () => {
    const flow = await startOAuth()
    const first = await request(app).post('/api/oauth/token').type('form').send(await consentOAuth(flow)).expect(200)
    const secondFlow = await startOAuth()
    const second = await request(app).post('/api/oauth/token').type('form').send(await consentOAuth(secondFlow, secondCookie)).expect(200)
    const before = store.exportData(firstId)
    await request(app).get('/api/oauth/connections').expect(401)
    const listing = await request(app).get('/api/oauth/connections').set('Cookie', cookie).expect(200)
    expect(listing.body.connections).toHaveLength(1)
    expect(JSON.stringify(listing.body)).not.toContain('wtr_access_')
    expect(JSON.stringify(listing.body)).not.toContain('wtr_refresh_')
    const id = listing.body.connections[0].id
    await request(app).delete(`/api/oauth/connections/${id}`).set('Cookie', cookie).send({}).expect(403)
    await request(app).delete(`/api/oauth/connections/${id}`).set('Cookie', secondCookie).set('Origin', origin).send({}).expect(204)
    await rpc(first.body.access_token, 'tools/list').expect(200)
    await request(app).delete(`/api/oauth/connections/${id}`).set('Cookie', cookie).set('Origin', origin).send({}).expect(204)
    await rpc(first.body.access_token, 'tools/list').expect(401)
    await rpc(second.body.access_token, 'tools/list').expect(200)
    await request(app).post('/api/oauth/token').type('form').send({ grant_type: 'refresh_token', client_id: flow.query.client_id, refresh_token: first.body.refresh_token }).expect(400)
    expect(store.exportData(firstId).words).toEqual(before.words)
    expect(store.exportData(firstId).attempts).toEqual(before.attempts)
  })

  it('rejects expired codes and tokens and invalidates OAuth connections after password recovery', async () => {
    const expiredCode = await consentOAuth(await startOAuth())
    await store.oauthTransaction(state => { state.grants[0].code!.expiresAt = Date.now() - 1000 })
    await request(app).post('/api/oauth/token').type('form').send(expiredCode).expect(400)
    const flow = await startOAuth()
    const issued = await request(app).post('/api/oauth/token').type('form').send(await consentOAuth(flow)).expect(200)
    const otherFlow = await startOAuth()
    const other = await request(app).post('/api/oauth/token').type('form').send(await consentOAuth(otherFlow, secondCookie)).expect(200)
    await store.oauthTransaction(state => { state.grants.find(grant => grant.accountId === firstId)!.access!.expiresAt = Date.now() - 1000 })
    await rpc(issued.body.access_token, 'tools/list').expect(401)
    const refreshed = await request(app).post('/api/oauth/token').type('form').send({ grant_type: 'refresh_token', client_id: flow.query.client_id, refresh_token: issued.body.refresh_token }).expect(200)
    await store.recoverPassword(firstId, { salt: '11'.repeat(16), passwordHash: '11'.repeat(64) })
    await rpc(refreshed.body.access_token, 'tools/list').expect(401)
    await request(app).post('/api/oauth/token').type('form').send({ grant_type: 'refresh_token', client_id: flow.query.client_id, refresh_token: refreshed.body.refresh_token }).expect(400)
    await rpc(other.body.access_token, 'tools/list').expect(200)
  })
})

describe('account-scoped Streamable HTTP MCP', () => {
  it('advertises OAuth discovery for web connectors without exposing account data', async () => {
    const response = await request(app).post('/api/mcp').set('Host', host).send({}).expect(401)
    expect(response.headers['www-authenticate']).toContain(`resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`)
    const resource = await request(app).get('/.well-known/oauth-protected-resource/api/mcp').expect(200)
    expect(resource.body).toMatchObject({ resource: `${origin}/api/mcp`, authorization_servers: [origin], scopes_supported: ['words:read', 'words:write'] })
    const authorization = await request(app).get('/.well-known/oauth-authorization-server').expect(200)
    expect(authorization.body).toMatchObject({
      issuer: origin,
      authorization_endpoint: `${origin}/api/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      code_challenge_methods_supported: ['S256'],
    })
  })

  it('protects token creation and keeps MCP credentials hashed, expiring and separate from browser sessions', async () => {
    await request(app).post('/api/mcp/token').set('Origin', origin).send({}).expect(401)
    await request(app).post('/api/mcp/token').set('Cookie', cookie).send({}).expect(403)
    await request(app).post('/api/mcp/token').set('Cookie', cookie).set('Origin', 'https://evil.example').send({}).expect(403)
    const token = await issue()
    expect(token).toMatch(/^wtr_mcp_[A-Za-z0-9_-]{43}$/)
    expect(store.sessionAccount(digest(token))).toBe(firstId)
    expect(store.sessionAccount(digest(token), Date.now() + 8 * 24 * 60 * 60 * 1000)).toBeNull()
    expect(await readFile(join(directory, 'store.json'), 'utf8')).not.toContain(token)
    await request(app).get('/api/words').set('Cookie', `worttrainer_session=${token}`).expect(401)
    await request(app).get('/api/words').set('Authorization', `Bearer ${token}`).expect(401)
    await rpc(cookie.split('=')[1], 'tools/list').expect(401)
  })

  it('initializes and advertises exactly the read and write tools with schemas and annotations', async () => {
    const token = await issue()
    const initialized = await rpc(token, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test-client', version: '1.0.0' } }).expect(200)
    expect(initialized.body.result.serverInfo.name).toBe('worttrainer-mcp-server')
    expect(initialized.headers['mcp-session-id']).toBeUndefined()
    const response = await rpc(token, 'tools/list').expect(200)
    expect(response.body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(['worttrainer_get_words', 'worttrainer_add_word', 'worttrainer_move_word', 'worttrainer_record_mistake', 'worttrainer_record_challenge'])
    expect(response.body.result.tools[0]).toMatchObject({ inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, annotations: { readOnlyHint: true } })
    expect(response.body.result.tools[1]).toMatchObject({ annotations: { readOnlyHint: false, destructiveHint: false } })
    for (const tool of response.body.result.tools.slice(2)) {
      expect(tool).toMatchObject({
        inputSchema: { type: 'object', additionalProperties: false }, outputSchema: { type: 'object' },
        annotations: { readOnlyHint: false, idempotentHint: tool.name === 'worttrainer_move_word', openWorldHint: false },
        _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['words:write'] }] },
      })
    }
    await request(app).post('/api/mcp').set('Host', host).set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', method: 'notifications/initialized' }).expect(202)
  })

  it('filters and paginates only the current account without changing progress', async () => {
    const first = await store.addWord(firstId, 'apple', 'en')
    await store.mark(firstId, first.id, false, randomUUID())
    await store.addWord(firstId, 'apricot', 'en')
    await store.addWord(firstId, 'Apfel', 'de')
    await store.addWord(secondId, 'private second-account word', 'en')
    const before = store.exportData(firstId)
    const token = await issue()
    const response = await call(token, 'worttrainer_get_words', { language: 'en', category: 'new', query: 'AP', limit: 1 }).expect(200)
    expect(response.body.result.isError).not.toBe(true)
    const result = response.body.result.structuredContent
    expect(result).toMatchObject({ total: 2, offset: 0, limit: 1, hasMore: true, nextOffset: 1 })
    expect(result.words).toHaveLength(1)
    const next = await call(token, 'worttrainer_get_words', { language: 'en', query: 'AP', limit: 1, offset: result.nextOffset }).expect(200)
    expect(next.body.result.structuredContent).toMatchObject({ total: 2, hasMore: false, nextOffset: null })
    expect(next.body.result.structuredContent.words[0].id).not.toBe(result.words[0].id)
    expect(store.exportData(firstId).words).toEqual(before.words)
    expect(store.exportData(firstId).attempts).toEqual(before.attempts)
    const empty = await call(token, 'worttrainer_get_words', { query: 'no such word' }).expect(200)
    expect(empty.body.result.structuredContent).toMatchObject({ words: [], total: 0, hasMore: false, nextOffset: null })
  })

  it('adds trimmed words to the token owner and persists them without attempts or progress changes', async () => {
    const existing = await store.addWord(firstId, 'existing', 'en')
    await store.mark(firstId, existing.id, false, randomUUID())
    const before = store.exportData(firstId)
    const other = store.words(secondId)
    const token = await issue()
    const response = await call(token, 'worttrainer_add_word', { text: '  butterfly  ', language: 'en' }).expect(200)
    expect(response.body.result.structuredContent.word).toMatchObject({ text: 'butterfly', language: 'en', category: 'new', consecutive_mistakes: 0, last_practiced_at: null })
    expect(store.words(firstId).find(word => word.id === existing.id)).toEqual(before.words.find(word => word.id === existing.id))
    expect(store.exportData(firstId).attempts).toEqual(before.attempts)
    expect(store.words(secondId)).toEqual(other)
    const reopened = await FileStore.open(join(directory, 'store.json'))
    expect(reopened.words(firstId)).toContainEqual(response.body.result.structuredContent.word)
    expect(reopened.sessionAccount(digest(token))).toBe(firstId)
  })

  it('moves words between categories without fabricating attempts or changing practice time', async () => {
    const word = await store.addWord(firstId, 'butterfly', 'en')
    await store.mark(firstId, word.id, false, randomUUID())
    await store.mark(firstId, word.id, false, randomUUID())
    const before = store.exportData(firstId)
    const token = await issue()
    for (const category of ['plus', 'minus', 'new']) {
      const response = await call(token, 'worttrainer_move_word', { wordId: word.id, category }).expect(200)
      expect(response.body.result.isError).not.toBe(true)
      expect(response.body.result.structuredContent.word).toEqual({ ...before.words[0], category, consecutive_mistakes: 0 })
      expect(store.exportData(firstId).attempts).toEqual(before.attempts)
    }
    const reopened = await FileStore.open(join(directory, 'store.json'))
    expect(reopened.words(firstId)[0]).toEqual({ ...before.words[0], category: 'new', consecutive_mistakes: 0 })
  })

  it('records a dated mixed challenge with generated ID and name', async () => {
    const token = await issue()
    const response = await call(token, 'worttrainer_record_challenge', {
      language: 'en', performedAt: '2026-10-25T18:00:00+02:00',
      words: [{ correctWord: 'butterfly', correct: true }, { correctWord: 'beautiful', correct: false, spelling: 'beautifull' }],
    }).expect(200)
    expect(response.body.result.isError).not.toBe(true)
    const result = response.body.result.structuredContent
    expect(result).toMatchObject({
      challengeId: expect.any(String), name: expect.stringMatching(/^Challenge /), performedAt: '2026-10-25T16:00:00.000Z',
      words: [
        { text: 'butterfly', category: 'new', consecutive_mistakes: 0 },
        { text: 'beautiful', category: 'new', consecutive_mistakes: 1 },
      ],
    })
    const saved = store.exportData(firstId)
    expect(saved.challenges).toHaveLength(1)
    expect(saved.challenges[0]).toMatchObject({
      id: result.challengeId, name: result.name, results: [true, false], nextIndex: 2,
      startedAt: result.performedAt, writtenAt: result.performedAt, reviewedAt: result.performedAt,
      check: { method: 'manual', spellings: [null, 'beautifull'], evaluatedAt: result.performedAt },
    })
    expect(saved.attempts).toEqual(saved.challenges[0].words.map((word, index) => ({
      id: word.attemptId, wordId: word.id, correct: index === 0, createdAt: result.performedAt,
      ...(index === 0 ? {} : { spelling: 'beautifull' }),
    })))
    expect(saved.statistics).toMatchObject({ started: 1, completed: 1, correct: 1, incorrect: 1 })
    const reopened = await FileStore.open(join(directory, 'store.json'))
    expect(reopened.challenges(firstId)).toEqual(saved.challenges)
    expect(reopened.exportData(firstId).attempts).toEqual(saved.attempts)
  })

  it('records a named challenge with normal ratings and language/account isolation', async () => {
    const learned = await store.addWord(firstId, 'butterfly', 'en')
    await store.moveWord(firstId, learned.id, 'plus')
    const german = await store.addWord(firstId, 'beautiful', 'de')
    await store.addWord(secondId, 'beautiful', 'en')
    const otherBefore = store.exportData(secondId)
    const token = await issue()
    const challengeId = randomUUID()
    const response = await call(token, 'worttrainer_record_challenge', {
      challengeId, name: ' Weekly spelling ', language: 'en',
      words: [{ correctWord: ' BUTTERFLY ', correct: false, spelling: ' buterfly ' }, { correctWord: 'beautiful', correct: false }],
    }).expect(200)
    expect(response.body.result.isError).not.toBe(true)
    expect(response.body.result.structuredContent).toMatchObject({
      challengeId, name: 'Weekly spelling',
      words: [
        { id: learned.id, text: 'butterfly', language: 'en', category: 'new', consecutive_mistakes: 1 },
        { text: 'beautiful', language: 'en', category: 'new', consecutive_mistakes: 1 },
      ],
    })
    const saved = store.exportData(firstId)
    expect(saved.challenges).toHaveLength(1)
    const entry = saved.challenges[0]
    expect(entry).toMatchObject({
      id: challengeId, name: 'Weekly spelling', nextIndex: 2, results: [false, false], telemetry: [], recognition: null, photo: null,
      check: { method: 'manual', spellings: ['buterfly', null], evaluatedAt: entry.reviewedAt },
    })
    expect(entry.reviewedAt).toEqual(expect.any(String))
    expect(saved.attempts).toEqual(entry.words.map((word, index) => ({
      id: word.attemptId, wordId: word.id, correct: false, createdAt: entry.reviewedAt,
      ...(index === 0 ? { spelling: 'buterfly' } : {}),
    })))
    expect(saved.statistics).toMatchObject({ started: 1, completed: 1, incorrect: 2, pending: 0 })
    expect(store.words(firstId).find(word => word.id === german.id)).toEqual(german)
    expect(store.words(secondId)).toEqual(otherBefore.words)
    expect(store.exportData(secondId).attempts).toEqual(otherBefore.attempts)
    const reopened = await FileStore.open(join(directory, 'store.json'))
    expect(reopened.challenges(firstId)).toEqual(saved.challenges)
    expect(reopened.exportData(firstId).attempts).toEqual(saved.attempts)
    expect(reopened.words(firstId)).toEqual(store.words(firstId))
  })

  it('retries challenges without double counting and rejects changed names, dates or results', async () => {
    const token = await issue()
    const args = {
      challengeId: randomUUID(), name: 'Weekly practice', performedAt: '2026-10-25', language: 'en',
      words: [{ correctWord: 'butterfly', correct: false, spelling: 'buterfly' }, { correctWord: 'beautiful', correct: false }],
    }
    const first = await call(token, 'worttrainer_record_challenge', args).expect(200)
    expect(first.body.result.isError).not.toBe(true)
    const before = store.exportData(firstId)
    const retries = await Promise.all([
      call(token, 'worttrainer_record_challenge', args).expect(200),
      call(token, 'worttrainer_record_challenge', args).expect(200),
    ])
    for (const retry of retries) expect(retry.body.result.structuredContent).toEqual(first.body.result.structuredContent)
    for (const changed of [
      { ...args, language: 'de' },
      { ...args, name: 'Different practice' },
      { ...args, performedAt: '2026-10-24' },
      { ...args, words: args.words.slice(0, 1) },
      { ...args, words: [...args.words].reverse() },
      { ...args, words: [{ ...args.words[0], correct: true }, args.words[1]] },
      { ...args, words: [{ correctWord: 'butterfly', correct: false, spelling: 'butterfli' }, args.words[1]] },
      { ...args, words: [{ correctWord: 'butterfly', correct: false }, args.words[1]] },
      { ...args, words: [args.words[0], { correctWord: 'different', correct: false }] },
    ]) {
      const conflict = await call(token, 'worttrainer_record_challenge', changed).expect(200)
      expect(conflict.body.result.isError).toBe(true)
    }
    expect(store.exportData(firstId)).toMatchObject({ words: before.words, attempts: before.attempts, challenges: before.challenges })
    store = await FileStore.open(join(directory, 'store.json'))
    app = createApp({ store, origin, secureCookie: false })
    await store.setLanguagePreferences(firstId, { enabled: ['de'], defaultLanguage: 'de' })
    const reopenedRetry = await call(token, 'worttrainer_record_challenge', args).expect(200)
    expect(reopenedRetry.body.result.structuredContent).toEqual(first.body.result.structuredContent)
    expect(store.exportData(firstId)).toMatchObject({ words: before.words, attempts: before.attempts, challenges: before.challenges })
    await store.setLanguagePreferences(firstId, { enabled: ['en', 'de'], defaultLanguage: 'en' })
    const next = await call(token, 'worttrainer_record_challenge', { ...args, challengeId: randomUUID() }).expect(200)
    expect(next.body.result.isError).not.toBe(true)
    expect(next.body.result.structuredContent.words).toEqual([
      expect.objectContaining({ text: 'butterfly', category: 'minus', consecutive_mistakes: 2 }),
      expect.objectContaining({ text: 'beautiful', category: 'minus', consecutive_mistakes: 2 }),
    ])
    expect(store.challenges(firstId)).toHaveLength(2)
    expect(store.exportData(firstId).attempts).toHaveLength(4)
    for (const word of store.words(firstId)) {
      for (let index = 0; index < 3; index++) await store.mark(firstId, word.id, true, randomUUID())
    }
    expect(store.words(firstId).every(word => word.category === 'plus' && word.consecutive_mistakes === 0)).toBe(true)
  })

  it('rejects invalid challenges and reserved IDs without partial words, history or ratings', async () => {
    const word = await store.addWord(firstId, 'butterfly', 'en')
    const attemptId = randomUUID()
    await store.mark(firstId, word.id, false, attemptId)
    const challenge = await store.createChallenge(firstId, [word.id])
    const before = store.exportData(firstId)
    const otherBefore = store.exportData(secondId)
    const token = await issue()
    const args = { challengeId: randomUUID(), language: 'en', words: [{ correctWord: 'new word', correct: true }, { correctWord: 'butterfly', correct: false, spelling: 'buterfly' }] }
    for (const invalid of [
      { ...args, challengeId: 'invalid' }, { ...args, challengeId: null },
      { ...args, challengeId: challenge.id }, { ...args, challengeId: challenge.words[0].attemptId }, { ...args, challengeId: attemptId },
      { ...args, name: '' }, { ...args, name: '   ' }, { ...args, name: 'a'.repeat(121) }, { ...args, name: null },
      { ...args, performedAt: 'invalid' }, { ...args, performedAt: '2026-02-30' },
      { ...args, performedAt: '2026-10-25T18:00:00' }, { ...args, performedAt: '2999-01-01' },
      { ...args, language: 'xx' }, { ...args, language: 'fr' },
      { ...args, accountId: secondId }, { ...args, words: [] },
      { ...args, words: Array.from({ length: 101 }, (_, index) => ({ correctWord: `word ${index}`, correct: true })) },
      { ...args, words: [args.words[0], { correctWord: '', correct: true }] },
      { ...args, words: [args.words[0], { correctWord: 'a\nb', correct: true }] },
      { ...args, words: [args.words[0], { correctWord: 'a'.repeat(81), correct: true }] },
      { ...args, words: [args.words[0], { correctWord: ' NEW WORD ', correct: true }] },
      { ...args, words: [args.words[0], { correctWord: 'butterfly', correct: false, spelling: '' }] },
      { ...args, words: [args.words[0], { correctWord: 'butterfly', correct: false, spelling: 'a'.repeat(1001) }] },
      { ...args, words: [args.words[0], { correctWord: 'butterfly', correct: false, spelling: null }] },
      { ...args, words: [args.words[0], { correctWord: 'butterfly' }] },
      { ...args, words: [args.words[0], { correctWord: 'butterfly', correct: 'true' }] },
    ]) {
      const response = await call(token, 'worttrainer_record_challenge', invalid).expect(200)
      expect(response.body.result.isError).toBe(true)
    }
    const reopened = await FileStore.open(join(directory, 'store.json'))
    for (const checked of [store, reopened]) {
      expect(checked.exportData(firstId)).toMatchObject({ words: before.words, attempts: before.attempts, challenges: before.challenges })
      expect(checked.exportData(secondId)).toMatchObject({ words: otherBefore.words, attempts: otherBefore.attempts, challenges: otherBefore.challenges })
    }
  })

  it('does not revive a deleted challenge or recount its attempts on MCP retries', async () => {
    const token = await issue()
    const args = { challengeId: randomUUID(), language: 'en', words: [{ correctWord: 'butterfly', correct: false, spelling: 'buterfly' }, { correctWord: 'beautiful', correct: false }] }
    const report = await call(token, 'worttrainer_record_challenge', args).expect(200)
    expect(report.body.result.isError).not.toBe(true)
    await request(app).delete(`/api/challenges/${args.challengeId}`).set('Cookie', cookie).set('Origin', origin).send({ removePractice: true }).expect(204)
    const beforeRetry = store.exportData(firstId)
    const retry = await call(token, 'worttrainer_record_challenge', args).expect(200)
    expect(retry.body.result).toMatchObject({ isError: true, content: [{ text: 'This challenge was deleted. Use a fresh challenge ID for a new challenge.' }] })
    const firstWord = store.words(firstId).find(word => word.text === 'butterfly')!
    const attemptRetry = await call(token, 'worttrainer_record_mistake', { wordId: firstWord.id, attemptId: args.challengeId, spelling: 'buterfly' }).expect(200)
    expect(attemptRetry.body.result.isError).toBe(true)
    expect(store.exportData(firstId)).toMatchObject({ words: beforeRetry.words, attempts: beforeRetry.attempts, challenges: beforeRetry.challenges })
    expect(store.words(firstId).every(word => word.category === 'new' && word.consecutive_mistakes === 0 && word.last_practiced_at === null)).toBe(true)
    const fresh = await call(token, 'worttrainer_record_challenge', { ...args, challengeId: randomUUID() }).expect(200)
    expect(fresh.body.result.isError).not.toBe(true)
    expect(fresh.body.result.structuredContent.words.every((word: { consecutive_mistakes: number }) => word.consecutive_mistakes === 1)).toBe(true)
    expect(store.challenges(firstId)).toHaveLength(1)
  })

  it('generates challenge and attempt IDs when omitted and supports retrying the returned IDs', async () => {
    const token = await issue()
    const input = { language: 'en', words: [{ correctWord: 'butterfly', correct: true }] }
    const first = await call(token, 'worttrainer_record_challenge', input).expect(200)
    const second = await call(token, 'worttrainer_record_challenge', input).expect(200)
    const firstResult = first.body.result.structuredContent
    expect(firstResult.challengeId).not.toBe(second.body.result.structuredContent.challengeId)
    expect(firstResult.name).not.toBe(second.body.result.structuredContent.name)
    expect(Date.parse(firstResult.performedAt)).toBeLessThanOrEqual(Date.now())
    const beforeRetry = store.exportData(firstId)
    const retried = await call(token, 'worttrainer_record_challenge', { ...input, challengeId: firstResult.challengeId }).expect(200)
    expect(retried.body.result.structuredContent).toMatchObject({ challengeId: firstResult.challengeId, name: firstResult.name, performedAt: firstResult.performedAt })
    expect(store.exportData(firstId)).toMatchObject({ attempts: beforeRetry.attempts, challenges: beforeRetry.challenges })
    const wordId = firstResult.words[0].id
    const mistaken = await call(token, 'worttrainer_record_mistake', { wordId }).expect(200)
    const attemptId = mistaken.body.result.structuredContent.attemptId
    expect(attemptId).toMatch(/^[a-f0-9-]{36}$/i)
    const attempts = store.exportData(firstId).attempts
    const retry = await call(token, 'worttrainer_record_mistake', { wordId, attemptId }).expect(200)
    expect(retry.body.result.structuredContent).toEqual(mistaken.body.result.structuredContent)
    expect(store.exportData(firstId).attempts).toEqual(attempts)
  })

  it('replays backdated results before newer practice and preserves the latest practice date', async () => {
    const token = await issue()
    for (const [performedAt, correct] of [['2026-10-20', false], ['2026-10-22', true], ['2026-10-23', true], ['2026-10-24', true]] as const) {
      const response = await call(token, 'worttrainer_record_challenge', { language: 'en', performedAt, words: [{ correctWord: 'butterfly', correct }] }).expect(200)
      expect(response.body.result.isError).not.toBe(true)
    }
    const before = store.words(firstId)[0]
    expect(before).toMatchObject({ category: 'plus', last_practiced_at: '2026-10-24T00:00:00.000Z' })
    const response = await call(token, 'worttrainer_record_challenge', { language: 'en', performedAt: '2026-10-21', words: [{ correctWord: 'butterfly', correct: false }] }).expect(200)
    expect(response.body.result.structuredContent.words[0]).toEqual(before)
    const attempts = store.exportData(firstId).attempts
    expect(attempts.map(attempt => attempt.correct)).toEqual([false, false, true, true, true])
    expect(attempts.map(attempt => attempt.createdAt)).toEqual([...attempts].sort((earlier, later) => Date.parse(earlier.createdAt) - Date.parse(later.createdAt)).map(attempt => attempt.createdAt))
    const reopened = await FileStore.open(join(directory, 'store.json'))
    expect(reopened.words(firstId)[0]).toEqual(before)
    await reopened.deleteChallenge(firstId, response.body.result.structuredContent.challengeId, true)
    expect(reopened.words(firstId)[0]).toEqual(before)
  })

  it.each([false, true])('preserves a newer manual category override when importing old practice (existing attempts: %s)', async existingAttempts => {
    const token = await issue()
    const word = await store.addWord(firstId, 'butterfly', 'en')
    if (existingAttempts) {
      await store.recordChallenge(firstId, { language: 'en', performedAt: '2026-10-20', words: [{ correctWord: 'butterfly', correct: false }] })
    }
    await store.moveWord(firstId, word.id, 'plus')
    const recorded = await call(token, 'worttrainer_record_challenge', { language: 'en', performedAt: '2026-10-21', words: [{ correctWord: 'butterfly', correct: false }] }).expect(200)
    expect(recorded.body.result.structuredContent.words[0]).toMatchObject({ category: 'plus', consecutive_mistakes: 0, last_practiced_at: '2026-10-21T00:00:00.000Z' })
    const reopened = await FileStore.open(join(directory, 'store.json'))
    expect(reopened.words(firstId)).toEqual(store.words(firstId))
    const current = await call(token, 'worttrainer_record_mistake', { wordId: word.id }).expect(200)
    expect(current.body.result.structuredContent.word).toMatchObject({ category: 'new', consecutive_mistakes: 1 })
  })

  it('records wrong spellings persistently with normal progress and retry-safe attempt IDs', async () => {
    const word = await store.addWord(firstId, 'butterfly', 'en')
    for (let index = 0; index < 3; index++) await store.mark(firstId, word.id, true, randomUUID())
    const token = await issue()
    const attemptId = randomUUID()
    const args = { wordId: word.id, attemptId, spelling: 'buterfly' }
    const first = await call(token, 'worttrainer_record_mistake', args).expect(200)
    expect(first.body.result.isError).not.toBe(true)
    expect(first.body.result.structuredContent.word).toMatchObject({ text: 'butterfly', category: 'new', consecutive_mistakes: 1 })
    const beforeRetry = store.exportData(firstId)
    const retries = await Promise.all([
      call(token, 'worttrainer_record_mistake', args).expect(200),
      call(token, 'worttrainer_record_mistake', args).expect(200),
    ])
    for (const retry of retries) expect(retry.body.result.structuredContent).toEqual(first.body.result.structuredContent)
    expect(store.exportData(firstId).attempts).toEqual(beforeRetry.attempts)
    expect(store.words(firstId)).toEqual(beforeRetry.words)
    const conflict = await call(token, 'worttrainer_record_mistake', { ...args, spelling: 'butterfli' }).expect(200)
    expect(conflict.body.result.isError).toBe(true)
    const second = await call(token, 'worttrainer_record_mistake', { ...args, attemptId: randomUUID() }).expect(200)
    expect(second.body.result.structuredContent.word).toMatchObject({ category: 'minus', consecutive_mistakes: 2 })
    const reopened = await FileStore.open(join(directory, 'store.json'))
    expect(reopened.exportData(firstId).attempts.slice(-2)).toEqual([
      { id: attemptId, wordId: word.id, correct: false, spelling: 'buterfly', createdAt: first.body.result.structuredContent.word.last_practiced_at },
      { id: second.body.result.structuredContent.attemptId, wordId: word.id, correct: false, spelling: 'buterfly', createdAt: second.body.result.structuredContent.word.last_practiced_at },
    ])
    expect(reopened.words(firstId)[0]).toEqual(second.body.result.structuredContent.word)
  })

  it('preserves a current category on repeated moves and allows mistakes without a known spelling', async () => {
    const word = await store.addWord(firstId, 'butterfly', 'en')
    const token = await issue()
    const attemptId = randomUUID()
    const first = await call(token, 'worttrainer_record_mistake', { wordId: word.id, attemptId }).expect(200)
    expect(first.body.result.structuredContent.word).toMatchObject({ category: 'new', consecutive_mistakes: 1 })
    const unchanged = await call(token, 'worttrainer_move_word', { wordId: word.id, category: 'new' }).expect(200)
    expect(unchanged.body.result.structuredContent.word).toEqual(first.body.result.structuredContent.word)
    const retry = await call(token, 'worttrainer_record_mistake', { wordId: word.id, attemptId }).expect(200)
    expect(retry.body.result.structuredContent).toEqual(first.body.result.structuredContent)
    const second = await call(token, 'worttrainer_record_mistake', { wordId: word.id, attemptId: randomUUID() }).expect(200)
    expect(second.body.result.structuredContent.word).toMatchObject({ category: 'minus', consecutive_mistakes: 2 })
    expect(store.exportData(firstId).attempts).toHaveLength(2)
    expect(store.exportData(firstId).attempts[0]).not.toHaveProperty('spelling')
  })

  it('rejects foreign and missing words, invalid mutation inputs and reused attempt payloads without changes', async () => {
    const word = await store.addWord(firstId, 'butterfly', 'en')
    const other = await store.addWord(secondId, 'private word', 'en')
    const existingAttempt = randomUUID()
    await store.mark(firstId, word.id, true, existingAttempt)
    const before = store.exportData(firstId)
    const otherBefore = store.exportData(secondId)
    const token = await issue()
    const attemptId = randomUUID()
    const move = { wordId: word.id, category: 'minus' }
    const mistake = { wordId: word.id, attemptId, spelling: 'buterfly' }
    for (const wordId of [other.id, randomUUID()]) {
      const moved = await call(token, 'worttrainer_move_word', { ...move, wordId }).expect(200)
      const recorded = await call(token, 'worttrainer_record_mistake', { ...mistake, wordId }).expect(200)
      expect(moved.body.result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Word not found. Sync your collection and try again.' }] })
      expect(recorded.body.result).toEqual(moved.body.result)
    }
    for (const args of [
      { ...move, wordId: 'invalid' }, { ...move, category: 'default' }, { ...move, category: '' },
      { ...move, accountId: secondId }, { wordId: word.id },
    ]) {
      const response = await call(token, 'worttrainer_move_word', args).expect(200)
      expect(response.body.result.isError).toBe(true)
    }
    for (const args of [
      { ...mistake, wordId: 'invalid' }, { ...mistake, attemptId: 'invalid' }, { spelling: 'buterfly' },
      { ...mistake, spelling: '   ' }, { ...mistake, spelling: 'a'.repeat(1001) }, { ...mistake, spelling: null },
      { ...mistake, accountId: secondId }, { ...mistake, correct: true }, { ...mistake, attemptId: existingAttempt },
    ]) {
      const response = await call(token, 'worttrainer_record_mistake', args).expect(200)
      expect(response.body.result.isError).toBe(true)
    }
    expect(store.words(firstId)).toEqual(before.words)
    expect(store.exportData(firstId).attempts).toEqual(before.attempts)
    expect(store.words(secondId)).toEqual(otherBefore.words)
    expect(store.exportData(secondId).attempts).toEqual(otherBefore.attempts)
  })

  it('rejects invalid words, disabled languages, duplicates and account overrides without writes', async () => {
    await store.addWord(firstId, 'duplicate', 'en')
    const before = store.words(firstId)
    const token = await issue()
    for (const args of [
      { text: '', language: 'en' }, { text: 'a\nb', language: 'en' }, { text: 'a'.repeat(81), language: 'en' },
      { text: 'word', language: 'xx' }, { text: 'word', language: 'fr' }, { text: 'DUPLICATE', language: 'en' },
      { text: 'word', language: 'en', accountId: secondId }, { text: 'word', language: 'en', category: 'plus' },
    ]) {
      const response = await call(token, 'worttrainer_add_word', args).expect(200)
      expect(response.body.result.isError).toBe(true)
    }
    for (const args of [{ limit: 101 }, { offset: -1 }, { accountId: secondId }]) {
      const response = await call(token, 'worttrainer_get_words', args).expect(200)
      expect(response.body.result.isError).toBe(true)
    }
    expect(store.words(firstId)).toEqual(before)
    expect(store.words(secondId)).toEqual([])
  })

  it('requires bearer auth, validates host and origin, and does not expose an SSE connection', async () => {
    const token = await issue()
    await request(app).post('/api/mcp').set('Host', host).set('Cookie', cookie).send({}).expect(401)
    await rpc('wtr_mcp_' + 'a'.repeat(43), 'tools/list').expect(401)
    await rpc(token, 'tools/list').set('Origin', 'https://evil.example').expect(403)
    await rpc(token, 'tools/list').set('Host', 'evil.example').expect(403)
    await rpc(token, 'tools/list').set('Origin', origin).expect(200)
    await request(app).get('/api/mcp').set('Host', host).set('Authorization', `Bearer ${token}`).expect(405).expect('Allow', 'POST')
  })

  it('allows only the owner to revoke a token and preserves their browser session', async () => {
    const token = await issue()
    await request(app).delete('/api/mcp/token').set('Origin', origin).set('Cookie', secondCookie).send({ token }).expect(204)
    await rpc(token, 'tools/list').expect(200)
    await request(app).delete('/api/mcp/token').set('Origin', origin).set('Cookie', cookie).send({ token }).expect(204)
    await rpc(token, 'tools/list').expect(401)
    await request(app).get('/api/words').set('Cookie', cookie).expect(200)
  })

  it('rejects expired tokens and revokes MCP access on password recovery without affecting another account', async () => {
    const token = await issue()
    const otherToken = await issue(secondCookie)
    const expired = 'wtr_mcp_' + randomBytes(32).toString('base64url')
    await store.addSession({ tokenHash: digest(expired), accountId: firstId, expiresAt: Date.now() - 1000 }, store.account(firstId).passwordHash)
    await rpc(expired, 'tools/list').expect(401)
    await store.recoverPassword(firstId, { salt: '11'.repeat(16), passwordHash: '11'.repeat(64) })
    await rpc(token, 'tools/list').expect(401)
    await rpc(otherToken, 'tools/list').expect(200)
    await request(app).get('/api/words').set('Cookie', cookie).expect(401)
  })

  it('prevents simultaneous duplicate additions while allowing the same spelling in another account', async () => {
    const token = await issue()
    const responses = await Promise.all([
      call(token, 'worttrainer_add_word', { text: 'simultaneous', language: 'en' }).expect(200),
      call(token, 'worttrainer_add_word', { text: 'SIMULTANEOUS', language: 'en' }).expect(200),
    ])
    expect(responses.filter(response => response.body.result.isError)).toHaveLength(1)
    expect(store.words(firstId)).toHaveLength(1)
    expect(store.exportData(firstId).attempts).toEqual([])
    const otherToken = await issue(secondCookie)
    const other = await call(otherToken, 'worttrainer_add_word', { text: 'simultaneous', language: 'en' }).expect(200)
    expect(other.body.result.isError).not.toBe(true)
    expect(store.words(secondId)).toHaveLength(1)
    expect(store.words(secondId)[0].id).not.toBe(store.words(firstId)[0].id)
  })

  it('supports the official MCP client over HTTP and rejects malformed, oversized and compressed bodies', async () => {
    const token = await issue()
    const server = createApp({ store, origin: 'http://127.0.0.1', secureCookie: false }).listen(0, '127.0.0.1')
    const client = new Client({ name: 'worttrainer-integration-test', version: '1.0.0' })
    try {
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Expected a temporary HTTP port.')
      const url = new URL(`http://127.0.0.1:${address.port}/api/mcp`)
      await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
      const tools = await client.listTools()
      expect(tools.tools.map(tool => tool.name)).toEqual(['worttrainer_get_words', 'worttrainer_add_word', 'worttrainer_move_word', 'worttrainer_record_mistake', 'worttrainer_record_challenge'])
      const added = await client.callTool({ name: 'worttrainer_add_word', arguments: { text: 'client word', language: 'en' } })
      expect(added.isError).not.toBe(true)
      expect(added.structuredContent).toMatchObject({ word: { text: 'client word', category: 'new' } })
      const listed = await client.callTool({ name: 'worttrainer_get_words', arguments: { language: 'en' } })
      expect(listed.structuredContent).toMatchObject({ total: 1, words: [{ text: 'client word' }], hasMore: false })
      const wordId = store.words(firstId)[0].id
      const moved = await client.callTool({ name: 'worttrainer_move_word', arguments: { wordId, category: 'plus' } })
      expect(moved.structuredContent).toMatchObject({ word: { text: 'client word', category: 'plus' } })
      const attemptId = randomUUID()
      const mistaken = await client.callTool({ name: 'worttrainer_record_mistake', arguments: { wordId, attemptId, spelling: 'clint word' } })
      expect(mistaken.structuredContent).toMatchObject({ attemptId, word: { text: 'client word', category: 'new', consecutive_mistakes: 1 } })
      expect(store.exportData(firstId).attempts[0]).toMatchObject({ id: attemptId, spelling: 'clint word', correct: false })
      const challengeId = randomUUID()
      const reported = await client.callTool({ name: 'worttrainer_record_challenge', arguments: {
        challengeId, language: 'en', words: [{ correctWord: 'client word', correct: false, spelling: 'clint word' }, { correctWord: 'another word', correct: false }],
      } })
      expect(reported.isError).not.toBe(true)
      expect(reported.structuredContent).toMatchObject({ challengeId, words: [
        { id: wordId, category: 'minus', consecutive_mistakes: 2 },
        { text: 'another word', category: 'new', consecutive_mistakes: 1 },
      ] })
      expect(store.challenges(firstId)).toHaveLength(1)
      expect(store.challenges(firstId)[0].id).toBe(challengeId)
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
      const malformed = await fetch(url, { method: 'POST', headers, body: '{broken' })
      expect(malformed.status).toBe(400)
      await malformed.arrayBuffer()
      const oversized = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ text: 'a'.repeat(20_000) }) })
      expect(oversized.status).toBe(413)
      await oversized.arrayBuffer()
      const compressed = await fetch(url, {
        method: 'POST', headers: { ...headers, 'Content-Encoding': 'gzip' },
        body: new Uint8Array(gzipSync(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })))),
      })
      expect(compressed.status).toBe(415)
      expect(await compressed.json()).toEqual({ error: 'Compressed request bodies are not supported.' })
      expect((await client.listTools()).tools).toHaveLength(5)
    } finally {
      await client.close()
      await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()) })
    }
  })
})