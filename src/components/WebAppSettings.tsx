import { useEffect, useState, type FormEvent } from 'react'
import { Bell, Download, Save } from 'lucide-react'
import type { ReminderSettings as Settings } from '../../shared/reminders'
import { api } from '../lib/api'
import { errorMessage } from '../lib/words'
import { canPromptInstallation, currentPushSubscription, installedWebApp, iosDevice, notificationSupport, promptInstallation, publicKeyBytes, pushDeviceId, registerWebApp, serializeSubscription } from '../lib/pwa'
import { useI18n } from '../i18n/context'

export function InstallWebApp() {
  const { t, message } = useI18n()
  const [, update] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const changed = () => update(value => value + 1)
    window.addEventListener('webapp-installable', changed)
    return () => window.removeEventListener('webapp-installable', changed)
  }, [])
  async function install() {
    setError('')
    setBusy(true)
    try { await promptInstallation() }
    catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }
  return <section className="settings-panel word-panel" aria-labelledby="install-title">
    <h2 id="install-title">{t('Install Worttrainer')}</h2>
    {installedWebApp() ? <p className="notice" role="status">{t('Installed on this device.')}</p> : canPromptInstallation()
      ? <button className="button secondary wide" disabled={busy} onClick={() => void install()}><Download size={18} />{t('Install app')}</button>
      : <p className="fine-print">{t(iosDevice() ? 'In Safari, open Share, then Add to Home Screen.' : 'Open your browser menu and choose Install app or Add to Home Screen.')}</p>}
    {error && <p className="error" role="alert">{message(error)}</p>}
  </section>
}

export function ReminderSettings() {
  const { t, message } = useI18n()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [time, setTime] = useState('17:00')
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const [timeZone, setTimeZone] = useState(deviceZone)
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [attempt, retry] = useState(0)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const subscription = await currentPushSubscription()
        const result = await api.reminderSettings(await pushDeviceId(subscription))
        if (!active) return
        setSettings(result)
        setEnabled(result.deviceEnabled)
        if (result.enabled) { setTime(result.time); setTimeZone(result.timeZone) }
      } catch (error) { if (active) setError(errorMessage(error)) }
    })()
    return () => { active = false }
  }, [attempt])

  const needsInstallation = iosDevice() && !installedWebApp()
  const supported = notificationSupport()
  const denied = supported && Notification.permission === 'denied'
  const unavailable = !settings?.configured || !supported || needsInstallation || denied

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !settings) return
    const permission = enabled && supported
      ? Notification.permission === 'default' ? Notification.requestPermission() : Promise.resolve(Notification.permission)
      : Promise.resolve('default')
    setBusy(true)
    setError('')
    setSaved(false)
    let created: PushSubscription | null = null
    try {
      if (enabled) {
        if (await permission !== 'granted') throw new Error('Notifications were not allowed. You can change this in your device settings.')
        if (!settings.publicKey) throw new Error('Daily reminders are not configured on this server yet.')
        const registration = await registerWebApp()
        let subscription = await registration.pushManager.getSubscription()
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKeyBytes(settings.publicKey) })
          created = subscription
        }
        const result = await api.saveReminder({ time, timeZone, subscription: serializeSubscription(subscription) })
        created = null
        setSettings(result)
        setEnabled(result.deviceEnabled)
      } else {
        const subscription = await currentPushSubscription()
        if (subscription) {
          await api.removeReminder(subscription.endpoint)
          await subscription.unsubscribe()
        }
        const result = await api.reminderSettings()
        setSettings(result)
        setEnabled(result.deviceEnabled)
      }
      setSaved(true)
    } catch (error) {
      if (created) await created.unsubscribe().catch(() => false)
      setError(errorMessage(error))
    } finally { setBusy(false) }
  }

  return <section className="settings-panel word-panel" aria-labelledby="reminder-title">
    <h2 id="reminder-title">{t('Daily reminder')}</h2>
    {!settings && !error && <p role="status">{t('Loading reminder…')}</p>}
    {settings && <form onSubmit={event => void save(event)}>
      <label className="reminder-toggle"><input type="checkbox" checked={enabled} disabled={busy || unavailable && !enabled} onChange={event => { setEnabled(event.target.checked); setSaved(false); setError('') }} />{t('Remind me on this device')}</label>
      <p className="fine-print">{t('Only if you have not finished a challenge that day.')}</p>
      <label className="reminder-time" htmlFor="reminder-time">{t('Reminder time')}<input id="reminder-time" type="time" required step="60" value={time} disabled={busy || !enabled} onChange={event => { setTime(event.target.value); setSaved(false) }} /></label>
      <p className="fine-print">{t('Time zone: {zone}', { zone: timeZone })}</p>
      {timeZone !== deviceZone && <button type="button" className="text-button" disabled={busy} onClick={() => { setTimeZone(deviceZone); setSaved(false) }}>{t('Use this phone’s time zone')}</button>}
      {!settings.configured ? <p className="fine-print">{t('Daily reminders are not configured on this server yet.')}</p>
        : needsInstallation ? <p className="fine-print">{t('On iPhone or iPad, install the app first. Notifications require iOS 16.4 or later.')}</p>
        : !supported ? <p className="fine-print">{t('Notifications need HTTPS and a supported browser.')}</p>
        : denied && <p className="fine-print">{t('Notifications were not allowed. You can change this in your device settings.')}</p>}
      <button className="button secondary wide" disabled={busy || enabled && unavailable || !enabled && !settings.deviceEnabled}>{enabled && !settings.deviceEnabled ? <Bell size={18} /> : <Save size={18} />}{t(busy ? 'Saving…' : enabled && !settings.deviceEnabled ? 'Enable reminders' : 'Save reminder')}</button>
    </form>}
    {saved && <p className="notice" role="status">{t(settings?.deviceEnabled ? 'Reminder saved.' : 'Reminders are off on this device.')}</p>}
    {error && <p className="error" role="alert">{message(error)}{!settings && <button className="text-button" onClick={() => { setError(''); retry(value => value + 1) }}>{t('Retry loading')}</button>}</p>}
  </section>
}