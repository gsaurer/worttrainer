import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Language, LanguagePreferences, Word } from '../../shared/model'
import { initialLanguagePreferences } from '../../shared/languages'
import { categories, errorMessage, languages, validateWord } from '../lib/words'
import { api } from '../lib/api'

export function AddWord({ words, loading, refresh, preferences = initialLanguagePreferences() }: { words: Word[]; loading: boolean; refresh: () => Promise<void>; preferences?: LanguagePreferences }) {
  const [selectedLanguage, setLanguage] = useState<Language | null>(null)
  const language = selectedLanguage && preferences.enabled.includes(selectedLanguage) ? selectedLanguage : preferences.defaultLanguage
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const focusAfterAdd = useRef(false)
  const adding = useRef(false)
  const existing = words.find(word => word.language === language && word.text.toLowerCase() === text.trim().toLowerCase())
  const duplicateMessage = existing ? `Already in ${languages[language].name} · ${categories[existing.category].label}.` : ''

  useEffect(() => {
    if (!saving && focusAfterAdd.current) {
      input.current?.focus()
      focusAfterAdd.current = false
    }
  }, [saving])

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (adding.current || loading) return
    setError('')
    setNotice('')
    const validation = validateWord(text) || duplicateMessage
    if (validation) { setError(validation); return }
    adding.current = true
    setSaving(true)
    try {
      await api.addWord(text.trim(), language)
      setText('')
      setNotice('Added to New.')
      focusAfterAdd.current = true
      await refresh()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      adding.current = false
      setSaving(false)
    }
  }

  return <section className="add-card" aria-labelledby="add-title">
    <h2 id="add-title">Add a word</h2>
    <form className="quick-add" onSubmit={add}>
      <div><label htmlFor="new-word">Word</label><input ref={input} id="new-word" dir="auto" autoComplete="off" enterKeyHint="done" spellCheck={false} value={text} onChange={event => { setText(event.target.value); setError(''); setNotice('') }} placeholder="Correct spelling" disabled={saving} required aria-invalid={!!existing || !!error} aria-describedby={error ? 'add-error' : existing ? 'word-duplicate' : undefined} /></div>
      <div><label htmlFor="new-language">Language</label><select id="new-language" value={language} onChange={event => { setLanguage(event.target.value as Language); setError(''); setNotice('') }} disabled={saving}>{preferences.enabled.map(value => <option key={value} value={value}>{languages[value].name}</option>)}</select></div>
      <button className="button primary" disabled={saving || loading || !!existing || !text.trim()}>{saving ? 'Adding…' : 'Add word'}</button>
    </form>
    {existing && !error && <p id="word-duplicate" role="status" className="add-status">{duplicateMessage}</p>}
    {error && <p id="add-error" role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="add-status">{notice}</p>}
  </section>
}
