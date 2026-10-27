import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BookOpen, Plus } from 'lucide-react'
import type { AddedWordList, Language, LanguagePreferences, Word, WordResource } from '../../shared/model'
import { api } from '../lib/api'
import { errorMessage, languages } from '../lib/words'
import { useI18n } from '../i18n/context'

export function WordResources({ words, wordLists = [], preferences, onUpdated }: {
  words: Word[]
  wordLists?: AddedWordList[]
  preferences: LanguagePreferences
  onUpdated: () => Promise<void>
}) {
  const { t, message } = useI18n()
  const [resources, setResources] = useState<WordResource[]>([])
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [language, setLanguage] = useState<Language | 'all'>('all')
  const [resourceId, setResourceId] = useState('')
  const [selection, setSelection] = useState<{ resourceId: string; sectionIds: string[] } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const importing = useRef(false)

  useEffect(() => {
    let active = true
    void api.wordResources().then(data => {
      if (active) { setResources(data); setLoadError(''); setLoading(false) }
    }).catch(error => {
      if (active) { setLoadError(errorMessage(error)); setLoading(false) }
    })
    return () => { active = false }
  }, [retry])

  const available = resources.filter(resource => language === 'all' || resource.language === language)
  const resource = available.find(resource => resource.id === resourceId) ?? available.find(resource => resource.language === preferences.defaultLanguage) ?? available[0]
  const addedList = wordLists.find(list => list.resourceId === resource?.id)
  const sectionIds = selection && selection.resourceId === resource?.id ? selection.sectionIds : addedList?.sectionIds ?? []
  const selected = resource?.sections.filter(section => sectionIds.includes(section.id)) ?? []
  const spellings = new Set(selected.flatMap(section => section.entries.map(entry => entry.word.toLowerCase())))
  const existing = new Set(words.filter(word => word.language === resource?.language).map(word => word.text.toLowerCase()))
  const missing = [...spellings].filter(word => !existing.has(word)).length
  const unregisteredSections = selected.some(section => !addedList?.sectionIds.includes(section.id))
  const enabled = resource ? preferences.enabled.includes(resource.language) : false
  const allSelected = !!resource && selected.length === resource.sections.length

  function resetSelection() { setSelection(null); setError(''); setNotice('') }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!resource || !selected.length || importing.current) return
    importing.current = true
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await api.importWordResource(resource.id, selected.map(section => section.id), !enabled)
      await onUpdated()
      setSelection(null)
      setNotice(t('{added} added, {existing} already in your collection.', result))
    } catch (error) { setError(errorMessage(error)) }
    finally { importing.current = false; setSaving(false) }
  }

  return <section className="word-resources" aria-label={t('Word lists')}>
    <h2>{t('Import word list')}</h2>
    {loading ? <p role="status">{t('Loading word lists...')}</p> : loadError ? <div role="alert" className="error">
      <p>{t('Could not load word lists: {error}', { error: message(loadError) })}</p>
      <button className="button secondary" onClick={() => { setLoading(true); setRetry(previous => previous + 1) }}>{t('Retry word lists')}</button>
    </div> : resources.length === 0 ? <p>{t('No word lists available.')}</p> : <>
      <div className="resource-selectors">
        <label>{t('Language')}<select value={language} disabled={saving} onChange={event => { setLanguage(event.target.value as Language | 'all'); setResourceId(''); resetSelection() }}>
          <option value="all">{t('All languages')}</option>
          {[...new Set(resources.map(resource => resource.language))].map(language => <option key={language} value={language}>{languages[language].name}</option>)}
        </select></label>
        <label>{t('Word list')}<select value={resource?.id ?? ''} disabled={saving} onChange={event => { setResourceId(event.target.value); resetSelection() }}>
          {available.map(resource => <option key={resource.id} value={resource.id}>{resource.title} · {languages[resource.language].name}</option>)}
        </select></label>
      </div>
      {resource && <form onSubmit={event => void add(event)}>
        <div className="resource-section-heading"><h3><BookOpen size={20} aria-hidden="true" />{resource.title}</h3><span>{languages[resource.language].name}</span></div>
        <fieldset className="resource-sections" disabled={saving}>
          <legend className="visually-hidden">{t('Sections')}</legend>
          <label className="resource-section-choice resource-select-all"><input type="checkbox" checked={allSelected} ref={input => { if (input) input.indeterminate = selected.length > 0 && !allSelected }} onChange={event => { setSelection({ resourceId: resource.id, sectionIds: event.target.checked ? resource.sections.map(section => section.id) : [] }); setNotice(''); setError('') }} />{t('All sections')}</label>
          {resource.sections.map(section => <div key={section.id} className="resource-section">
            <label className="resource-section-choice"><input type="checkbox" checked={sectionIds.includes(section.id)} onChange={event => {
              setSelection({ resourceId: resource.id, sectionIds: event.target.checked ? [...sectionIds, section.id] : sectionIds.filter(id => id !== section.id) })
              setNotice(''); setError('')
            }} /><span dir="auto">{section.title}</span><span className="resource-count">{t('Words: {count}', { count: section.entries.length })}</span></label>
            <details><summary>{t('Preview words')}</summary><p lang={resource.language} dir="auto">{section.entries.map(entry => entry.word).join(', ')}</p></details>
          </div>)}
        </fieldset>
        <div className="resource-add-actions">
          {selected.length > 0 && <p>{t(missing === 1 ? '1 new word selected' : '{count} new words selected', { count: missing })}</p>}
          <button className="button primary resource-command" disabled={saving || !selected.length || (enabled && missing === 0 && !unregisteredSections)}><Plus size={18} />{t(saving ? 'Adding words...' : enabled ? 'Add selected words' : 'Enable {language} and add words', { language: languages[resource.language].name })}</button>
        </div>
      </form>}
    </>}
    {error && <p role="alert" className="error">{t('Could not add words: {error}', { error: message(error) })}</p>}
    {notice && <p className="resource-import-result" role="status">{notice}</p>}
  </section>
}