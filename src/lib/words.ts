import type { Category, Language, Word } from '../database.types'

export const languages: Record<Language, { name: string; speech: string }> = {
  de: { name: 'Deutsch', speech: 'de-DE' },
  en: { name: 'English', speech: 'en-GB' },
}

export const categories: Record<Category, { label: string; description: string }> = {
  new: { label: 'New', description: 'A fresh start' },
  plus: { label: '+', description: 'Getting stronger' },
  minus: { label: '−', description: 'A little more practice' },
}

export function validateWord(value: string): string | null {
  if (!value.trim()) return 'Please enter a word.'
  if ([...value.trim()].length > 80) return 'Please keep each word to 80 characters or fewer.'
  // Match the database constraint, including pasted line breaks.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/u.test(value)) return 'Please enter a word without line breaks or control characters.'
  return null
}

export function shuffled(words: Word[]): Word[] {
  const result = [...words]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.'
}
