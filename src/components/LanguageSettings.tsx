import { useRef, useState, type FormEvent } from 'react'
import type { Language, LanguagePreferences } from '../../shared/model'
import { languageCodes } from '../../shared/languages'
import { errorMessage, languages } from '../lib/words'

export function LanguageSettings({ preferences, onSave, onSaved }: {
  preferences: LanguagePreferences
  onSave: (preferences: LanguagePreferences) => Promise<void>
  onSaved: () => void
}) {
  const [enabled, setEnabled] = useState(preferences.enabled)
  const [defaultLanguage, setDefaultLanguage] = useState(preferences.defaultLanguage)
  const [selected, setSelected] = useState<Language | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const saving = useRef(false)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    try {
      await onSave({ enabled, defaultLanguage })
      onSaved()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  return <section className="language-settings word-panel" aria-labelledby="language-settings-title">
    <h2 id="language-settings-title">Languages</h2>
    <p className="fine-print">Keep at least one language. Disabling a language keeps its words and history.</p>
    <form onSubmit={save}>
      <fieldset disabled={busy}>
        <legend className="visually-hidden">Choose languages and a default</legend>
        <ul className="enabled-languages">{enabled.map(language => <li key={language}>
          <strong>{languages[language].name}</strong>
          <button type="button" className="text-button" aria-label={`Disable ${languages[language].name}`} disabled={enabled.length === 1} onClick={() => {
            const remaining = enabled.filter(value => value !== language)
            setEnabled(remaining)
            if (defaultLanguage === language) setDefaultLanguage(remaining[0])
          }}>Disable</button>
        </li>)}</ul>
        <label htmlFor="add-language">Add a language</label>
        <div className="language-add">
          <select id="add-language" value={selected} onChange={event => setSelected(event.target.value as Language | '')}><option value="">Choose a language</option>{languageCodes.filter(language => !enabled.includes(language)).map(language => <option key={language} value={language}>{languages[language].name}</option>)}</select>
          <button type="button" className="button secondary" disabled={!selected} onClick={() => {
            if (!selected) { setError('Choose a language to add.'); return }
            setEnabled([...enabled, selected])
            setSelected('')
          }}>Enable</button>
        </div>
        <label htmlFor="default-language">Default language</label>
        <select id="default-language" value={defaultLanguage} onChange={event => setDefaultLanguage(event.target.value as Language)}>{enabled.map(language => <option key={language} value={language}>{languages[language].name}</option>)}</select>
        <p className="fine-print">Dictation needs a voice installed on this device.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="button primary wide" type="submit">{busy ? 'Saving…' : 'Save languages'}</button>
      </fieldset>
    </form>
  </section>
}
