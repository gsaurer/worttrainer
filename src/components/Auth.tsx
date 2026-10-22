import { useState, type FormEvent } from 'react'
import type { AuthState } from '../../shared/model'
import { api } from '../lib/api'
import { errorMessage } from '../lib/words'
import { ArrowIcon, Brand } from './Icons'

export function Auth({ setupRequired, setupCode, emailMigrationRequired = false, onAuthenticated }: {
  setupRequired: boolean
  setupCode: string
  emailMigrationRequired?: boolean
  onAuthenticated: (state: AuthState) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [code, setCode] = useState(setupCode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (setupRequired && password !== confirmation) { setError('The passwords do not match. Please try again.'); return }
    setBusy(true)
    try {
      const result = setupRequired
        ? await api.setup(email.trim(), password, code.trim())
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
        <div className="language-note"><span>DE</span> Deutsch <span>EN</span> English <i>Made for learning together.</i></div>
      </section>
      <section className="auth-card" aria-labelledby="signin-title">
        <p className="eyebrow">YOUR FAMILY’S WORD COLLECTION</p>
        <h2 id="signin-title">{setupRequired ? 'A home for your words.' : 'Welcome back, grown-up.'}</h2>
        <p>{setupRequired ? 'Create your shared parent account. One login keeps your family’s words and progress together on every device.' : 'Sign in to your parent account. Your little word collection is right where you left it.'}</p>
        {setupRequired && <div className="setup-notice"><strong>A one-time welcome.</strong><p>Enter SETUP_TOKEN from your server’s .env configuration, or use the private setup link from its logs. Generated links expire after 15 minutes; a configured token works until the first account is created.</p></div>}
        {emailMigrationRequired && <div className="setup-notice"><strong>Use your parent email from now on.</strong><p>Enter the email you want to use and your existing password. This replaces the old username without changing your words or progress. Other devices will need to sign in again.</p></div>}
        <form onSubmit={submit}>
          {setupRequired && <><label htmlFor="setup-code">One-time setup code</label><input id="setup-code" type="password" value={code} onChange={e => setCode(e.target.value)} required maxLength={128} disabled={busy} autoComplete="off" /></>}
          <label htmlFor="email">Parent email</label>
          <input id="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={254} placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} disabled={busy} />
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete={setupRequired ? 'new-password' : 'current-password'} required minLength={setupRequired ? 12 : 1} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} aria-describedby={setupRequired ? 'password-hint' : undefined} />
          {setupRequired && <><p id="password-hint" className="input-hint">At least 12 characters. A memorable passphrase works well.</p><label htmlFor="confirm-password">Confirm password</label><input id="confirm-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} /></>}
          <button className="button primary wide" disabled={busy}>{busy ? 'Opening your collection…' : setupRequired ? 'Create our parent account' : emailMigrationRequired ? 'Set parent email and sign in' : 'Open our word collection'}<ArrowIcon /></button>
        </form>
        {error && <p role="alert" className="error">{error}</p>}
        <p className="fine-print">Your family’s own space. The parent email is only used to sign in; no emails are sent. No child account or personal details needed. Words and progress are saved on your server.</p>
      </section>
    </main>
    <footer><span>Less pressure. More practice.</span><span>Your words. Your pace.</span></footer>
  </div>
}
