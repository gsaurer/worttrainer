import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const umami = { scriptUrl: 'https://stats.example.com/script.js', websiteId: 'c3fea621-d611-41f0-98a7-a648659b4cc7' }
const fetchMock = vi.fn()

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('navigator', { language: 'en', doNotTrack: null, globalPrivacyControl: false })
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ umami: null })))
})

afterEach(() => {
  document.getElementById('worttrainer-umami')?.remove()
  window.history.replaceState(null, '', '/')
  delete window.umami
  vi.unstubAllGlobals()
})

it('makes no tracker requests when analytics is disabled', async () => {
  const { initializeAnalytics } = await import('./analytics')
  await initializeAnalytics()
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/analytics', expect.objectContaining({ cache: 'no-store', credentials: 'omit' }))
  expect(document.getElementById('worttrainer-umami')).toBeNull()
})

it('loads once and sends only a minimal pageview without sensitive URL, referrer or account data', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ umami })))
  window.history.replaceState(null, '', '/?code=private-code&token=private-token&email=parent@example.com#private-fragment')
  vi.spyOn(document, 'referrer', 'get').mockReturnValue('https://search.example.com/private-path?code=private-referrer#secret')
  const track = vi.fn().mockResolvedValue(undefined)
  window.umami = { track }
  const { initializeAnalytics } = await import('./analytics')
  await Promise.all([initializeAnalytics(), initializeAnalytics()])
  const script = document.querySelector<HTMLScriptElement>('#worttrainer-umami')
  expect(script?.src).toBe(umami.scriptUrl)
  expect(script?.async).toBe(true)
  expect(script?.referrerPolicy).toBe('no-referrer')
  expect(script?.dataset).toMatchObject({ websiteId: umami.websiteId, autoTrack: 'false', doNotTrack: 'true', excludeSearch: 'true', excludeHash: 'true' })
  expect(track).not.toHaveBeenCalled()
  script?.dispatchEvent(new Event('load'))
  script?.dispatchEvent(new Event('load'))
  expect(track).toHaveBeenCalledExactlyOnceWith({ website: umami.websiteId, url: '/', title: 'Worttrainer', hostname: window.location.hostname, language: 'en', screen: `${window.screen.width}x${window.screen.height}`, referrer: 'https://search.example.com' })
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it.each([{ doNotTrack: '1' }, { globalPrivacyControl: true }])('does not even fetch configuration when the browser declines tracking: %j', async preference => {
  vi.stubGlobal('navigator', { language: 'en', ...preference })
  const { initializeAnalytics } = await import('./analytics')
  await initializeAnalytics()
  expect(fetchMock).not.toHaveBeenCalled()
  expect(document.getElementById('worttrainer-umami')).toBeNull()
})

it('ignores invalid configuration instead of loading an unsafe script', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ umami: { ...umami, scriptUrl: 'javascript:alert(1)' } })))
  const { initializeAnalytics } = await import('./analytics')
  await initializeAnalytics()
  expect(document.getElementById('worttrainer-umami')).toBeNull()
})

it('tolerates unavailable configuration, blocked scripts and tracker failures', async () => {
  fetchMock.mockRejectedValue(new Error('Offline'))
  let analytics = await import('./analytics')
  await expect(analytics.initializeAnalytics()).resolves.toBeUndefined()
  expect(document.getElementById('worttrainer-umami')).toBeNull()
  vi.resetModules()
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ umami })))
  analytics = await import('./analytics')
  await expect(analytics.initializeAnalytics()).resolves.toBeUndefined()
  document.getElementById('worttrainer-umami')?.dispatchEvent(new Event('error'))
  window.umami = { track: vi.fn().mockRejectedValue(new Error('Tracker blocked')) }
  document.getElementById('worttrainer-umami')?.dispatchEvent(new Event('load'))
  await Promise.resolve()
})