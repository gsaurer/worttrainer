import type { Language, LanguagePreferences } from './languages.js'
export type { Language, LanguagePreferences } from './languages.js'
export type Category = 'new' | 'plus' | 'minus'
export type WebsiteLanguage = 'de' | 'en'

export type WordResource = {
  id: string
  title: string
  language: Language
  sections: {
    id: string
    title: string
    entries: {
      id: string
      word: string
      sentence: string
      translations: { language: Language; word: string }[]
    }[]
  }[]
}

export type ResourceImport = {
  added: number
  existing: number
  language: Language
}

export type AddedWordList = {
  resourceId: string
  title: string
  language: Language
  sectionIds: string[]
  wordIds: string[]
}

export type PracticeWordList = AddedWordList & {
  sections: { id: string; title: string; wordIds: string[] }[]
}

export type Word = {
  id: string
  text: string
  language: Language
  category: Category
  consecutive_mistakes: number
  created_at: string
  last_practiced_at: string | null
  progressOverride?: { category: Category; afterAttemptId: string | null }
}

export type AuthState = {
  authenticated: boolean
  emailMigrationRequired: boolean
  email: string | null
  websiteLanguage?: WebsiteLanguage
  features?: string[]
}

export type PhotoRecognition = {
  answers: { number: number; text: string | null; confidence: number | null }[]
  warnings: string[]
}

export type DocumentCheck = {
  language: 'en' | 'de'
  text: string
  wordCount: number
  possibleMistakes: { word: string; occurrences: number; suggestions: string[] }[]
  limited: boolean
}

export type ChallengeTiming = {
  fromIndex: number
  toIndex: number
  recordedAt: string
  elapsedMs: number
  intervalSeconds: number
  automatic: boolean
  action: 'next' | 'previous' | 'stop' | 'play' | 'listen'
}

export type NavigationTiming = Pick<ChallengeTiming, 'elapsedMs' | 'intervalSeconds' | 'automatic'> & {
  action: ChallengeTiming['action']
  fromIndex: number
}

export type ChallengeCheckInput = {
  method: 'manual' | 'photo'
  spellings: (string | null)[]
}

export type ChallengeCheck = ChallengeCheckInput & { evaluatedAt: string }
export type ChallengePhoto = { dataUrl: string; uploadedAt: string; evaluatedAt: string }

export type Challenge = {
  id: string
  deletedAt?: string
  startedAt: string
  writtenAt: string | null
  reviewedAt: string | null
  nextIndex: number
  words: { id: string; text: string; language: Language; attemptId: string }[]
  recognition: PhotoRecognition | null
  results: boolean[] | null
  telemetry: ChallengeTiming[]
  check: ChallengeCheck | null
  photo: ChallengePhoto | null
}

export type ChallengeStatus = {
  challenges: Challenge[]
  ocr: { enabled: boolean; month: string; used: number; limit: number }
}

export type PracticeAttempt = {
  id: string
  wordId: string
  correct: boolean
  createdAt: string
  spelling?: string
  deletedAt?: string
}

export type AccountDataExport = {
  format: 'worttrainer-account-export'
  schemaVersion: 5
  exportedAt: string
  account: { id: string } & ({ email: string } | { username: string })
  languagePreferences: LanguagePreferences
  websiteLanguage: WebsiteLanguage
  words: Word[]
  attempts: PracticeAttempt[]
  challenges: Challenge[]
  wordLists: AddedWordList[]
  statistics: ReturnType<typeof challengeStatistics>
}

export function challengeStatistics(challenges: Challenge[]) {
  const active = challenges.filter(challenge => !challenge.deletedAt)
  let completed = 0
  let correct = 0
  let incorrect = 0
  let unmarked = 0
  for (const challenge of active) {
    if (challenge.reviewedAt !== null && challenge.results !== null) {
      completed++
      correct += challenge.results.filter(Boolean).length
      incorrect += challenge.results.filter(result => !result).length
    } else {
      unmarked += challenge.words.length
    }
  }
  const reviewed = correct + incorrect
  return { started: active.length, completed, pending: active.length - completed, correct, incorrect, unmarked, reviewed, accuracy: reviewed ? Math.round(correct / reviewed * 100) : null }
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

export function nextProgress(word: Word, correct: boolean, attempts: readonly { wordId: string; correct: boolean; deletedAt?: string }[]) {
  let correctStreak = correct ? 1 : 0
  if (correct) {
    for (let index = attempts.length - 1; index >= 0 && correctStreak < 3; index--) {
      const attempt = attempts[index]
      if (attempt.wordId !== word.id || attempt.deletedAt) continue
      if (!attempt.correct) break
      correctStreak++
    }
  }
  const consecutive_mistakes = correct ? 0 : Math.min(word.consecutive_mistakes + 1, 2)
  const category: Category = correct
    ? correctStreak >= 3 ? 'plus' : word.category
    : consecutive_mistakes >= 2 ? 'minus' : word.category === 'plus' ? 'new' : word.category
  return { category, consecutive_mistakes }
}
