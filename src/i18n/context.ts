import { createContext, useContext } from 'react'
import type { Category, WebsiteLanguage } from '../../shared/model'
import { translate, translateError, type Message, type Values } from './messages'

export function browserLanguage(): WebsiteLanguage {
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en'
}

export function translations(language: WebsiteLanguage) {
  return {
    language,
    t: (key: Message, values?: Values) => translate(language, key, values),
    message: (text: string) => translateError(language, text),
    date: (value: string) => new Date(value).toLocaleString(language === 'de' ? 'de-DE' : 'en-GB'),
    categoryLabel: (category: Category) => category === 'new' ? translate(language, 'New') : category === 'plus' ? '+' : '−',
  }
}

export const I18n = createContext<ReturnType<typeof translations> & { chooseLanguage: (language: WebsiteLanguage) => void }>({
  ...translations('en'), chooseLanguage: () => {},
})
export const useI18n = () => useContext(I18n)
