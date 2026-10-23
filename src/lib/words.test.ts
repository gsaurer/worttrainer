import { describe, expect, it } from 'vitest'
import { selectPracticeWords, shuffled, validateWord } from './words'
import type { Category, Word } from '../../shared/model'

function group(category: Category, count: number): Word[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${category}-${index}`, text: `${category}-${index}`, language: 'de', category,
    consecutive_mistakes: category === 'minus' ? 2 : 0,
    created_at: '2026-10-23T12:00:00Z', last_practiced_at: null,
  }))
}

describe('mixed practice selection', () => {
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
