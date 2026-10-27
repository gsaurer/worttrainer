import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConnectedApps, OAuthConsent } from './ConnectedApps'
import { api } from '../lib/api'
import { I18nProvider } from '../i18n/I18n'

const details = { clientName: 'ChatGPT', clientOrigin: 'https://chatgpt.com', accountEmail: 'parent@example.test', scopes: ['words:read', 'words:write'] as const }
const connection = { id: 'connection-id', clientName: 'Claude', clientOrigin: 'https://claude.ai', createdAt: '2026-10-26T09:00:00Z', scopes: ['words:read' as const] }

describe('OAuth consent and connected apps', () => {
  it('shows the actual account, callback website and permissions and waits for explicit approval', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'connectionRequest').mockResolvedValue({ ...details, scopes: [...details.scopes] })
    const decide = vi.spyOn(api, 'decideConnection').mockResolvedValue({ redirect: 'https://chatgpt.com/callback?code=test' })
    const complete = vi.fn()
    render(<I18nProvider language="en"><OAuthConsent requestId="pending-id" onComplete={complete} onSwitchAccount={vi.fn()} /></I18nProvider>)
    expect(await screen.findByText(details.accountEmail)).toBeVisible()
    expect(screen.getByText(details.clientOrigin)).toBeVisible()
    expect(screen.getByText('Read your words and progress')).toBeVisible()
    expect(screen.getByText('Add words to your collection')).toBeVisible()
    expect(decide).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(complete).toHaveBeenCalledWith('https://chatgpt.com/callback?code=test'))
    expect(decide).toHaveBeenCalledWith('pending-id', true)
  })

  it('declines without granting permission and keeps failed consent retryable', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'connectionRequest').mockResolvedValue({ ...details, scopes: [...details.scopes] })
    const decide = vi.spyOn(api, 'decideConnection').mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue({ redirect: 'https://chatgpt.com/callback?error=access_denied' })
    const complete = vi.fn()
    render(<I18nProvider language="en"><OAuthConsent requestId="pending-id" onComplete={complete} onSwitchAccount={vi.fn()} /></I18nProvider>)
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost')
    expect(complete).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(complete).toHaveBeenCalledOnce())
    expect(decide).toHaveBeenLastCalledWith('pending-id', false)
  })

  it('does not navigate a stale approval after the consent screen unmounts', async () => {
    vi.spyOn(api, 'connectionRequest').mockResolvedValue({ ...details, scopes: [...details.scopes] })
    let finish!: (result: { redirect: string }) => void
    vi.spyOn(api, 'decideConnection').mockReturnValue(new Promise(resolve => { finish = resolve }))
    const complete = vi.fn()
    const view = render(<I18nProvider language="en"><OAuthConsent requestId="pending-id" onComplete={complete} onSwitchAccount={vi.fn()} /></I18nProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    view.unmount()
    await act(async () => { finish({ redirect: 'https://chatgpt.com/callback?code=stale' }) })
    expect(complete).not.toHaveBeenCalled()
  })

  it.each([
    { language: 'en' as const, trigger: 'Disconnect Claude', label: 'Disconnect', confirm: 'Yes, disconnect', keep: 'Keep connected' },
    { language: 'de' as const, trigger: 'Claude trennen', label: 'Trennen', confirm: 'Ja, trennen', keep: 'Verbunden lassen' },
  ])('offers clear disconnect and keep actions in $language and retains failed connections for retry', async ({ language, trigger, label, confirm, keep }) => {
    const user = userEvent.setup()
    vi.spyOn(api, 'connectedApps').mockResolvedValue({ endpoint: 'https://words.example.test/api/mcp', connections: [connection] })
    const disconnect = vi.spyOn(api, 'disconnectApp').mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue(undefined)
    render(<I18nProvider language={language}><ConnectedApps /></I18nProvider>)
    const button = await screen.findByRole('button', { name: trigger })
    expect(button).toHaveTextContent(label)
    await user.click(button)
    expect(screen.getByRole('button', { name: confirm })).toHaveClass('button', 'danger')
    expect(screen.getByRole('button', { name: keep })).toHaveClass('button', 'secondary')
    expect(disconnect).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: keep }))
    expect(screen.queryByRole('button', { name: confirm })).not.toBeInTheDocument()
    expect(disconnect).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: trigger }))
    await user.click(screen.getByRole('button', { name: confirm }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost')
    expect(screen.getByText('Claude', { selector: 'strong' })).toBeVisible()
    expect(screen.getByRole('button', { name: confirm })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: confirm }))
    await waitFor(() => expect(screen.queryByText('Claude', { selector: 'strong' })).not.toBeInTheDocument())
    expect(disconnect).toHaveBeenCalledTimes(2)
    expect(disconnect).toHaveBeenLastCalledWith(connection.id)
  })

  it('copies the server-provided address and offers both web connector settings', async () => {
    const user = userEvent.setup()
    const copy = vi.spyOn(navigator.clipboard, 'writeText')
    vi.spyOn(api, 'connectedApps').mockResolvedValue({ endpoint: 'http://localhost:5182/api/mcp', connections: [] })
    render(<I18nProvider language="en"><ConnectedApps /></I18nProvider>)
    expect(await screen.findByLabelText('MCP address')).toHaveValue('http://localhost:5182/api/mcp')
    await user.click(screen.getByRole('button', { name: 'Copy MCP address' }))
    await waitFor(() => expect(copy).toHaveBeenCalledWith('http://localhost:5182/api/mcp'))
    expect(screen.getByText('Web connections require a public HTTPS address.')).toBeVisible()
    expect(screen.getByRole('link', { name: /ChatGPT/ })).toHaveAttribute('href', 'https://chatgpt.com/plugins')
    expect(screen.getByRole('link', { name: /Claude/ })).toHaveAttribute('href', 'https://claude.ai/customize/connectors')
  })

  it('loads consent in German and never offers approval for an expired request', async () => {
    vi.spyOn(api, 'connectionRequest').mockRejectedValue(new Error('The connection request expired. Start again from your chat app.'))
    render(<I18nProvider language="de"><OAuthConsent requestId="expired" onComplete={vi.fn()} onSwitchAccount={vi.fn()} /></I18nProvider>)
    expect(await screen.findByRole('alert')).toHaveTextContent('Die Verbindungsanfrage ist abgelaufen.')
    expect(screen.queryByRole('button', { name: 'Verbinden' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Zurück zum Worttrainer' })).toHaveAttribute('href', '/')
  })
})