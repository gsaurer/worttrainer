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
import { FeatureFlags } from './feature-flags.js'
import { challengeSchema } from './challenge-schema.js'
import type { Challenge } from '../shared/model.js'

const origin = 'http://localhost:5173'
const ocr = { endpoint: 'https://test.cognitiveservices.azure.com', key: 'test-only-key', monthlyLimit: 2 }
let directory: string
let store: FileStore
let app: ReturnType<typeof createApp>
let cookie: string
let ids: string[]
let photo: Buffer
let accountId: string
let features: FeatureFlags
const options = () => ({ store, origin, secureCookie: false, ocr, features })
const post = (path: string, body: object) => request(app).post(path).set('Origin', origin).set('Cookie', cookie).send(body)
const upload = (id: string, bytes = photo) => request(app).post(`/api/challenges/${id}/photo`).set('Origin', origin).set('Cookie', cookie).set('Content-Type', 'image/png').send(bytes)
const advance = (id: string, fromIndex: number, nextIndex: number) => post(`/api/challenges/${id}/advance`, { fromIndex, nextIndex, elapsedMs: 4500, intervalSeconds: 5, automatic: false, action: nextIndex < fromIndex ? 'previous' : 'next' })
const review = (id: string, results: boolean[]) => post(`/api/challenges/${id}/review`, { results, check: { method: 'manual', spellings: results.map((correct, index) => correct ? ['Straße', 'Schmetterling'][index] : null) } })
async function newChallenge() {
  return (await post('/api/challenges', { wordIds: ids }).expect(201)).body as Challenge
}
async function finish(challenge: Challenge) {
  for (let nextIndex = 1; nextIndex <= ids.length; nextIndex++) await advance(challenge.id, nextIndex - 1, nextIndex).expect(200)
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'worttrainer-photo-'))
  store = await FileStore.open(join(directory, 'store.json'))
  const token = randomBytes(32).toString('base64url')
  cookie = `worttrainer_session=${token}`
  accountId = randomUUID()
  await store.register({ email: 'parent@example.com', salt: '00'.repeat(16), passwordHash: 'aa'.repeat(64) }, { accountId, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: Date.now() + 60_000 })
  ids = [ (await store.addWord(accountId, 'Straße', 'de')).id, (await store.addWord(accountId, 'Schmetterling', 'de')).id ]
  await writeFile(join(directory, 'store.feature-flags.json'), JSON.stringify({ flags: { 'challenge-auto-check': { all: true } } }))
  features = await FeatureFlags.open(join(directory, 'store.json'))
  app = createApp(options())
  photo = await sharp({ create: { width: 30, height: 40, channels: 3, background: '#ffffff' } }).png().toBuffer()
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(directory, { recursive: true, force: true })
})

