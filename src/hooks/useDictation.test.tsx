import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('spoken dictation', () => {
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
