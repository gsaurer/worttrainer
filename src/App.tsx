import { useEffect, useState } from 'react'
import type { AuthState } from '../shared/model'
import { api } from './lib/api'
import { errorMessage } from './lib/words'
import { useWords } from './hooks/useWords'
import { Auth } from './components/Auth'
import { Brand } from './components/Icons'
import { Collection } from './components/Collection'
import { Practice } from './components/Practice'
import { PasswordSettings } from './components/PasswordSettings'
import { DataExport } from './components/DataExport'
import { AddWord } from './components/AddWord'
import { LanguageSettings } from './components/LanguageSettings'

function removeSetupFragment() {
  const fragment = new URLSearchParams(window.location.hash.slice(1))
  const code = fragment.get('setup')
  if (code !== null) {
    fragment.delete('setup')
    const url = new URL(window.location.href)
    url.hash = fragment.toString()
    window.history.replaceState(null, '', url)
  }
}

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [error, setError] = useState('')

  async function reconnect() {
    setError('')
    try { setAuth(await api.session()) }
    catch (error) { setError(`Could not connect to the Worttrainer server: ${errorMessage(error)}`) }
  }

  useEffect(() => {
    let active = true
    removeSetupFragment()
    const expired = () => {
      setAuth({ authenticated: false, emailMigrationRequired: false, email: null })
      setError('Your session has ended. Please sign in again.')
    }
    const refresh = () => {
      void api.session().then(state => { if (active) { setAuth(state); setError('') } })
        .catch(error => { if (active) setError(`Could not connect to the server: ${errorMessage(error)}`) })
    }
    refresh()
    window.addEventListener('auth-expired', expired)
    window.addEventListener('focus', refresh)
    window.addEventListener('hashchange', removeSetupFragment)
    return () => { active = false; window.removeEventListener('auth-expired', expired); window.removeEventListener('focus', refresh); window.removeEventListener('hashchange', removeSetupFragment) }
  }, [])

  if (!auth) return <main className="loading-screen"><Brand />{error ? <><p className="error" role="alert">{error}</p><button className="button primary" onClick={() => void reconnect()}>Retry connection</button></> : <p role="status">Opening your little word collection…</p>}</main>
  if (auth.authenticated && !auth.emailMigrationRequired) return <FamilyApp key={auth.email} onSignedOut={() => setAuth({ authenticated: false, emailMigrationRequired: false, email: null })} email={auth.email ?? 'Parent'} />
  return <>{error && <div className="auth-error error" role="alert">{error}<button className="text-button" onClick={() => setError('')}>Dismiss</button></div>}<Auth emailMigrationRequired={auth.emailMigrationRequired} onAuthenticated={state => { setError(''); setAuth(state) }} /></>
}

function FamilyApp({ email, onSignedOut }: { email: string; onSignedOut: () => void }) {
  const { words, preferences, loading, error, refresh, saveLanguages } = useWords()
  const [tab, setTab] = useState<'home' | 'collection' | 'languages'>('home')
  const [practicing, setPracticing] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [authError, setAuthError] = useState('')

  async function signOut() {
    setSigningOut(true)
    setAuthError('')
    try { await api.logout(); onSignedOut() }
    catch (error) { setAuthError(`Could not sign out: ${errorMessage(error)}`) }
    finally { setSigningOut(false) }
  }

  return <div className="app-shell">
    <header className="site-header"><Brand /><div className="account"><span title={email}>{email}</span><PasswordSettings /><button className="text-button" disabled={signingOut} onClick={() => void signOut()}>{signingOut ? 'Signing out…' : 'Sign out'}</button></div></header>
    <nav className="main-nav" aria-label="Main navigation"><button aria-current={tab === 'home' ? 'page' : undefined} onClick={() => { if (tab !== 'home') { setTab('home'); setPracticing(false) } }}>Home</button><button aria-current={tab === 'collection' ? 'page' : undefined} onClick={() => { setTab('collection'); setPracticing(false) }}>Collection</button><button aria-current={tab === 'languages' ? 'page' : undefined} onClick={() => { setTab('languages'); setPracticing(false) }}>Languages</button></nav>
    <main>
      <div className="page-heading"><h1>{tab === 'home' ? 'Let’s practice' : tab === 'collection' ? 'Collection' : 'Languages'}</h1></div>
      {authError && <p className="error" role="alert">{authError}</p>}
      {error && <div className="error" role="alert">{error} <button className="text-button" disabled={loading} onClick={() => void refresh()}>Retry sync</button></div>}
      {!preferences ? !error && <p role="status">Loading your languages…</p> : tab === 'languages' ? <LanguageSettings preferences={preferences} onSave={saveLanguages} onSaved={() => setTab('home')} /> : tab === 'collection' ? <Collection words={words} loading={loading} refresh={refresh} preferences={preferences} /> : <div className="home-actions">{!practicing && <AddWord words={words} loading={loading} refresh={refresh} preferences={preferences} />}<Practice words={words} loading={loading} onUpdated={refresh} onActiveChange={setPracticing} preferences={preferences} /></div>}
    </main>
    <footer><span>Little by little is a lot.</span><DataExport /><span>Private spelling practice</span></footer>
  </div>
}
