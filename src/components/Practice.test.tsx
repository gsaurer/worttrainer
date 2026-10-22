import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createClient, PostgrestError } from '@supabase/supabase-js'
import type { Database, Word } from '../database.types'
import { Practice } from './Practice'

const word: Word = {
  id: '11111111-1111-4111-8111-111111111111',
  owner_id: '22222222-2222-4222-8222-222222222222',
  text: 'Schmetterling',
  language: 'de',
  category: 'new',
  consecutive_mistakes: 0,
  created_at: '2026-10-22T12:00:00Z',
  last_practiced_at: null,
}
const client = createClient<Database>('https://example.supabase.co', 'public-test-key', { auth: { persistSession: false } })

beforeEach(() => {
  vi.stubGlobal('speechSynthesis', { getVoices: () => [], cancel: vi.fn(), speak: vi.fn() })
  vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; constructor(text: string) { this.text = text } })
})

describe('paper dictation', () => {
  it('conceals the word in the DOM until explicit reveal, then saves the parent mark', async () => {
    const user = userEvent.setup()
    const rpc = vi.spyOn(client, 'rpc').mockResolvedValue({ success: true, data: { ...word, category: 'plus' }, error: null, count: null, status: 200, statusText: 'OK' })
    const refresh = vi.fn().mockResolvedValue(undefined)
    render(<Practice words={[word]} client={client} loading={false} onUpdated={refresh} />)
    await user.click(screen.getByRole('button', { name: /let’s begin/i }))
    expect(document.body).not.toHaveTextContent('Schmetterling')
    expect(screen.queryByRole('button', { name: /spelled correctly/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /reveal/i }))
    expect(screen.getByRole('heading', { name: 'Schmetterling' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /spelled correctly/i }))
    expect(rpc).toHaveBeenCalledWith('record_practice', { p_word_id: word.id, p_correct: true, p_attempt_id: expect.any(String) })
    await user.click(await screen.findByRole('button', { name: 'Finish practice' }))
    expect(screen.getByText('Practice, not perfection.')).toBeInTheDocument()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('keeps the same attempt ID and answer after an uncertain save', async () => {
    const user = userEvent.setup()
    const rpc = vi.spyOn(client, 'rpc')
      .mockResolvedValueOnce({ success: false, data: null, error: new PostgrestError({ message: 'Network unavailable', details: '', hint: '', code: 'NETWORK' }), count: null, status: 0, statusText: '' })
      .mockResolvedValueOnce({ success: true, data: { ...word, consecutive_mistakes: 1 }, error: null, count: null, status: 200, statusText: 'OK' })
    render(<Practice words={[word]} client={client} loading={false} onUpdated={vi.fn().mockResolvedValue(undefined)} />)
    await user.click(screen.getByRole('button', { name: /let’s begin/i }))
    await user.click(screen.getByRole('button', { name: /reveal/i }))
    await user.click(screen.getByRole('button', { name: /not quite/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not been confirmed as saved')
    expect(screen.queryByRole('button', { name: /spelled correctly/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /retry saving/i }))
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0])
    expect(await screen.findByRole('button', { name: 'Finish practice' })).toBeInTheDocument()
  })

  it('reports missing language voices instead of speaking in the wrong language', async () => {
    const user = userEvent.setup()
    render(<Practice words={[word]} client={client} loading={false} onUpdated={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /let’s begin/i }))
    await user.click(screen.getByRole('button', { name: /listen to the hidden/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No Deutsch voice')
    expect(document.body).not.toHaveTextContent('Schmetterling')
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled()
  })

  it('does not start an empty language list', () => {
    render(<Practice words={[]} client={client} loading={false} onUpdated={vi.fn()} />)
    expect(screen.getByRole('button', { name: /let’s begin/i })).toBeDisabled()
  })
})
