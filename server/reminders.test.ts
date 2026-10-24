// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import webpush from 'web-push'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deviceId, pushConfiguration, reminderWindow, ReminderService, type PushConfiguration } from './reminders.js'
import { FileStore } from './store.js'
import { createApp } from './app.js'

const schedule = { time: '17:00', timeZone: 'Europe/Vienna' }

describe('daily challenge reminder eligibility', () => {
  it('waits until 5 pm local time and expires the catch-up window after an hour', () => {
    expect(reminderWindow(schedule, [], null, new Date('2026-10-23T14:59:59Z'))).toBeNull()
    expect(reminderWindow(schedule, [], null, new Date('2026-10-23T15:00:00Z'))).toEqual({ day: '2026-10-23', expiresAt: Date.parse('2026-10-23T16:00:00Z') })
    expect(reminderWindow(schedule, [], null, new Date('2026-10-23T15:59:59Z'))).not.toBeNull()
    expect(reminderWindow(schedule, [], null, new Date('2026-10-23T16:00:00Z'))).toBeNull()
  })

  it('skips a finished dictation even if its parent check is still pending', () => {
    expect(reminderWindow(schedule, [null, '2026-10-23T10:00:00Z'], null, new Date('2026-10-23T15:00:00Z'))).toBeNull()
    expect(reminderWindow(schedule, ['2026-10-22T10:00:00Z'], null, new Date('2026-10-23T15:00:00Z'))).not.toBeNull()
  })

  it('uses the local calendar day rather than the UTC day', () => {
    const pacific = { time: '17:00', timeZone: 'America/Los_Angeles' }
    const now = new Date('2026-10-24T00:00:00Z')
    expect(reminderWindow(pacific, [], null, now)?.day).toBe('2026-10-23')
    expect(reminderWindow(pacific, ['2026-10-23T06:00:00Z'], null, now)).not.toBeNull()
    expect(reminderWindow(pacific, ['2026-10-23T08:00:00Z'], null, now)).toBeNull()
  })

  it('follows daylight-saving changes without shifting the chosen local time', () => {
    expect(reminderWindow(schedule, [], null, new Date('2026-10-25T15:00:00Z'))).toBeNull()
    expect(reminderWindow(schedule, [], null, new Date('2026-10-25T16:00:00Z'))?.day).toBe('2026-10-25')
  })

  it('does not repeat a reminder on the same local day', () => {
    expect(reminderWindow(schedule, [], '2026-10-23', new Date('2026-10-23T15:02:00Z'))).toBeNull()
    expect(reminderWindow(schedule, [], '2026-10-22', new Date('2026-10-23T15:02:00Z'))).not.toBeNull()
  })
})