describe('persisted photo challenges and parent-confirmed batches', () => {
  it('requires explicit timing and check metadata rather than accepting legacy requests', async () => {
    const challenge = await newChallenge()
    for (const field of ['telemetry', 'check', 'photo']) expect(challengeSchema.safeParse({ ...challenge, [field]: undefined }).success).toBe(false)
    await post(`/api/challenges/${challenge.id}/advance`, { nextIndex: 1 }).expect(400)
    await finish(challenge)
    await post(`/api/challenges/${challenge.id}/review`, { results: [true, false] }).expect(400)
  })

  it('records navigation timing and supports previous words without checking answers', async () => {
    const challenge = await newChallenge()
    const path = `/api/challenges/${challenge.id}/advance`
    const timing = { elapsedMs: 4500, intervalSeconds: 5, automatic: true }
    await post(path, { nextIndex: 1, fromIndex: 0, action: 'next', ...timing }).expect(200)
    await post(path, { nextIndex: 0, fromIndex: 1, action: 'previous', ...timing, automatic: false }).expect(200)
    await post(path, { nextIndex: 1, fromIndex: 0, action: 'next', ...timing }).expect(200)
    const response = await post(path, { nextIndex: 2, fromIndex: 1, action: 'next', ...timing }).expect(200)
    expect(response.body.telemetry).toHaveLength(4)
    expect(response.body.telemetry[0]).toMatchObject({ fromIndex: 0, toIndex: 1, ...timing })
    expect(response.body.writtenAt).toBeTruthy()
    expect(response.body.reviewedAt).toBeNull()
    expect(response.body.results).toBeNull()
    expect(store.words(accountId).every(word => word.last_practiced_at === null)).toBe(true)
    const reopened = await FileStore.open(join(directory, 'store.json'))
    expect(reopened.challenge(accountId, challenge.id)).toMatchObject({ telemetry: response.body.telemetry })
  })

  it('requires authentication, origin, proper content type, and a completed numbered challenge', async () => {
    await request(app).get('/api/challenges').expect(401)
    await request(app).post('/api/challenges').set('Origin', origin).send({ wordIds: ids }).expect(401)
    const challenge = await newChallenge()
    await request(app).post(`/api/challenges/${challenge.id}/photo`).set('Cookie', cookie).set('Origin', 'https://untrusted.example').set('Content-Type', 'image/png').send(photo).expect(403)
    await upload(challenge.id).expect(409)
    await post(`/api/challenges/${challenge.id}/review`, { results: [true, false] }).expect(400)
    await post('/api/challenges', { wordIds: [ids[0], ids[0]] }).expect(400)
    await advance(challenge.id, 0, 2).expect(409)
    await finish(challenge)
    await advance(challenge.id, 1, 2).expect(409)
    await upload(challenge.id, Buffer.from('not an image')).expect(400)
    expect(store.ocrUsage().used).toBe(0)
    await upload(challenge.id, Buffer.alloc(4 * 1024 * 1024 + 1)).expect(413)
    expect(store.ocrUsage().used).toBe(0)
  })
  it('persists ordered snapshots, writing position, and timestamps without recording spelling attempts', async () => {
    const challenge = await newChallenge()
    await advance(challenge.id, 0, 1).expect(200)
    store = await FileStore.open(join(directory, 'store.json'))
    expect(store.challenge(accountId, challenge.id)).toMatchObject({ nextIndex: 1, writtenAt: null, reviewedAt: null })
    expect(store.challenge(accountId, challenge.id).words.map(word => word.id)).toEqual(ids)
    expect(store.words(accountId).every(word => word.last_practiced_at === null)).toBe(true)
    const saved = JSON.parse(await readFile(join(directory, 'store.accounts', `${accountId}.json`), 'utf8'))
    expect(saved.attempts).toHaveLength(0)
  })
  it('saves a reviewed batch atomically and deduplicates simultaneous retries across restart', async () => {
    const challenge = await newChallenge()
    await finish(challenge)
    await review(challenge.id, [true]).expect(400)
    expect(store.words(accountId).every(word => word.category === 'new')).toBe(true)
    const responses = await Promise.all([review(challenge.id, [true, false]), review(challenge.id, [true, false])])
    expect(responses.map(response => response.status)).toEqual([200, 200])
    expect(store.words(accountId).find(word => word.id === ids[0])).toMatchObject({ category: 'new', consecutive_mistakes: 0 })
    expect(store.words(accountId).find(word => word.id === ids[1])).toMatchObject({ category: 'new', consecutive_mistakes: 1 })
    await review(challenge.id, [false, false]).expect(409)
    store = await FileStore.open(join(directory, 'store.json'))
    app = createApp(options())
    await review(challenge.id, [true, false]).expect(200)
    const saved = JSON.parse(await readFile(join(directory, 'store.accounts', `${accountId}.json`), 'utf8')) as { attempts: { createdAt: string }[] }
    expect(saved.attempts).toHaveLength(2)
    expect(saved.attempts.every(attempt => attempt.createdAt === store.challenge(accountId, challenge.id).reviewedAt)).toBe(true)
    const again = await newChallenge()
    await finish(again)
    await review(again.id, [false, false]).expect(200)
    expect(store.words(accountId).find(word => word.id === ids[0])).toMatchObject({ category: 'new', consecutive_mistakes: 1 })
    expect(store.words(accountId).find(word => word.id === ids[1])).toMatchObject({ category: 'minus', consecutive_mistakes: 2 })
  })
  it('counts progress across separate reviewed challenges and restarts, including a missed plus word', async () => {
    const outcomes = [
      { results: [true, false], categories: ['new', 'new'] },
      { results: [true, false], categories: ['new', 'minus'] },
      { results: [true, true], categories: ['plus', 'minus'] },
      { results: [false, true], categories: ['new', 'minus'] },
      { results: [true, true], categories: ['new', 'plus'] },
    ]
    for (const outcome of outcomes) {
      const challenge = await newChallenge()
      await finish(challenge)
      await review(challenge.id, outcome.results).expect(200)
      store = await FileStore.open(join(directory, 'store.json'))
      app = createApp(options())
      expect(ids.map(id => store.words(accountId).find(word => word.id === id)?.category)).toEqual(outcome.categories)
    }
  })

  it('keeps OCR unavailable explicitly until configured while allowing manual parent review', async () => {
    app = createApp({ ...options(), ocr: undefined })
    const challenge = await newChallenge()
    await finish(challenge)
    await upload(challenge.id).expect(503)
    await review(challenge.id, [true, false]).expect(200)
  })
  it('counts failed provider requests conservatively, persists quota, and never makes a paid fallback call', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 }))
    vi.stubGlobal('fetch', transport)
    const challenge = await newChallenge()
    await finish(challenge)
    await upload(challenge.id).expect(429)
    await upload(challenge.id).expect(429)
    store = await FileStore.open(join(directory, 'store.json'))
    app = createApp(options())
    await upload(challenge.id).expect(429)
    expect(transport).toHaveBeenCalledTimes(2)
    expect(store.ocrUsage().used).toBe(2)
    expect(store.words(accountId).every(word => word.last_practiced_at === null)).toBe(true)
    await Promise.all([store.reserveOcr(2, '2099-01'), store.reserveOcr(2, '2099-01')])
    await expect(store.reserveOcr(2, '2099-01')).rejects.toThrow('exhausted')
  })
  it('stores sanitized photos and evaluation metadata without creating attempts before confirmation', async () => {
    const content = '1. Straße\n2. Schmeterling'
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 202, headers: { 'Operation-Location': `${ocr.endpoint}/documentintelligence/documentModels/prebuilt-read/analyzeResults/test-id?api-version=2024-11-30` } }))
      .mockResolvedValueOnce(Response.json({ status: 'succeeded', analyzeResult: { content, pages: [{ words: [...content.matchAll(/\S+/g)].map(match => ({ confidence: 0.95, span: { offset: match.index, length: match[0].length } })) }] } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', transport)
    const challenge = await newChallenge()
    await finish(challenge)
    const response = await upload(challenge.id).expect(200)
    expect(response.body.recognition.answers.map((answer: { text: string }) => answer.text)).toEqual(['Straße', 'Schmeterling'])
    expect(response.body.photo.dataUrl).toMatch(/^data:image\/jpeg;base64,/)
    expect(response.body.photo.uploadedAt).toBeTruthy()
    expect(response.body.photo.evaluatedAt).toBeTruthy()
    expect(store.words(accountId).every(word => word.last_practiced_at === null)).toBe(true)
    const saved = await readFile(join(directory, 'store.accounts', `${accountId}.json`), 'utf8')
    expect(saved).toContain('Schmeterling')
    expect(saved).not.toContain(photo.toString('base64'))
    expect(saved).not.toContain(ocr.key)
    expect(store.ocrUsage().used).toBe(1)
    const check = { method: 'photo', spellings: ['Straße', 'Schmeterling'] }
    const reviewed = await post(`/api/challenges/${challenge.id}/review`, { results: [true, false], check }).expect(200)
    expect(reviewed.body.check).toEqual({ ...check, evaluatedAt: reviewed.body.reviewedAt })
    const reopened = await FileStore.open(join(directory, 'store.json'))
    expect(reopened.challenge(accountId, challenge.id).photo).toEqual(response.body.photo)
    expect(reopened.challenge(accountId, challenge.id).check).toEqual(reviewed.body.check)
  })
  it('stores manual misspellings and rejects altered check metadata on retry', async () => {
    const challenge = await newChallenge()
    await finish(challenge)
    const path = `/api/challenges/${challenge.id}/review`
    const check = { method: 'manual', spellings: ['Straße', 'Schmeterling'] }
    const response = await post(path, { results: [true, false], check }).expect(200)
    expect(response.body.check).toEqual({ ...check, evaluatedAt: response.body.reviewedAt })
    await post(path, { results: [true, false], check }).expect(200)
    await post(path, { results: [true, false], check: { ...check, spellings: ['Straße', 'different'] } }).expect(409)
    expect(store.exportData(accountId).challenges.find(item => item.id === challenge.id)?.check).toEqual(response.body.check)
  })
  it('enforces the actual default 450-reading boundary, not just a smaller test budget', async () => {
    const challenge = await newChallenge()
    await finish(challenge)
    const file = join(directory, 'store.json')
    const state = JSON.parse(await readFile(file, 'utf8')) as { ocrUsage: { month: string; used: number } }
    state.ocrUsage = { month: new Date().toISOString().slice(0, 7), used: 449 }
    await writeFile(file, JSON.stringify(state))
    store = await FileStore.open(file)
    app = createApp({ ...options(), ocr: { ...ocr, monthlyLimit: 450 } })
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 }))
    vi.stubGlobal('fetch', transport)
    await upload(challenge.id).expect(429)
    expect(store.ocrUsage().used).toBe(450)
    await upload(challenge.id).expect(429)
    expect(transport).toHaveBeenCalledTimes(1)
    expect((await FileStore.open(file)).ocrUsage().used).toBe(450)
  })
  it('soft-deletes a challenge and ignores its practice results while preserving later practice', async () => {
    const first = await newChallenge()
    await finish(first)
    await review(first.id, [false, false]).expect(200)
    const later = await newChallenge()
    await finish(later)
    await review(later.id, [false, false]).expect(200)
    expect(store.words(accountId).every(word => word.category === 'minus')).toBe(true)
    const laterTime = store.challenge(accountId, later.id).reviewedAt
    await request(app).delete(`/api/challenges/${first.id}`).set('Cookie', cookie).set('Origin', origin).send({ removePractice: true }).expect(204)
    expect(store.words(accountId)).toEqual(expect.arrayContaining(ids.map(id => expect.objectContaining({ id, category: 'new', consecutive_mistakes: 1, last_practiced_at: laterTime }))))
    expect(store.challenges(accountId).map(challenge => challenge.id)).toEqual([later.id])
    const exported = store.exportData(accountId)
    expect(exported.challenges).toHaveLength(2)
    expect(exported.challenges.find(challenge => challenge.id === first.id)).toMatchObject({ deletedAt: expect.any(String) })
    expect(exported.attempts).toHaveLength(4)
    for (const snapshot of first.words) {
      expect(exported.attempts.find(attempt => attempt.id === snapshot.attemptId)).toMatchObject({ deletedAt: expect.any(String), correct: false })
    }
    expect(exported.statistics).toMatchObject({ started: 1, completed: 1, incorrect: 2, reviewed: 2 })
    const reopened = await FileStore.open(join(directory, 'store.json'))
    expect(reopened.words(accountId)).toEqual(store.words(accountId))
    expect(reopened.challenges(accountId).map(challenge => challenge.id)).toEqual([later.id])
    expect(reopened.exportData(accountId).attempts).toEqual(exported.attempts)
  })

  it('ignores deleted correct answers in future streaks and resets only the linked word history', async () => {
    await store.mark(accountId, ids[0], true, randomUUID())
    const previousTime = store.words(accountId).find(word => word.id === ids[0])!.last_practiced_at
    const challenge = await newChallenge()
    await finish(challenge)
    await review(challenge.id, [true, false]).expect(200)
    const remove = () => request(app).delete(`/api/challenges/${challenge.id}`).set('Cookie', cookie).set('Origin', origin).send({ removePractice: true })
    await remove().expect(204)
    expect(store.words(accountId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ids[0], category: 'new', consecutive_mistakes: 0, last_practiced_at: previousTime }),
      expect.objectContaining({ id: ids[1], category: 'new', consecutive_mistakes: 0, last_practiced_at: null }),
    ]))
    const beforeRetry = store.exportData(accountId)
    await remove().expect(204)
    expect(store.exportData(accountId)).toMatchObject({ words: beforeRetry.words, attempts: beforeRetry.attempts, challenges: beforeRetry.challenges })
    expect(await store.mark(accountId, ids[0], true, randomUUID())).toMatchObject({ category: 'new' })
    expect(await store.mark(accountId, ids[0], true, randomUUID())).toMatchObject({ category: 'plus' })
    expect(await store.mark(accountId, ids[1], false, randomUUID())).toMatchObject({ category: 'new', consecutive_mistakes: 1 })
  })

  it('preserves explicit category moves while replaying remaining practice after deletion', async () => {
    const first = await newChallenge()
    await finish(first)
    await review(first.id, [false, false]).expect(200)
    await store.moveWord(accountId, ids[0], 'plus')
    await store.moveWord(accountId, ids[1], 'minus')
    const later = await newChallenge()
    await finish(later)
    await review(later.id, [true, true]).expect(200)
    await store.deleteChallenge(accountId, first.id, true)
    expect(store.words(accountId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ids[0], category: 'plus', consecutive_mistakes: 0 }),
      expect.objectContaining({ id: ids[1], category: 'minus', consecutive_mistakes: 0 }),
    ]))
    const reopened = await FileStore.open(join(directory, 'store.json'))
    await reopened.deleteChallenge(accountId, later.id, true)
    expect(reopened.words(accountId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ids[0], category: 'plus', consecutive_mistakes: 0, last_practiced_at: null }),
      expect.objectContaining({ id: ids[1], category: 'minus', consecutive_mistakes: 0, last_practiced_at: null }),
    ]))
  })

  it('rejects invalid deletion options, foreign challenges and mutations of deleted challenges', async () => {
    const challenge = await newChallenge()
    const before = store.exportData(accountId)
    const path = `/api/challenges/${challenge.id}`
    await request(app).delete(path).set('Origin', origin).send({ removePractice: true }).expect(401)
    await request(app).delete(path).set('Cookie', cookie).set('Origin', 'https://other.example').send({ removePractice: true }).expect(403)
    for (const body of [{ removePractice: 'true' }, { removePractice: null }, { removePractice: true, accountId: randomUUID() }]) {
      await request(app).delete(path).set('Cookie', cookie).set('Origin', origin).send(body).expect(400)
    }
    const otherId = randomUUID()
    await store.register({ email: 'other@example.test', salt: '00'.repeat(16), passwordHash: 'bb'.repeat(64) }, {
      accountId: otherId, tokenHash: randomBytes(32).toString('hex'), expiresAt: Date.now() + 60_000,
    })
    const otherWord = await store.addWord(otherId, 'private', 'en')
    const otherChallenge = await store.createChallenge(otherId, [otherWord.id])
    await request(app).delete(`/api/challenges/${otherChallenge.id}`).set('Cookie', cookie).set('Origin', origin).send({ removePractice: true }).expect(404)
    expect(store.challenges(otherId)).toEqual([otherChallenge])
    expect(store.exportData(accountId)).toMatchObject({ words: before.words, attempts: before.attempts, challenges: before.challenges })
    await request(app).delete(path).set('Cookie', cookie).set('Origin', origin).send({ removePractice: true }).expect(204)
    await advance(challenge.id, 0, 1).expect(404)
    await review(challenge.id, [true, true]).expect(404)
    await upload(challenge.id).expect(404)
    expect(store.ocrUsage().used).toBe(0)
    expect(store.words(accountId)).toEqual(before.words)
    expect(store.exportData(accountId).attempts).toEqual([])
    expect(store.challenges(accountId)).toEqual([])
  })

  it('accepts an empty JSON request while keeping practice results', async () => {
    const challenge = await newChallenge()
    await finish(challenge)
    await review(challenge.id, [true, false]).expect(200)
    const before = store.exportData(accountId)
    await request(app).delete(`/api/challenges/${challenge.id}`).set('Cookie', cookie).set('Origin', origin).expect(415)
    await request(app).delete(`/api/challenges/${challenge.id}`).set('Cookie', cookie).set('Origin', origin).set('Content-Type', 'application/json').set('Content-Length', '0').expect(204)
    expect(store.words(accountId)).toEqual(before.words)
    expect(store.exportData(accountId).attempts).toEqual(before.attempts)
    expect(store.challenges(accountId)).toEqual([])
  })

  it('can remove a saved sheet from active history without undoing its practice results', async () => {
    const challenge = await newChallenge()
    await finish(challenge)
    await review(challenge.id, [true, false]).expect(200)
    const progress = structuredClone(store.words(accountId))
    await request(app).delete(`/api/challenges/${challenge.id}`).set('Cookie', cookie).set('Origin', origin).send({}).expect(204)
    expect(store.challenges(accountId)).toHaveLength(0)
    expect(store.words(accountId)).toEqual(progress)
    const saved = JSON.parse(await readFile(join(directory, 'store.accounts', `${accountId}.json`), 'utf8'))
    expect(saved.attempts).toHaveLength(2)
    expect(saved.attempts.every((attempt: { deletedAt?: string }) => !attempt.deletedAt)).toBe(true)
    expect(saved.challenges).toHaveLength(1)
    expect(saved.challenges[0]).toMatchObject({ id: challenge.id, deletedAt: expect.any(String), results: [true, false] })
  })
  it('removes stored recognition snapshots on word deletion and does not partially apply a stale batch', async () => {
    const challenge = await newChallenge()
    await finish(challenge)
    await store.deleteWord(accountId, ids[1])
    await review(challenge.id, [true, false]).expect(404)
    expect(store.words(accountId)[0].last_practiced_at).toBeNull()
    expect(store.challenges(accountId)).toHaveLength(0)
  })
})
