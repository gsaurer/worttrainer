import { describe, expect, it } from 'vitest'
import { shuffled, validateWord } from './words'
import type { Word } from '../../shared/model'

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
