import { useRef, useState, type FormEvent } from 'react'
import type { AuthState } from '../../shared/model'
import { api } from '../lib/api'
import { errorMessage } from '../lib/words'
import { ArrowIcon, Brand } from './Icons'
import { useI18n } from '../i18n/context'
import { VisitorLanguage } from '../i18n/I18n'

export function Auth({ emailMigrationRequired = false, resetToken, onRecoveryExit, onAuthenticated }: {
  emailMigrationRequired?: boolean
  resetToken?: string
  onRecoveryExit?: () => void
  onAuthenticated: (state: AuthState) => void
}) {
  const { language, t, message } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [recovery, setRecovery] = useState(resetToken !== undefined)
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
        ? await api.signup(email.trim(), password, language)
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
    <header className="site-header"><Brand /><VisitorLanguage /></header>
    <main className="welcome-grid">
      <section className="welcome-story">
        <p className="eyebrow">{t('PAPER. PENCIL. POSSIBILITY.')}</p>
        <h1>{t('Little words.')}<br />{t('Big')} <em>{t('confidence.')}</em></h1>
        <p className="lede">{t('A calm little space to turn tricky words into familiar friends. Listen, write on paper, and celebrate each step together.')}</p>
        <div className="paper-illustration" aria-hidden="true">
          <span className="paper-tab">{t('one word at a time')}</span>
          <div className="paper-line">{t('listen')}<span>01</span></div>
          <div className="paper-line">{t('write')}<span>02</span></div>
          <div className="paper-line">{t('grow')}<span>03</span></div>
          <span className="pencil" />
          <span className="star-sticker">{t('you’ve got this!')}</span>
        </div>
        <div className="language-note">{t('Choose your practice languages after signing in.')}<i>{t('Made for learning together.')}</i></div>
      </section>
      <section className="auth-card" aria-labelledby="signin-title">
        <p className="eyebrow">{t('YOUR PRIVATE WORD COLLECTION')}</p>
        {recovery ? <PasswordRecovery resetToken={resetToken} initialEmail={email} onBack={() => { setRecovery(false); setError(''); onRecoveryExit?.() }} /> : <>
        {!emailMigrationRequired && <div className="segmented" aria-label={t('Account access')}><button type="button" aria-pressed={!signup} className={!signup ? 'selected' : ''} disabled={busy} onClick={() => changeMode('signin')}>{t('Sign in')}</button><button type="button" aria-pressed={signup} className={signup ? 'selected' : ''} disabled={busy} onClick={() => changeMode('signup')}>{t('Create account')}</button></div>}
        <h2 id="signin-title">{t(signup ? 'A home for your words.' : 'Welcome back, grown-up.')}</h2>
        <p>{t(signup ? 'Create an account with your email and a password. Your words and practice history are private to your account and sync across your devices. No invitation or setup code needed.' : 'Sign in to your account. Your private word collection is right where you left it.')}</p>
        {emailMigrationRequired && <div className="setup-notice"><strong>{t('Use your parent email from now on.')}</strong><p>{t('Enter the email you want to use and your existing password. This replaces the old username without changing your words or progress. Other devices will need to sign in again.')}</p></div>}
        <form onSubmit={submit}>
          <label htmlFor="email">{t('Parent email')}</label>
          <input id="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={254} placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} disabled={busy} />
          <label htmlFor="password">{t('Password')}</label>
          <input id="password" type="password" autoComplete={signup ? 'new-password' : 'current-password'} required minLength={signup ? 12 : 1} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} aria-describedby={signup ? 'password-hint' : undefined} />
          {signup && <><p id="password-hint" className="input-hint">{t('At least 12 characters. A memorable passphrase works well.')}</p><label htmlFor="confirm-password">{t('Confirm password')}</label><input id="confirm-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} /></>}
          <button className="button primary wide" disabled={busy}>{t(busy ? 'Opening your collection…' : signup ? 'Create my account' : emailMigrationRequired ? 'Set parent email and sign in' : 'Open our word collection')}<ArrowIcon /></button>
        </form>
        {error && <p role="alert" className="error">{message(error)}</p>}
        {!signup && !emailMigrationRequired && <button type="button" className="text-button" disabled={busy} onClick={() => setRecovery(true)}>{t('Forgot password?')}</button>}
        </>}
        <p className="fine-print">{t('Each account has its own private words and progress. No child account or personal details needed.')}</p>
      </section>
    </main>
    <footer><span>{t('Less pressure. More practice.')}</span><span>{t('Your words. Your pace.')}</span></footer>
  </div>
}

function PasswordRecovery({ resetToken, initialEmail, onBack }: { resetToken?: string; initialEmail: string; onBack: () => void }) {
  const { t, message } = useI18n()
  const [requesting, setRequesting] = useState(resetToken === undefined)
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const saving = useRef(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving.current) return
    setError('')
    if (!requesting && password !== confirmation) { setError('The passwords do not match. Please try again.'); return }
    saving.current = true
    setBusy(true)
    try {
      if (requesting) await api.requestPasswordReset(email.trim())
      else await api.resetPassword(resetToken ?? '', password)
      setPassword('')
      setConfirmation('')
      setSuccess(true)
    } catch (error) { setError(errorMessage(error)) }
    finally { saving.current = false; setBusy(false) }
  }

  return <>
    <h2 id="signin-title">{t(success ? requesting ? 'Check your email' : 'Password updated' : requesting ? 'Reset your password' : 'Choose a new password')}</h2>
    {success ? <p role="status">{t(requesting ? 'If an account exists for that email, a password reset link will be sent. Check your inbox and spam folder.' : 'Your password has been reset. Sign in with your new password.')}</p> : <form onSubmit={submit}>
      {requesting ? <>
        <label htmlFor="reset-email">{t('Parent email')}</label>
        <input id="reset-email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />
      </> : <>
        <label htmlFor="reset-password">{t('New password')}</label>
        <input id="reset-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} aria-describedby="reset-password-hint" />
        <p id="reset-password-hint" className="input-hint">{t('At least 12 characters. A memorable passphrase works well.')}</p>
        <label htmlFor="reset-confirmation">{t('Confirm password')}</label>
        <input id="reset-confirmation" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} />
      </>}
      <button type="submit" className="button primary wide" disabled={busy}>{t(busy ? requesting ? 'Sending...' : 'Saving...' : requesting ? 'Send reset link' : 'Reset password')}<ArrowIcon /></button>
    </form>}
    {error && <p className="error" role="alert">{message(error)}</p>}
    {!requesting && !success && <button type="button" className="text-button" disabled={busy} onClick={() => { setRequesting(true); setPassword(''); setConfirmation(''); setError('') }}>{t('Request a new link')}</button>}
    <button type="button" className="text-button" disabled={busy} onClick={onBack}>{t('Back to sign in')}</button>
  </>
}
