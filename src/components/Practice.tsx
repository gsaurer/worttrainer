import { useState } from 'react'
import type { Category, Language, Word } from '../../shared/model'
import { categories, languages } from '../lib/words'
import { RoundPractice } from './RoundPractice'

export function Practice({ words, onUpdated, loading, onActiveChange }: {
  words: Word[]
  onUpdated: () => Promise<void>
  loading: boolean
  onActiveChange?: (active: boolean) => void
}) {
  const [language, setLanguage] = useState<Language>('de')
  const [category, setCategory] = useState<Category | 'all'>('all')
  const candidates = words.filter(word => word.language === language && (category === 'all' || word.category === category))

  return <RoundPractice words={candidates} onUpdated={onUpdated} loading={loading} onActiveChange={onActiveChange} selectionLabel={`${languages[language].name} · ${category === 'all' ? 'All categories' : categories[category].label}`} filters={<>
    <div><label htmlFor="practice-language">Language</label><select id="practice-language" value={language} onChange={event => setLanguage(event.target.value as Language)}><option value="de">Deutsch</option><option value="en">English</option></select></div>
    <div><label htmlFor="practice-category">Category</label><select id="practice-category" value={category} onChange={event => setCategory(event.target.value as Category | 'all')}><option value="all">All categories</option>{(Object.keys(categories) as Category[]).map(key => <option key={key} value={key}>{categories[key].label}</option>)}</select></div>
  </>} />
}
