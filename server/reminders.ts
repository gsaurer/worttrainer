import { createECDH, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import webpush from 'web-push'
import { z } from 'zod'
import type { DevicePushSubscription, ReminderSchedule, ReminderSettings } from '../shared/reminders.js'
import { HttpError } from './errors.js'
import { writeJson, type FileStore } from './store.js'

export const reminderScheduleSchema = z.object({
  time: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Choose a valid reminder time.'),
  timeZone: z.string().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true }
    catch { return false }
  }, 'Choose a valid time zone.'),
})

const endpointSchema = z.url().max(4096).refine(value => {
  const url = new URL(value)
  const allowed = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com'].includes(url.hostname)
    || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname)
  return allowed && url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash
}, 'Use a supported browser push service.')

export const pushSubscriptionSchema = z.object({
  endpoint: endpointSchema,
  expirationTime: z.number().nonnegative().nullable().optional(),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/).refine(value => Buffer.from(value, 'base64url')[0] === 4),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }).strict(),
}).strict()

const deviceSchema = z.object({
  subscription: pushSubscriptionSchema,
  lastSentDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  claimedAt: z.number().nullable(),
  retryAt: z.number(),
}).strict()
const recordSchema = reminderScheduleSchema.extend({
  accountId: z.uuid(), lastCompletedAt: z.iso.datetime().nullable(), devices: z.array(deviceSchema).max(8),
}).strict()
const stateSchema = z.object({
  format: z.literal('worttrainer-reminders'), schemaVersion: z.literal(1), accounts: z.array(recordSchema),
}).strict().superRefine((state, context) => {
  const accounts = state.accounts.map(account => account.accountId)
  const endpoints = state.accounts.flatMap(account => account.devices.map(device => device.subscription.endpoint))
  if (new Set(accounts).size !== accounts.length || new Set(endpoints).size !== endpoints.length) context.addIssue({ code: 'custom', message: 'Duplicate reminder ownership.' })
})
type ReminderState = z.infer<typeof stateSchema>
export type PushConfiguration = {
  publicKey: string
  send: (subscription: DevicePushSubscription, payload: string, ttl: number) => Promise<unknown>
}

export function pushConfiguration(env: NodeJS.ProcessEnv): PushConfiguration | undefined {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = env
  if (!publicKey && !privateKey && !subject) return undefined
  if (!publicKey || !privateKey || !subject || !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(subject)) throw new Error('Configure VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and a mailto: or HTTPS VAPID_SUBJECT together.')
  try {
    const key = createECDH('prime256v1')
    key.setPrivateKey(Buffer.from(privateKey, 'base64url'))
    if (key.getPublicKey().toString('base64url') !== publicKey) throw new Error('Key mismatch')
  } catch { throw new Error('The configured VAPID keys are not a matching P-256 key pair.') }
  return { publicKey, send: (subscription, payload, ttl) => webpush.sendNotification(subscription, payload, {
    vapidDetails: { publicKey, privateKey, subject }, TTL: ttl, timeout: 10_000, urgency: 'normal', topic: 'worttrainer-daily',
  }) }
}

export const deviceId = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex')

export class ReminderService {
  private queue: Promise<unknown> = Promise.resolve()
  private dispatching: Promise<void> | null = null

  private constructor(private file: string, private store: FileStore, private state: ReminderState, private push?: PushConfiguration) {}

  static async open(dataFile: string, store: FileStore, push?: PushConfiguration) {
    const file = join(dirname(dataFile), `${basename(dataFile, extname(dataFile))}.reminders.json`)
    let state: ReminderState = { format: 'worttrainer-reminders', schemaVersion: 1, accounts: [] }
    try { state = stateSchema.parse(JSON.parse(await readFile(file, 'utf8'))) }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
    if (state.accounts.some(account => !store.hasAccount(account.accountId))) throw new Error('Reminder data references an unknown account. Restore matching data files before restarting.')
    return new ReminderService(file, store, state, push)
  }

  settings(accountId: string, device?: string): ReminderSettings {
    if (!this.store.hasAccount(accountId)) throw new HttpError(401, 'Please sign in to your account.')
    const record = this.state.accounts.find(account => account.accountId === accountId)
    return {
      time: record?.time ?? '17:00', timeZone: record?.timeZone ?? 'UTC',
      enabled: !!record?.devices.length, deviceEnabled: !!record?.devices.some(item => deviceId(item.subscription.endpoint) === device),
      configured: !!this.push, publicKey: this.push?.publicKey ?? null,
    }
  }

  async configure(accountId: string, input: ReminderSchedule & { subscription: DevicePushSubscription }) {
    this.settings(accountId)
    if (!this.push) throw new HttpError(503, 'Daily reminders are not configured on this server.')
    const schedule = reminderScheduleSchema.parse(input)
    const subscription = pushSubscriptionSchema.parse(input.subscription)
    await this.change(state => {
      for (const record of state.accounts) if (record.accountId !== accountId) record.devices = record.devices.filter(device => device.subscription.endpoint !== subscription.endpoint)
      let record = state.accounts.find(account => account.accountId === accountId)
      if (!record) {
        const completed = this.store.challenges(accountId).map(challenge => challenge.writtenAt).filter(timestamp => timestamp !== null).sort()
        record = { ...schedule, accountId, lastCompletedAt: completed.at(-1) ?? null, devices: [] }
        state.accounts.push(record)
      }
      Object.assign(record, schedule)
      const existing = record.devices.find(device => device.subscription.endpoint === subscription.endpoint)
      if (existing) existing.subscription = subscription
      else {
        if (record.devices.length >= 8) throw new HttpError(409, 'This account already has eight reminder devices.')
        record.devices.push({ subscription, lastSentDay: null, claimedAt: null, retryAt: 0 })
      }
    })
    return this.settings(accountId, deviceId(subscription.endpoint))
  }