describe('private persistent Web Push reminders', () => {
  let directory: string
  let file: string
  let store: FileStore
  let reminders: ReminderService
  let first: string
  let second: string
  const keys = webpush.generateVAPIDKeys()
  const send = vi.fn<PushConfiguration['send']>()
  const push = { publicKey: keys.publicKey, send }
  const token = 'a'.repeat(43)
  const cookie = `worttrainer_session=${token}`
  const subscription = (name = 'first') => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh: keys.publicKey, auth: Buffer.alloc(16, 1).toString('base64url') } })
  const now = new Date('2026-10-23T15:00:00Z')

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'worttrainer-reminders-'))
    file = join(directory, 'store.json')
    store = await FileStore.open(file)
    first = randomUUID(); second = randomUUID()
    const credentials = { salt: '11'.repeat(16), passwordHash: '22'.repeat(64) }
    await store.register({ email: 'first@example.test', ...credentials }, { accountId: first, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: Date.parse('2100-01-01T00:00:00Z') })
    await store.register({ email: 'second@example.test', ...credentials }, { accountId: second, tokenHash: '44'.repeat(32), expiresAt: Date.parse('2100-01-01T00:00:00Z') })
    send.mockReset().mockResolvedValue({})
    reminders = await ReminderService.open(file, store, push)
  })
  afterEach(async () => { vi.useRealTimers(); await rm(directory, { recursive: true, force: true }) })

  it('defaults to opt-out, persists private subscriptions, and avoids duplicate sends after restart', async () => {
    expect(reminders.settings(first)).toMatchObject({ enabled: false, time: '17:00' })
    await reminders.dispatch(now)
    expect(send).not.toHaveBeenCalled()
    await reminders.configure(first, { ...schedule, subscription: subscription() })
    await Promise.all([reminders.dispatch(now), reminders.dispatch(now)])
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][2]).toBe(3600)
    expect(JSON.parse(send.mock.calls[0][1])).toMatchObject({ title: 'Worttrainer', tag: 'worttrainer-daily-2026-10-23' })
    expect(send.mock.calls[0][1]).not.toContain('first@example.test')
    const reopened = await ReminderService.open(file, store, push)
    await reopened.dispatch(new Date('2026-10-23T15:01:00Z'))
    expect(send).toHaveBeenCalledTimes(1)
    await reopened.dispatch(new Date('2026-10-24T15:00:00Z'))
    expect(send).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(store.exportData(first))).not.toContain(subscription().endpoint)
  })

  it('only lets an owner disable a device and rebinds a shared device without leaking accounts', async () => {
    const device = subscription()
    await reminders.configure(first, { ...schedule, subscription: device })
    await reminders.remove(second, device.endpoint)
    expect(reminders.settings(first, deviceId(device.endpoint)).deviceEnabled).toBe(true)
    expect(reminders.settings(second, deviceId(device.endpoint)).deviceEnabled).toBe(false)
    await reminders.configure(second, { ...schedule, subscription: device })
    expect(reminders.settings(first).enabled).toBe(false)
    expect(reminders.settings(second, deviceId(device.endpoint)).deviceEnabled).toBe(true)
    await reminders.remove(second, device.endpoint)
    await reminders.dispatch(now)
    expect(send).not.toHaveBeenCalled()
  })

  it('retries temporary failures after five minutes and removes expired subscriptions', async () => {
    await reminders.configure(first, { ...schedule, subscription: subscription() })
    send.mockRejectedValueOnce({ statusCode: 503 })
    await reminders.dispatch(now)
    await reminders.dispatch(new Date('2026-10-23T15:01:00Z'))
    expect(send).toHaveBeenCalledTimes(1)
    await reminders.dispatch(new Date('2026-10-23T15:05:00Z'))
    expect(send).toHaveBeenCalledTimes(2)
    send.mockRejectedValueOnce({ statusCode: 410 })
    await reminders.dispatch(new Date('2026-10-24T15:00:00Z'))
    expect(reminders.settings(first).enabled).toBe(false)
  })

  it('keeps completion suppression after the finished challenge is deleted', async () => {
    await reminders.configure(first, { ...schedule, subscription: subscription() })
    const word = await store.addWord(first, 'Katze', 'de')
    const challenge = await store.createChallenge(first, [word.id])
    const app = createApp({ store, origin: 'http://localhost:5182', secureCookie: false, reminders })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-23T10:00:00Z'))
    await request(app).post(`/api/challenges/${challenge.id}/advance`).set('Cookie', cookie).set('Origin', 'http://localhost:5182').send({ nextIndex: 1, fromIndex: 0, elapsedMs: 5000, intervalSeconds: 5, automatic: true, action: 'next' }).expect(200)
    await request(app).delete(`/api/challenges/${challenge.id}`).set('Cookie', cookie).set('Origin', 'http://localhost:5182').send({}).expect(204)
    expect(store.challenges(first)).toEqual([])
    await (await ReminderService.open(file, store, push)).dispatch(now)
    expect(send).not.toHaveBeenCalled()
  })

  it('rechecks completion before notifying a second device', async () => {
    await reminders.configure(first, { ...schedule, subscription: subscription('one') })
    await reminders.configure(first, { ...schedule, subscription: subscription('two') })
    send.mockImplementationOnce(async () => { await reminders.recordCompletion(first, now.toISOString()) })
    await reminders.dispatch(now)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('requires authentication and origin, rejects forged ownership and private-network push endpoints', async () => {
    const app = createApp({ store, origin: 'http://localhost:5182', secureCookie: false, reminders })
    await request(app).get('/api/reminders').expect(401)
    await request(app).post('/api/reminders').set('Origin', 'http://localhost:5182').send({ ...schedule, subscription: subscription() }).expect(401)
    await request(app).post('/api/reminders').set('Cookie', cookie).set('Origin', 'https://elsewhere.test').send({ ...schedule, subscription: subscription() }).expect(403)
    await request(app).post('/api/reminders').set('Cookie', cookie).set('Origin', 'http://localhost:5182').send({ ...schedule, accountId: second, subscription: subscription() }).expect(400)
    for (const endpoint of ['https://127.0.0.1/private', 'https://fcm.googleapis.com.attacker.test/send', 'https://fcm.googleapis.com:444/send']) {
      await request(app).post('/api/reminders').set('Cookie', cookie).set('Origin', 'http://localhost:5182').send({ ...schedule, subscription: { ...subscription(), endpoint } }).expect(400)
    }
    await request(app).post('/api/reminders').set('Cookie', cookie).set('Origin', 'http://localhost:5182').send({ ...schedule, subscription: subscription() }).expect(200)
    const response = await request(app).get(`/api/reminders?device=${deviceId(subscription().endpoint)}`).set('Cookie', cookie).expect(200)
    expect(response.body.deviceEnabled).toBe(true)
    expect(JSON.stringify(response.body)).not.toContain('endpoint')
    expect(JSON.stringify(response.body)).not.toContain('auth')
  })

  it('validates configuration without disclosing private keys and refuses corrupt data', async () => {
    expect(pushConfiguration({})).toBeUndefined()
    expect(() => pushConfiguration({ VAPID_PUBLIC_KEY: keys.publicKey })).toThrow('Configure VAPID')
    expect(pushConfiguration({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:admin@example.test' })?.publicKey).toBe(keys.publicKey)
    const target = join(directory, 'store.reminders.json')
    await writeFile(target, '{broken', 'utf8')
    await expect(ReminderService.open(file, store, push)).rejects.toThrow()
    expect(await readFile(target, 'utf8')).toBe('{broken')
  })
})