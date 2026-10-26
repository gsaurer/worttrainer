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

describe('account-scoped Streamable HTTP MCP', () => {
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
    expect(response.body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(['worttrainer_get_words', 'worttrainer_add_word'])
    expect(response.body.result.tools[0]).toMatchObject({ inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, annotations: { readOnlyHint: true } })
    expect(response.body.result.tools[1]).toMatchObject({ annotations: { readOnlyHint: false, destructiveHint: false } })
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
      expect(tools.tools.map(tool => tool.name)).toEqual(['worttrainer_get_words', 'worttrainer_add_word'])
      const added = await client.callTool({ name: 'worttrainer_add_word', arguments: { text: 'client word', language: 'en' } })
      expect(added.isError).not.toBe(true)
      expect(added.structuredContent).toMatchObject({ word: { text: 'client word', category: 'new' } })
      const listed = await client.callTool({ name: 'worttrainer_get_words', arguments: { language: 'en' } })
      expect(listed.structuredContent).toMatchObject({ total: 1, words: [{ text: 'client word' }], hasMore: false })
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
      expect((await client.listTools()).tools).toHaveLength(2)
    } finally {
      await client.close()
      await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()) })
    }
  })
})