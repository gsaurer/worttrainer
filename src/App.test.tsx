import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { api } from './lib/api'

const setupState = { authenticated: false, setupRequired: true, emailMigrationRequired: false, email: null }
const accountState = { authenticated: true, setupRequired: false, emailMigrationRequired: false, email: 'parent@example.com' }
beforeEach(() => {
  window.history.replaceState(null, '', '/')
  vi.spyOn(api, 'session').mockResolvedValue(setupState)
  vi.spyOn(api, 'words').mockResolvedValue([])
})

describe('setup link navigation', () => {
  it('uses a fresh setup link opened in the existing tab, not the expired initial token', async () => {
    window.history.replaceState(null, '', '/#setup=expired-initial-token')
    const setup = vi.spyOn(api, 'setup').mockImplementation(async (_email, _password, token) => {
      if (token !== 'fresh-server-token') throw new Error('Invalid or expired setup code.')
      return accountState
    })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('button', { name: 'Create our parent account' })
    window.location.hash = 'setup=fresh-server-token'
    await waitFor(() => expect(window.location.hash).toBe(''))
    await user.type(screen.getByLabelText('Parent email'), 'parent@example.com')
    await user.type(screen.getByLabelText('Password', { exact: true }), 'a long test passphrase')
    await user.type(screen.getByLabelText('Confirm password'), 'a long test passphrase')
    await user.click(screen.getByRole('button', { name: 'Create our parent account' }))
    expect(setup).toHaveBeenCalledWith('parent@example.com', 'a long test passphrase', 'fresh-server-token')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('lets the parent replace a stale link token with the configured setup token', async () => {
    window.history.replaceState(null, '', '/#setup=stale-token')
    const setup = vi.spyOn(api, 'setup').mockResolvedValue(accountState)
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('button', { name: 'Create our parent account' })
    const input = screen.getByLabelText('One-time setup code')
    await user.clear(input)
    await user.type(input, 'configured-token')
    await user.type(screen.getByLabelText('Parent email'), 'parent@example.com')
    await user.type(screen.getByLabelText('Password', { exact: true }), 'a long test passphrase')
    await user.type(screen.getByLabelText('Confirm password'), 'a long test passphrase')
    await user.click(screen.getByRole('button', { name: 'Create our parent account' }))
    expect(setup).toHaveBeenCalledWith('parent@example.com', 'a long test passphrase', 'configured-token')
  })
})
