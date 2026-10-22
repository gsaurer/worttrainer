import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { createApp } from './app.js'
import { FileStore } from './store.js'

const production = process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT ?? (production ? 3000 : 3001))
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.')
const origin = process.env.APP_ORIGIN ?? (production ? '' : 'http://localhost:5173')
if (!origin || new URL(origin).origin !== origin) throw new Error('APP_ORIGIN must be the exact public origin, without a trailing slash.')
const secureSetting = process.env.COOKIE_SECURE
if (secureSetting && !['true', 'false'].includes(secureSetting)) throw new Error('COOKIE_SECURE must be true or false.')
const secureCookie = secureSetting ? secureSetting === 'true' : production
if (secureCookie && !origin.startsWith('https://')) throw new Error('Secure cookies require an HTTPS APP_ORIGIN. Set COOKIE_SECURE=false only for a trusted local HTTP preview.')
const store = await FileStore.open(resolve(process.env.DATA_FILE ?? 'data/store.json'))
const setupToken = randomBytes(32).toString('base64url')
const app = createApp({
  store, origin, production, secureCookie, setupToken,
  setupExpiresAt: Date.now() + 15 * 60 * 1000,
  trustProxy: process.env.TRUST_PROXY === '1',
})
const host = process.env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1')
const server = app.listen(port, host, () => {
  console.log(`Worttrainer API listening on ${host}:${port}`)
  if (!store.account) {
    console.log(`First run: create your parent account at ${origin}/#setup=${setupToken}`)
    console.log('This one-time setup link expires in 15 minutes. Restart the server to renew it. Keep it private.')
  }
})
server.on('error', error => { console.error('Cannot start Worttrainer', error); process.exitCode = 1 })
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(error => { process.exit(error ? 1 : 0) })
    server.closeIdleConnections()
  })
}
