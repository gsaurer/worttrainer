import { useCallback, useEffect, useRef, useState } from 'react'
import type { Language } from '../database.types'
import { languages } from '../lib/words'

export function useDictation() {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
  const [speaking, setSpeaking] = useState(false)
  const [error, setError] = useState('')
  const current = useRef<SpeechSynthesisUtterance | null>(null)

  const stop = useCallback(() => {
    current.current = null
    if (supported) window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [supported])

  useEffect(() => {
    if (!supported) return
    // Trigger voice loading before the first Listen gesture.
    window.speechSynthesis.getVoices()
    const cancelWhenHidden = () => { if (document.hidden) stop() }
    document.addEventListener('visibilitychange', cancelWhenHidden)
    return () => {
      current.current = null
      window.speechSynthesis.cancel()
      document.removeEventListener('visibilitychange', cancelWhenHidden)
    }
  }, [supported, stop])

  const speak = useCallback((word: string, language: Language) => {
    stop()
    setError('')
    if (!supported) {
      setError('Spoken dictation is not supported in this browser. Try a current Chrome, Edge, or Safari browser.')
      return
    }
    const matching = window.speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().split(/[-_]/)[0] === language)
    const voice = matching.find(v => v.localService) ?? matching[0]
    if (!voice) {
      setError(`No ${languages[language].name} voice is available yet. Enable a ${languages[language].name} speech voice in your device settings, wait a moment, then try Listen again.`)
      return
    }
    try {
      const utterance = new SpeechSynthesisUtterance(word)
      utterance.voice = voice
      utterance.lang = voice.lang || languages[language].speech
      utterance.rate = 0.8
      current.current = utterance
      utterance.onstart = () => { if (current.current === utterance) setSpeaking(true) }
      utterance.onend = () => { if (current.current === utterance) { current.current = null; setSpeaking(false) } }
      utterance.onerror = event => {
        if (current.current !== utterance) return
        current.current = null
        setSpeaking(false)
        setError(`Dictation could not play (${event.error}). Check your device audio and try Listen again.`)
      }
      window.speechSynthesis.speak(utterance)
    } catch (error) {
      current.current = null
      setSpeaking(false)
      setError(`Dictation could not start: ${error instanceof Error ? error.message : 'Please try again.'}`)
    }
  }, [stop, supported])

  return { supported, speaking, error, speak, stop }
}
