// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { roundStatistics, type PracticeRound } from './model.js'

function round(results: boolean[] | null, count = results?.length ?? 2): PracticeRound {
  return {
    id: 'round', startedAt: '2026-10-22T12:00:00Z',
    writtenAt: '2026-10-22T12:01:00Z', reviewedAt: results ? '2026-10-22T12:02:00Z' : null,
    nextIndex: count, words: Array.from({ length: count }, (_, index) => ({ id: String(index), text: 'word', language: 'en', attemptId: `attempt-${index}` })),
    results, recognition: null,
  }
}

describe('parent-confirmed round statistics', () => {
  it('shows no accuracy before any confirmed answer, not a misleading zero percent', () => {
    expect(roundStatistics([])).toEqual({ started: 0, completed: 0, pending: 0, correct: 0, incorrect: 0, unmarked: 0, reviewed: 0, accuracy: null })
    expect(roundStatistics([round(null, 3)])).toMatchObject({ pending: 1, unmarked: 3, incorrect: 0, correct: 0, accuracy: null })
  })
  it('weights accuracy by reviewed answers rather than averaging round percentages', () => {
    expect(roundStatistics([round([true]), round([false, false, true]), round(null, 5)])).toEqual({ started: 3, completed: 2, pending: 1, correct: 2, incorrect: 2, unmarked: 5, reviewed: 4, accuracy: 50 })
  })
  it('rounds percentages and keeps complete success and failure distinct', () => {
    expect(roundStatistics([round([true, false, false])]).accuracy).toBe(33)
    expect(roundStatistics([round([true, true])]).accuracy).toBe(100)
    expect(roundStatistics([round([false, false])]).accuracy).toBe(0)
  })
})
