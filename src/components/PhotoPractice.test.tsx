import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PhotoRound, PhotoStatus, Word } from '../../shared/model'
import { api } from '../lib/api'
import { PhotoPractice } from './PhotoPractice'

const word: Word = { id: '11111111-1111-4111-8111-111111111111', text: 'Schmetterling', language: 'de', category: 'new', consecutive_mistakes: 0, created_at: '2026-10-22T12:00:00Z', last_practiced_at: null }
const round: PhotoRound = { id: '22222222-2222-4222-8222-222222222222', startedAt: '2026-10-22T12:00:00Z', writtenAt: null, reviewedAt: null, nextIndex: 0, words: [{ id: word.id, text: word.text, language: word.language, attemptId: '33333333-3333-4333-8333-333333333333' }], recognition: null, results: null }
const written: PhotoRound = { ...round, nextIndex: 1, writtenAt: '2026-10-22T12:01:00Z' }
const status: PhotoStatus = { rounds: [], ocr: { enabled: false, month: '2026-10', used: 0, limit: 450 } }
beforeEach(() => {
  vi.stubGlobal('speechSynthesis', { getVoices: () => [], cancel: vi.fn(), speak: vi.fn() })
  vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; constructor(text: string) { this.text = text } })
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:test-photo')
    static revokeObjectURL = vi.fn()
  })
  vi.spyOn(api, 'photoStatus').mockResolvedValue(status)
})
describe('one-photo practice', () => {
  it('conceals spelling while writing, persists position, and only saves after a complete manual parent review', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'createPhotoRound').mockResolvedValue(round)
    const advance = vi.spyOn(api, 'advancePhotoRound').mockResolvedValue(written)
    const review = vi.spyOn(api, 'reviewPhotoRound').mockResolvedValue({ ...written, reviewedAt: '2026-10-22T12:02:00Z', results: [true] })
    const refresh = vi.fn().mockResolvedValue(undefined)
    render(<PhotoPractice words={[word]} onUpdated={refresh} onClose={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: /start numbered round/i }))
    expect(document.body).not.toHaveTextContent(word.text)
    expect(screen.queryByText(/expected spelling/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /all written/i }))
    expect(advance).toHaveBeenCalledWith(round.id, 1)
    expect(document.body).not.toHaveTextContent(word.text)
    await user.click(screen.getByRole('button', { name: /review the sheet manually/i }))
    expect(screen.getByText(word.text)).toBeInTheDocument()
    expect(review).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /confirm all/i })).toBeDisabled()
    await user.selectOptions(screen.getByRole('combobox', { name: /parent’s result/i }), 'correct')
    await user.click(screen.getByRole('button', { name: /confirm all/i }))
    expect(review).toHaveBeenCalledWith(round.id, [true])
    expect(await screen.findByRole('status')).toHaveTextContent('parent-confirmed results are saved')
    expect(refresh).toHaveBeenCalledOnce()
  })
  it('shows unconfigured recognition explicitly and resumes the saved numbered position', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'photoStatus').mockResolvedValue({ ...status, rounds: [round] })
    render(<PhotoPractice words={[]} onUpdated={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByText(/automatic reading is not configured/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue round' }))
    expect(document.body).not.toHaveTextContent(word.text)
    expect(screen.getByRole('heading', { name: /write answer number 1/i })).toBeInTheDocument()
  })
  it('uploads only after explicit consent, keeps uncertain suggestions unmarked, and supports a retry without changing the submitted batch', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'photoStatus').mockResolvedValue({ ...status, rounds: [written], ocr: { ...status.ocr, enabled: true } })
    const read = vi.spyOn(api, 'readPhoto').mockResolvedValue({ ...written, recognition: { answers: [{ number: 1, text: 'Schmeterling', confidence: 0.6 }], warnings: ['Check this answer.'] } })
    const review = vi.spyOn(api, 'reviewPhotoRound').mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce({ ...written, results: [false], reviewedAt: '2026-10-22T12:02:00Z' })
    render(<PhotoPractice words={[]} onUpdated={vi.fn()} onClose={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Continue round' }))
    const file = new File(['test-photo'], 'answers.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText(/one photo of the numbered answers/i), file)
    expect(read).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /send photo to azure/i }))
    expect(read).toHaveBeenCalledWith(round.id, file)
    expect(await screen.findByText('Schmeterling')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm all/i })).toBeDisabled()
    expect(review).not.toHaveBeenCalled()
    await user.selectOptions(screen.getByRole('combobox'), 'incorrect')
    await user.click(screen.getByRole('button', { name: /confirm all/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost')
    expect(screen.getByRole('combobox')).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /retry confirming/i }))
    expect(review.mock.calls).toEqual([[round.id, [false]], [round.id, [false]]])
  })
})
