import { useState } from 'react'
import type { PracticeWordList, Category, Language, LanguagePreferences, Word } from '../../shared/model'
import { initialLanguagePreferences } from '../../shared/languages'
import { categories, languages } from '../lib/words'
import { ChallengePractice } from './ChallengePractice'
import { useI18n } from '../i18n/context'

export function Practice({ words, wordLists = [], initialWords, onUpdated, loading, onActiveChange, preferences = initialLanguagePreferences() }: {
  words: Word[]
  wordLists?: PracticeWordList[]
  initialWords?: Word[]
  onUpdated: () => Promise<void>
  loading: boolean
  onActiveChange?: (active: boolean) => void
  preferences?: LanguagePreferences
}) {
  const { t, categoryLabel } = useI18n()
  const [selectedLanguage, setLanguage] = useState<Language | null>(null)
  const language = selectedLanguage && preferences.enabled.includes(selectedLanguage) ? selectedLanguage : preferences.defaultLanguage
  const [category, setCategory] = useState<Category | 'all'>('all')
  const [listId, setListId] = useState('')
  const [sectionId, setSectionId] = useState('')
  const ownedWords = new Map(words.map(word => [word.id, word]))
  const availableLists = wordLists.filter(list => preferences.enabled.includes(list.language)).map(list => ({
    ...list, wordIds: list.wordIds.filter(id => ownedWords.get(id)?.language === list.language),
    sections: (list.sections ?? []).map(section => ({ ...section, wordIds: section.wordIds.filter(id => list.wordIds.includes(id) && ownedWords.get(id)?.language === list.language) })).filter(section => section.wordIds.length > 0),
  })).filter(list => list.wordIds.length > 0)
  const selectedList = availableLists.find(list => list.resourceId === listId && list.language === language)
  const selectedSection = selectedList?.sections.find(section => section.id === sectionId)
  const sectionSources = availableLists.flatMap(list => list.sections.map(section => ({ value: JSON.stringify([list.resourceId, section.id]), list, section })))
  const selectedIds = selectedList ? new Set(selectedSection?.wordIds ?? selectedList.wordIds) : null
  const candidates = words.filter(word => word.language === language && (!selectedIds || selectedIds.has(word.id)) && (category === 'all' || word.category === category))

  return <ChallengePractice words={candidates} initialWords={initialWords} onUpdated={onUpdated} loading={loading} onActiveChange={onActiveChange} selectionLabel={`${languages[language].name} · ${category === 'all' ? t('All categories') : categoryLabel(category)}${selectedList ? ` · ${selectedList.title}` : ''}${selectedSection ? ` · ${selectedSection.title}` : ''}`} filters={<>
    <div><label htmlFor="practice-language">{t('Language')}</label><select id="practice-language" value={language} onChange={event => { setLanguage(event.target.value as Language); setListId(''); setSectionId('') }}>{preferences.enabled.map(value => <option key={value} value={value}>{languages[value].name}</option>)}</select></div>
    {availableLists.length > 0 && <div>
      <label htmlFor="practice-source">{t('Practice from')}</label>
      <select id="practice-source" value={selectedList && selectedSection ? JSON.stringify([selectedList.resourceId, selectedSection.id]) : selectedList?.resourceId ?? ''} onChange={event => {
        const source = sectionSources.find(source => source.value === event.target.value)
        const list = source?.list ?? availableLists.find(list => list.resourceId === event.target.value)
        setListId(list?.resourceId ?? '')
        setSectionId(source?.section.id ?? '')
        if (list) setLanguage(list.language)
      }}>
        <option value="">{t('All my words')}</option>
        {availableLists.map(list => <optgroup key={list.resourceId} label={list.title}>
          <option value={list.resourceId}>{t(list.wordIds.length === 1 ? '{title} · {count} word' : '{title} · {count} words', { title: list.title, count: list.wordIds.length })}</option>
          {list.sections.map(section => <option key={section.id} value={JSON.stringify([list.resourceId, section.id])}>{t(section.wordIds.length === 1 ? '{title} · {count} word' : '{title} · {count} words', { title: section.title, count: section.wordIds.length })}</option>)}
        </optgroup>)}
      </select>
    </div>}
    <div><label htmlFor="practice-category">{t('Category')}</label><select id="practice-category" value={category} onChange={event => setCategory(event.target.value as Category | 'all')}><option value="all">{t('All categories')}</option>{(Object.keys(categories) as Category[]).map(key => <option key={key} value={key}>{categoryLabel(key)}</option>)}</select></div>
  </>} />
}
