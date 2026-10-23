import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
    await user.click(await screen.findByRole('button', { name: 'Start 1 word' }))
    expect(create).toHaveBeenCalledWith([word.id])
    expect(document.body).not.toHaveTextContent(word.text)
    expect(screen.queryByRole('button', { name: /reveal|spelled correctly/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Write answer number 1.' })).toBeInTheDocument()
  })

  it('reports missing voices without exposing the word', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'createPhotoRound').mockResolvedValue(round)
    render(<Practice words={[word]} loading={false} onUpdated={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Start 1 word' }))
    await user.click(screen.getByRole('button', { name: /listen to the hidden/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No Deutsch voice')
    expect(document.body).not.toHaveTextContent(word.text)
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled()
  })

  it('disables empty rounds and offers a direct ten-word start for large collections', async () => {
    const user = userEvent.setup()
    const create = vi.spyOn(api, 'createPhotoRound').mockResolvedValue(round)
    const { rerender } = render(<Practice words={[]} loading={false} onUpdated={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'Start 10 words' })).toBeDisabled()
    rerender(<Practice words={Array.from({ length: 101 }, (_, index) => ({ ...word, id: String(index) }))} loading={false} onUpdated={vi.fn()} />)
    expect(screen.queryByLabelText('How many words?')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start 10 words' }))
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
    expect(screen.getByLabelText('Language')).not.toBeVisible()
    await user.click(screen.getByText('Change words', { selector: 'summary' }))
    await user.selectOptions(screen.getByLabelText('Category'), 'new')
    await user.click(screen.getByRole('button', { name: `Start ${size} words` }))
    expect(create).toHaveBeenCalledOnce()
    const selected = create.mock.calls[0][0]
    expect(selected).toHaveLength(size)
    expect(new Set(selected).size).toBe(size)
    expect(selected.every(id => candidates.some(candidate => candidate.id === id))).toBe(true)
  })

  it('offers just one truthful start action when fewer than ten words match', async () => {
    const user = userEvent.setup()
    const create = vi.spyOn(api, 'createPhotoRound').mockResolvedValue(round)
    const available = Array.from({ length: 8 }, (_, index) => ({ ...word, id: `available-${index}` }))
    render(<Practice words={available} loading={false} onUpdated={vi.fn()} />)
    const actions = screen.getByRole('group', { name: 'Start a practice round' })
    expect(within(actions).getAllByRole('button')).toHaveLength(1)
    await user.click(within(actions).getByRole('button', { name: 'Start 8 words' }))
    expect(create.mock.calls[0][0].sort()).toEqual(available.map(item => item.id).sort())
  })

  it('shows distinct actual counts for collections between presets', async () => {
    render(<Practice words={Array.from({ length: 12 }, (_, index) => ({ ...word, id: `available-${index}` }))} loading={false} onUpdated={vi.fn()} />)
    const actions = screen.getByRole('group', { name: 'Start a practice round' })
    expect(within(actions).getAllByRole('button').map(button => button.textContent)).toEqual(['Start 10 words', 'Start 12 words'])
  })

  it('changes the visible selection and start actions when another language is chosen', async () => {
    const user = userEvent.setup()
    const create = vi.spyOn(api, 'createPhotoRound').mockResolvedValue(round)
    const english: Word = { ...word, id: 'english', text: 'butterfly', language: 'en' }
    render(<Practice words={[word, english]} loading={false} onUpdated={vi.fn()} />)
    await user.click(screen.getByText('Change words', { selector: 'summary' }))
    await user.selectOptions(screen.getByLabelText('Language'), 'en')
    expect(screen.getByText('English · All categories · 1 available')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start 1 word' }))
    expect(create).toHaveBeenCalledWith([english.id])
  })

  it('resumes the saved length rather than applying a current start size', async () => {
    const user = userEvent.setup()
    const saved = { ...round, words: Array.from({ length: 25 }, (_, index) => ({ ...round.words[0], id: `saved-${index}`, attemptId: `saved-attempt-${index}` })) }
    vi.spyOn(api, 'photoStatus').mockResolvedValue({ rounds: [saved], ocr: { enabled: false, month: '2026-10', used: 0, limit: 450 } })
    const create = vi.spyOn(api, 'createPhotoRound')
    render(<Practice words={[word]} loading={false} onUpdated={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Start 1 word' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Continue round' }))
    expect(screen.getByRole('progressbar', { name: 'Numbered answers written' })).toHaveAttribute('max', '25')
    expect(create).not.toHaveBeenCalled()
  })
})
