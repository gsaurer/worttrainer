self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', event => {
  let payload = {}
  try { payload = event.data?.json() ?? {} } catch { payload = {} }
  event.waitUntil(self.registration.showNotification('Worttrainer', {
    body: typeof payload.body === 'string' ? payload.body.slice(0, 300) : 'Your next challenge is waiting for you.',
    icon: '/app-icon-192.png',
    badge: '/favicon-32.png',
    tag: typeof payload.tag === 'string' && /^worttrainer-daily-\d{4}-\d{2}-\d{2}$/.test(payload.tag) ? payload.tag : 'worttrainer-daily',
    data: { url: '/' },
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin)
    if (existing) {
      await existing.focus()
      existing.postMessage({ type: 'OPEN_PRACTICE' })
    } else await self.clients.openWindow('/')
  })())
})