import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../lib/api'
import { DataExport } from './DataExport'
import { roundStatistics, type AccountDataExport } from '../../shared/model'
import { initialLanguagePreferences } from '../../shared/languages'

const data: AccountDataExport = {
  format: 'worttrainer-account-export', schemaVersion: 2, exportedAt: '2026-10-23T00:00:00Z', languagePreferences: initialLanguagePreferences(),
  account: { id: 'account', email: 'parent@example.test' }, words: [], attempts: [], rounds: [], statistics: roundStatistics([]),
}
beforeEach(() => {
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:account-export')
    static revokeObjectURL = vi.fn()
  })
})

describe('private JSON download', () => {
  it('downloads the exported account as JSON with a dated filename', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'exportData').mockResolvedValue(data)
    const clicks: { download: string; href: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ download: this.download, href: this.href })
    })
    render(<DataExport />)
    await user.click(screen.getByRole('button', { name: 'Export my data (JSON)' }))
    expect(clicks).toEqual([{ download: 'worttrainer-2026-10-23.json', href: 'blob:account-export' }])
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'application/json;charset=utf-8' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:account-export'), { timeout: 2500 })
  })

  it('surfaces failures and allows retry without downloading an error as data', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'exportData').mockRejectedValue(new Error('Network unavailable'))
    render(<DataExport />)
    await user.click(screen.getByRole('button', { name: 'Export my data (JSON)' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not export your data: Network unavailable')
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Export my data (JSON)' })).toBeEnabled()
  })

  it('does not download private data after signing out or switching accounts', async () => {
    const user = userEvent.setup()
    let resolve: (value: AccountDataExport) => void = () => { throw new Error('Export was not started.') }
    vi.spyOn(api, 'exportData').mockReturnValue(new Promise<AccountDataExport>(done => { resolve = done }))
    const { unmount } = render(<DataExport />)
    await user.click(screen.getByRole('button', { name: 'Export my data (JSON)' }))
    expect(screen.getByRole('button', { name: 'Preparing JSON…' })).toBeDisabled()
    unmount()
    resolve(data)
    await Promise.resolve()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
})
