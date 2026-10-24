import { resolve } from 'node:path'
import { createApp } from './app.js'
import { FileStore } from './store.js'
import { ocrConfiguration } from './ocr.js'
import { pushConfiguration, ReminderService } from './reminders.js'

const production = process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT ?? (production ? 3000 : 3002))
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.')
const origin = process.env.APP_ORIGIN ?? (production ? '' : 'http://localhost:5182')
if (!origin || new URL(origin).origin !== origin) throw new Error('APP_ORIGIN must be the exact public origin, without a trailing slash.')
const secureSetting = process.env.COOKIE_SECURE
if (secureSetting && !['true', 'false'].includes(secureSetting)) throw new Error('COOKIE_SECURE must be true or false.')
const secureCookie = secureSetting ? secureSetting === 'true' : production
if (secureCookie && !origin.startsWith('https://')) throw new Error('Secure cookies require an HTTPS APP_ORIGIN. Set COOKIE_SECURE=false only for a trusted local HTTP preview.')
const dataFile = resolve(process.env.DATA_FILE ?? 'data/store.json')
const store = await FileStore.open(dataFile)
const reminders = await ReminderService.open(dataFile, store, pushConfiguration(process.env))
const app = createApp({
  store, origin, production, secureCookie,
  trustProxy: process.env.TRUST_PROXY === '1',
  ocr: ocrConfiguration(process.env),
  reminders,
})
const host = process.env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1')
let stopReminders: (() => Promise<void>) | undefined
const server = app.listen(port, host, () => {
  stopReminders = reminders.start()
  console.log(`Worttrainer API listening on ${host}:${port}`)
  console.log(`Sign in or create a private account at ${origin}/`)
})
server.on('error', error => { console.error('Cannot start Worttrainer', error); process.exitCode = 1 })
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(error => { void (stopReminders?.() ?? Promise.resolve()).then(() => process.exit(error ? 1 : 0), () => process.exit(1)) })
    server.closeIdleConnections()
  })
}
