import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { WebsiteLanguage } from '../../shared/model'
import { browserLanguage, I18n, translations, useI18n } from './context'

export function I18nProvider({ language: accountLanguage, children }: { language?: WebsiteLanguage; children: ReactNode }) {
  const [visitorLanguage, chooseLanguage] = useState(browserLanguage)
  const language = accountLanguage ?? visitorLanguage
  const value = useMemo(() => ({ ...translations(language), chooseLanguage }), [language])
  useEffect(() => {
    const previous = { language: document.documentElement.lang, title: document.title }
    document.documentElement.lang = language
    document.title = language === 'de' ? 'Worttrainer · Schritt für Schritt' : 'Worttrainer · A little practice, a little progress'
    return () => { document.documentElement.lang = previous.language; document.title = previous.title }
  }, [language])
  return <I18n.Provider value={value}>{children}</I18n.Provider>
}

export function VisitorLanguage() {
  const { language, chooseLanguage, t } = useI18n()
  return <div className="website-language-choice" role="group" aria-label={t('Website language')}>
    <button type="button" lang="en" title="English" aria-label="English" aria-pressed={language === 'en'} onClick={() => chooseLanguage('en')}>EN</button>
    <span aria-hidden="true">|</span>
    <button type="button" lang="de" title="Deutsch" aria-label="Deutsch" aria-pressed={language === 'de'} onClick={() => chooseLanguage('de')}>DE</button>
  </div>
}
