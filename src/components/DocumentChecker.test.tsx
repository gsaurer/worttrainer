import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initialLanguagePreferences } from '../../shared/languages'
import type { DocumentCheck } from '../../shared/model'
import { api } from '../lib/api'
import { DocumentChecker } from './DocumentChecker'

const checked: DocumentCheck = { language: 'en', text: 'A beautifull flower. Xyzzname.', wordCount: 4, limited: false, possibleMistakes: [
  { word: 'beautifull', occurrences: 1, suggestions: ['beautiful', 'beautifully'] },
  { word: 'Xyzzname', occurrences: 1, suggestions: [] },
] }
const onUpdated = vi.fn(async () => {})
function open() { return render(<DocumentChecker preferences={{ ...initialLanguagePreferences(), defaultLanguage: 'en' }} onUpdated={onUpdated} onBack={() => {}} />) }
async function upload() {
  await waitFor(() => expect(api.challengeStatus).toHaveBeenCalled())
  fireEvent.change(screen.getByLabelText('Document photo (JPEG or PNG, up to 4 MB)'), { target: { files: [new File(['photo'], 'text.jpg', { type: 'image/jpeg' })] } })
  await userEvent.click(screen.getByRole('button', { name: 'Check document' }))
}

beforeEach(() => {
  vi.spyOn(api, 'challengeStatus').mockResolvedValue({ challenges: [], ocr: { enabled: true, month: '2026-10', used: 0, limit: 450 } })
  vi.spyOn(api, 'checkDocument').mockResolvedValue(checked)
  vi.spyOn(api, 'addDocumentWords').mockResolvedValue({ added: 1, existing: 0, language: 'en' })
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test-photo'), revokeObjectURL: vi.fn() }))
  onUpdated.mockClear()
})

describe('document correction review', () => {
  it('uploads, reviews editable corrections and adds corrected words, never the original mistakes', async () => {
    const user = userEvent.setup()
    open()
    await upload()
    expect(await screen.findByRole('heading', { name: 'Possible spelling mistakes' })).toBeVisible()
    expect(api.checkDocument).toHaveBeenCalledWith('en', expect.any(File))
    expect(api.addDocumentWords).not.toHaveBeenCalled()
    const correction = screen.getByRole('combobox', { name: 'Correct spelling for beautifull' })
    expect(correction).toHaveValue('beautiful')
    await user.clear(correction)
    expect(screen.getByRole('button', { name: 'Add selected words' })).toBeDisabled()
    await user.type(correction, 'beautifully')
    await user.click(screen.getByRole('button', { name: 'Add selected words' }))
    expect(api.addDocumentWords).toHaveBeenCalledWith('en', ['beautifully'])
    expect(await screen.findByRole('status')).toHaveTextContent('1 added, 0 already in your collection.')
    expect(onUpdated).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Add selected words' })).toBeDisabled()
    expect(correction).toBeDisabled()
    await user.click(screen.getByText('Recognized text', { selector: 'summary' }))
    expect(screen.getByText(checked.text)).toBeVisible()
  })

  it('keeps unknown words unselected and supports manual spelling and select none/all', async () => {
    const user = userEvent.setup()
    open(); await upload()
    expect(await screen.findByRole('checkbox', { name: /Xyzzname/ })).not.toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: 'Select all corrections' }))
    expect(screen.getByRole('button', { name: 'Add selected words' })).toBeDisabled()
    await user.type(screen.getByRole('combobox', { name: 'Correct spelling for Xyzzname' }), 'name')
    await user.click(screen.getByRole('checkbox', { name: 'Select all corrections' }))
    await user.click(screen.getByRole('button', { name: 'Add selected words' }))
    expect(api.addDocumentWords).toHaveBeenCalledWith('en', ['beautiful', 'name'])
  })

  it('retains review on failed import and allows retry', async () => {
    vi.mocked(api.addDocumentWords).mockRejectedValueOnce(new Error('Offline'))
    open(); await upload()
    await screen.findByRole('heading', { name: 'Possible spelling mistakes' })
    await userEvent.click(screen.getByRole('button', { name: 'Add selected words' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline')
    expect(screen.getByRole('combobox', { name: 'Correct spelling for beautifull' })).toHaveValue('beautiful')
    await userEvent.click(screen.getByRole('button', { name: 'Add selected words' }))
    expect(await screen.findByRole('status')).toHaveTextContent('1 added')
  })

  it('handles clean documents and clears stale findings when switching languages', async () => {
    vi.mocked(api.checkDocument).mockResolvedValue({ ...checked, text: 'A beautiful flower.', possibleMistakes: [] })
    open(); await upload()
    expect(await screen.findByRole('status')).toHaveTextContent('No possible spelling mistakes found.')
    expect(screen.queryByRole('button', { name: 'Add selected words' })).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Document language' }), 'de')
    expect(screen.queryByRole('heading', { name: 'Possible spelling mistakes' })).not.toBeInTheDocument()
  })

  it('handles invalid photos, missing configuration and unsupported enabled languages', async () => {
    vi.mocked(api.challengeStatus).mockResolvedValue({ challenges: [], ocr: { enabled: false, month: '2026-10', used: 0, limit: 450 } })
    const view = open()
    expect(await screen.findByText(/Automatic reading needs/)).toBeVisible()
    fireEvent.change(screen.getByLabelText('Document photo (JPEG or PNG, up to 4 MB)'), { target: { files: [new File(['pdf'], 'text.pdf', { type: 'application/pdf' })] } })
    expect(screen.getByRole('alert')).toHaveTextContent('Choose one JPEG or PNG photo up to 4 MB.')
    expect(api.checkDocument).not.toHaveBeenCalled()
    view.unmount()
    render(<DocumentChecker preferences={{ enabled: ['fr'], defaultLanguage: 'fr' }} onUpdated={onUpdated} onBack={() => {}} />)
    expect(screen.getByText('Enable English or German in Languages to check a document.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Check document' })).not.toBeInTheDocument()
  })
})