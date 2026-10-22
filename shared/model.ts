export type Language = 'de' | 'en'
export type Category = 'new' | 'plus' | 'minus'

export type Word = {
  id: string
  text: string
  language: Language
  category: Category
  consecutive_mistakes: number
  created_at: string
  last_practiced_at: string | null
}

export type AuthState = {
  authenticated: boolean
  emailMigrationRequired: boolean
  email: string | null
}

export type PhotoRecognition = {
  answers: { number: number; text: string | null; confidence: number | null }[]
  warnings: string[]
}

export type PhotoRound = {
  id: string
  startedAt: string
  writtenAt: string | null
  reviewedAt: string | null
  nextIndex: number
  words: { id: string; text: string; language: Language; attemptId: string }[]
  recognition: PhotoRecognition | null
  results: boolean[] | null
}

export type PhotoStatus = {
  rounds: PhotoRound[]
  ocr: { enabled: boolean; month: string; used: number; limit: number }
}

export function suggestedResult(expected: string, text: string | null, confidence: number | null): boolean | null {
  if (text === null || confidence === null || confidence < 0.8) return null
  return expected.normalize('NFC') === text.trim().normalize('NFC')
}

export function validateWord(value: string): string | null {
  if (!value.trim()) return 'Please enter a word.'
  if ([...value.trim()].length > 80) return 'Please keep each word to 80 characters or fewer.'
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/u.test(value)) return 'Please enter a word without line breaks or control characters.'
  return null
}

export function nextProgress(word: Word, correct: boolean) {
  const consecutive_mistakes = correct ? 0 : Math.min(word.consecutive_mistakes + 1, 2)
  const category: Category = correct ? 'plus' : consecutive_mistakes >= 2 ? 'minus' : word.category
  return { category, consecutive_mistakes }
}
