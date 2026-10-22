// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import request from 'supertest'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { FileStore } from './store.js'
import type { PhotoRound } from '../shared/model.js'

const origin = 'http://localhost:5173'
const ocr = { endpoint: 'https://test.cognitiveservices.azure.com', key: 'test-only-key', monthlyLimit: 2 }
let directory: string
let store: FileStore
let app: ReturnType<typeof createApp>
let cookie: string
let ids: string[]
let photo: Buffer
let accountId: string
const options = () => ({ store, origin, secureCookie: false, ocr })
const post = (path: string, body: object) => request(app).post(path).set('Origin', origin).set('Cookie', cookie).send(body)
const upload = (id: string, bytes = photo) => request(app).post(`/api/photo-rounds/${id}/photo`).set('Origin', origin).set('Cookie', cookie).set('Content-Type', 'image/png').send(bytes)
async function newRound() {
  return (await post('/api/photo-rounds', { wordIds: ids }).expect(201)).body as PhotoRound
}
async function finish(round: PhotoRound) {
  for (let nextIndex = 1; nextIndex <= ids.length; nextIndex++) await post(`/api/photo-rounds/${round.id}/advance`, { nextIndex }).expect(200)
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'worttrainer-photo-'))
  store = await FileStore.open(join(directory, 'store.json'))
  const token = randomBytes(32).toString('base64url')
  cookie = `worttrainer_session=${token}`
  accountId = randomUUID()
  await store.register({ email: 'parent@example.com', salt: '00'.repeat(16), passwordHash: 'aa'.repeat(64) }, { accountId, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: Date.now() + 60_000 })
  ids = [ (await store.addWord(accountId, 'Straße', 'de')).id, (await store.addWord(accountId, 'Schmetterling', 'de')).id ]
  app = createApp(options())
  photo = await sharp({ create: { width: 30, height: 40, channels: 3, background: '#ffffff' } }).png().toBuffer()
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(directory, { recursive: true, force: true })
})

