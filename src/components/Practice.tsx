import { useState } from 'react'
import type { Category, Language, Word } from '../../shared/model'
import { categories } from '../lib/words'
import { RoundPractice } from './RoundPractice'

export function Practice({ words, onUpdated, loading }: {
  words: Word[]
  onUpdated: () => Promise<void>
  loading: boolean
}) {
  const [language, setLanguage] = useState<Language>('de')
  const [category, setCategory] = useState<Category | 'all'>('all')
  const candidates = words.filter(word => word.language === language && (category === 'all' || word.category === category))

  return <RoundPractice words={candidates} onUpdated={onUpdated} loading={loading} filters={<div className="round-filters">
    <div><label htmlFor="practice-language">Which language?</label><select id="practice-language" value={language} onChange={event => setLanguage(event.target.value as Language)}><option value="de">Deutsch</option><option value="en">English</option></select></div>
    <div><label htmlFor="practice-category">Which words?</label><select id="practice-category" value={category} onChange={event => setCategory(event.target.value as Category | 'all')}><option value="all">All categories</option>{(Object.keys(categories) as Category[]).map(key => <option key={key} value={key}>{categories[key].label} · {categories[key].description}</option>)}</select></div>
  </div>} />
}
