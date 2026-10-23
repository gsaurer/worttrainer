import { useState } from 'react'
import type { Category, Language, Word } from '../../shared/model'
import { categories, errorMessage, languages } from '../lib/words'
import { api } from '../lib/api'

export function Collection({ words, loading, refresh }: {
  words: Word[]
  loading: boolean
  refresh: () => Promise<void>
}) {
  const [language, setLanguage] = useState<Language | 'all'>('all')
  const [category, setCategory] = useState<Category | 'all'>('all')
  const [query, setQuery] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const search = query.trim().toLowerCase()
  const filtered = search ? words.filter(word => word.text.toLowerCase().includes(search) && (language === 'all' || word.language === language) && (category === 'all' || word.category === category)) : []
  const practiced = words.filter(word => word.last_practiced_at !== null).length

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
    <section className="word-panel" aria-label="Collection overview">
      <div className="panel-heading"><h2>Overview</h2><button className="text-button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Syncing…' : '↻ Sync'}</button></div>
      {loading ? <p className="overview-loading" role="status">Loading collection…</p> : <>
        <dl className="collection-stats"><div><dt>Total words</dt><dd>{words.length}</dd></div><div><dt>Practiced</dt><dd>{practiced}</dd></div><div><dt>Not practiced</dt><dd>{words.length - practiced}</dd></div></dl>
        <div className="overview-table"><table><caption>Words by language and category</caption><thead><tr><th scope="col">Language</th><th scope="col">New</th><th scope="col">+</th><th scope="col">−</th><th scope="col">Total</th></tr></thead><tbody>{(['de', 'en'] as const).map(value => {
          const subset = words.filter(word => word.language === value)
          return <tr key={value}><th scope="row">{languages[value].name}</th>{(['new', 'plus', 'minus'] as const).map(key => <td key={key}>{subset.filter(word => word.category === key).length}</td>)}<td>{subset.length}</td></tr>
        })}</tbody></table></div>
      </>}
      <div className="panel-footnote">One correct answer → + &nbsp; / &nbsp; Two mistakes in a row → −</div>
    </section>
    <section className="word-panel" aria-labelledby="collection-title">
      <div className="panel-heading"><h2 id="collection-title">Find a word</h2></div>
      <div className="collection-search"><label htmlFor="word-search">Search words</label><input id="word-search" type="search" value={query} onChange={event => { setQuery(event.target.value); setConfirmDelete(null) }} placeholder="Type a spelling" /></div>
      {search && <>
      <div className="filters">
        <div className="segmented" aria-label="Filter by language">{(['all', 'de', 'en'] as const).map(value => <button key={value} aria-pressed={language === value} className={language === value ? 'selected' : ''} onClick={() => setLanguage(value)}>{value === 'all' ? 'All languages' : languages[value].name}</button>)}</div>
        <label className="compact-label">Category<select value={category} onChange={e => setCategory(e.target.value as Category | 'all')}><option value="all">All categories</option>{(Object.keys(categories) as Category[]).map(key => <option key={key} value={key}>{categories[key].label}</option>)}</select></label>
      </div>
      {filtered.length > 0 ? <ul className="word-list">{filtered.slice(0, 20).map(word => <li key={word.id} className="word-row">
        <div className="word-info"><span className="word-text" lang={word.language}>{word.text}</span><span className="word-meta">{languages[word.language].name} <span aria-hidden="true">·</span> {word.last_practiced_at ? <>Practiced <time dateTime={word.last_practiced_at}>{new Date(word.last_practiced_at).toLocaleString()}</time></> : 'Not practiced yet'}{word.consecutive_mistakes === 1 && ' · 1 mistake in a row'}</span></div>
        <span className={`badge ${word.category}`} aria-label={`Category: ${categories[word.category].label}`}>{categories[word.category].label}</span>
        {confirmDelete === word.id ? <div className="delete-confirm"><span>Delete word & history?</span><span>Saved rounds containing this word and their round statistics are also removed. Other words’ progress stays.</span><button className="text-button danger" disabled={deleting !== null} onClick={() => void deleteWord(word.id)}>{deleting === word.id ? 'Deleting…' : 'Delete'}</button><button className="text-button" disabled={deleting !== null} onClick={() => setConfirmDelete(null)}>Keep</button></div> : <button className="delete-button" onClick={() => setConfirmDelete(word.id)} aria-label={`Delete ${word.text}`} title="Delete word">×</button>}
      </li>)}</ul> : <p className="search-summary">{loading ? 'Loading…' : 'No matching words.'}</p>}
      {filtered.length > 20 && <p className="search-summary">Showing 20 of {filtered.length} matches. Refine your search.</p>}
      </>}
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status" className="notice">{notice}</p>}
    </section>
  </div>
}
