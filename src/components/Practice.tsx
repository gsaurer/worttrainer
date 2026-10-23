import { useState } from 'react'
import type { Category, Language, LanguagePreferences, Word } from '../../shared/model'
import { initialLanguagePreferences } from '../../shared/languages'
import { categories, languages } from '../lib/words'
import { RoundPractice } from './RoundPractice'

export function Practice({ words, onUpdated, loading, onActiveChange, preferences = initialLanguagePreferences() }: {
  words: Word[]
  onUpdated: () => Promise<void>
  loading: boolean
  onActiveChange?: (active: boolean) => void
  preferences?: LanguagePreferences
}) {
  const [selectedLanguage, setLanguage] = useState<Language | null>(null)
  const language = selectedLanguage && preferences.enabled.includes(selectedLanguage) ? selectedLanguage : preferences.defaultLanguage
  const [category, setCategory] = useState<Category | 'all'>('all')
  const candidates = words.filter(word => word.language === language && (category === 'all' || word.category === category))

  return <RoundPractice words={candidates} onUpdated={onUpdated} loading={loading} onActiveChange={onActiveChange} selectionLabel={`${languages[language].name} · ${category === 'all' ? 'All categories' : categories[category].label}`} filters={<>
    <div><label htmlFor="practice-language">Language</label><select id="practice-language" value={language} onChange={event => setLanguage(event.target.value as Language)}>{preferences.enabled.map(value => <option key={value} value={value}>{languages[value].name}</option>)}</select></div>
    <div><label htmlFor="practice-category">Category</label><select id="practice-category" value={category} onChange={event => setCategory(event.target.value as Category | 'all')}><option value="all">All categories</option>{(Object.keys(categories) as Category[]).map(key => <option key={key} value={key}>{categories[key].label}</option>)}</select></div>
  </>} />
}
