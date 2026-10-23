import { useCallback, useEffect, useRef, useState } from 'react'
import type { LanguagePreferences, Word } from '../../shared/model'
import { errorMessage } from '../lib/words'
import { api } from '../lib/api'
import { useI18n } from '../i18n/context'

export function useWords() {
  const { t, message } = useI18n()
  const [words, setWords] = useState<Word[]>([])
  const [preferences, setPreferences] = useState<LanguagePreferences | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requests = useRef({ generation: 0 })

  const load = useCallback(async () => {
    const request = ++requests.current.generation
    try {
      const [data, languages] = await Promise.all([api.words(), api.languagePreferences()])
      if (requests.current.generation === request) {
        setWords(data)
        setPreferences(languages)
        setError('')
      }
    } catch (error) {
      if (requests.current.generation === request) setError(errorMessage(error))
    } finally {
      if (requests.current.generation === request) setLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    await load()
  }, [load])

  useEffect(() => {
    const requestState = requests.current
    const refreshVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Start the initial async server fetch; state updates after it settles.
    void load()
    window.addEventListener('focus', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
    const timer = window.setInterval(refreshVisible, 30_000)
    return () => {
      requestState.generation++
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshVisible)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [load, refresh])

  const saveLanguages = useCallback(async (preferences: LanguagePreferences) => {
    const saved = await api.saveLanguagePreferences(preferences)
    requests.current.generation++
    setPreferences(saved)
    setLoading(false)
    setError('')
  }, [])

  return { words, preferences, loading, error: error ? t('Could not sync your account: {error}', { error: message(error) }) : '', refresh, saveLanguages }
}
