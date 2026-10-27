import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Word } from '../../shared/model'
import { I18nProvider } from '../i18n/I18n'
import { api } from '../lib/api'
import { Collection } from './Collection'

const words: Word[] = [
  { id: '1', text: 'Straße', language: 'de', category: 'new', consecutive_mistakes: 0, created_at: '2026-10-22T12:00:00Z', last_practiced_at: null },
  { id: '2', text: 'beautiful', language: 'en', category: 'plus', consecutive_mistakes: 1, created_at: '2026-10-22T12:00:00Z', last_practiced_at: null },
]

describe('word collection', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps the existing words separate from word entry and imports', () => {
    render(<Collection words={words} loading={false} refresh={vi.fn()} />)
    expect(screen.getByRole('searchbox', { name: 'Search words' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Your words' })).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Add a word' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Word lists' })).not.toBeInTheDocument()
  })

  it('keeps disabled-language words visible and filterable without a search', async () => {
    const user = userEvent.setup()
    render(<Collection words={words} loading={false} refresh={vi.fn()} preferences={{ enabled: ['fr'], defaultLanguage: 'fr' }} />)
    const languageFilter = screen.getByRole('combobox', { name: 'Filter by language' })
    expect(within(languageFilter).getByRole('option', { name: 'Français' })).toBeInTheDocument()
    expect(within(languageFilter).getByRole('option', { name: 'Deutsch (off)' })).toBeInTheDocument()
    expect(within(languageFilter).getByRole('option', { name: 'English (off)' })).toBeInTheDocument()
    expect(screen.getByText('beautiful')).toBeVisible()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by language' }), 'de')
    expect(screen.queryByText('beautiful')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Search words'), 'Straße')
    expect(screen.getByText('Straße')).toBeInTheDocument()
  })

  it('preserves local practice dates and the original server timestamp on individual words', () => {
    const timestamp = '2026-10-22T12:34:56Z'
    const { container } = render(<Collection words={[{ ...words[0], last_practiced_at: timestamp }]} loading={false} refresh={vi.fn()} />)
    expect(screen.getByText('Straße')).toBeVisible()
    const time = container.querySelector('time')
    expect(time).toHaveAttribute('dateTime', timestamp)
    expect(time).toHaveTextContent(new Date(timestamp).toLocaleString('en-GB'))
  })

  it('opens with the defined words and filters, not aggregate statistics', () => {
    render(<Collection words={words} loading={false} refresh={vi.fn()} />)
    expect(screen.getByText('Straße')).toBeVisible()
    expect(screen.getByText('beautiful')).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Filter by language' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Category' })).toBeVisible()
    expect(screen.queryByText('Total words')).not.toBeInTheDocument()
  })

  it('filters by language without changing the underlying word list', async () => {
    const user = userEvent.setup()
    render(<Collection words={words} loading={false} refresh={vi.fn()} />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by language' }), 'en')
    expect(screen.queryByText('Straße')).not.toBeInTheDocument()
    expect(screen.getByText('beautiful')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'new')
    expect(screen.queryByText('beautiful')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'plus')
    expect(screen.getByText('beautiful')).toBeVisible()
    await user.type(screen.getByLabelText('Search words'), 'absent')
    expect(screen.getByText('No matching words.')).toBeVisible()
    await user.clear(screen.getByLabelText('Search words'))
    expect(screen.getByText('beautiful')).toBeVisible()
    expect(screen.queryByText('Straße')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Filter by language' })).toHaveValue('en')
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('plus')
  })

  it.each([
    { language: 'en' as const, trigger: 'Delete word: Straße', label: 'Delete word', question: 'Delete word & history?', confirm: 'Yes, delete', keep: 'Keep word' },
    { language: 'de' as const, trigger: 'Wort löschen: Straße', label: 'Wort löschen', question: 'Wort und Verlauf löschen?', confirm: 'Ja, löschen', keep: 'Wort behalten' },
  ])('offers clear deletion and cancellation buttons in $language without deleting on cancel', async ({ language, trigger, label, question, confirm, keep }) => {
    const user = userEvent.setup()
    const remove = vi.spyOn(api, 'deleteWord').mockResolvedValue(undefined)
    render(<I18nProvider language={language}><Collection words={words} loading={false} refresh={vi.fn()} /></I18nProvider>)
    const button = screen.getByRole('button', { name: trigger })
    expect(button).toHaveTextContent(label)
    await user.click(button)
    expect(screen.getByText(question)).toBeVisible()
    expect(screen.getByRole('button', { name: confirm })).toHaveClass('button', 'danger')
    expect(screen.getByRole('button', { name: keep })).toHaveClass('button', 'secondary')
    expect(remove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: keep }))
    expect(screen.queryByText(question)).not.toBeInTheDocument()
    expect(screen.getByText('Straße')).toBeInTheDocument()
    expect(remove).not.toHaveBeenCalled()
  })

  it('deletes only the confirmed word and refreshes the collection', async () => {
    const user = userEvent.setup()
    const remove = vi.spyOn(api, 'deleteWord').mockResolvedValue(undefined)
    const refresh = vi.fn().mockResolvedValue(undefined)
    render(<Collection words={words} loading={false} refresh={refresh} />)
    await user.click(screen.getByRole('button', { name: 'Delete word: Straße' }))
    expect(screen.getByText('Saved challenges containing this word and their results are also removed. Other words’ progress stays.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Word and its practice history deleted.')
    expect(remove).toHaveBeenCalledExactlyOnceWith('1')
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('keeps the confirmation available after a failed deletion', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'deleteWord').mockRejectedValue(new Error('Connection lost'))
    render(<Collection words={words} loading={false} refresh={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Delete word: Straße' }))
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost')
    expect(screen.getByRole('button', { name: 'Yes, delete' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Keep word' })).toBeEnabled()
    expect(screen.getByText('Straße')).toBeVisible()
  })

  it('shows more words and restores the defined list when a search is cleared', async () => {
    const user = userEvent.setup()
    render(<Collection words={Array.from({ length: 30 }, (_, index) => ({ ...words[0], id: String(index), text: `Word${index}` }))} loading={false} refresh={vi.fn()} />)
    const input = screen.getByLabelText('Search words')
    await user.type(input, 'word')
    expect(screen.getAllByRole('listitem')).toHaveLength(20)
    expect(screen.getByText('Showing 20 of 30 words')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Show more words' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(30)
    expect(screen.queryByRole('button', { name: 'Show more words' })).not.toBeInTheDocument()
    await user.clear(input)
    expect(screen.getAllByRole('listitem')).toHaveLength(20)
    expect(screen.getByText('Word0')).toBeVisible()
  })
})
