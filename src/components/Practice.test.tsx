import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Word } from '../../shared/model'
import { api } from '../lib/api'
import { Practice } from './Practice'

const word: Word = {
  id: '11111111-1111-4111-8111-111111111111',
  text: 'Schmetterling',
  language: 'de',
  category: 'new',
  consecutive_mistakes: 0,
  created_at: '2026-10-22T12:00:00Z',
  last_practiced_at: null,
}
beforeEach(() => {
  vi.stubGlobal('speechSynthesis', { getVoices: () => [], cancel: vi.fn(), speak: vi.fn() })
  vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; constructor(text: string) { this.text = text } })
})

describe('paper dictation', () => {
  it('conceals the word in the DOM until explicit reveal, then saves the parent mark', async () => {
    const user = userEvent.setup()
    const mark = vi.spyOn(api, 'mark').mockResolvedValue({ ...word, category: 'plus' })
    const refresh = vi.fn().mockResolvedValue(undefined)
    render(<Practice words={[word]} loading={false} onUpdated={refresh} />)
    await user.click(screen.getByRole('button', { name: /let’s begin/i }))
    expect(document.body).not.toHaveTextContent('Schmetterling')
    expect(screen.queryByRole('button', { name: /spelled correctly/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /reveal/i }))
    expect(screen.getByRole('heading', { name: 'Schmetterling' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /spelled correctly/i }))
    expect(mark).toHaveBeenCalledWith(word.id, true, expect.any(String))
    await user.click(await screen.findByRole('button', { name: 'Finish practice' }))
    expect(screen.getByText('Practice, not perfection.')).toBeInTheDocument()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('keeps the same attempt ID and answer after an uncertain save', async () => {
    const user = userEvent.setup()
    const mark = vi.spyOn(api, 'mark')
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce({ ...word, consecutive_mistakes: 1 })
    render(<Practice words={[word]} loading={false} onUpdated={vi.fn().mockResolvedValue(undefined)} />)
    await user.click(screen.getByRole('button', { name: /let’s begin/i }))
    await user.click(screen.getByRole('button', { name: /reveal/i }))
    await user.click(screen.getByRole('button', { name: /not quite/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not been confirmed as saved')
    expect(screen.queryByRole('button', { name: /spelled correctly/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /retry saving/i }))
    expect(mark.mock.calls[1]).toEqual(mark.mock.calls[0])
    expect(await screen.findByRole('button', { name: 'Finish practice' })).toBeInTheDocument()
  })

  it('reports missing language voices instead of speaking in the wrong language', async () => {
    const user = userEvent.setup()
    render(<Practice words={[word]} loading={false} onUpdated={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /let’s begin/i }))
    await user.click(screen.getByRole('button', { name: /listen to the hidden/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No Deutsch voice')
    expect(document.body).not.toHaveTextContent('Schmetterling')
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled()
  })

  it('does not start an empty language list', () => {
    render(<Practice words={[]} loading={false} onUpdated={vi.fn()} />)
    expect(screen.getByRole('button', { name: /let’s begin/i })).toBeDisabled()
  })
})
