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

export type PracticeRound = {
  id: string
  startedAt: string
  writtenAt: string | null
  reviewedAt: string | null
  nextIndex: number
  words: { id: string; text: string; language: Language; attemptId: string }[]
  recognition: PhotoRecognition | null
  results: boolean[] | null
}

// Preserve compatibility with the existing storage and photo-reading API.
export type PhotoRound = PracticeRound

export type RoundStatus = {
  rounds: PracticeRound[]
  ocr: { enabled: boolean; month: string; used: number; limit: number }
}

export type PhotoStatus = RoundStatus

export type AccountDataExport = {
  format: 'worttrainer-account-export'
  schemaVersion: 1
  exportedAt: string
  account: { id: string } & ({ email: string } | { username: string })
  words: Word[]
  attempts: { id: string; wordId: string; correct: boolean; createdAt: string }[]
  rounds: PracticeRound[]
  statistics: ReturnType<typeof roundStatistics>
}

export function roundStatistics(rounds: PracticeRound[]) {
  let completed = 0
  let correct = 0
  let incorrect = 0
  let unmarked = 0
  for (const round of rounds) {
    if (round.reviewedAt !== null && round.results !== null) {
      completed++
      correct += round.results.filter(Boolean).length
      incorrect += round.results.filter(result => !result).length
    } else {
      unmarked += round.words.length
    }
  }
  const reviewed = correct + incorrect
  return { started: rounds.length, completed, pending: rounds.length - completed, correct, incorrect, unmarked, reviewed, accuracy: reviewed ? Math.round(correct / reviewed * 100) : null }
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
