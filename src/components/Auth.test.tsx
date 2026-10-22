import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../lib/api'
import { Auth } from './Auth'

describe('shared parent authentication', () => {
  it('creates a real server account using the private setup code, without child data', async () => {
    const state = { authenticated: true, setupRequired: false, username: 'parent' }
    const setup = vi.spyOn(api, 'setup').mockResolvedValue(state)
    const authenticated = vi.fn()
    const user = userEvent.setup()
    render(<Auth setupRequired setupCode="private-test-code" onAuthenticated={authenticated} />)
    await user.type(screen.getByLabelText('Parent username'), 'parent')
    await user.type(screen.getByLabelText('Password', { exact: true }), 'a long test passphrase')
    await user.type(screen.getByLabelText('Confirm password'), 'a long test passphrase')
    await user.click(screen.getByRole('button', { name: 'Create our parent account' }))
    expect(setup).toHaveBeenCalledWith('parent', 'a long test passphrase', 'private-test-code')
    expect(authenticated).toHaveBeenCalledWith(state)
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
  })

  it('does not create an account when password confirmation differs', async () => {
    const setup = vi.spyOn(api, 'setup')
    const user = userEvent.setup()
    render(<Auth setupRequired setupCode="private-test-code" onAuthenticated={vi.fn()} />)
    await user.type(screen.getByLabelText('Parent username'), 'parent')
    await user.type(screen.getByLabelText('Password', { exact: true }), 'a long test passphrase')
    await user.type(screen.getByLabelText('Confirm password'), 'a different test passphrase')
    await user.click(screen.getByRole('button', { name: 'Create our parent account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('do not match')
    expect(setup).not.toHaveBeenCalled()
  })

  it('shows failed real-login errors without treating them as success', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new Error('The username or password is incorrect.'))
    const authenticated = vi.fn()
    const user = userEvent.setup()
    render(<Auth setupRequired={false} setupCode="" onAuthenticated={authenticated} />)
    await user.type(screen.getByLabelText('Parent username'), 'parent')
    await user.type(screen.getByLabelText('Password', { exact: true }), 'incorrect')
    await user.click(screen.getByRole('button', { name: 'Open our word collection' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('incorrect')
    expect(authenticated).not.toHaveBeenCalled()
  })
})
