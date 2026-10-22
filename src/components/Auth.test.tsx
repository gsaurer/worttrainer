import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../database.types'
import { Auth } from './Auth'

describe('parent authentication', () => {
  it('shows honest setup state with no pretend login', () => {
    render(<Auth client={null} configured={false} />)
    expect(screen.getByText(/local preview · connection needed/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /email me/i })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: /parent’s email/i })).toBeDisabled()
  })

  it('requests a real Supabase magic link without collecting child data', async () => {
    const client = createClient<Database>('https://example.supabase.co', 'public-test-key', { auth: { persistSession: false } })
    const sendLink = vi.spyOn(client.auth, 'signInWithOtp').mockResolvedValue({ data: { user: null, session: null }, error: null })
    const user = userEvent.setup()
    render(<Auth client={client} />)
    await user.type(screen.getByRole('textbox', { name: /parent’s email/i }), 'parent@example.com')
    await user.click(screen.getByRole('button', { name: /email me/i }))
    expect(sendLink).toHaveBeenCalledWith({ email: 'parent@example.com', options: { emailRedirectTo: window.location.origin } })
    expect(await screen.findByRole('status')).toHaveTextContent('same browser')
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
  })
})
