import { useEffect, useState } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import type { Category, Database } from './database.types'
import { supabase } from './lib/supabase'
import { categories, errorMessage } from './lib/words'
import { useWords } from './hooks/useWords'
import { Auth } from './components/Auth'
import { Brand } from './components/Icons'
import { Collection } from './components/Collection'
import { Practice } from './components/Practice'

export default function App() {
  if (!supabase) return <Auth client={null} configured={false} />
  return <AuthenticatedApp client={supabase} />
}

function AuthenticatedApp({ client }: { client: SupabaseClient<Database> }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    let authEventReceived = false
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (active && event !== 'INITIAL_SESSION') {
        authEventReceived = true
        setSession(session)
      }
    })
    async function initialize() {
      try {
        const params = new URLSearchParams(window.location.search)
        const fragment = new URLSearchParams(window.location.hash.slice(1))
        const code = params.get('code')
        const redirectError = params.get('error_description') ?? fragment.get('error_description') ??
          params.get('error') ?? fragment.get('error')
        const unexpectedToken = fragment.has('access_token')
        if (code || redirectError || unexpectedToken) {
          const cleanUrl = new URL(window.location.href)
          for (const name of ['code', 'error', 'error_code', 'error_description']) cleanUrl.searchParams.delete(name)
          for (const name of ['access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type', 'type', 'error', 'error_code', 'error_description']) fragment.delete(name)
          cleanUrl.hash = fragment.toString()
          window.history.replaceState(null, '', cleanUrl)
        }
        if (redirectError) throw new Error(redirectError)
        if (unexpectedToken) throw new Error('This link uses an unsupported sign-in flow.')
        const { data, error } = code
          ? await client.auth.exchangeCodeForSession(code)
          : await client.auth.getSession()
        if (error) throw error
        if (active && !authEventReceived) setSession(data.session)
      } catch (error) {
        if (active) setError(`Could not sign in: ${errorMessage(error)} Request a fresh link and open it in the same browser where you requested it.`)
      } finally {
        if (active) setLoading(false)
      }
    }
    void initialize()
    return () => { active = false; subscription.unsubscribe() }
  }, [client])

  if (loading) return <main className="loading-screen" role="status"><Brand /><p>Opening your little word collection…</p></main>
  if (session) return <FamilyApp key={session.user.id} client={client} session={session} />
  return <>{error && <div className="auth-error error" role="alert">{error}<button className="text-button" onClick={() => setError('')}>Dismiss</button></div>}<Auth client={client} /></>
}

function FamilyApp({ client, session }: { client: SupabaseClient<Database>; session: Session }) {
  const { words, loading, error, refresh } = useWords(client)
  const [tab, setTab] = useState<'collection' | 'practice'>('collection')
  const [category, setCategory] = useState<Category | 'all'>('all')
  const [signingOut, setSigningOut] = useState(false)
  const [authError, setAuthError] = useState('')

  async function signOut() {
    setSigningOut(true)
    setAuthError('')
    try {
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error) throw error
    } catch (error) {
      setAuthError(`Could not sign out: ${errorMessage(error)}`)
    } finally {
      setSigningOut(false)
    }
  }

  return <div className="app-shell">
    <header className="site-header"><Brand /><div className="account"><span title={session.user.email}>{session.user.email}</span><button className="text-button" disabled={signingOut} onClick={() => void signOut()}>{signingOut ? 'Signing out…' : 'Sign out'}</button></div></header>
    <nav className="main-nav" aria-label="Main navigation"><button aria-current={tab === 'collection' ? 'page' : undefined} onClick={() => setTab('collection')}>Word collection</button><button aria-current={tab === 'practice' ? 'page' : undefined} onClick={() => setTab('practice')}>Let’s practice <span aria-hidden="true">↗</span></button><span className="nav-note">a little, often.</span></nav>
    <main>
      <div className="page-heading"><div><p className="eyebrow">THE LITTLE WORD WORKSHOP</p><h1>{tab === 'collection' ? <>Small steps.<br /><em>Stronger spelling.</em></> : <>A little practice.<br /><em>A little progress.</em></>}</h1></div><p>For the words that need<br />a second hello.</p></div>
      {authError && <p className="error" role="alert">{authError}</p>}
      {error && <div className="error" role="alert">{error} <button className="text-button" disabled={loading} onClick={() => void refresh()}>Retry sync</button></div>}
      {tab === 'collection' && <section className="category-grid" aria-label="Word categories">{(Object.keys(categories) as Category[]).map(key => <button key={key} className={`category-card ${key} ${category === key ? 'active' : ''}`} aria-pressed={category === key} onClick={() => setCategory(category === key ? 'all' : key)}><span className="category-sign">{categories[key].label}</span><span className="category-copy"><strong>{key === 'new' ? 'New beginnings' : key === 'plus' ? 'Finding their feet' : 'Worth another try'}</strong><span>{categories[key].description}</span></span><span className="category-count">{words.filter(w => w.category === key).length}</span></button>)}</section>}
      {tab === 'collection' ? <Collection client={client} words={words} loading={loading} category={category} onCategory={setCategory} refresh={refresh} onPractice={() => setTab('practice')} /> : <Practice words={words} client={client} loading={loading} onUpdated={refresh} />}
    </main>
    <footer><span>Little by little is a lot.</span><span>Deutsch & English · Made for learning together</span></footer>
  </div>
}
