import { useState } from 'react'
import { ChevronDown, Trash2 } from 'lucide-react'
import type { Category, Language, LanguagePreferences, Word } from '../../shared/model'
import { initialLanguagePreferences } from '../../shared/languages'
import { categories, errorMessage, languages } from '../lib/words'
import { api } from '../lib/api'
import { useI18n } from '../i18n/context'
import { AddWord } from './AddWord'

export function Collection({ words, loading, refresh, preferences = initialLanguagePreferences(), onOpenWordLists }: {
  words: Word[]
  loading: boolean
  refresh: () => Promise<void>
  preferences?: LanguagePreferences
  onOpenWordLists?: () => void
}) {
  const { t, message, date, categoryLabel } = useI18n()
  const [language, setLanguage] = useState<Language | 'all'>('all')
  const [category, setCategory] = useState<Category | 'all'>('all')
  const [query, setQuery] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [visibleCount, setVisibleCount] = useState(20)
  const search = query.trim().toLowerCase()
  const filtered = words.filter(word => word.text.toLowerCase().includes(search) && (language === 'all' || word.language === language) && (category === 'all' || word.category === category))
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
    <AddWord words={words} loading={loading} refresh={refresh} preferences={preferences} onOpenWordLists={onOpenWordLists} />
    <section className="word-panel" aria-labelledby="collection-title">
      <div className="panel-heading"><h2 id="collection-title">{t('Your words')}</h2></div>
      <div className="collection-search"><label htmlFor="word-search">{t('Search words')}</label><input id="word-search" type="search" dir="auto" value={query} onChange={event => { setQuery(event.target.value); setConfirmDelete(null); setVisibleCount(20) }} placeholder={t('Type a spelling')} /></div>
      <div className="filters">
        <label className="compact-label">{t('Filter by language')}<select value={language} onChange={event => { setLanguage(event.target.value as Language | 'all'); setVisibleCount(20); setConfirmDelete(null) }}><option value="all">{t('All languages')}</option>{collectionLanguages.map(value => <option key={value} value={value}>{languages[value].name}{preferences.enabled.includes(value) ? '' : t(' (off)')}</option>)}</select></label>
        <label className="compact-label">{t('Category')}<select value={category} onChange={event => { setCategory(event.target.value as Category | 'all'); setVisibleCount(20); setConfirmDelete(null) }}><option value="all">{t('All categories')}</option>{(Object.keys(categories) as Category[]).map(key => <option key={key} value={key}>{categoryLabel(key)}</option>)}</select></label>
      </div>
      {filtered.length > 0 ? <ul className="word-list" aria-label={t('Your words')}>{filtered.slice(0, visibleCount).map(word => <li key={word.id} className="word-row">
        <div className="word-info"><span className="word-text" lang={word.language} dir="auto">{word.text}</span><span className="word-meta">{languages[word.language].name} <span aria-hidden="true">·</span> {word.last_practiced_at ? <>{t('Practiced')} <time dateTime={word.last_practiced_at}>{date(word.last_practiced_at)}</time></> : t('Not practiced yet')}{word.consecutive_mistakes === 1 && t(' · 1 mistake in a row')}</span></div>
        <span className={`badge ${word.category}`} aria-label={t('Category: {category}', { category: categoryLabel(word.category) })}>{categoryLabel(word.category)}</span>
        {confirmDelete === word.id ? <div className="delete-confirm"><span>{t('Delete word & history?')}</span><span>{t('Saved challenges containing this word and their results are also removed. Other words’ progress stays.')}</span><button className="text-button danger" disabled={deleting !== null} onClick={() => void deleteWord(word.id)}>{t(deleting === word.id ? 'Deleting…' : 'Delete')}</button><button className="text-button" disabled={deleting !== null} onClick={() => setConfirmDelete(null)}>{t('Keep')}</button></div> : <button className="delete-button" onClick={() => setConfirmDelete(word.id)} aria-label={t('Delete {word}', { word: word.text })} title={t('Delete word')}><Trash2 size={18} /></button>}
      </li>)}</ul> : <p className="search-summary">{t(loading ? 'Loading…' : 'No matching words.')}</p>}
      {filtered.length > 0 && <div className="collection-list-footer"><span>{t('Showing {shown} of {count} words', { shown: Math.min(visibleCount, filtered.length), count: filtered.length })}</span>{filtered.length > visibleCount && <button className="text-button resource-command" onClick={() => setVisibleCount(previous => previous + 20)}><ChevronDown size={18} />{t('Show more words')}</button>}</div>}
      {error && <p role="alert" className="error">{message(error)}</p>}
      {notice && <p role="status" className="notice">{message(notice)}</p>}
    </section>
  </div>
}
