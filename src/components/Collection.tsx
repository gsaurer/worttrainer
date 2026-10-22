import { useState, type FormEvent } from 'react'
import type { Category, Language, Word } from '../../shared/model'
import { categories, errorMessage, languages, validateWord } from '../lib/words'
import { api } from '../lib/api'

export function Collection({ words, loading, category, onCategory, refresh, onPractice }: {
  words: Word[]
  loading: boolean
  category: Category | 'all'
  onCategory: (category: Category | 'all') => void
  refresh: () => Promise<void>
  onPractice: () => void
}) {
  const [language, setLanguage] = useState<Language | 'all'>('all')
  const [newLanguage, setNewLanguage] = useState<Language>('de')
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const filtered = words.filter(word => (language === 'all' || word.language === language) && (category === 'all' || word.category === category))

  async function addWord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    const validation = validateWord(text)
    if (validation) { setError(validation); return }
    setSaving(true)
    try {
      await api.addWord(text.trim(), newLanguage)
      setText('')
      setNotice('Word added to New. Its first practice is a fresh start.')
      await refresh()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function deleteWord(id: string) {
    setDeleting(id)
    setError('')
    setNotice('')
    try {
      await api.deleteWord(id)
      setConfirmDelete(null)
      setNotice('Word and its practice history deleted.')
      await refresh()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setDeleting(null)
    }
  }

  return <div className="collection-layout">
    <section className="word-panel" aria-labelledby="collection-title">
      <div className="panel-heading"><div><p className="eyebrow">A GROWING LITTLE COLLECTION</p><h2 id="collection-title">Your words <span className="count">{words.length}</span></h2></div><button className="text-button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Syncing…' : '↻ Sync'}</button></div>
      <div className="filters">
        <div className="segmented" aria-label="Filter by language">{(['all', 'de', 'en'] as const).map(value => <button key={value} aria-pressed={language === value} className={language === value ? 'selected' : ''} onClick={() => setLanguage(value)}>{value === 'all' ? 'All languages' : languages[value].name}</button>)}</div>
        <label className="compact-label">Category<select value={category} onChange={e => onCategory(e.target.value as Category | 'all')}><option value="all">All categories</option>{(Object.keys(categories) as Category[]).map(key => <option key={key} value={key}>{categories[key].label} · {categories[key].description}</option>)}</select></label>
      </div>
      {filtered.length > 0 ? <ul className="word-list">{filtered.map(word => <li key={word.id} className="word-row">
        <div className="word-info"><span className="word-text" lang={word.language}>{word.text}</span><span className="word-meta">{languages[word.language].name} <span aria-hidden="true">·</span> {word.last_practiced_at ? <>Practiced <time dateTime={word.last_practiced_at}>{new Date(word.last_practiced_at).toLocaleString()}</time></> : 'Not practiced yet'}{word.consecutive_mistakes === 1 && ' · 1 mistake in a row'}</span></div>
        <span className={`badge ${word.category}`} aria-label={`Category: ${categories[word.category].label}`}>{categories[word.category].label}</span>
        {confirmDelete === word.id ? <div className="delete-confirm"><span>Delete word & history?</span><span>Saved rounds containing this word and their round statistics are also removed. Other words’ progress stays.</span><button className="text-button danger" disabled={deleting !== null} onClick={() => void deleteWord(word.id)}>{deleting === word.id ? 'Deleting…' : 'Delete'}</button><button className="text-button" disabled={deleting !== null} onClick={() => setConfirmDelete(null)}>Keep</button></div> : <button className="delete-button" onClick={() => setConfirmDelete(word.id)} aria-label={`Delete ${word.text}`} title="Delete word">×</button>}
      </li>)}</ul> : <div className="empty-state"><span aria-hidden="true" className="empty-symbol">a<span>+</span></span><h3>{loading ? 'Gathering your words…' : words.length ? 'No words here just yet.' : 'Every word is a beginning.'}</h3><p>{words.length ? 'Try another language or category, or add a new word.' : 'Add a tricky word to start your collection. There’s no hurry, and no score to chase.'}</p></div>}
      <div className="panel-footnote">One correct answer → + &nbsp; / &nbsp; Two mistakes in a row → −</div>
    </section>
    <aside className="collection-sidebar">
      <section className="add-card" aria-labelledby="add-title"><span className="small-plus" aria-hidden="true">+</span><p className="eyebrow">MAKE ROOM FOR A NEW WORD</p><h2 id="add-title">What’s a little tricky?</h2><p>Add a word that needs some practice. It will start in New, with a clean slate.</p>
        <form onSubmit={addWord}><label htmlFor="new-word">Word</label><input id="new-word" autoComplete="off" spellCheck={false} value={text} onChange={e => setText(e.target.value)} placeholder={newLanguage === 'de' ? 'e.g. Schmetterling' : 'e.g. beautiful'} disabled={saving} required aria-describedby={error ? 'collection-error' : undefined} /><label htmlFor="new-language">Language</label><select id="new-language" value={newLanguage} onChange={e => setNewLanguage(e.target.value as Language)} disabled={saving}><option value="de">Deutsch</option><option value="en">English</option></select><button className="button primary wide" disabled={saving}>{saving ? 'Adding…' : '+ Add to New'}</button></form>
      </section>
      {error && <p id="collection-error" role="alert" className="error">{error}</p>}
      {notice && <p role="status" className="notice">{notice}</p>}
      <div className="practice-note"><span className="eyebrow">A FEW MINUTES IS ENOUGH</span><h3>Ready when you are.</h3><p>Grab a pencil and a piece of paper. Let’s give those words a little attention.</p><button className="text-button" onClick={onPractice}>Let’s practice <span aria-hidden="true">↗</span></button></div>
    </aside>
  </div>
}
