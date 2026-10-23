import { useState } from 'react'
import type { Category, Language, LanguagePreferences, Word } from '../../shared/model'
import { initialLanguagePreferences } from '../../shared/languages'
import { categories, languages } from '../lib/words'
import { RoundPractice } from './RoundPractice'
import { useI18n } from '../i18n/context'

export function Practice({ words, onUpdated, loading, onActiveChange, preferences = initialLanguagePreferences() }: {
  words: Word[]
  onUpdated: () => Promise<void>
  loading: boolean
  onActiveChange?: (active: boolean) => void
  preferences?: LanguagePreferences
}) {
  const { t, categoryLabel } = useI18n()
  const [selectedLanguage, setLanguage] = useState<Language | null>(null)
  const language = selectedLanguage && preferences.enabled.includes(selectedLanguage) ? selectedLanguage : preferences.defaultLanguage
  const [category, setCategory] = useState<Category | 'all'>('all')
  const candidates = words.filter(word => word.language === language && (category === 'all' || word.category === category))

  return <RoundPractice words={candidates} onUpdated={onUpdated} loading={loading} onActiveChange={onActiveChange} selectionLabel={`${languages[language].name} · ${category === 'all' ? t('All categories') : categoryLabel(category)}`} filters={<>
    <div><label htmlFor="practice-language">{t('Language')}</label><select id="practice-language" value={language} onChange={event => setLanguage(event.target.value as Language)}>{preferences.enabled.map(value => <option key={value} value={value}>{languages[value].name}</option>)}</select></div>
    <div><label htmlFor="practice-category">{t('Category')}</label><select id="practice-category" value={category} onChange={event => setCategory(event.target.value as Category | 'all')}><option value="all">{t('All categories')}</option>{(Object.keys(categories) as Category[]).map(key => <option key={key} value={key}>{categoryLabel(key)}</option>)}</select></div>
  </>} />
}
