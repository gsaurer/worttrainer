import { useCallback, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Word } from '../database.types'
import { errorMessage } from '../lib/words'

export function useWords(client: SupabaseClient<Database>) {
  const [words, setWords] = useState<Word[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requests = useRef({ generation: 0 })

  const load = useCallback(async () => {
    const request = ++requests.current.generation
    try {
      const data: Word[] = []
      const pageSize = 500
      for (let offset = 0; ; offset += pageSize) {
        const result = await client.from('words').select('*')
          .order('created_at', { ascending: false }).order('id', { ascending: false })
          .range(offset, offset + pageSize - 1)
        if (result.error) throw result.error
        if (requests.current.generation !== request) return
        data.push(...result.data)
        if (result.data.length < pageSize) break
      }
      if (requests.current.generation === request) {
        setWords(data)
        setError('')
      }
    } catch (error) {
      if (requests.current.generation === request) setError(`Could not sync your collection: ${errorMessage(error)}`)
    } finally {
      if (requests.current.generation === request) setLoading(false)
    }
  }, [client])

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
