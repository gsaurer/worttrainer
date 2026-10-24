// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

const asset = (name: string) => new URL(`../public/${name}`, import.meta.url)

async function workerHarness() {
  const handlers = new Map<string, (event: unknown) => void>()
  const focus = vi.fn(async () => {})
  const postMessage = vi.fn()
  const client = { url: 'https://words.example/', focus, postMessage }
  const worker = {
    addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
    skipWaiting: vi.fn(async () => {}),
    location: { origin: 'https://words.example' },
    clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => [client]), openWindow: vi.fn(async () => {}) },
    registration: { showNotification: vi.fn(async () => {}) },
  }
  runInNewContext(await readFile(asset('sw.js'), 'utf8'), { self: worker, URL })
  async function fire(name: string, data: Record<string, unknown> = {}) {
    let pending: Promise<unknown> | undefined
    handlers.get(name)!({ ...data, waitUntil: (promise: Promise<unknown>) => { pending = promise } })
    await pending
  }
  return { worker, client, handlers, fire }
}

describe('installable private web app', () => {
  it('provides standalone metadata and correctly sized PNG icons, including Apple Home Screen', async () => {
    const manifest = JSON.parse(await readFile(asset('manifest.webmanifest'), 'utf8'))
    expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone', name: 'Worttrainer' })
    for (const icon of manifest.icons) {
      const metadata = await sharp(await readFile(asset(icon.src.slice(1)))).metadata()
      expect(`${metadata.width}x${metadata.height}`).toBe(icon.sizes)
      expect(metadata.format).toBe('png')
    }
    expect(await sharp(await readFile(asset('apple-touch-icon.png'))).metadata()).toMatchObject({ width: 180, height: 180 })
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
    expect(html).toContain('rel="manifest"')
    expect(html).toContain('rel="apple-touch-icon"')
  })

  it('does not intercept fetches or cache authenticated pages and APIs', async () => {
    const { handlers, worker, fire } = await workerHarness()
    expect(handlers.has('fetch')).toBe(false)
    await fire('install')
    await fire('activate')
    expect(worker.skipWaiting).toHaveBeenCalledOnce()
    expect(worker.clients.claim).toHaveBeenCalledOnce()
  })

  it('displays the generic reminder and retains the daily notification tag', async () => {
    const { worker, fire } = await workerHarness()
    await fire('push', { data: { json: () => ({ title: 'Untrusted title', body: 'Deine nächste Herausforderung wartet auf dich.', tag: 'worttrainer-daily-2026-10-23', url: 'https://elsewhere.example' }) } })
    expect(worker.registration.showNotification).toHaveBeenCalledWith('Worttrainer', expect.objectContaining({ body: 'Deine nächste Herausforderung wartet auf dich.', tag: 'worttrainer-daily-2026-10-23', data: { url: '/' } }))
  })

  it('always shows a visible fallback when a push payload is malformed', async () => {
    const { worker, fire } = await workerHarness()
    await fire('push', { data: { json: () => { throw new Error('Malformed data') } } })
    expect(worker.registration.showNotification).toHaveBeenCalledWith('Worttrainer', expect.objectContaining({ body: 'Your next challenge is waiting for you.' }))
    await fire('push', { data: { json: () => null } })
    expect(worker.registration.showNotification).toHaveBeenCalledTimes(2)
  })

  it('focuses the existing app and asks it to open Home instead of opening an external payload URL', async () => {
    const { worker, client, fire } = await workerHarness()
    const close = vi.fn()
    await fire('notificationclick', { notification: { close, data: { url: 'https://elsewhere.example' } } })
    expect(close).toHaveBeenCalledOnce()
    expect(client.focus).toHaveBeenCalledOnce()
    expect(client.postMessage).toHaveBeenCalledWith({ type: 'OPEN_PRACTICE' })
    expect(worker.clients.openWindow).not.toHaveBeenCalled()
  })

  it('opens Home when the app is not running', async () => {
    const { worker, fire } = await workerHarness()
    worker.clients.matchAll.mockResolvedValue([])
    await fire('notificationclick', { notification: { close: vi.fn() } })
    expect(worker.clients.openWindow).toHaveBeenCalledWith('/')
  })
})