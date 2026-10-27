import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BuildInfo, ServiceStatus } from '../../shared/status'
import { AppStatus } from './AppStatus'
import { api } from '../lib/api'
import { I18nProvider } from '../i18n/I18n'

declare const __BUILD_INFO__: BuildInfo

const status: ServiceStatus = { status: 'ok', backend: __BUILD_INFO__, frontend: __BUILD_INFO__, startedAt: '2026-10-27T10:00:00.000Z', uptimeSeconds: 100 }
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('app status', () => {
  it('shows the loaded frontend and matching live backend without an update warning', async () => {
    vi.spyOn(api, 'status').mockResolvedValue(status)
    render(<AppStatus />)
    expect(await screen.findByText('Online')).toBeVisible()
    expect(within(screen.getByRole('group', { name: 'Frontend' })).getByText('Loaded')).toBeVisible()
    expect(screen.getAllByText(`v${__BUILD_INFO__.version}`)).toHaveLength(2)
    expect(screen.getAllByText(__BUILD_INFO__.buildId.slice(0, 12))).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Reload app' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Status API/ })).toHaveAttribute('href', '/api/status')
  })

  it('shows a build mismatch and offers an explicit reload without automatically navigating', async () => {
    vi.stubEnv('DEV', false)
    const changed = { ...__BUILD_INFO__, buildId: 'b'.repeat(64) }
    vi.spyOn(api, 'status').mockResolvedValue({ ...status, backend: changed, frontend: changed })
    render(<AppStatus />)
    expect(await screen.findByRole('alert')).toHaveTextContent('The frontend and server builds differ.')
    expect(screen.getByRole('button', { name: 'Reload app' })).toBeVisible()
  })

  it('marks development builds without proposing a reload for a hot-reload mismatch', async () => {
    vi.stubEnv('DEV', true)
    const changed = { ...__BUILD_INFO__, buildId: 'b'.repeat(64) }
    vi.spyOn(api, 'status').mockResolvedValue({ ...status, backend: changed, frontend: changed })
    render(<AppStatus />)
    expect(await screen.findByText('Online')).toBeVisible()
    expect(screen.getByText('Development build')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Reload app' })).not.toBeInTheDocument()
  })

  it('keeps the frontend identity visible when the backend cannot be reached and supports retry', async () => {
    vi.spyOn(api, 'status').mockRejectedValueOnce(new Error('Network failed')).mockResolvedValue(status)
    render(<AppStatus />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the status API.')
    expect(within(screen.getByRole('group', { name: 'Backend' })).getByText('Unreachable')).toBeVisible()
    expect(within(screen.getByRole('group', { name: 'Frontend' })).getByText('Loaded')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
    expect(await screen.findByText('Online')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('bounds a stalled status request and cancels polling on unmount', async () => {
    vi.useFakeTimers()
    vi.spyOn(api, 'status').mockImplementation(signal => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const view = render(<AppStatus />)
    expect(screen.getByText('Checking status...')).toBeVisible()
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(screen.getByText('Unreachable')).toBeVisible()
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores a stale response after leaving the status panel', async () => {
    let finish!: (value: ServiceStatus) => void
    const check = vi.spyOn(api, 'status').mockReturnValue(new Promise(resolve => { finish = resolve }))
    const view = render(<AppStatus />)
    const signal = check.mock.calls[0][0]
    view.unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => { finish(status) })
    expect(screen.queryByRole('heading', { name: 'App status' })).not.toBeInTheDocument()
  })

  it('localizes status in German', async () => {
    vi.spyOn(api, 'status').mockResolvedValue(status)
    render(<I18nProvider language="de"><AppStatus /></I18nProvider>)
    expect(await screen.findByText('Erreichbar')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'App-Status' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Status aktualisieren' })).toBeVisible()
  })
})

describe('public status client', () => {
  it('requests uncached status anonymously with an abort signal and validates its response', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(status), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    expect(await api.status(controller.signal)).toEqual(status)
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/status', { signal: controller.signal, cache: 'no-store', credentials: 'omit' })
  })

  it('rejects invalid metadata rather than displaying a healthy backend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"status":"ok"}', { headers: { 'Content-Type': 'application/json' } })))
    await expect(api.status()).rejects.toThrow()
  })

  it('rejects HTML responses and never expires the account on a failed public status request', async () => {
    const expired = vi.fn()
    window.addEventListener('auth-expired', expired)
    try {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(new Response('<html>Proxy error</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }))
        .mockResolvedValueOnce(new Response('{"error":"Unavailable"}', { status: 401, headers: { 'Content-Type': 'application/json' } })))
      await expect(api.status()).rejects.toThrow('The app backend is not responding correctly.')
      await expect(api.status()).rejects.toThrow('Unavailable')
      expect(expired).not.toHaveBeenCalled()
    } finally { window.removeEventListener('auth-expired', expired) }
  })
})