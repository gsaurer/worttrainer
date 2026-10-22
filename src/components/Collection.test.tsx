import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Word } from '../../shared/model'
import { api } from '../lib/api'
import { Collection } from './Collection'

const words: Word[] = [
  { id: '1', text: 'Straße', language: 'de', category: 'new', consecutive_mistakes: 0, created_at: '2026-10-22T12:00:00Z', last_practiced_at: null },
  { id: '2', text: 'beautiful', language: 'en', category: 'plus', consecutive_mistakes: 1, created_at: '2026-10-22T12:00:00Z', last_practiced_at: null },
]

describe('word collection', () => {
  it('shows the local practice date and time while preserving the server timestamp', () => {
    const timestamp = '2026-10-22T12:34:56Z'
    const { container } = render(<Collection words={[{ ...words[0], last_practiced_at: timestamp }]} loading={false} category="all" onCategory={vi.fn()} refresh={vi.fn()} onPractice={vi.fn()} />)
    const time = container.querySelector('time')
    expect(time).toHaveAttribute('dateTime', timestamp)
    expect(time).toHaveTextContent(new Date(timestamp).toLocaleString())
  })

  it('adds correct spelling and language, leaving category and attempts to server defaults', async () => {
    const user = userEvent.setup()
    const insert = vi.spyOn(api, 'addWord').mockResolvedValue(words[0])
    const mark = vi.spyOn(api, 'mark')
    const refresh = vi.fn().mockResolvedValue(undefined)
    render(<Collection words={[]} loading={false} category="all" onCategory={vi.fn()} refresh={refresh} onPractice={vi.fn()} />)
    await user.type(screen.getByRole('textbox', { name: 'Word' }), '  butterfly  ')
    await user.selectOptions(screen.getByLabelText('Language'), 'en')
    await user.click(screen.getByRole('button', { name: '+ Add to New' }))
    expect(insert).toHaveBeenCalledWith('butterfly', 'en')
    expect(mark).not.toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent('fresh start')
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('filters by language without changing the underlying word list', async () => {
    const user = userEvent.setup()
    render(<Collection words={words} loading={false} category="all" onCategory={vi.fn()} refresh={vi.fn()} onPractice={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'English' }))
    expect(screen.queryByText('Straße')).not.toBeInTheDocument()
    expect(screen.getByText('beautiful')).toBeInTheDocument()
    expect(screen.getByText(/1 mistake in a row/)).toBeInTheDocument()
  })

  it('requires an explicit delete confirmation and lets the parent keep the word', async () => {
    const user = userEvent.setup()
    render(<Collection words={words} loading={false} category="all" onCategory={vi.fn()} refresh={vi.fn()} onPractice={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Delete Straße' }))
    expect(screen.getByText('Delete word & history?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep' }))
    expect(screen.queryByText('Delete word & history?')).not.toBeInTheDocument()
    expect(screen.getByText('Straße')).toBeInTheDocument()
  })
})
