import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PracticeRound, Word } from '../../shared/model'
import { api } from '../lib/api'
import { Practice } from './Practice'

const word: Word = { id: '11111111-1111-4111-8111-111111111111', text: 'Schmetterling', language: 'de', category: 'new', consecutive_mistakes: 0, created_at: '2026-10-22T12:00:00Z', last_practiced_at: null }
const round: PracticeRound = { id: '22222222-2222-4222-8222-222222222222', startedAt: word.created_at, writtenAt: null, reviewedAt: null, nextIndex: 0, words: [{ id: word.id, text: word.text, language: word.language, attemptId: '33333333-3333-4333-8333-333333333333' }], recognition: null, results: null }
beforeEach(() => {
  vi.stubGlobal('speechSynthesis', { getVoices: () => [], cancel: vi.fn(), speak: vi.fn() })
  vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; constructor(text: string) { this.text = text } })
  vi.spyOn(api, 'photoStatus').mockResolvedValue({ rounds: [], ocr: { enabled: false, month: '2026-10', used: 0, limit: 450 } })
})

describe('whole-round dictation', () => {
  it('persists a filtered round before dictation and never offers immediate marking', async () => {
    const user = userEvent.setup()
    const create = vi.spyOn(api, 'createPhotoRound').mockResolvedValue(round)
    const english: Word = { ...word, id: '44444444-4444-4444-8444-444444444444', text: 'butterfly', language: 'en' }
    render(<Practice words={[word, english]} loading={false} onUpdated={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Start round (1 word)' }))
    expect(create).toHaveBeenCalledWith([word.id])
    expect(document.body).not.toHaveTextContent(word.text)
    expect(screen.queryByRole('button', { name: /reveal|spelled correctly/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Write answer number 1.' })).toBeInTheDocument()
  })

  it('reports missing voices without exposing the word', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'createPhotoRound').mockResolvedValue(round)
    render(<Practice words={[word]} loading={false} onUpdated={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: /start round/i }))
    await user.click(screen.getByRole('button', { name: /listen to the hidden/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No Deutsch voice')
    expect(document.body).not.toHaveTextContent(word.text)
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled()
  })

  it('does not start an empty list and defaults large collections to ten words', async () => {
    const user = userEvent.setup()
    const create = vi.spyOn(api, 'createPhotoRound').mockResolvedValue(round)
    const { rerender } = render(<Practice words={[]} loading={false} onUpdated={vi.fn()} />)
    expect(await screen.findByRole('button', { name: /start round/i })).toBeDisabled()
    rerender(<Practice words={Array.from({ length: 101 }, (_, index) => ({ ...word, id: String(index) }))} loading={false} onUpdated={vi.fn()} />)
    expect(screen.getByLabelText('How many words?')).toHaveValue('10')
    await user.click(screen.getByRole('button', { name: 'Start round (10 words)' }))
    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0][0]).toHaveLength(10)
    expect(new Set(create.mock.calls[0][0]).size).toBe(10)
  })

  it.each([10, 15, 20, 25])('selects exactly %i distinct words from the chosen language and category', async size => {
    const user = userEvent.setup()
    const candidates = Array.from({ length: 30 }, (_, index) => ({ ...word, id: `eligible-${index}`, text: `Word-${index}` }))
    const excluded: Word[] = [
      { ...word, id: 'other-language', language: 'en' },
      { ...word, id: 'other-category', category: 'plus' },
    ]
    const create = vi.spyOn(api, 'createPhotoRound').mockResolvedValue(round)
    render(<Practice words={[...candidates, ...excluded]} loading={false} onUpdated={vi.fn()} />)
    await user.selectOptions(screen.getByLabelText('Which words?'), 'new')
    await user.selectOptions(screen.getByLabelText('How many words?'), String(size))
    await user.click(screen.getByRole('button', { name: `Start round (${size} words)` }))
    expect(create).toHaveBeenCalledOnce()
    const selected = create.mock.calls[0][0]
    expect(selected).toHaveLength(size)
    expect(new Set(selected).size).toBe(size)
    expect(selected.every(id => candidates.some(candidate => candidate.id === id))).toBe(true)
  })

  it('uses all available words when fewer match than the requested size', async () => {
    const user = userEvent.setup()
    const create = vi.spyOn(api, 'createPhotoRound').mockResolvedValue(round)
    render(<Practice words={[word]} loading={false} onUpdated={vi.fn()} />)
    await user.selectOptions(screen.getByLabelText('How many words?'), '25')
    expect(screen.getByText(/fewer words are available/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start round (1 word)' }))
    expect(create).toHaveBeenCalledWith([word.id])
  })

  it('resumes the saved length rather than applying the current ten-word preset', async () => {
    const user = userEvent.setup()
    const saved = { ...round, words: Array.from({ length: 25 }, (_, index) => ({ ...round.words[0], id: `saved-${index}`, attemptId: `saved-attempt-${index}` })) }
    vi.spyOn(api, 'photoStatus').mockResolvedValue({ rounds: [saved], ocr: { enabled: false, month: '2026-10', used: 0, limit: 450 } })
    const create = vi.spyOn(api, 'createPhotoRound')
    render(<Practice words={[word]} loading={false} onUpdated={vi.fn()} />)
    expect(screen.getByLabelText('How many words?')).toHaveValue('10')
    await user.click(await screen.findByRole('button', { name: 'Continue round' }))
    expect(screen.getByRole('progressbar', { name: 'Numbered answers written' })).toHaveAttribute('max', '25')
    expect(create).not.toHaveBeenCalled()
  })
})
