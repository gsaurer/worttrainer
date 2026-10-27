import { describe, expect, it } from 'vitest'
import { selectPracticeWords, shuffled, validateWord } from './words'
import type { Category, Challenge, Word } from '../../shared/model'

function group(category: Category, count: number): Word[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${category}-${index}`, text: `${category}-${index}`, language: 'de', category,
    consecutive_mistakes: category === 'minus' ? 2 : 0,
    created_at: '2026-10-23T12:00:00Z', last_practiced_at: null,
  }))
}

describe('mixed practice selection', () => {
  it.each(['new', 'minus', 'plus'] as const)('prioritizes never-practiced words before checked words in %s', category => {
    const words = group(category, 20).map((word, index) => ({ ...word, last_practiced_at: index < 10 ? '2026-10-23T12:00:00Z' : null }))
    const selected = selectPracticeWords(words, 10)
    expect(selected).toHaveLength(10)
    expect(selected.every(word => word.last_practiced_at === null)).toBe(true)
  })

  it('selects the oldest checked words first without changing collection order or timestamps', () => {
    const words = group('new', 20).map((word, index) => ({ ...word, last_practiced_at: `2026-10-${String(index + 1).padStart(2, '0')}T12:00:00Z` }))
    const before = structuredClone(words)
    expect(selectPracticeWords(words, 10).map(word => word.id).sort()).toEqual(words.slice(0, 10).map(word => word.id).sort())
    expect(words).toEqual(before)
  })

  it('covers all words across checked challenges before returning to recently checked words', () => {
    const words = group('new', 30)
    const seen = new Set<string>()
    for (let challengeNumber = 0; challengeNumber < 3; challengeNumber++) {
      const selected = selectPracticeWords(words, 10)
      expect(selected.some(word => seen.has(word.id))).toBe(false)
      for (const word of selected) {
        seen.add(word.id)
        word.last_practiced_at = `2026-10-2${challengeNumber + 1}T12:00:00Z`
      }
    }
    expect(seen.size).toBe(words.length)
  })

  it('covers each category across successive mixed challenges while keeping the category distribution', () => {
    const words = [...group('new', 10), ...group('minus', 8), ...group('plus', 2)]
    const first = selectPracticeWords(words, 10)
    for (const word of first) word.last_practiced_at = '2026-10-23T12:00:00Z'
    const second = selectPracticeWords(words, 10)
    const firstIds = new Set(first.map(word => word.id))
    expect(second.every(word => !firstIds.has(word.id))).toBe(true)
    expect(new Set([...first, ...second].map(word => word.id)).size).toBe(words.length)
    for (const selected of [first, second]) {
      expect(selected.filter(word => word.category === 'new')).toHaveLength(5)
      expect(selected.filter(word => word.category === 'minus')).toHaveLength(4)
      expect(selected.filter(word => word.category === 'plus')).toHaveLength(1)
    }
  })

  it('fills missing category slots from the least recently checked remaining priority words', () => {
    const words = [...group('minus', 20), ...group('plus', 10)].map((word, index) => ({ ...word, last_practiced_at: `2026-10-${String(index + 1).padStart(2, '0')}T12:00:00Z` }))
    const selected = selectPracticeWords(words, 10)
    expect(selected.filter(word => word.category === 'minus').map(word => word.id).sort()).toEqual(words.slice(0, 9).map(word => word.id).sort())
    expect(selected.find(word => word.category === 'plus')?.id).toBe('plus-0')
  })

  it('rotates unchecked challenge words too, using the newest appearance without changing history', () => {
    const words = group('new', 20)
    const history: Challenge[] = [{ id: 'unchecked', startedAt: '2026-10-23T12:00:00Z', writtenAt: null, reviewedAt: null, nextIndex: 0, words: words.slice(0, 10).map(word => ({ id: word.id, text: word.text, language: word.language, attemptId: word.id })), recognition: null, results: null, telemetry: [], check: null, photo: null }]
    const before = structuredClone(history)
    expect(selectPracticeWords(words, 10, history).map(word => word.id).sort()).toEqual(words.slice(10).map(word => word.id).sort())
    expect(history).toEqual(before)
    history.push({ ...history[0], id: 'newer', startedAt: '2026-10-24T12:00:00Z', words: history[0].words.slice(0, 5) })
    expect(selectPracticeWords(words, 15, [...history].reverse()).filter(word => words.slice(0, 5).some(recent => recent.id === word.id))).toEqual([])
  })

  it('does not use deleted challenge appearances when choosing the oldest words', () => {
    const words = group('new', 20).map((word, index) => ({ ...word, last_practiced_at: `2026-10-${String(index + 1).padStart(2, '0')}T12:00:00Z` }))
    const deleted: Challenge = {
      id: 'deleted', startedAt: '2026-10-27T12:00:00Z', deletedAt: '2026-10-27T13:00:00Z',
      writtenAt: null, reviewedAt: null, nextIndex: 0,
      words: words.slice(0, 10).map(word => ({ id: word.id, text: word.text, language: word.language, attemptId: word.id })),
      recognition: null, results: null, telemetry: [], check: null, photo: null,
    }
    expect(selectPracticeWords(words, 10, [deleted]).map(word => word.id).sort()).toEqual(words.slice(0, 10).map(word => word.id).sort())
  })

  it.each([
    { size: 10, defaults: 5, minus: 4, plus: 1 },
    { size: 15, defaults: 8, minus: 6, plus: 1 },
    { size: 20, defaults: 10, minus: 8, plus: 2 },
  ])('prioritizes Default and minus in a $size-word challenge', ({ size, defaults, minus, plus }) => {
    const words = [...group('new', 30), ...group('minus', 30), ...group('plus', 100)]
    const before = structuredClone(words)
    const selected = selectPracticeWords(words, size)
    expect(selected).toHaveLength(size)
    expect(new Set(selected.map(word => word.id)).size).toBe(size)
    expect(selected.filter(word => word.category === 'new')).toHaveLength(defaults)
    expect(selected.filter(word => word.category === 'minus')).toHaveLength(minus)
    expect(selected.filter(word => word.category === 'plus')).toHaveLength(plus)
    expect(words).toEqual(before)
  })

  it.each(['new', 'minus', 'plus'] as const)('fills a category-only selection without adding other categories: %s', category => {
    expect(selectPracticeWords(group(category, 12), 20)).toHaveLength(12)
    expect(selectPracticeWords(group(category, 30), 10).every(word => word.category === category)).toBe(true)
  })

  it('fills missing priority words from the other priority group before using extra plus words', () => {
    const words = [...group('new', 2), ...group('minus', 20), ...group('plus', 100)]
    const selected = selectPracticeWords(words, 10)
    expect(selected.filter(word => word.category === 'new')).toHaveLength(2)
    expect(selected.filter(word => word.category === 'minus')).toHaveLength(7)
    expect(selected.filter(word => word.category === 'plus')).toHaveLength(1)
  })

  it('uses spare plus words only when necessary to fill the challenge', () => {
    const selected = selectPracticeWords([...group('new', 2), ...group('plus', 20)], 10)
    expect(selected.filter(word => word.category === 'new')).toHaveLength(2)
    expect(selected.filter(word => word.category === 'plus')).toHaveLength(8)
    expect(selectPracticeWords([], 10)).toEqual([])
    expect(selectPracticeWords(group('new', 10), 0)).toEqual([])
  })
})

describe('word validation', () => {
  it.each(['Schmetterling', 'beautiful', 'Straße', 'groß', ' ice-cream ', 'a'.repeat(80)])('accepts %s', word => {
    expect(validateWord(word)).toBeNull()
  })
  it.each(['', '   ', '\n', 'hello\nworld', 'a\tb', 'a'.repeat(81)])('rejects blank, control or overlong words', word => {
    expect(validateWord(word)).not.toBeNull()
  })
})

describe('shuffled practice', () => {
  it('includes each word exactly once without changing the collection', () => {
    const words = ['a', 'b', 'c'].map(id => ({ id }) as Word)
    const original = [...words]
    const queue = shuffled(words)
    expect(queue).not.toBe(words)
    expect(queue.map(w => w.id).sort()).toEqual(['a', 'b', 'c'])
    expect(words).toEqual(original)
  })
})
