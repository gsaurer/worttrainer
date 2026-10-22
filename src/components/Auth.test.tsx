import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../lib/api'
import { Auth } from './Auth'

describe('private parent authentication', () => {
  it('registers without any token, invitation, or child data', async () => {
    const state = { authenticated: true, emailMigrationRequired: false, email: 'parent@example.com' }
    const signup = vi.spyOn(api, 'signup').mockResolvedValue(state)
    const authenticated = vi.fn()
    const user = userEvent.setup()
    render(<Auth onAuthenticated={authenticated} />)
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await user.type(screen.getByLabelText('Parent email'), 'parent@example.com')
    await user.type(screen.getByLabelText('Password', { exact: true }), 'a long test passphrase')
    await user.type(screen.getByLabelText('Confirm password'), 'a long test passphrase')
    await user.click(screen.getByRole('button', { name: 'Create my account' }))
    expect(signup).toHaveBeenCalledWith('parent@example.com', 'a long test passphrase')
    expect(screen.queryByLabelText('One-time setup code')).not.toBeInTheDocument()
    expect(authenticated).toHaveBeenCalledWith(state)
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
  })

  it('does not create an account when password confirmation differs', async () => {
    const signup = vi.spyOn(api, 'signup')
    const user = userEvent.setup()
    render(<Auth onAuthenticated={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await user.type(screen.getByLabelText('Parent email'), 'parent@example.com')
    await user.type(screen.getByLabelText('Password', { exact: true }), 'a long test passphrase')
    await user.type(screen.getByLabelText('Confirm password'), 'a different test passphrase')
    await user.click(screen.getByRole('button', { name: 'Create my account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('do not match')
    expect(signup).not.toHaveBeenCalled()
  })

  it('shows failed real-login errors without treating them as success', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new Error('The email or password is incorrect.'))
    const authenticated = vi.fn()
    const user = userEvent.setup()
    render(<Auth onAuthenticated={authenticated} />)
    await user.type(screen.getByLabelText('Parent email'), 'parent@example.com')
    await user.type(screen.getByLabelText('Password', { exact: true }), 'incorrect')
    await user.click(screen.getByRole('button', { name: 'Open our word collection' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('incorrect')
    expect(authenticated).not.toHaveBeenCalled()
  })

  it('clearly asks existing username accounts to adopt a parent email with their existing password', async () => {
    const state = { authenticated: true, emailMigrationRequired: false, email: 'parent@example.com' }
    const login = vi.spyOn(api, 'login').mockResolvedValue(state)
    const user = userEvent.setup()
    const authenticated = vi.fn()
    render(<Auth emailMigrationRequired onAuthenticated={authenticated} />)
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
