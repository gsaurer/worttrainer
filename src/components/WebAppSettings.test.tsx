import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../lib/api'
import * as pwa from '../lib/pwa'
import { I18nProvider } from '../i18n/I18n'
import { InstallWebApp, ReminderSettings } from './WebAppSettings'

vi.mock('../lib/pwa', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/pwa')>(),
  notificationSupport: vi.fn(), iosDevice: vi.fn(), installedWebApp: vi.fn(),
  currentPushSubscription: vi.fn(), pushDeviceId: vi.fn(), registerWebApp: vi.fn(),
  canPromptInstallation: vi.fn(), promptInstallation: vi.fn(),
}))

const disabled = { configured: true, publicKey: 'AQID', enabled: false, deviceEnabled: false, time: '17:00', timeZone: 'UTC' }
const unsubscribe = vi.fn(async () => true)
const subscription = { endpoint: 'https://fcm.googleapis.com/test', expirationTime: null, toJSON: () => ({ keys: { p256dh: 'key', auth: 'auth' } }), unsubscribe } as unknown as PushSubscription
const subscribe = vi.fn(async () => subscription)
const getSubscription = vi.fn(async (): Promise<PushSubscription | null> => null)
const permission = vi.fn(async () => 'granted')

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(pwa.notificationSupport).mockReturnValue(true)
  vi.mocked(pwa.iosDevice).mockReturnValue(false)
  vi.mocked(pwa.installedWebApp).mockReturnValue(false)
  vi.mocked(pwa.canPromptInstallation).mockReturnValue(false)
  vi.mocked(pwa.currentPushSubscription).mockResolvedValue(null)
  vi.mocked(pwa.pushDeviceId).mockResolvedValue(undefined)
  vi.mocked(pwa.registerWebApp).mockResolvedValue({ pushManager: { getSubscription, subscribe } } as unknown as ServiceWorkerRegistration)
  getSubscription.mockResolvedValue(null)
  permission.mockResolvedValue('granted')
  unsubscribe.mockResolvedValue(true)
  vi.stubGlobal('Notification', { permission: 'default', requestPermission: permission })
  vi.spyOn(api, 'reminderSettings').mockResolvedValue(disabled)
  vi.spyOn(api, 'saveReminder').mockImplementation(async input => ({ ...disabled, ...input, enabled: true, deviceEnabled: true }))
  vi.spyOn(api, 'removeReminder').mockResolvedValue(undefined)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

function renderReminder() { render(<I18nProvider language="en"><ReminderSettings /></I18nProvider>) }

describe('daily reminder settings', () => {
  it('starts off at 17:00 in the phone time zone without requesting permission on load', async () => {
    renderReminder()
    expect(await screen.findByRole('checkbox', { name: 'Remind me on this device' })).not.toBeChecked()
    expect(screen.getByLabelText('Reminder time')).toHaveValue('17:00')
    expect(screen.getByText(`Time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`)).toBeVisible()
    expect(permission).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('asks for permission from the click before awaiting registration and saves the selected time', async () => {
    const user = userEvent.setup()
    permission.mockImplementationOnce(async () => { expect(pwa.registerWebApp).not.toHaveBeenCalled(); return 'granted' })
    renderReminder()
    await user.click(await screen.findByRole('checkbox'))
    await user.clear(screen.getByLabelText('Reminder time'))
    await user.type(screen.getByLabelText('Reminder time'), '18:30')
    await user.click(screen.getByRole('button', { name: 'Enable reminders' }))
    expect(await screen.findByText('Reminder saved.')).toBeVisible()
    expect(permission).toHaveBeenCalledOnce()
    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: new Uint8Array([1, 2, 3]) })
    expect(api.saveReminder).toHaveBeenCalledWith(expect.objectContaining({ time: '18:30', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, subscription: expect.objectContaining({ endpoint: subscription.endpoint }) }))
  })

  it('does not subscribe or save when permission is refused', async () => {
    const user = userEvent.setup()
    permission.mockResolvedValueOnce('denied')
    renderReminder()
    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Enable reminders' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Notifications were not allowed.')
    expect(subscribe).not.toHaveBeenCalled()
    expect(api.saveReminder).not.toHaveBeenCalled()
  })

  it('unsubscribes a newly created registration when the server save fails', async () => {
    const user = userEvent.setup()
    vi.mocked(api.saveReminder).mockRejectedValueOnce(new Error('Connection lost'))
    renderReminder()
    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Enable reminders' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost')
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(screen.queryByText('Reminder saved.')).not.toBeInTheDocument()
  })

  it('removes the account registration before unsubscribing and turns off this device', async () => {
    const user = userEvent.setup()
    vi.mocked(pwa.currentPushSubscription).mockResolvedValue(subscription)
    vi.mocked(pwa.pushDeviceId).mockResolvedValue('device-hash')
    vi.mocked(api.reminderSettings).mockResolvedValueOnce({ ...disabled, enabled: true, deviceEnabled: true })
    vi.mocked(api.removeReminder).mockImplementationOnce(async () => { expect(unsubscribe).not.toHaveBeenCalled() })
    renderReminder()
    const toggle = await screen.findByRole('checkbox')
    expect(toggle).toBeChecked()
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: 'Save reminder' }))
    expect(await screen.findByText('Reminders are off on this device.')).toBeVisible()
    expect(api.reminderSettings).toHaveBeenCalledWith('device-hash')
    expect(api.removeReminder).toHaveBeenCalledWith(subscription.endpoint)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('requires Home Screen installation on iOS before permission can be requested', async () => {
    vi.mocked(pwa.iosDevice).mockReturnValue(true)
    renderReminder()
    expect(await screen.findByRole('checkbox')).toBeDisabled()
    expect(screen.getByText(/Notifications require iOS 16.4/)).toBeVisible()
    expect(permission).not.toHaveBeenCalled()
  })

  it('shows a disabled state when the server has no push configuration', async () => {
    vi.mocked(api.reminderSettings).mockResolvedValue({ ...disabled, configured: false, publicKey: null })
    renderReminder()
    expect(await screen.findByRole('checkbox')).toBeDisabled()
    expect(screen.getByText('Daily reminders are not configured on this server yet.')).toBeVisible()
  })
})

describe('installation controls', () => {
  it('uses the captured native install prompt only when selected', async () => {
    const user = userEvent.setup()
    vi.mocked(pwa.canPromptInstallation).mockReturnValue(true)
    render(<I18nProvider language="en"><InstallWebApp /></I18nProvider>)
    expect(pwa.promptInstallation).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Install app' }))
    expect(pwa.promptInstallation).toHaveBeenCalledOnce()
  })

  it('shows Safari Home Screen guidance in German', () => {
    vi.mocked(pwa.iosDevice).mockReturnValue(true)
    render(<I18nProvider language="de"><InstallWebApp /></I18nProvider>)
    expect(screen.getByText('Öffne in Safari das Teilen-Menü und wähle „Zum Home-Bildschirm“.')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})