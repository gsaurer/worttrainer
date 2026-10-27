import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDictation } from './useDictation'

class Utterance {
  text: string
  voice: SpeechSynthesisVoice | null = null
  lang = ''
  rate = 1
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  constructor(text: string) { this.text = text }
}

const germanVoice = { lang: 'de-DE', localService: true }
const englishVoice = { lang: 'en-GB', localService: true }
const speak = vi.fn()
const cancel = vi.fn()

beforeEach(() => {
  vi.stubGlobal('speechSynthesis', { getVoices: () => [englishVoice, germanVoice], cancel, speak })
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('spoken dictation', () => {
  it('resumes a paused speech engine so a queued word actually starts', () => {
    let paused = true
    const resume = vi.fn(() => { paused = false })
    const enqueue = vi.fn((utterance: Utterance) => { if (!paused) utterance.onstart?.() })
    vi.stubGlobal('speechSynthesis', { getVoices: () => [germanVoice], get paused() { return paused }, cancel, resume, speak: enqueue })
    const { result } = renderHook(useDictation)
    act(() => result.current.speak('Straße', 'de'))
    expect(resume).toHaveBeenCalledOnce()
    expect(result.current.speaking).toBe(true)
    expect(enqueue).toHaveBeenCalledOnce()
  })

  it('reports speech that never starts instead of leaving automatic playback running silently', () => {
    vi.useFakeTimers()
    const finished = vi.fn()
    const { result } = renderHook(useDictation)
    act(() => result.current.speak('Straße', 'de', finished))
    act(() => vi.advanceTimersByTime(5000))
    expect(finished).toHaveBeenCalledExactlyOnceWith(false)
    expect(result.current.error).toContain('audio-start-timeout')
    expect(result.current.error).not.toContain('Straße')
    expect(result.current.speaking).toBe(false)
  })

  it('does not time out a word that has started or completed successfully', () => {
    vi.useFakeTimers()
    const finished = vi.fn()
    const { result } = renderHook(useDictation)
    act(() => result.current.speak('Straße', 'de', finished))
    const utterance: Utterance = speak.mock.calls[0][0]
    act(() => utterance.onstart?.())
    act(() => vi.advanceTimersByTime(10000))
    expect(result.current.error).toBe('')
    expect(finished).not.toHaveBeenCalled()
    act(() => utterance.onend?.())
    act(() => vi.advanceTimersByTime(10000))
    expect(finished).toHaveBeenCalledExactlyOnceWith(true)
    expect(result.current.error).toBe('')
  })

  it.each(['stop', 'unmount'])('clears the speech startup timeout after %s', action => {
    vi.useFakeTimers()
    const finished = vi.fn()
    const { result, unmount } = renderHook(useDictation)
    act(() => result.current.speak('Straße', 'de', finished))
    if (action === 'stop') act(() => result.current.stop())
    else unmount()
    act(() => vi.advanceTimersByTime(10000))
    expect(finished).not.toHaveBeenCalled()
  })

  it('uses a matching additional-language voice rather than a different language', () => {
    const french = { lang: 'fr-FR', localService: true }
    vi.stubGlobal('speechSynthesis', { getVoices: () => [englishVoice, french], cancel, speak })
    const { result } = renderHook(useDictation)
    act(() => result.current.speak('papillon', 'fr'))
    expect(speak.mock.calls[0][0]).toMatchObject({ text: 'papillon', voice: french, lang: 'fr-FR' })
  })

  it('explicitly reports a missing additional-language voice without using another language', () => {
    const { result } = renderHook(useDictation)
    act(() => result.current.speak('papillon', 'fr'))
    expect(result.current.error).toContain('No Français voice')
    expect(result.current.error).not.toContain('papillon')
    expect(speak).not.toHaveBeenCalled()
  })

  it('uses a matching German voice, allows repeat, and cancels on unmount', () => {
    const { result, unmount } = renderHook(useDictation)
    act(() => result.current.speak('Straße', 'de'))
    const utterance: Utterance = speak.mock.calls[0][0]
    expect(utterance.text).toBe('Straße')
    expect(utterance.voice).toBe(germanVoice)
    expect(utterance.lang).toBe('de-DE')
    act(() => utterance.onstart?.())
    expect(result.current.speaking).toBe(true)
    act(() => result.current.speak('Straße', 'de'))
    expect(speak).toHaveBeenCalledTimes(2)
    unmount()
    expect(cancel).toHaveBeenCalled()
  })

  it('uses English and exposes playback errors without leaking the word', () => {
    const { result } = renderHook(useDictation)
    act(() => result.current.speak('beautiful', 'en'))
    const utterance: Utterance = speak.mock.calls[0][0]
    expect(utterance.voice).toBe(englishVoice)
    act(() => utterance.onerror?.({ error: 'audio-busy' }))
    expect(result.current.error).toContain('audio-busy')
    expect(result.current.error).not.toContain('beautiful')
    expect(result.current.speaking).toBe(false)
  })

  it('ignores callbacks from canceled playback', () => {
    const { result } = renderHook(useDictation)
    act(() => result.current.speak('Straße', 'de'))
    const utterance: Utterance = speak.mock.calls[0][0]
    act(() => result.current.stop())
    act(() => utterance.onerror?.({ error: 'canceled' }))
    expect(result.current.error).toBe('')
  })
})
