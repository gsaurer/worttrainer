// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { checkSpelling } from './spelling.js'

describe('local document spelling', () => {
  it('accepts British and American spelling, punctuation, contractions and hyphenated words', async () => {
    const result = await checkSpelling("The color and colour are beautiful. Don't worry about well-known words!", 'en')
    expect(result.possibleMistakes).toEqual([])
    expect(result.wordCount).toBeGreaterThan(10)
  })

  it('groups repeated possible mistakes and offers dictionary corrections', async () => {
    const result = await checkSpelling('A beautifull day. A beautifull flower.', 'en')
    expect(result.possibleMistakes).toEqual([
      { word: 'beautifull', occurrences: 2, suggestions: expect.arrayContaining(['beautiful']) },
    ])
    expect(result.limited).toBe(false)
  })

  it('handles German Unicode and suggests the correct noun', async () => {
    const result = await checkSpelling('Das Hauus steht an der Straße. Die Häuser sind schön.', 'de')
    expect(result.possibleMistakes).toEqual([
      { word: 'Hauus', occurrences: 1, suggestions: expect.arrayContaining(['Haus']) },
    ])
  })

  it('rejects unsupported languages, unreadable input and excessive work', async () => {
    await expect(checkSpelling('Bonjour', 'fr')).rejects.toMatchObject({ status: 400 })
    await expect(checkSpelling('123 !', 'en')).rejects.toMatchObject({ status: 422 })
    await expect(checkSpelling('a'.repeat(20_001), 'en')).rejects.toMatchObject({ status: 413 })
    await expect(checkSpelling('word '.repeat(2001), 'en')).rejects.toMatchObject({ status: 413 })
  })

  it('does not let a correctly capitalized German noun hide a lowercase mistake', async () => {
    const result = await checkSpelling('Das Haus ist schön. Das haus ist schön.', 'de')
    expect(result.possibleMistakes).toEqual([
      { word: 'haus', occurrences: 1, suggestions: expect.arrayContaining(['Haus']) },
    ])
  })

  it('bounds findings and suggestions without claiming the whole document was clean', async () => {
    const text = Array.from({ length: 50 }, (_, index) => `zzzzzzzzzzzzzzzzzzzzzzzzzz${String.fromCharCode(97 + Math.floor(index / 26), 97 + index % 26)}`).join(' ')
    const result = await checkSpelling(text, 'en')
    expect(result.possibleMistakes).toHaveLength(40)
    expect(result.possibleMistakes.every(finding => finding.suggestions.length === 0)).toBe(true)
    expect(result.limited).toBe(true)
  })
})