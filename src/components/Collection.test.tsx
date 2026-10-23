import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Word } from '../../shared/model'
import { Collection } from './Collection'

const words: Word[] = [
  { id: '1', text: 'Straße', language: 'de', category: 'new', consecutive_mistakes: 0, created_at: '2026-10-22T12:00:00Z', last_practiced_at: null },
  { id: '2', text: 'beautiful', language: 'en', category: 'plus', consecutive_mistakes: 1, created_at: '2026-10-22T12:00:00Z', last_practiced_at: null },
]

describe('word collection', () => {
  it('shows the local practice date and time in search results while preserving the server timestamp', async () => {
    const user = userEvent.setup()
    const timestamp = '2026-10-22T12:34:56Z'
    const { container } = render(<Collection words={[{ ...words[0], last_practiced_at: timestamp }]} loading={false} refresh={vi.fn()} />)
    await user.type(screen.getByLabelText('Search words'), 'Straße')
    const time = container.querySelector('time')
    expect(time).toHaveAttribute('dateTime', timestamp)
    expect(time).toHaveTextContent(new Date(timestamp).toLocaleString())
  })

  it('opens with an aggregate overview, not the full list of spellings', () => {
    render(<Collection words={words} loading={false} refresh={vi.fn()} />)
    expect(screen.queryByText('Straße')).not.toBeInTheDocument()
    expect(screen.queryByText('beautiful')).not.toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Words by language and category' })
    const rows = within(table).getAllByRole('row')
    expect(within(rows[1]).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['1', '0', '0', '1'])
    expect(within(rows[2]).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['0', '1', '0', '1'])
    expect(screen.getByText('Total words').nextElementSibling).toHaveTextContent('2')
    expect(screen.getByText('Not practiced').nextElementSibling).toHaveTextContent('2')
  })

  it('filters by language without changing the underlying word list', async () => {
    const user = userEvent.setup()
    render(<Collection words={words} loading={false} refresh={vi.fn()} />)
    await user.type(screen.getByLabelText('Search words'), 'a')
    await user.click(screen.getByRole('button', { name: 'English' }))
    expect(screen.queryByText('Straße')).not.toBeInTheDocument()
    expect(screen.getByText('beautiful')).toBeInTheDocument()
    expect(screen.getByText(/1 mistake in a row/)).toBeInTheDocument()
  })

  it('requires an explicit delete confirmation and lets the parent keep the word', async () => {
    const user = userEvent.setup()
    render(<Collection words={words} loading={false} refresh={vi.fn()} />)
    await user.type(screen.getByLabelText('Search words'), 'Straße')
    await user.click(screen.getByRole('button', { name: 'Delete Straße' }))
    expect(screen.getByText('Delete word & history?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep' }))
    expect(screen.queryByText('Delete word & history?')).not.toBeInTheDocument()
    expect(screen.getByText('Straße')).toBeInTheDocument()
  })

  it('limits broad searches and clearing the search hides the word list again', async () => {
    const user = userEvent.setup()
    render(<Collection words={Array.from({ length: 30 }, (_, index) => ({ ...words[0], id: String(index), text: `Word${index}` }))} loading={false} refresh={vi.fn()} />)
    const input = screen.getByLabelText('Search words')
    await user.type(input, 'word')
    expect(screen.getAllByRole('listitem')).toHaveLength(20)
    expect(screen.getByText('Showing 20 of 30 matches. Refine your search.')).toBeInTheDocument()
    await user.clear(input)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})
