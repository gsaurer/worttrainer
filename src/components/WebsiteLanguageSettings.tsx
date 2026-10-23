import { useState, type FormEvent } from 'react'
import type { WebsiteLanguage } from '../../shared/model'
import { api } from '../lib/api'
import { errorMessage } from '../lib/words'
import { useI18n } from '../i18n/context'

export function WebsiteLanguageSettings({ onSaved }: { onSaved: (language: WebsiteLanguage) => void }) {
  const { language, t, message } = useI18n()
  const [selected, select] = useState<WebsiteLanguage | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const result = await api.saveWebsiteLanguage(selected ?? language)
      select(null)
      onSaved(result.websiteLanguage)
      setSaved(true)
    } catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }
  return <section className="settings-panel word-panel" aria-labelledby="website-language-title">
    <h2 id="website-language-title">{t('Website language')}</h2>
    <form onSubmit={save}>
      <label className="visually-hidden" htmlFor="website-language">{t('Website language')}</label>
      <select id="website-language" value={selected ?? language} disabled={busy} onChange={event => { select(event.target.value as WebsiteLanguage); setSaved(false); setError('') }}><option value="de" lang="de">Deutsch</option><option value="en" lang="en">English</option></select>
      <p className="fine-print">{t('Separate from your practice languages.')}</p>
      <button className="button secondary wide" disabled={busy}>{t(busy ? 'Saving…' : 'Save language')}</button>
    </form>
    {saved && <p className="notice" role="status">{t('Language saved.')}</p>}
    {error && <p className="error" role="alert">{message(error)}</p>}
  </section>
}
