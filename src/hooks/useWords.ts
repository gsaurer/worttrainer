import { useCallback, useEffect, useRef, useState } from 'react'
import type { Word } from '../../shared/model'
import { errorMessage } from '../lib/words'
import { api } from '../lib/api'

export function useWords() {
  const [words, setWords] = useState<Word[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requests = useRef({ generation: 0 })

  const load = useCallback(async () => {
    const request = ++requests.current.generation
    try {
      const data = await api.words()
      if (requests.current.generation === request) {
        setWords(data)
        setError('')
      }
    } catch (error) {
      if (requests.current.generation === request) setError(`Could not sync your collection: ${errorMessage(error)}`)
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

  return { words, loading, error, refresh }
}
