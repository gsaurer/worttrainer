import { useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { errorMessage } from '../lib/words'

export function PasswordSettings() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api.changePassword(current, next)
      setCurrent('')
      setNext('')
      setNotice('Password changed. Other devices have been signed out.')
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return <details className="password-settings"><summary>Change password</summary><form onSubmit={submit}>
    <label htmlFor="current-password">Current password</label><input id="current-password" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required maxLength={128} disabled={busy} />
    <label htmlFor="next-password">New password</label><input id="next-password" type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} required minLength={12} maxLength={128} disabled={busy} />
    <button className="button secondary" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
  </form>{error && <p className="error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}</details>
}
