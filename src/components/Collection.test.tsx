import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createClient } from '@supabase/supabase-js'
import type { Database, Word } from '../database.types'
import { Collection } from './Collection'

const words: Word[] = [
  { id: '1', owner_id: 'parent', text: 'Straße', language: 'de', category: 'new', consecutive_mistakes: 0, created_at: '2026-10-22T12:00:00Z', last_practiced_at: null },
  { id: '2', owner_id: 'parent', text: 'beautiful', language: 'en', category: 'plus', consecutive_mistakes: 1, created_at: '2026-10-22T12:00:00Z', last_practiced_at: null },
]
const client = createClient<Database>('https://example.supabase.co', 'public-test-key', { auth: { persistSession: false } })

describe('word collection', () => {
  it('adds correct spelling and language, leaving category and attempts to server defaults', async () => {
    const user = userEvent.setup()
    const query = client.from('words')
    const insert = vi.spyOn(query, 'insert').mockResolvedValue({ success: true, data: null, error: null, count: null, status: 201, statusText: 'Created' })
    vi.spyOn(client, 'from').mockReturnValue(query)
    const rpc = vi.spyOn(client, 'rpc')
    const refresh = vi.fn().mockResolvedValue(undefined)
    render(<Collection client={client} words={[]} loading={false} category="all" onCategory={vi.fn()} refresh={refresh} onPractice={vi.fn()} />)
    await user.type(screen.getByRole('textbox', { name: 'Word' }), '  butterfly  ')
    await user.selectOptions(screen.getByLabelText('Language'), 'en')
    await user.click(screen.getByRole('button', { name: '+ Add to New' }))
    expect(insert).toHaveBeenCalledWith({ text: 'butterfly', language: 'en' })
    expect(rpc).not.toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent('fresh start')
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('filters by language without changing the underlying word list', async () => {
    const user = userEvent.setup()
    render(<Collection client={client} words={words} loading={false} category="all" onCategory={vi.fn()} refresh={vi.fn()} onPractice={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'English' }))
    expect(screen.queryByText('Straße')).not.toBeInTheDocument()
    expect(screen.getByText('beautiful')).toBeInTheDocument()
    expect(screen.getByText(/1 mistake in a row/)).toBeInTheDocument()
  })

  it('requires an explicit delete confirmation and lets the parent keep the word', async () => {
    const user = userEvent.setup()
    render(<Collection client={client} words={words} loading={false} category="all" onCategory={vi.fn()} refresh={vi.fn()} onPractice={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Delete Straße' }))
    expect(screen.getByText('Delete word & history?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep' }))
    expect(screen.queryByText('Delete word & history?')).not.toBeInTheDocument()
    expect(screen.getByText('Straße')).toBeInTheDocument()
  })
})
