import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { api } from './lib/api'
import type { Word } from '../shared/model'

const anonymous = { authenticated: false, emailMigrationRequired: false, email: null }
const account = { authenticated: true, emailMigrationRequired: false, email: 'parent@example.com' }
beforeEach(() => {
  window.history.replaceState(null, '', '/')
  vi.spyOn(api, 'session').mockResolvedValue(anonymous)
  vi.spyOn(api, 'words').mockResolvedValue([])
})

describe('public registration and private account state', () => {
  it('registers from a retired setup link without submitting any setup token', async () => {
    window.history.replaceState(null, '', '/#setup=retired-token')
    const signup = vi.spyOn(api, 'signup').mockResolvedValue(account)
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Create account' }))
    expect(window.location.hash).toBe('')
    expect(screen.queryByLabelText('One-time setup code')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Parent email'), 'parent@example.com')
    await user.type(screen.getByLabelText('Password', { exact: true }), 'a long test passphrase')
    await user.type(screen.getByLabelText('Confirm password'), 'a long test passphrase')
    await user.click(screen.getByRole('button', { name: 'Create my account' }))
    expect(signup).toHaveBeenCalledWith('parent@example.com', 'a long test passphrase')
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('unmounts the previous private collection when another account signs in in another tab', async () => {
    const oldWord: Word = { id: '1', text: 'Private-first-account', language: 'de', category: 'new', consecutive_mistakes: 0, created_at: '2026-10-22T12:00:00Z', last_practiced_at: null }
    vi.spyOn(api, 'session').mockResolvedValue(account)
    const words = vi.spyOn(api, 'words').mockResolvedValue([oldWord])
    render(<App />)
    expect(await screen.findByText(oldWord.text)).toBeInTheDocument()
    vi.spyOn(api, 'session').mockResolvedValue({ ...account, email: 'another@example.com' })
    words.mockResolvedValue([])
    fireEvent(window, new Event('focus'))
    await screen.findByText('another@example.com')
    expect(screen.queryByText(oldWord.text)).not.toBeInTheDocument()
  })
})
