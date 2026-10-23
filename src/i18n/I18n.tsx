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
  return <label className="website-language-choice">{t('Website language')}<select value={language} onChange={event => chooseLanguage(event.target.value as WebsiteLanguage)}><option value="de" lang="de">Deutsch</option><option value="en" lang="en">English</option></select></label>
}
