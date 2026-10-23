import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { errorMessage } from '../lib/words'
import { useI18n } from '../i18n/context'

export function DataExport() {
  const { t, message } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = useRef(true)
  const working = useRef(false)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])

  async function download() {
    if (working.current) return
    working.current = true
    setBusy(true)
    setError('')
    try {
      const data = await api.exportData()
      if (!active.current) return
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `worttrainer-${data.exportedAt.slice(0, 10)}.json`
      document.body.append(link)
      try { link.click() }
      finally {
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch (error) {
      if (active.current) setError(errorMessage(error))
    } finally {
      working.current = false
      if (active.current) setBusy(false)
    }
  }

  return <div className="data-export">
    <button className="button secondary wide" disabled={busy} onClick={() => void download()}>{t(busy ? 'Preparing JSON…' : 'Export my data (JSON)')}</button>
    <p>{t('Languages, words, and practice history. Keep the file private.')}</p>
    {error && <p className="error" role="alert">{t('Could not export your data: {error}', { error: message(error) })}</p>}
  </div>
}