describe('persisted photo rounds and parent-confirmed batches', () => {
  it('requires authentication, origin, proper content type, and a completed numbered round', async () => {
    await request(app).get('/api/photo-rounds').expect(401)
    await request(app).post('/api/photo-rounds').set('Origin', origin).send({ wordIds: ids }).expect(401)
    const round = await newRound()
    await request(app).post(`/api/photo-rounds/${round.id}/photo`).set('Cookie', cookie).set('Origin', 'https://untrusted.example').set('Content-Type', 'image/png').send(photo).expect(403)
    await upload(round.id).expect(409)
    await post(`/api/photo-rounds/${round.id}/review`, { results: [true, false] }).expect(400)
    await post('/api/photo-rounds', { wordIds: [ids[0], ids[0]] }).expect(400)
    await post(`/api/photo-rounds/${round.id}/advance`, { nextIndex: 2 }).expect(409)
    await finish(round)
    await post(`/api/photo-rounds/${round.id}/advance`, { nextIndex: 2 }).expect(200)
    await upload(round.id, Buffer.from('not an image')).expect(400)
    expect(store.ocrUsage().used).toBe(0)
    await upload(round.id, Buffer.alloc(4 * 1024 * 1024 + 1)).expect(413)
    expect(store.ocrUsage().used).toBe(0)
  })
  it('persists ordered snapshots, writing position, and timestamps without recording spelling attempts', async () => {
    const round = await newRound()
    await post(`/api/photo-rounds/${round.id}/advance`, { nextIndex: 1 }).expect(200)
    store = await FileStore.open(join(directory, 'store.json'))
    expect(store.photoRound(accountId, round.id)).toMatchObject({ nextIndex: 1, writtenAt: null, reviewedAt: null })
    expect(store.photoRound(accountId, round.id).words.map(word => word.id)).toEqual(ids)
    expect(store.words(accountId).every(word => word.last_practiced_at === null)).toBe(true)
    const saved = JSON.parse(await readFile(join(directory, 'store.json'), 'utf8')) as { accounts: { attempts: unknown[] }[] }
    expect(saved.accounts[0].attempts).toHaveLength(0)
  })
  it('saves a reviewed batch atomically and deduplicates simultaneous retries across restart', async () => {
    const round = await newRound()
    await finish(round)
    await post(`/api/photo-rounds/${round.id}/review`, { results: [true] }).expect(400)
    expect(store.words(accountId).every(word => word.category === 'new')).toBe(true)
    const path = `/api/photo-rounds/${round.id}/review`
    const responses = await Promise.all([post(path, { results: [true, false] }), post(path, { results: [true, false] })])
    expect(responses.map(response => response.status)).toEqual([200, 200])
    expect(store.words(accountId).find(word => word.id === ids[0])).toMatchObject({ category: 'plus', consecutive_mistakes: 0 })
    expect(store.words(accountId).find(word => word.id === ids[1])).toMatchObject({ category: 'new', consecutive_mistakes: 1 })
    await post(path, { results: [false, false] }).expect(409)
    store = await FileStore.open(join(directory, 'store.json'))
    app = createApp(options())
    await post(path, { results: [true, false] }).expect(200)
    const saved = JSON.parse(await readFile(join(directory, 'store.json'), 'utf8')) as { accounts: { attempts: { createdAt: string }[] }[] }
    expect(saved.accounts[0].attempts).toHaveLength(2)
    expect(saved.accounts[0].attempts.every(attempt => attempt.createdAt === store.photoRound(accountId, round.id).reviewedAt)).toBe(true)
    const again = await newRound()
    await finish(again)
    await post(`/api/photo-rounds/${again.id}/review`, { results: [false, false] }).expect(200)
    expect(store.words(accountId).find(word => word.id === ids[0])).toMatchObject({ category: 'plus', consecutive_mistakes: 1 })
    expect(store.words(accountId).find(word => word.id === ids[1])).toMatchObject({ category: 'minus', consecutive_mistakes: 2 })
  })
  it('keeps OCR unavailable explicitly until configured while allowing manual parent review', async () => {
    app = createApp({ ...options(), ocr: undefined })
    const round = await newRound()
    await finish(round)
    await upload(round.id).expect(503)
    await post(`/api/photo-rounds/${round.id}/review`, { results: [true, false] }).expect(200)
  })
  it('counts failed provider requests conservatively, persists quota, and never makes a paid fallback call', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 }))
    vi.stubGlobal('fetch', transport)
    const round = await newRound()
    await finish(round)
    await upload(round.id).expect(429)
    await upload(round.id).expect(429)
    store = await FileStore.open(join(directory, 'store.json'))
    app = createApp(options())
    await upload(round.id).expect(429)
    expect(transport).toHaveBeenCalledTimes(2)
    expect(store.ocrUsage().used).toBe(2)
    expect(store.words(accountId).every(word => word.last_practiced_at === null)).toBe(true)
    await Promise.all([store.reserveOcr(2, '2099-01'), store.reserveOcr(2, '2099-01')])
    await expect(store.reserveOcr(2, '2099-01')).rejects.toThrow('exhausted')
  })
  it('stores recognition only, not the photo, and waits for explicit parent confirmation', async () => {
    const content = '1. Straße\n2. Schmeterling'
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 202, headers: { 'Operation-Location': `${ocr.endpoint}/documentintelligence/documentModels/prebuilt-read/analyzeResults/test-id?api-version=2024-11-30` } }))
      .mockResolvedValueOnce(Response.json({ status: 'succeeded', analyzeResult: { content, pages: [{ words: [...content.matchAll(/\S+/g)].map(match => ({ confidence: 0.95, span: { offset: match.index, length: match[0].length } })) }] } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', transport)
    const round = await newRound()
    await finish(round)
    const response = await upload(round.id).expect(200)
    expect(response.body.recognition.answers.map((answer: { text: string }) => answer.text)).toEqual(['Straße', 'Schmeterling'])
    expect(store.words(accountId).every(word => word.last_practiced_at === null)).toBe(true)
    const saved = await readFile(join(directory, 'store.json'), 'utf8')
    expect(saved).toContain('Schmeterling')
    expect(saved).not.toContain(photo.toString('base64'))
    expect(saved).not.toContain(ocr.key)
    expect(store.ocrUsage().used).toBe(1)
  })
  it('enforces the actual default 450-reading boundary, not just a smaller test budget', async () => {
    const round = await newRound()
    await finish(round)
    const file = join(directory, 'store.json')
    const state = JSON.parse(await readFile(file, 'utf8')) as { ocrUsage: { month: string; used: number } }
    state.ocrUsage = { month: new Date().toISOString().slice(0, 7), used: 449 }
    await writeFile(file, JSON.stringify(state))
    store = await FileStore.open(file)
    app = createApp({ ...options(), ocr: { ...ocr, monthlyLimit: 450 } })
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 }))
    vi.stubGlobal('fetch', transport)
    await upload(round.id).expect(429)
    expect(store.ocrUsage().used).toBe(450)
    await upload(round.id).expect(429)
    expect(transport).toHaveBeenCalledTimes(1)
    expect((await FileStore.open(file)).ocrUsage().used).toBe(450)
  })
  it('can remove a saved sheet and recognized text without undoing its practice results', async () => {
    const round = await newRound()
    await finish(round)
    await post(`/api/photo-rounds/${round.id}/review`, { results: [true, false] }).expect(200)
    await request(app).delete(`/api/photo-rounds/${round.id}`).set('Cookie', cookie).set('Origin', origin).send({}).expect(204)
    expect(store.photoRounds(accountId)).toHaveLength(0)
    expect(store.words(accountId).find(word => word.id === ids[0])?.category).toBe('plus')
    const saved = JSON.parse(await readFile(join(directory, 'store.json'), 'utf8')) as { accounts: { attempts: unknown[] }[] }
    expect(saved.accounts[0].attempts).toHaveLength(2)
  })
  it('removes stored recognition snapshots on word deletion and does not partially apply a stale batch', async () => {
    const round = await newRound()
    await finish(round)
    await store.deleteWord(accountId, ids[1])
    await post(`/api/photo-rounds/${round.id}/review`, { results: [true, false] }).expect(404)
    expect(store.words(accountId)[0].last_practiced_at).toBeNull()
    expect(store.photoRounds(accountId)).toHaveLength(0)
  })
})
