export const languages = {
  de: { name: 'Deutsch', speech: 'de-DE' },
  en: { name: 'English', speech: 'en-GB' },
  fr: { name: 'Français', speech: 'fr-FR' },
  es: { name: 'Español', speech: 'es-ES' },
  it: { name: 'Italiano', speech: 'it-IT' },
  pt: { name: 'Português', speech: 'pt-PT' },
  nl: { name: 'Nederlands', speech: 'nl-NL' },
  da: { name: 'Dansk', speech: 'da-DK' },
  sv: { name: 'Svenska', speech: 'sv-SE' },
  nb: { name: 'Norsk bokmål', speech: 'nb-NO' },
  fi: { name: 'Suomi', speech: 'fi-FI' },
  pl: { name: 'Polski', speech: 'pl-PL' },
  cs: { name: 'Čeština', speech: 'cs-CZ' },
  sk: { name: 'Slovenčina', speech: 'sk-SK' },
  hu: { name: 'Magyar', speech: 'hu-HU' },
  ro: { name: 'Română', speech: 'ro-RO' },
  uk: { name: 'Українська', speech: 'uk-UA' },
  ru: { name: 'Русский', speech: 'ru-RU' },
  tr: { name: 'Türkçe', speech: 'tr-TR' },
  el: { name: 'Ελληνικά', speech: 'el-GR' },
  ar: { name: 'العربية', speech: 'ar-SA' },
  he: { name: 'עברית', speech: 'he-IL' },
  hi: { name: 'हिन्दी', speech: 'hi-IN' },
  zh: { name: '中文', speech: 'zh-CN' },
  ja: { name: '日本語', speech: 'ja-JP' },
  ko: { name: '한국어', speech: 'ko-KR' },
} as const

export type Language = keyof typeof languages
export const languageCodes = Object.keys(languages) as Language[]

export type LanguagePreferences = {
  enabled: Language[]
  defaultLanguage: Language
}

export function initialLanguagePreferences(): LanguagePreferences {
  return { enabled: ['de', 'en'], defaultLanguage: 'de' }
}
