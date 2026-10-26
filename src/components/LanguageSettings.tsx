import { useRef, useState, type FormEvent } from 'react'
import type { Language, LanguagePreferences } from '../../shared/model'
import { languageCodes } from '../../shared/languages'
import { errorMessage, languages } from '../lib/words'
import { useI18n } from '../i18n/context'

export function LanguageSettings({ preferences, onSave, onSaved }: {
  preferences: LanguagePreferences
  onSave: (preferences: LanguagePreferences) => Promise<void>
  onSaved?: () => void
}) {
  const { t, message } = useI18n()
  const [enabled, setEnabled] = useState(preferences.enabled)
  const [defaultLanguage, setDefaultLanguage] = useState(preferences.defaultLanguage)
  const [selected, setSelected] = useState<Language | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const saving = useRef(false)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await onSave({ enabled, defaultLanguage })
      setSaved(true)
      onSaved?.()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  return <section className="language-settings word-panel" aria-labelledby="language-settings-title">
    <h2 id="language-settings-title">{t('Languages')}</h2>
    <p className="fine-print">{t('Keep at least one language. Disabling a language keeps its words and history.')}</p>
    <form onSubmit={save}>
      <fieldset disabled={busy}>
        <legend className="visually-hidden">{t('Choose languages and a default')}</legend>
        <ul className="enabled-languages">{enabled.map(language => <li key={language}>
          <strong>{languages[language].name}</strong>
          <button type="button" className="text-button" aria-label={t('Disable {language}', { language: languages[language].name })} disabled={enabled.length === 1} onClick={() => {
            const remaining = enabled.filter(value => value !== language)
            setEnabled(remaining)
            setSaved(false)
            if (defaultLanguage === language) setDefaultLanguage(remaining[0])
          }}>{t('Disable')}</button>
        </li>)}</ul>
        <label htmlFor="add-language">{t('Add a language')}</label>
        <div className="language-add">
          <select id="add-language" value={selected} onChange={event => setSelected(event.target.value as Language | '')}><option value="">{t('Choose a language')}</option>{languageCodes.filter(language => !enabled.includes(language)).map(language => <option key={language} value={language}>{languages[language].name}</option>)}</select>
          <button type="button" className="button secondary" disabled={!selected} onClick={() => {
            if (!selected) { setError('Choose a language to add.'); return }
            setEnabled([...enabled, selected])
            setSelected('')
            setSaved(false)
          }}>{t('Enable')}</button>
        </div>
        <label htmlFor="default-language">{t('Default language')}</label>
        <select id="default-language" value={defaultLanguage} onChange={event => { setDefaultLanguage(event.target.value as Language); setSaved(false) }}>{enabled.map(language => <option key={language} value={language}>{languages[language].name}</option>)}</select>
        <p className="fine-print">{t('Dictation needs a voice installed on this device.')}</p>
        {error && <p className="error" role="alert">{message(error)}</p>}
        <button className="button primary wide" type="submit">{t(busy ? 'Saving…' : 'Save languages')}</button>
      </fieldset>
    </form>
    {saved && <p className="notice" role="status">{t('Languages saved.')}</p>}
  </section>
}
