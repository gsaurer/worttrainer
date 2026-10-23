import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AddedWordList, Challenge, Word } from '../../shared/model'
import { api } from '../lib/api'
import { Practice } from './Practice'
import { I18nProvider } from '../i18n/I18n'

const word: Word = { id: '11111111-1111-4111-8111-111111111111', text: 'Schmetterling', language: 'de', category: 'new', consecutive_mistakes: 0, created_at: '2026-10-22T12:00:00Z', last_practiced_at: null }
const list: AddedWordList = { resourceId: 'school', title: 'School list', language: 'de', sectionIds: ['animals'], wordIds: [word.id] }
const challenge: Challenge = { id: '22222222-2222-4222-8222-222222222222', startedAt: word.created_at, writtenAt: null, reviewedAt: null, nextIndex: 0, words: [{ id: word.id, text: word.text, language: word.language, attemptId: '33333333-3333-4333-8333-333333333333' }], recognition: null, results: null, telemetry: [], check: null, photo: null }
beforeEach(() => {
  vi.stubGlobal('speechSynthesis', { getVoices: () => [], cancel: vi.fn(), speak: vi.fn() })
  vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; constructor(text: string) { this.text = text } })
  vi.spyOn(api, 'challengeStatus').mockResolvedValue({ challenges: [], ocr: { enabled: false, month: '2026-10', used: 0, limit: 450 } })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('whole-challenge dictation', () => {
  it('hides the source picker without an added list containing available words', async () => {
    const { rerender } = render(<Practice words={[word]} loading={false} onUpdated={vi.fn()} />)
    await screen.findByRole('button', { name: 'Start 15 words' })
    expect(screen.queryByRole('combobox', { name: 'Practice from' })).not.toBeInTheDocument()
    rerender(<Practice words={[word]} wordLists={[{ ...list, wordIds: ['deleted-word'] }, { ...list, resourceId: 'disabled', language: 'fr' }]} loading={false} onUpdated={vi.fn()} />)
    expect(screen.queryByRole('combobox', { name: 'Practice from' })).not.toBeInTheDocument()
  })

  it.each(['all', 'minus'])('uses only the selected list and the %s category in the existing ready/start flow', async category => {
    const user = userEvent.setup()
    const difficult: Word = { ...word, id: 'difficult', text: 'Straße', category: 'minus', consecutive_mistakes: 2 }
    const unrelated: Word = { ...word, id: 'unrelated', text: 'Fenster' }
    const create = vi.spyOn(api, 'createChallenge').mockResolvedValue(challenge)
    render(<Practice words={[word, difficult, unrelated]} wordLists={[{ ...list, wordIds: [word.id, difficult.id, 'deleted-word'] }]} loading={false} onUpdated={vi.fn()} />)
    const source = screen.getByRole('combobox', { name: 'Practice from' })
    expect(source).toHaveValue('')
    expect(within(source).getAllByRole('option').map(option => option.textContent)).toEqual(['All my words', 'School list · 2 words'])
    expect(screen.getByText('Deutsch · All categories · 3 available')).toBeVisible()
    await user.selectOptions(source, list.resourceId)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), category)
    await user.click(await screen.findByRole('button', { name: 'Start 15 words' }))
    expect(screen.getByRole('heading', { name: 'Ready to write?' })).toBeVisible()
    expect(create).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    const expected = category === 'all' ? [word.id, difficult.id] : [difficult.id]
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith(expect.arrayContaining(expected))
    expect(create.mock.calls[0][0]).toHaveLength(expected.length)
  })

  it('selects the list language and falls back to all words on language changes or disablement', async () => {
    const user = userEvent.setup()
    const english: Word = { ...word, id: 'english-word', text: 'book', language: 'en' }
    const lists: AddedWordList[] = [list, { ...list, resourceId: 'english', title: 'English list', language: 'en', wordIds: [english.id] }, { ...list, resourceId: 'french', title: 'Disabled list', language: 'fr' }]
    const { rerender } = render(<Practice words={[word, english]} wordLists={lists} loading={false} onUpdated={vi.fn()} />)
    const source = screen.getByRole('combobox', { name: 'Practice from' })
    expect(within(source).queryByRole('option', { name: /Disabled list/ })).not.toBeInTheDocument()
    await user.selectOptions(source, 'english')
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveValue('en')
    expect(screen.getByText('English · All categories · English list · 1 available')).toBeVisible()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'de')
    expect(source).toHaveValue('')
    await user.selectOptions(source, 'english')
    rerender(<Practice words={[word, english]} wordLists={lists} loading={false} onUpdated={vi.fn()} preferences={{ enabled: ['de'], defaultLanguage: 'de' }} />)
    expect(source).toHaveValue('')
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveValue('de')
    expect(within(source).queryByRole('option', { name: /English list/ })).not.toBeInTheDocument()
  })

  it('translates the source picker and word counts for the German website', async () => {
    render(<I18nProvider language="de"><Practice words={[word]} wordLists={[list]} loading={false} onUpdated={vi.fn()} /></I18nProvider>)
    const source = screen.getByRole('combobox', { name: 'Üben mit' })
    expect(within(source).getAllByRole('option').map(option => option.textContent)).toEqual(['Alle meine Wörter', 'School list · 1 Wort'])
    await act(async () => {})
  })

  it('automatically speaks words, waits the configured interval after speech, and stops without advancing', async () => {
    vi.useFakeTimers()
    const spoken: { text: string; onend: () => void }[] = []
    vi.stubGlobal('speechSynthesis', { getVoices: () => [{ lang: 'de-DE', localService: true }], cancel: vi.fn(), speak: (utterance: { text: string; onend: () => void }) => spoken.push(utterance) })
    const saved = { ...challenge, words: [...challenge.words, { ...challenge.words[0], id: 'second-word', text: 'Straße' }] }
    vi.spyOn(api, 'createChallenge').mockResolvedValue(saved)
    const advance = vi.spyOn(api, 'advanceChallenge').mockImplementation(async (_id, nextIndex) => ({ ...saved, nextIndex }))
    render(<Practice words={[word]} loading={false} onUpdated={vi.fn()} />)
    await act(async () => {})
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start 10 words' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start' })) })
    const interval = screen.getByRole('combobox', { name: 'Seconds between words' })
    await act(async () => { fireEvent.change(interval, { target: { value: '3' } }) })
    const firstSpeech = spoken[spoken.length - 1]
    expect(firstSpeech.text).toBe(word.text)
    await act(async () => { vi.advanceTimersByTime(10000) })
    expect(advance).not.toHaveBeenCalled()
    act(() => firstSpeech.onend())
    await act(async () => { vi.advanceTimersByTime(2999) })
    expect(advance).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(advance).toHaveBeenCalledWith(challenge.id, 1, expect.objectContaining({ intervalSeconds: 3, automatic: true, elapsedMs: 13000, action: 'next' }))
    expect(spoken[spoken.length - 1].text).toBe('Straße')
    act(() => spoken[spoken.length - 1].onend())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop' })) })
    const count = advance.mock.calls.length
    await act(async () => { vi.advanceTimersByTime(10000) })
    expect(advance).toHaveBeenCalledTimes(count)
    expect(screen.getByRole('button', { name: 'Play automatically' })).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Previous word' })) })
    expect(advance).toHaveBeenLastCalledWith(challenge.id, 0, expect.objectContaining({ automatic: false, action: 'previous' }))
    expect(screen.getByRole('heading', { name: 'Listen and write the word.' })).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(word.text)
  })

  it('finishes without revealing answers, closes unchecked, and saves a later manual check with a misspelling', async () => {
    const user = userEvent.setup()
    const finished = { ...challenge, nextIndex: 1, writtenAt: '2026-10-23T10:00:00Z' }
    vi.spyOn(api, 'createChallenge').mockResolvedValue(challenge)
    vi.spyOn(api, 'advanceChallenge').mockResolvedValue(finished)
    const review = vi.spyOn(api, 'reviewChallenge').mockResolvedValue({ ...finished, results: [false], reviewedAt: finished.writtenAt, check: { method: 'manual', spellings: ['Schmeterling'], evaluatedAt: finished.writtenAt } })
    render(<Practice words={[word]} loading={false} onUpdated={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Start 10 words' }))
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await user.click(screen.getByRole('button', { name: 'Finish challenge' }))
    expect(screen.getByRole('heading', { name: 'Challenge finished.' })).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(word.text)
    expect(screen.getByRole('button', { name: 'Auto check' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Manual check' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Correct' })).not.toBeInTheDocument()
    expect(review).not.toHaveBeenCalled()
    vi.mocked(api.challengeStatus).mockResolvedValue({ challenges: [finished], ocr: { enabled: false, month: '2026-10', used: 0, limit: 450 } })
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(await screen.findByRole('button', { name: 'Manual check' }))
    expect(screen.getByText(word.text)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm all 1 results' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Incorrect' }))
    await user.type(screen.getByLabelText('Written spelling (optional)'), 'Schmeterling')
    await user.click(screen.getByRole('button', { name: 'Confirm all 1 results' }))
    expect(review).toHaveBeenCalledWith(challenge.id, [false], { method: 'manual', spellings: ['Schmeterling'] })
    expect(await screen.findByText('Written spelling:')).toBeInTheDocument()
    expect(screen.getByText('Schmeterling')).toBeInTheDocument()
    expect(screen.getByText(/Check evaluated/)).toBeInTheDocument()
  })

  it('starts photo checking from history and preserves recognized mistakes and the retained photo', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:sheet'; static revokeObjectURL = vi.fn() })
    const timestamp = '2026-10-23T10:00:00Z'
    const finished = { ...challenge, nextIndex: 1, writtenAt: timestamp }
    const recognized: Challenge = { ...finished, recognition: { answers: [{ number: 1, text: 'Schmeterling', confidence: 0.95 }], warnings: [] }, photo: { dataUrl: 'data:image/jpeg;base64,aGVsbG8=', uploadedAt: timestamp, evaluatedAt: timestamp } }
    vi.spyOn(api, 'challengeStatus').mockResolvedValue({ challenges: [finished], ocr: { enabled: true, month: '2026-10', used: 0, limit: 450 } })
    const read = vi.spyOn(api, 'readPhoto').mockResolvedValue(recognized)
    const review = vi.spyOn(api, 'reviewChallenge').mockResolvedValue({ ...recognized, reviewedAt: timestamp, results: [false], check: { method: 'photo', spellings: ['Schmeterling'], evaluatedAt: timestamp } })
    render(<Practice words={[word]} loading={false} onUpdated={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Auto check' }))
    expect(document.body).not.toHaveTextContent(word.text)
    const image = new File(['photo'], 'answers.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('One photo of your answers (JPEG or PNG, up to 4 MB)'), image)
    await user.click(screen.getByRole('button', { name: 'Send photo to Azure for reading' }))
    expect(read).toHaveBeenCalledWith(challenge.id, image)
    expect(screen.getByRole('button', { name: 'Incorrect' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Written spelling (optional)')).toHaveValue('Schmeterling')
    await user.click(screen.getByRole('button', { name: 'Confirm all 1 results' }))
    expect(review).toHaveBeenCalledWith(challenge.id, [false], { method: 'photo', spellings: ['Schmeterling'] })
    await user.click(screen.getByText('Challenge details', { selector: 'summary' }))
    expect(screen.getByText(/Photo evaluated/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Selected answer sheet for parent checking' })).toBeInTheDocument()
  })

  it('starts in the account default language and excludes disabled languages from new challenges', async () => {
    const user = userEvent.setup()
    const french: Word = { ...word, id: 'french', text: 'papillon', language: 'fr' }
    const create = vi.spyOn(api, 'createChallenge').mockResolvedValue({ ...challenge, words: [{ ...challenge.words[0], id: french.id, text: french.text, language: 'fr' }] })
    render(<Practice words={[word, french]} loading={false} onUpdated={vi.fn()} preferences={{ enabled: ['fr'], defaultLanguage: 'fr' }} />)
    expect(screen.getByText('Français · All categories · 1 available')).toBeInTheDocument()
    expect(screen.getByLabelText('Language')).toHaveValue('fr')
    expect(screen.getByRole('option', { name: 'Français' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Deutsch' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start 10 words' }))
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(create).toHaveBeenCalledWith([french.id])
    expect(document.body).not.toHaveTextContent('papillon')
  })

  it('persists a filtered challenge before dictation and never offers immediate marking', async () => {
    const user = userEvent.setup()
    const create = vi.spyOn(api, 'createChallenge').mockResolvedValue(challenge)
    const english: Word = { ...word, id: '44444444-4444-4444-8444-444444444444', text: 'butterfly', language: 'en' }
    render(<Practice words={[word, english]} loading={false} onUpdated={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Start 10 words' }))
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(create).toHaveBeenCalledWith([word.id])
    expect(document.body).not.toHaveTextContent(word.text)
    expect(screen.queryByRole('button', { name: /reveal|spelled correctly/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Listen and write the word.' })).toBeInTheDocument()
  })

  it('reports missing voices without exposing the word', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'createChallenge').mockResolvedValue(challenge)
    render(<Practice words={[word]} loading={false} onUpdated={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Start 10 words' }))
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await user.click(screen.getByRole('button', { name: /listen to the hidden/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No Deutsch voice')
    expect(document.body).not.toHaveTextContent(word.text)
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled()
  })

  it('disables empty challenges and offers a direct ten-word start for large collections', async () => {
    const user = userEvent.setup()
    const create = vi.spyOn(api, 'createChallenge').mockResolvedValue(challenge)
    const { rerender } = render(<Practice words={[]} loading={false} onUpdated={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'Start 10 words' })).toBeDisabled()
    rerender(<Practice words={Array.from({ length: 101 }, (_, index) => ({ ...word, id: String(index) }))} loading={false} onUpdated={vi.fn()} />)
    expect(screen.queryByLabelText('How many words?')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start 10 words' }))
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0][0]).toHaveLength(10)
    expect(new Set(create.mock.calls[0][0]).size).toBe(10)
  })

  it.each([10, 15, 20])('selects exactly %i distinct words from the chosen language and category', async size => {
    const user = userEvent.setup()
    const candidates = Array.from({ length: 30 }, (_, index) => ({ ...word, id: `eligible-${index}`, text: `Word-${index}` }))
    const excluded: Word[] = [
      { ...word, id: 'other-language', language: 'en' },
      { ...word, id: 'other-category', category: 'plus' },
    ]
    const create = vi.spyOn(api, 'createChallenge').mockResolvedValue(challenge)
    render(<Practice words={[...candidates, ...excluded]} loading={false} onUpdated={vi.fn()} />)
    expect(screen.getByLabelText('Language')).toBeVisible()
    await user.selectOptions(screen.getByLabelText('Category'), 'new')
    await user.click(screen.getByRole('button', { name: `Start ${size} words` }))
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(create).toHaveBeenCalledOnce()
    const selected = create.mock.calls[0][0]
    expect(selected).toHaveLength(size)
    expect(new Set(selected).size).toBe(size)
    expect(selected.every(id => candidates.some(candidate => candidate.id === id))).toBe(true)
  })

  it.each([10, 15, 20])('keeps all three choices visible and caps the %i-word choice at the available eight words', async size => {
    const user = userEvent.setup()
    const create = vi.spyOn(api, 'createChallenge').mockResolvedValue(challenge)
    const available = Array.from({ length: 8 }, (_, index) => ({ ...word, id: `available-${index}` }))
    render(<Practice words={available} loading={false} onUpdated={vi.fn()} />)
    const actions = screen.getByRole('group', { name: 'Start a challenge' })
    expect(within(actions).getAllByRole('button')).toHaveLength(3)
    expect(within(actions).getAllByText('words')).toHaveLength(3)
    const start = within(actions).getByRole('button', { name: `Start ${size} words` })
    expect(start).toHaveAccessibleDescription('Uses up to 8 available words, without repeats.')
    await user.click(start)
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(create.mock.calls[0][0].sort()).toEqual(available.map(item => item.id).sort())
  })

  it('keeps the challenge visible for collections between presets and uses all available words', async () => {
    const user = userEvent.setup()
    const create = vi.spyOn(api, 'createChallenge').mockResolvedValue(challenge)
    render(<Practice words={Array.from({ length: 12 }, (_, index) => ({ ...word, id: `available-${index}` }))} loading={false} onUpdated={vi.fn()} />)
    const actions = screen.getByRole('group', { name: 'Start a challenge' })
    expect(within(actions).getAllByRole('button')).toHaveLength(3)
    await user.click(within(actions).getByRole('button', { name: 'Start 20 words' }))
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(create.mock.calls[0][0]).toHaveLength(12)
    expect(new Set(create.mock.calls[0][0]).size).toBe(12)
  })

  it('changes the visible selection and start actions when another language is chosen', async () => {
    const user = userEvent.setup()
    const create = vi.spyOn(api, 'createChallenge').mockResolvedValue(challenge)
    const english: Word = { ...word, id: 'english', text: 'butterfly', language: 'en' }
    render(<Practice words={[word, english]} loading={false} onUpdated={vi.fn()} />)
    await user.selectOptions(screen.getByLabelText('Language'), 'en')
    expect(screen.getByText('English · All categories · 1 available')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start 10 words' }))
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(create).toHaveBeenCalledWith([english.id])
  })

  it('resumes the saved length rather than applying a current start size', async () => {
    const user = userEvent.setup()
    const saved = { ...challenge, words: Array.from({ length: 25 }, (_, index) => ({ ...challenge.words[0], id: `saved-${index}`, attemptId: `saved-attempt-${index}` })) }
    vi.spyOn(api, 'challengeStatus').mockResolvedValue({ challenges: [saved], ocr: { enabled: false, month: '2026-10', used: 0, limit: 450 } })
    const create = vi.spyOn(api, 'createChallenge')
    render(<Practice words={[word]} loading={false} onUpdated={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Start 10 words' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Continue challenge' }))
    expect(screen.getByRole('progressbar', { name: 'Answers written' })).toHaveAttribute('max', '25')
    expect(create).not.toHaveBeenCalled()
  })
})
