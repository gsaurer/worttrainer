import type { DevicePushSubscription } from '../../shared/reminders'

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let installPrompt: InstallPromptEvent | null = null
let initialized = false

export function installedWebApp() {
  return window.matchMedia?.('(display-mode: standalone)').matches === true || 'standalone' in navigator && navigator.standalone === true
}

export function iosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

export function notificationSupport() {
  return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function registerWebApp() {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return Promise.reject(new Error('Notifications need HTTPS and a supported browser.'))
  return navigator.serviceWorker.register('/sw.js').then(async registration => {
    if (!registration.active) await navigator.serviceWorker.ready
    return registration
  })
}

export function initializeWebApp() {
  if (initialized) return
  initialized = true
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault()
    installPrompt = event as InstallPromptEvent
    window.dispatchEvent(new Event('webapp-installable'))
  })
  window.addEventListener('appinstalled', () => {
    installPrompt = null
    window.dispatchEvent(new Event('webapp-installable'))
  })
  if (window.isSecureContext && 'serviceWorker' in navigator) void registerWebApp().catch(() => {})
}

export function canPromptInstallation() { return installPrompt !== null }

export async function promptInstallation() {
  const prompt = installPrompt
  if (!prompt) return
  installPrompt = null
  await prompt.prompt()
  await prompt.userChoice
  window.dispatchEvent(new Event('webapp-installable'))
}

export async function currentPushSubscription() {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return null
  const registration = await navigator.serviceWorker.getRegistration('/')
  return registration?.pushManager ? registration.pushManager.getSubscription() : null
}

export async function pushDeviceId(subscription: PushSubscription | null) {
  if (!subscription) return undefined
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subscription.endpoint))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function publicKeyBytes(key: string) {
  const decoded = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - key.length % 4) % 4))
  return Uint8Array.from(decoded, character => character.charCodeAt(0))
}

export function serializeSubscription(subscription: PushSubscription): DevicePushSubscription {
  const keys = subscription.toJSON().keys
  if (!keys?.p256dh || !keys.auth) throw new Error('The browser did not provide a valid push subscription.')
  return { endpoint: subscription.endpoint, expirationTime: subscription.expirationTime, keys: { p256dh: keys.p256dh, auth: keys.auth } }
}