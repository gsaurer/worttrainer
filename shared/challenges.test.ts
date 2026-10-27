// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { nextProgress, challengeStatistics, type Category, type Challenge, type Word } from './model.js'

function progress(results: boolean[], category: Category = 'new') {
  let word: Word = { id: 'word', text: 'Wort', language: 'de', category, consecutive_mistakes: category === 'minus' ? 2 : 0, created_at: '2026-10-23T12:00:00Z', last_practiced_at: null }
  const attempts: { wordId: string; correct: boolean }[] = []
  return results.map(correct => {
    word = { ...word, ...nextProgress(word, correct, attempts) }
    attempts.push({ wordId: word.id, correct })
    return word
  })
}

describe('word learning progress', () => {
  it('requires three consecutive correct answers to earn plus', () => {
    expect(progress([true, true, true]).map(word => word.category)).toEqual(['new', 'new', 'plus'])
  })

  it('resets the correct streak after a mistake', () => {
    expect(progress([true, true, false, true, true, true]).map(word => word.category)).toEqual(['new', 'new', 'new', 'new', 'new', 'plus'])
  })

  it('returns a missed plus word to Default immediately and minus after the next mistake', () => {
    expect(progress([false, false], 'plus')).toMatchObject([
      { category: 'new', consecutive_mistakes: 1 },
      { category: 'minus', consecutive_mistakes: 2 },
    ])
    expect(progress([false, true, true, true], 'plus').map(word => word.category)).toEqual(['new', 'new', 'new', 'plus'])
  })

  it('keeps minus words in extra practice until three correct answers', () => {
    expect(progress([false, false, true, true, true])).toMatchObject([
      { category: 'new', consecutive_mistakes: 1 },
      { category: 'minus', consecutive_mistakes: 2 },
      { category: 'minus', consecutive_mistakes: 0 },
      { category: 'minus', consecutive_mistakes: 0 },
      { category: 'plus', consecutive_mistakes: 0 },
    ])
  })

  it('does not count another word toward the correct streak', () => {
    const word = progress([true])[0]
    expect(nextProgress(word, true, [{ wordId: word.id, correct: true }, { wordId: 'another', correct: true }])).toMatchObject({ category: 'new' })
    expect(nextProgress(word, true, [{ wordId: word.id, correct: true }, { wordId: 'another', correct: false }, { wordId: word.id, correct: true }])).toMatchObject({ category: 'plus' })
  })
  it('ignores deleted answers without counting them or breaking the surviving correct streak', () => {
    const word = progress([true])[0]
    const deletedAt = '2026-10-27T12:00:00Z'
    expect(nextProgress(word, true, [{ wordId: word.id, correct: true, deletedAt }, { wordId: word.id, correct: true }])).toMatchObject({ category: 'new' })
    expect(nextProgress(word, true, [{ wordId: word.id, correct: true }, { wordId: word.id, correct: false, deletedAt }, { wordId: word.id, correct: true }])).toMatchObject({ category: 'plus' })
  })
})

function challenge(results: boolean[] | null, count = results?.length ?? 2): Challenge {
  return {
    id: 'challenge', startedAt: '2026-10-22T12:00:00Z',
    writtenAt: '2026-10-22T12:01:00Z', reviewedAt: results ? '2026-10-22T12:02:00Z' : null,
    nextIndex: count, words: Array.from({ length: count }, (_, index) => ({ id: String(index), text: 'word', language: 'en', attemptId: `attempt-${index}` })),
    results, recognition: null, telemetry: [], photo: null,
    check: results ? { method: 'manual', spellings: results.map(correct => correct ? 'word' : null), evaluatedAt: '2026-10-22T12:02:00Z' } : null,
  }
}

describe('parent-confirmed challenge statistics', () => {
  it('excludes deleted completed and unfinished challenges from every total', () => {
    const deletedAt = '2026-10-27T12:00:00Z'
    expect(challengeStatistics([{ ...challenge([false, false]), deletedAt }, { ...challenge(null, 5), deletedAt }, challenge([true])])).toEqual({ started: 1, completed: 1, pending: 0, correct: 1, incorrect: 0, unmarked: 0, reviewed: 1, accuracy: 100 })
  })
  it('shows no accuracy before any confirmed answer, not a misleading zero percent', () => {
    expect(challengeStatistics([])).toEqual({ started: 0, completed: 0, pending: 0, correct: 0, incorrect: 0, unmarked: 0, reviewed: 0, accuracy: null })
    expect(challengeStatistics([challenge(null, 3)])).toMatchObject({ pending: 1, unmarked: 3, incorrect: 0, correct: 0, accuracy: null })
  })
  it('weights accuracy by reviewed answers rather than averaging challenge percentages', () => {
    expect(challengeStatistics([challenge([true]), challenge([false, false, true]), challenge(null, 5)])).toEqual({ started: 3, completed: 2, pending: 1, correct: 2, incorrect: 2, unmarked: 5, reviewed: 4, accuracy: 50 })
  })
  it('challenges percentages and keeps complete success and failure distinct', () => {
    expect(challengeStatistics([challenge([true, false, false])]).accuracy).toBe(33)
    expect(challengeStatistics([challenge([true, true])]).accuracy).toBe(100)
    expect(challengeStatistics([challenge([false, false])]).accuracy).toBe(0)
  })
})
