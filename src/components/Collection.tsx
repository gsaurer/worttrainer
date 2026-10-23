import { useState } from 'react'
import type { Category, Language, LanguagePreferences, Word } from '../../shared/model'
import { initialLanguagePreferences } from '../../shared/languages'
import { categories, errorMessage, languages } from '../lib/words'
import { api } from '../lib/api'
import { useI18n } from '../i18n/context'

export function Collection({ words, loading, refresh, preferences = initialLanguagePreferences() }: {
  words: Word[]
  loading: boolean
  refresh: () => Promise<void>
  preferences?: LanguagePreferences
}) {
  const { t, message, date, categoryLabel } = useI18n()
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
  const collectionLanguages = [...new Set([...preferences.enabled, ...words.map(word => word.language)])]

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
    <section className="word-panel" aria-label={t('Collection overview')}>
      <div className="panel-heading"><h2>{t('Overview')}</h2><button className="text-button" onClick={() => void refresh()} disabled={loading}>{t(loading ? 'Syncing…' : '↻ Sync')}</button></div>
      {loading ? <p className="overview-loading" role="status">{t('Loading collection…')}</p> : <>
        <dl className="collection-stats"><div><dt>{t('Total words')}</dt><dd>{words.length}</dd></div><div><dt>{t('Practiced')}</dt><dd>{practiced}</dd></div><div><dt>{t('Not practiced')}</dt><dd>{words.length - practiced}</dd></div></dl>
        <div className="overview-table"><table><caption>{t('Words by language and category')}</caption><thead><tr><th scope="col">{t('Language')}</th><th scope="col">{t('New')}</th><th scope="col">+</th><th scope="col">−</th><th scope="col">{t('Total')}</th></tr></thead><tbody>{collectionLanguages.map(value => {
          const subset = words.filter(word => word.language === value)
          return <tr key={value}><th scope="row">{`${languages[value].name}${preferences.enabled.includes(value) ? '' : t(' (off)')}`}</th>{(['new', 'plus', 'minus'] as const).map(key => <td key={key}>{subset.filter(word => word.category === key).length}</td>)}<td>{subset.length}</td></tr>
        })}</tbody></table></div>
      </>}
      <div className="panel-footnote">{t('One correct answer → +')} &nbsp; / &nbsp; {t('Two mistakes in a row → −')}</div>
    </section>
    <section className="word-panel" aria-labelledby="collection-title">
      <div className="panel-heading"><h2 id="collection-title">{t('Find a word')}</h2></div>
      <div className="collection-search"><label htmlFor="word-search">{t('Search words')}</label><input id="word-search" type="search" dir="auto" value={query} onChange={event => { setQuery(event.target.value); setConfirmDelete(null) }} placeholder={t('Type a spelling')} /></div>
      {search && <>
      <div className="filters">
        <div className="segmented" aria-label={t('Filter by language')}>{(['all', ...collectionLanguages] as const).map(value => <button key={value} aria-pressed={language === value} className={language === value ? 'selected' : ''} onClick={() => setLanguage(value)}>{value === 'all' ? t('All languages') : languages[value].name}</button>)}</div>
        <label className="compact-label">{t('Category')}<select value={category} onChange={e => setCategory(e.target.value as Category | 'all')}><option value="all">{t('All categories')}</option>{(Object.keys(categories) as Category[]).map(key => <option key={key} value={key}>{categoryLabel(key)}</option>)}</select></label>
      </div>
      {filtered.length > 0 ? <ul className="word-list">{filtered.slice(0, 20).map(word => <li key={word.id} className="word-row">
        <div className="word-info"><span className="word-text" lang={word.language} dir="auto">{word.text}</span><span className="word-meta">{languages[word.language].name} <span aria-hidden="true">·</span> {word.last_practiced_at ? <>{t('Practiced')} <time dateTime={word.last_practiced_at}>{date(word.last_practiced_at)}</time></> : t('Not practiced yet')}{word.consecutive_mistakes === 1 && t(' · 1 mistake in a row')}</span></div>
        <span className={`badge ${word.category}`} aria-label={t('Category: {category}', { category: categoryLabel(word.category) })}>{categoryLabel(word.category)}</span>
        {confirmDelete === word.id ? <div className="delete-confirm"><span>{t('Delete word & history?')}</span><span>{t('Saved rounds containing this word and their round statistics are also removed. Other words’ progress stays.')}</span><button className="text-button danger" disabled={deleting !== null} onClick={() => void deleteWord(word.id)}>{t(deleting === word.id ? 'Deleting…' : 'Delete')}</button><button className="text-button" disabled={deleting !== null} onClick={() => setConfirmDelete(null)}>{t('Keep')}</button></div> : <button className="delete-button" onClick={() => setConfirmDelete(word.id)} aria-label={t('Delete {word}', { word: word.text })} title={t('Delete word')}>×</button>}
      </li>)}</ul> : <p className="search-summary">{t(loading ? 'Loading…' : 'No matching words.')}</p>}
      {filtered.length > 20 && <p className="search-summary">{t('Showing 20 of {count} matches. Refine your search.', { count: filtered.length })}</p>}
      </>}
      {error && <p role="alert" className="error">{message(error)}</p>}
      {notice && <p role="status" className="notice">{message(notice)}</p>}
    </section>
  </div>
}
