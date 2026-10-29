import { analyticsSchema } from '../../shared/analytics'

declare global {
  interface Window {
    umami?: { track: (payload: Record<string, string>) => unknown }
  }
}

let initialization: Promise<void> | undefined

function trackingDeclined() {
  return navigator.doNotTrack === '1' || 'globalPrivacyControl' in navigator && navigator.globalPrivacyControl === true
}

async function trackPageview(websiteId: string) {
  if (trackingDeclined()) return
  await window.umami?.track({
    website: websiteId,
    url: '/',
    title: 'Worttrainer',
    hostname: window.location.hostname,
    language: navigator.language,
    screen: `${window.screen.width}x${window.screen.height}`,
    referrer: document.referrer ? new URL(document.referrer).origin : '',
  })
}

async function loadAnalytics() {
  if (trackingDeclined() || document.getElementById('worttrainer-umami')) return
  const response = await fetch('/api/analytics', { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(5000) })
  if (!response.ok) return
  const configuration = analyticsSchema.safeParse(await response.json())
  if (!configuration.success || !configuration.data.umami || trackingDeclined() || document.getElementById('worttrainer-umami')) return
  const { scriptUrl, websiteId } = configuration.data.umami
  const script = document.createElement('script')
  script.id = 'worttrainer-umami'
  script.src = scriptUrl
  script.async = true
  script.referrerPolicy = 'no-referrer'
  script.dataset.websiteId = websiteId
  script.dataset.autoTrack = 'false'
  script.dataset.doNotTrack = 'true'
  script.dataset.excludeSearch = 'true'
  script.dataset.excludeHash = 'true'
  script.addEventListener('load', () => { void trackPageview(websiteId).catch(() => {}) }, { once: true })
  document.head.append(script)
}

export function initializeAnalytics() {
  initialization ??= loadAnalytics().catch(() => {})
  return initialization
}