  async remove(accountId: string, endpoint: string) {
    this.settings(accountId)
    await this.change(state => {
      const record = state.accounts.find(account => account.accountId === accountId)
      if (record) record.devices = record.devices.filter(device => device.subscription.endpoint !== endpoint)
    })
    return this.settings(accountId, deviceId(endpoint))
  }

  async recordCompletion(accountId: string, completedAt: string | null) {
    if (!completedAt || !this.state.accounts.some(account => account.accountId === accountId)) return
    await this.change(state => {
      const record = state.accounts.find(account => account.accountId === accountId)
      if (record && (!record.lastCompletedAt || completedAt > record.lastCompletedAt)) record.lastCompletedAt = completedAt
    })
  }

  private change<T>(operation: (state: ReminderState) => T): Promise<T> {
    const result = this.queue.then(async () => {
      const next = structuredClone(this.state)
      const value = operation(next)
      stateSchema.parse(next)
      await writeJson(this.file, next)
      this.state = next
      return value
    })
    this.queue = result.catch(() => {})
    return result
  }

  dispatch(now = new Date()): Promise<void> {
    if (!this.dispatching) this.dispatching = this.deliver(now).finally(() => { this.dispatching = null })
    return this.dispatching
  }

  private async deliver(now: Date) {
    const push = this.push
    if (!push) return
    for (const account of this.state.accounts) {
      const completed = [...this.store.challenges(account.accountId).map(challenge => challenge.writtenAt), account.lastCompletedAt]
      for (const device of account.devices) {
        const window = reminderWindow(account, completed, device.lastSentDay, now)
        if (!window || device.retryAt > now.getTime() || device.claimedAt !== null && now.getTime() - device.claimedAt < 120_000) continue
        if (typeof device.subscription.expirationTime === 'number' && device.subscription.expirationTime <= now.getTime()) { await this.remove(account.accountId, device.subscription.endpoint); continue }
        const claim = await this.change(state => {
          const record = state.accounts.find(record => record.accountId === account.accountId)
          const current = record?.devices.find(item => item.subscription.endpoint === device.subscription.endpoint)
          if (!record || !current) return null
          const fresh = reminderWindow(record, [...this.store.challenges(account.accountId).map(challenge => challenge.writtenAt), record.lastCompletedAt], current.lastSentDay, now)
          if (!fresh) return null
          current.claimedAt = now.getTime()
          return fresh
        })
        if (!claim) continue
        try {
          const german = this.store.websiteLanguage(account.accountId) === 'de'
          await push.send(device.subscription, JSON.stringify({
            title: 'Worttrainer', body: german ? 'Deine nächste Herausforderung wartet auf dich.' : 'Your next challenge is waiting for you.',
            tag: `worttrainer-daily-${claim.day}`,
          }), Math.max(1, Math.floor((claim.expiresAt - now.getTime()) / 1000)))
          await this.change(state => {
            const current = state.accounts.find(record => record.accountId === account.accountId)?.devices.find(item => item.subscription.endpoint === device.subscription.endpoint)
            if (current) { current.lastSentDay = claim.day; current.claimedAt = null; current.retryAt = 0 }
          })
        } catch (error) {
          const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : null
          if (status === 404 || status === 410) await this.remove(account.accountId, device.subscription.endpoint)
          else await this.change(state => {
            const current = state.accounts.find(record => record.accountId === account.accountId)?.devices.find(item => item.subscription.endpoint === device.subscription.endpoint)
            if (current) { current.claimedAt = null; current.retryAt = now.getTime() + 300_000 }
          })
        }
      }
    }
  }

  start() {
    const tick = () => { void this.dispatch().catch(() => { console.error('Daily reminder delivery could not access its private data file.') }) }
    const timer = setInterval(tick, 60_000)
    timer.unref()
    tick()
    return async () => { clearInterval(timer); await this.dispatching }
  }
}

export function reminderWindow(schedule: ReminderSchedule, completedAt: readonly (string | null)[], lastSentDay: string | null, now: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: schedule.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  function localParts(date: Date) {
    const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]))
    return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) }
  }
  const local = localParts(now)
  const [hour, minute] = schedule.time.split(':').map(Number)
  const elapsed = local.minutes - (hour * 60 + minute)
  if (elapsed < 0 || elapsed >= 60 || lastSentDay === local.day) return null
  if (completedAt.some(timestamp => timestamp !== null && localParts(new Date(timestamp)).day === local.day)) return null
  return {
    day: local.day,
    expiresAt: now.getTime() + (60 - elapsed) * 60_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds(),
  }
}