import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { initialLanguagePreferences } from '../../shared/languages'
import { LanguageSettings } from './LanguageSettings'

describe('private language configuration', () => {
  it('enables an additional language, chooses it as default, and saves one coherent configuration', async () => {
    const user = userEvent.setup()
    const save = vi.fn().mockResolvedValue(undefined)
    const saved = vi.fn()
    render(<LanguageSettings preferences={initialLanguagePreferences()} onSave={save} onSaved={saved} />)
    await user.selectOptions(screen.getByLabelText('Add a language'), 'fr')
    await user.click(screen.getByRole('button', { name: 'Enable' }))
    await user.selectOptions(screen.getByLabelText('Default language'), 'fr')
    await user.click(screen.getByRole('button', { name: 'Save languages' }))
    expect(save).toHaveBeenCalledWith({ enabled: ['de', 'en', 'fr'], defaultLanguage: 'fr' })
    expect(saved).toHaveBeenCalledOnce()
  })

  it('keeps one language enabled and moves the default when disabling its previous language', async () => {
    const user = userEvent.setup()
    const save = vi.fn().mockResolvedValue(undefined)
    render(<LanguageSettings preferences={initialLanguagePreferences()} onSave={save} onSaved={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Disable Deutsch' }))
    expect(screen.getByLabelText('Default language')).toHaveValue('en')
    expect(screen.getByRole('button', { name: 'Disable English' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Save languages' }))
    expect(save).toHaveBeenCalledWith({ enabled: ['en'], defaultLanguage: 'en' })
  })

  it('keeps unsaved edits visible on failure and lets the parent retry', async () => {
    const user = userEvent.setup()
    const save = vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce(undefined)
    const saved = vi.fn()
    render(<LanguageSettings preferences={initialLanguagePreferences()} onSave={save} onSaved={saved} />)
    await user.selectOptions(screen.getByLabelText('Add a language'), 'da')
    await user.click(screen.getByRole('button', { name: 'Enable' }))
    await user.click(screen.getByRole('button', { name: 'Save languages' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost')
    expect(saved).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Disable Dansk' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save languages' }))
    expect(saved).toHaveBeenCalledOnce()
  })
})
