import type { Category, Word } from '../../shared/model'
export { validateWord } from '../../shared/model'
export { languages } from '../../shared/languages'

export const categories: Record<Category, { label: string; description: string }> = {
  new: { label: 'Default', description: 'Building confidence' },
  plus: { label: '+', description: 'Getting stronger' },
  minus: { label: '−', description: 'A little more practice' },
}

export function shuffled(words: Word[]): Word[] {
  const result = [...words]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function selectPracticeWords(words: Word[], size: number): Word[] {
  const count = Math.min(Math.max(0, Math.floor(size)), words.length)
  const groups: Record<Category, Word[]> = { new: [], minus: [], plus: [] }
  for (const word of shuffled(words)) groups[word.category].push(word)
  const defaultCount = Math.ceil(count / 2)
  const plusCount = Math.floor(count / 10)
  const selected = [
    ...groups.new.splice(0, defaultCount),
    ...groups.minus.splice(0, count - defaultCount - plusCount),
    ...groups.plus.splice(0, plusCount),
  ]
  const priority = shuffled([...groups.new, ...groups.minus])
  selected.push(...priority.slice(0, count - selected.length))
  selected.push(...groups.plus.slice(0, count - selected.length))
  return shuffled(selected)
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.'
}
