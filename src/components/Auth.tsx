import { useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../database.types'
import { errorMessage } from '../lib/words'
import { ArrowIcon, Brand } from './Icons'

export function Auth({ client, configured = true }: { client: SupabaseClient<Database> | null; configured?: boolean }) {
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!client) return
    setBusy(true)
    setError('')
    try {
      const { error } = await client.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      })
      if (error) throw error
      setSentTo(email.trim())
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return <div className="welcome-page">
    <header className="site-header"><Brand /><span className="header-note">A little practice. A little progress.</span></header>
    <main className="welcome-grid">
      <section className="welcome-story">
        <p className="eyebrow">PAPER. PENCIL. POSSIBILITY.</p>
        <h1>Little words.<br />Big <em>confidence.</em></h1>
        <p className="lede">A calm little space to turn tricky words into familiar friends. Listen, write on paper, and celebrate each step together.</p>
        <div className="paper-illustration" aria-hidden="true">
          <span className="paper-tab">one word at a time</span>
          <div className="paper-line">listen<span>01</span></div>
          <div className="paper-line">write<span>02</span></div>
          <div className="paper-line">grow<span>03</span></div>
          <span className="pencil" />
          <span className="star-sticker">you’ve<br />got this!</span>
        </div>
        <div className="language-note"><span>DE</span> Deutsch <span>EN</span> English <i>Made for learning together.</i></div>
      </section>
      <section className="auth-card" aria-labelledby="signin-title">
        <p className="eyebrow">YOUR FAMILY’S WORD COLLECTION</p>
        <h2 id="signin-title">Welcome, grown-up.</h2>
        <p>Sign in with a parent’s email to keep your words and progress together, on every device.</p>
        {!configured && <div className="setup-notice" role="status"><strong>Local preview · connection needed</strong><p>The interface is running. Sign-in and saved words need a Supabase project. There is no demo login or simulated sync.</p><details><summary>Connect your project</summary><p>Run the migration in <code>supabase/migrations</code>, set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> in <code>.env.local</code>, and allow this site’s URL in Supabase Authentication. Restart the dev server. See README for the full steps.</p></details></div>}
        <form onSubmit={signIn}>
          <label htmlFor="email">Parent’s email address</label>
          <input id="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} disabled={busy || !configured} />
          <button className="button primary wide" disabled={busy || !configured}>{busy ? 'Sending your link…' : sentTo ? 'Send another sign-in link' : 'Email me a sign-in link'}<ArrowIcon /></button>
        </form>
        {error && <p role="alert" className="error">{error}</p>}
        {sentTo && <div role="status" className="notice">Check <strong>{sentTo}</strong> for your link. Open it in this same browser to finish signing in. It may take a minute; check your spam folder too.</div>}
        <p className="fine-print">No password to remember. No child account or personal details needed. Each parent account has its own private collection.</p>
      </section>
    </main>
    <footer><span>Less pressure. More practice.</span><span>Your words. Your pace.</span></footer>
  </div>
}
