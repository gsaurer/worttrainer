import { useState, type FormEvent } from 'react'
import type { AuthState } from '../../shared/model'
import { api } from '../lib/api'
import { errorMessage } from '../lib/words'
import { ArrowIcon, Brand } from './Icons'

export function Auth({ emailMigrationRequired = false, onAuthenticated }: {
  emailMigrationRequired?: boolean
  onAuthenticated: (state: AuthState) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const signup = mode === 'signup' && !emailMigrationRequired

  function changeMode(next: 'signin' | 'signup') {
    setMode(next)
    setPassword('')
    setConfirmation('')
    setError('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (signup && password !== confirmation) { setError('The passwords do not match. Please try again.'); return }
    setBusy(true)
    try {
      const result = signup
        ? await api.signup(email.trim(), password)
        : await api.login(email.trim(), password)
      setPassword('')
      setConfirmation('')
      onAuthenticated(result)
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
        <div className="language-note">Choose your practice languages after signing in.<i>Made for learning together.</i></div>
      </section>
      <section className="auth-card" aria-labelledby="signin-title">
        <p className="eyebrow">YOUR PRIVATE WORD COLLECTION</p>
        {!emailMigrationRequired && <div className="segmented" aria-label="Account access"><button type="button" aria-pressed={!signup} className={!signup ? 'selected' : ''} disabled={busy} onClick={() => changeMode('signin')}>Sign in</button><button type="button" aria-pressed={signup} className={signup ? 'selected' : ''} disabled={busy} onClick={() => changeMode('signup')}>Create account</button></div>}
        <h2 id="signin-title">{signup ? 'A home for your words.' : 'Welcome back, grown-up.'}</h2>
        <p>{signup ? 'Create an account with your email and a password. Your words and practice history are private to your account and sync across your devices. No invitation or setup code needed.' : 'Sign in to your account. Your private word collection is right where you left it.'}</p>
        {emailMigrationRequired && <div className="setup-notice"><strong>Use your parent email from now on.</strong><p>Enter the email you want to use and your existing password. This replaces the old username without changing your words or progress. Other devices will need to sign in again.</p></div>}
        <form onSubmit={submit}>
          <label htmlFor="email">Parent email</label>
          <input id="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={254} placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} disabled={busy} />
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete={signup ? 'new-password' : 'current-password'} required minLength={signup ? 12 : 1} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} aria-describedby={signup ? 'password-hint' : undefined} />
          {signup && <><p id="password-hint" className="input-hint">At least 12 characters. A memorable passphrase works well.</p><label htmlFor="confirm-password">Confirm password</label><input id="confirm-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} /></>}
          <button className="button primary wide" disabled={busy}>{busy ? 'Opening your collection…' : signup ? 'Create my account' : emailMigrationRequired ? 'Set parent email and sign in' : 'Open our word collection'}<ArrowIcon /></button>
        </form>
        {error && <p role="alert" className="error">{error}</p>}
        <p className="fine-print">Each account has its own private words and progress. Email is a sign-in identifier; no verification or password-reset emails are sent. No child account or personal details needed. Forgot your password? Contact the server operator for private recovery.</p>
      </section>
    </main>
    <footer><span>Less pressure. More practice.</span><span>Your words. Your pace.</span></footer>
  </div>
}
