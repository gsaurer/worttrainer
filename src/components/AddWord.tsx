import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BookOpen } from 'lucide-react'
import type { Language, LanguagePreferences, Word } from '../../shared/model'
import { initialLanguagePreferences } from '../../shared/languages'
import { errorMessage, languages, validateWord } from '../lib/words'
import { api } from '../lib/api'
import { useI18n } from '../i18n/context'

export function AddWord({ words, loading, refresh, preferences = initialLanguagePreferences(), onOpenWordLists }: { words: Word[]; loading: boolean; refresh: () => Promise<void>; preferences?: LanguagePreferences; onOpenWordLists?: () => void }) {
  const { t, message, categoryLabel } = useI18n()
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
  const duplicateMessage = existing ? t('Already in {language} · {category}.', { language: languages[language].name, category: categoryLabel(existing.category) }) : ''

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
      setNotice('Added to Default.')
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
    <div className="add-heading"><h2 id="add-title">{t('Add a word')}</h2>{onOpenWordLists && <button className="text-button resource-command" onClick={onOpenWordLists}><BookOpen size={18} />{t('Word lists')}</button>}</div>
    <form className="quick-add" onSubmit={add}>
      <div><label htmlFor="new-language">{t('Language')}</label><select id="new-language" value={language} onChange={event => { setLanguage(event.target.value as Language); setError(''); setNotice('') }} disabled={saving}>{preferences.enabled.map(value => <option key={value} value={value}>{languages[value].name}</option>)}</select></div>
      <div><label htmlFor="new-word">{t('Word')}</label><input ref={input} id="new-word" dir="auto" autoComplete="off" enterKeyHint="done" spellCheck={false} value={text} onChange={event => { setText(event.target.value); setError(''); setNotice('') }} placeholder={t('Correct spelling')} disabled={saving} required aria-invalid={!!existing || !!error} aria-describedby={error ? 'add-error' : existing ? 'word-duplicate' : undefined} /></div>
      <button className="button primary" disabled={saving || loading || !!existing || !text.trim()}>{t(saving ? 'Adding…' : 'Add word')}</button>
    </form>
    {existing && !error && <p id="word-duplicate" role="status" className="add-status">{duplicateMessage}</p>}
    {error && <p id="add-error" role="alert" className="error">{message(error)}</p>}
    {notice && <p role="status" className="add-status">{message(notice)}</p>}
  </section>
}
