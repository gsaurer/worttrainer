import { useEffect, useState } from 'react'
import type { AuthState, Category } from '../shared/model'
import { api } from './lib/api'
import { categories, errorMessage } from './lib/words'
import { useWords } from './hooks/useWords'
import { Auth } from './components/Auth'
import { Brand } from './components/Icons'
import { Collection } from './components/Collection'
import { Practice } from './components/Practice'
import { PasswordSettings } from './components/PasswordSettings'

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
  const { words, loading, error, refresh } = useWords()
  const [tab, setTab] = useState<'collection' | 'practice'>('collection')
  const [category, setCategory] = useState<Category | 'all'>('all')
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
    <nav className="main-nav" aria-label="Main navigation"><button aria-current={tab === 'collection' ? 'page' : undefined} onClick={() => setTab('collection')}>Word collection</button><button aria-current={tab === 'practice' ? 'page' : undefined} onClick={() => setTab('practice')}>Let’s practice <span aria-hidden="true">↗</span></button><span className="nav-note">a little, often.</span></nav>
    <main>
      <div className="page-heading"><div><p className="eyebrow">THE LITTLE WORD WORKSHOP</p><h1>{tab === 'collection' ? <>Small steps.<br /><em>Stronger spelling.</em></> : <>A little practice.<br /><em>A little progress.</em></>}</h1></div><p>For the words that need<br />a second hello.</p></div>
      {authError && <p className="error" role="alert">{authError}</p>}
      {error && <div className="error" role="alert">{error} <button className="text-button" disabled={loading} onClick={() => void refresh()}>Retry sync</button></div>}
      {tab === 'collection' && <section className="category-grid" aria-label="Word categories">{(Object.keys(categories) as Category[]).map(key => <button key={key} className={`category-card ${key} ${category === key ? 'active' : ''}`} aria-pressed={category === key} onClick={() => setCategory(category === key ? 'all' : key)}><span className="category-sign">{categories[key].label}</span><span className="category-copy"><strong>{key === 'new' ? 'New beginnings' : key === 'plus' ? 'Finding their feet' : 'Worth another try'}</strong><span>{categories[key].description}</span></span><span className="category-count">{words.filter(w => w.category === key).length}</span></button>)}</section>}
      {tab === 'collection' ? <Collection words={words} loading={loading} category={category} onCategory={setCategory} refresh={refresh} onPractice={() => setTab('practice')} /> : <Practice words={words} loading={loading} onUpdated={refresh} />}
    </main>
    <footer><span>Little by little is a lot.</span><span>Deutsch & English · Made for learning together</span></footer>
  </div>
}
