import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../lib/api'
import { Auth } from './Auth'

describe('shared parent authentication', () => {
  it('creates a real server account using the private setup code, without child data', async () => {
    const state = { authenticated: true, setupRequired: false, emailMigrationRequired: false, email: 'parent@example.com' }
    const setup = vi.spyOn(api, 'setup').mockResolvedValue(state)
    const authenticated = vi.fn()
    const user = userEvent.setup()
    render(<Auth setupRequired setupCode="private-test-code" onAuthenticated={authenticated} />)
    await user.type(screen.getByLabelText('Parent email'), 'parent@example.com')
    await user.type(screen.getByLabelText('Password', { exact: true }), 'a long test passphrase')
    await user.type(screen.getByLabelText('Confirm password'), 'a long test passphrase')
    await user.click(screen.getByRole('button', { name: 'Create our parent account' }))
    expect(setup).toHaveBeenCalledWith('parent@example.com', 'a long test passphrase', 'private-test-code')
    expect(authenticated).toHaveBeenCalledWith(state)
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
  })

  it('does not create an account when password confirmation differs', async () => {
    const setup = vi.spyOn(api, 'setup')
    const user = userEvent.setup()
    render(<Auth setupRequired setupCode="private-test-code" onAuthenticated={vi.fn()} />)
    await user.type(screen.getByLabelText('Parent email'), 'parent@example.com')
    await user.type(screen.getByLabelText('Password', { exact: true }), 'a long test passphrase')
    await user.type(screen.getByLabelText('Confirm password'), 'a different test passphrase')
    await user.click(screen.getByRole('button', { name: 'Create our parent account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('do not match')
    expect(setup).not.toHaveBeenCalled()
  })

  it('shows failed real-login errors without treating them as success', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new Error('The email or password is incorrect.'))
    const authenticated = vi.fn()
    const user = userEvent.setup()
    render(<Auth setupRequired={false} setupCode="" onAuthenticated={authenticated} />)
    await user.type(screen.getByLabelText('Parent email'), 'parent@example.com')
    await user.type(screen.getByLabelText('Password', { exact: true }), 'incorrect')
    await user.click(screen.getByRole('button', { name: 'Open our word collection' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('incorrect')
    expect(authenticated).not.toHaveBeenCalled()
  })

  it('clearly asks existing username accounts to adopt a parent email with their existing password', async () => {
    const state = { authenticated: true, setupRequired: false, emailMigrationRequired: false, email: 'parent@example.com' }
    const login = vi.spyOn(api, 'login').mockResolvedValue(state)
    const user = userEvent.setup()
    const authenticated = vi.fn()
    render(<Auth setupRequired={false} setupCode="" emailMigrationRequired onAuthenticated={authenticated} />)
    expect(screen.getByText(/without changing your words or progress/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Confirm password')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Parent email')).toHaveAttribute('type', 'email')
    await user.type(screen.getByLabelText('Parent email'), 'parent@example.com')
    await user.type(screen.getByLabelText('Password', { exact: true }), 'existing password')
    await user.click(screen.getByRole('button', { name: 'Set parent email and sign in' }))
    expect(login).toHaveBeenCalledWith('parent@example.com', 'existing password')
    expect(authenticated).toHaveBeenCalledWith(state)
  })
})
