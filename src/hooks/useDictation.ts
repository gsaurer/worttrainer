import { useCallback, useEffect, useRef, useState } from 'react'
import type { Language } from '../../shared/model'
import { languages } from '../lib/words'
import { useI18n } from '../i18n/context'
import type { Message, Values } from '../i18n/messages'

export function useDictation() {
  const { t } = useI18n()
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
  const [speaking, setSpeaking] = useState(false)
  const [error, setError] = useState<{ key: Message; values?: Values } | null>(null)
  const current = useRef<SpeechSynthesisUtterance | null>(null)
  const startTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const stop = useCallback(() => {
    clearTimeout(startTimer.current)
    startTimer.current = undefined
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
      clearTimeout(startTimer.current)
      current.current = null
      window.speechSynthesis.cancel()
      document.removeEventListener('visibilitychange', cancelWhenHidden)
    }
  }, [supported, stop])

  const speak = useCallback((word: string, language: Language, onFinished?: (success: boolean) => void) => {
    stop()
    setError(null)
    if (!supported) {
      setError({ key: 'Spoken dictation is not supported in this browser. Try a current Chrome, Edge, or Safari browser.' })
      onFinished?.(false)
      return
    }
    const matching = window.speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().split(/[-_]/)[0] === language)
    const voice = matching.find(v => v.localService) ?? matching[0]
    if (!voice) {
      setError({ key: 'No {language} voice is available yet. Enable a {language} speech voice in your device settings, wait a moment, then try Listen again.', values: { language: languages[language].name } })
      onFinished?.(false)
      return
    }
    try {
      const utterance = new SpeechSynthesisUtterance(word)
      utterance.voice = voice
      utterance.lang = voice.lang || languages[language].speech
      utterance.rate = 0.8
      current.current = utterance
      utterance.onstart = () => { if (current.current === utterance) { clearTimeout(startTimer.current); setSpeaking(true) } }
      utterance.onend = () => { if (current.current === utterance) { clearTimeout(startTimer.current); current.current = null; setSpeaking(false); onFinished?.(true) } }
      utterance.onerror = event => {
        if (current.current !== utterance) return
        clearTimeout(startTimer.current)
        current.current = null
        setSpeaking(false)
        setError({ key: 'Dictation could not play ({error}). Check your device audio and try Listen again.', values: { error: event.error } })
        onFinished?.(false)
      }
      startTimer.current = setTimeout(() => {
        if (current.current !== utterance) return
        current.current = null
        window.speechSynthesis.cancel()
        setSpeaking(false)
        setError({ key: 'Dictation could not play ({error}). Check your device audio and try Listen again.', values: { error: 'audio-start-timeout' } })
        onFinished?.(false)
      }, 5000)
      if (window.speechSynthesis.paused) window.speechSynthesis.resume()
      window.speechSynthesis.speak(utterance)
    } catch (error) {
      clearTimeout(startTimer.current)
      current.current = null
      setSpeaking(false)
      setError(error instanceof Error ? { key: 'Dictation could not start: {error}', values: { error: error.message } } : { key: 'Dictation could not start: Please try again.' })
      onFinished?.(false)
    }
  }, [stop, supported])

  return { supported, speaking, error: error ? t(error.key, error.values) : '', speak, stop }
}
