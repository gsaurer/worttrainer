import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Word } from '../../shared/model'
import { api } from '../lib/api'
import { AddWord } from './AddWord'

const word: Word = { id: '1', text: 'Straße', language: 'de', category: 'new', consecutive_mistakes: 0, created_at: '2026-10-22T12:00:00Z', last_practiced_at: null }

describe('quick word entry', () => {
  it('uses the account default and only offers its enabled languages', async () => {
    const user = userEvent.setup()
    const insert = vi.spyOn(api, 'addWord').mockResolvedValue(word)
    render(<AddWord words={[]} loading={false} refresh={vi.fn()} preferences={{ enabled: ['fr', 'en'], defaultLanguage: 'fr' }} />)
    expect(screen.getByLabelText('Language')).toHaveValue('fr')
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Français', 'English'])
    await user.type(screen.getByLabelText('Word'), 'papillon{Enter}')
    expect(insert).toHaveBeenCalledWith('papillon', 'fr')
  })

  it('adds with one button press, clears and refocuses the input, and keeps the language', async () => {
    const user = userEvent.setup()
    const insert = vi.spyOn(api, 'addWord').mockResolvedValue(word)
    const mark = vi.spyOn(api, 'mark')
    const refresh = vi.fn()
    render(<AddWord words={[]} loading={false} refresh={refresh} />)
    await user.type(screen.getByLabelText('Word'), '  butterfly  ')
    await user.selectOptions(screen.getByLabelText('Language'), 'en')
    await user.click(screen.getByRole('button', { name: 'Add word' }))
    expect(insert).toHaveBeenCalledWith('butterfly', 'en')
    expect(mark).not.toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent('Added to Default.')
    expect(refresh).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Word')).toHaveValue('')
    expect(screen.getByLabelText('Word')).toHaveFocus()
    expect(screen.getByLabelText('Language')).toHaveValue('en')
  })

  it('adds successive words with Enter', async () => {
    const user = userEvent.setup()
    const insert = vi.spyOn(api, 'addWord').mockResolvedValue(word)
    render(<AddWord words={[]} loading={false} refresh={vi.fn()} />)
    const input = screen.getByLabelText('Word')
    await user.type(input, 'Straße{Enter}')
    expect(insert).toHaveBeenNthCalledWith(1, 'Straße', 'de')
    expect(input).toHaveFocus()
    await user.type(input, 'Baum{Enter}')
    expect(insert).toHaveBeenNthCalledWith(2, 'Baum', 'de')
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
  })

  it('flags a same-language duplicate while typing, ignoring case and edge spaces', async () => {
    const user = userEvent.setup()
    const insert = vi.spyOn(api, 'addWord')
    render(<AddWord words={[word]} loading={false} refresh={vi.fn()} />)
    await user.type(screen.getByLabelText('Word'), '  STRAßE  ')
    expect(screen.getByRole('status')).toHaveTextContent('Already in Deutsch · Default.')
    expect(screen.getByLabelText('Word')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Add word' })).toBeDisabled()
    await user.keyboard('{Enter}')
    expect(insert).not.toHaveBeenCalled()
  })

  it('allows the same spelling in a different language and rechecks immediately on language changes', async () => {
    const user = userEvent.setup()
    const insert = vi.spyOn(api, 'addWord').mockResolvedValue(word)
    render(<AddWord words={[word]} loading={false} refresh={vi.fn()} />)
    await user.type(screen.getByLabelText('Word'), 'Straße')
    await user.selectOptions(screen.getByLabelText('Language'), 'en')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add word' })).toBeEnabled()
    await user.selectOptions(screen.getByLabelText('Language'), 'de')
    expect(screen.getByRole('button', { name: 'Add word' })).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('Language'), 'en')
    await user.click(screen.getByRole('button', { name: 'Add word' }))
    expect(insert).toHaveBeenCalledWith('Straße', 'en')
  })

  it('does not add before the collection is loaded and rechecks refreshed words', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<AddWord words={[]} loading refresh={vi.fn()} />)
    await user.type(screen.getByLabelText('Word'), 'Straße')
    expect(screen.getByRole('button', { name: 'Add word' })).toBeDisabled()
    rerender(<AddWord words={[word]} loading={false} refresh={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('Already in Deutsch')
    expect(screen.getByRole('button', { name: 'Add word' })).toBeDisabled()
  })

  it('preserves spelling and shows server conflicts when another device added the word first', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'addWord').mockRejectedValue(new Error('That word is already in this language’s collection.'))
    const refresh = vi.fn()
    render(<AddWord words={[]} loading={false} refresh={refresh} />)
    await user.type(screen.getByLabelText('Word'), 'Straße')
    await user.click(screen.getByRole('button', { name: 'Add word' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already in this language')
    expect(screen.getByLabelText('Word')).toHaveValue('Straße')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })
})
