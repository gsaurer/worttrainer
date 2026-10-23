import { useState } from 'react'
import type { LanguagePreferences, Word } from '../../shared/model'
import { languages } from '../lib/words'
import { useI18n } from '../i18n/context'
import { ChallengePractice } from './ChallengePractice'

export function Statistics({ words, preferences, loading, refresh }: {
  words: Word[]
  preferences: LanguagePreferences
  loading: boolean
  refresh: () => Promise<void>
}) {
  const { t } = useI18n()
  const [active, setActive] = useState(false)
  const practiced = words.filter(word => word.last_practiced_at !== null).length
  const collectionLanguages = [...new Set([...preferences.enabled, ...words.map(word => word.language)])]

  return <div className="statistics-layout">
    {!active && <section className="word-panel statistics-progress" aria-labelledby="progress-title">
      <div className="panel-heading"><h2 id="progress-title">{t('Words')}</h2></div>
      {loading ? <p role="status">{t('Loading collection…')}</p> : <>
        <dl className="collection-stats"><div><dt>{t('Total words')}</dt><dd>{words.length}</dd></div><div><dt>{t('Practiced')}</dt><dd>{practiced}</dd></div><div><dt>{t('Not practiced')}</dt><dd>{words.length - practiced}</dd></div></dl>
        <div className="overview-table"><table><caption>{t('Words by language and category')}</caption><thead><tr><th scope="col">{t('Language')}</th><th scope="col">{t('Default')}</th><th scope="col">+</th><th scope="col">−</th><th scope="col">{t('Total')}</th></tr></thead><tbody>{collectionLanguages.map(language => {
          const subset = words.filter(word => word.language === language)
          return <tr key={language}><th scope="row">{languages[language].name}{preferences.enabled.includes(language) ? '' : t(' (off)')}</th>{(['new', 'plus', 'minus'] as const).map(category => <td key={category}>{subset.filter(word => word.category === category).length}</td>)}<td>{subset.length}</td></tr>
        })}</tbody></table></div>
      </>}
    </section>}
    <ChallengePractice view="statistics" words={words} loading={loading} onUpdated={refresh} onActiveChange={setActive} />
  </div>
}