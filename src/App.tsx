import { useEffect, useRef, useState } from 'react'
import { ChevronDown, CircleUserRound, Download, LogOut, Settings } from 'lucide-react'
import type { AuthState, WebsiteLanguage } from '../shared/model'
import { api } from './lib/api'
import { errorMessage } from './lib/words'
import { useWords } from './hooks/useWords'
import { Auth } from './components/Auth'
import { Brand } from './components/Icons'
import { Collection } from './components/Collection'
import { Statistics } from './components/Statistics'
import { Practice } from './components/Practice'
import { PasswordSettings } from './components/PasswordSettings'
import { DataExport } from './components/DataExport'
import { WordResources } from './components/WordResources'
import { LanguageSettings } from './components/LanguageSettings'
import { WebsiteLanguageSettings } from './components/WebsiteLanguageSettings'
import { InstallWebApp, ReminderSettings } from './components/WebAppSettings'
import { currentPushSubscription, installedWebApp } from './lib/pwa'
import { I18nProvider } from './i18n/I18n'
import { useI18n } from './i18n/context'

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
  return <I18nProvider><Application /></I18nProvider>
}

function Application() {
  const { t, message } = useI18n()
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [error, setError] = useState('')
  const requests = useRef(0)

  async function reconnect() {
    const generation = ++requests.current
    setError('')
    try { const state = await api.session(); if (generation === requests.current) setAuth(state) }
    catch (error) { if (generation === requests.current) setError(errorMessage(error)) }
  }

  useEffect(() => {
    let active = true
    removeSetupFragment()
    const expired = () => {
      requests.current++
      setAuth({ authenticated: false, emailMigrationRequired: false, email: null })
      setError('Your session has ended. Please sign in again.')
    }
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      const generation = ++requests.current
      void api.session().then(state => { if (active && generation === requests.current) { setAuth(state); setError('') } })
        .catch(error => { if (active && generation === requests.current) setError(errorMessage(error)) })
    }
    refresh()
    window.addEventListener('auth-expired', expired)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    const timer = window.setInterval(refresh, 30_000)
    window.addEventListener('hashchange', removeSetupFragment)
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('auth-expired', expired); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('hashchange', removeSetupFragment) }
  }, [])

  if (!auth) return <main className="loading-screen"><Brand />{error ? <><p className="error" role="alert">{t('Could not connect to the Worttrainer server: {error}', { error: message(error) })}</p><button className="button primary" onClick={() => void reconnect()}>{t('Retry connection')}</button></> : <p role="status">{t('Opening your little word collection…')}</p>}</main>
  if (auth.authenticated && !auth.emailMigrationRequired) return <I18nProvider language={auth.websiteLanguage ?? 'en'}><FamilyApp key={auth.email} onSignedOut={() => { requests.current++; setAuth({ authenticated: false, emailMigrationRequired: false, email: null }) }} onWebsiteLanguageSaved={language => {
    requests.current++
    setAuth(current => current?.email === auth.email ? { ...current, websiteLanguage: language } : current)
  }} email={auth.email ?? ''} /></I18nProvider>
  return <>{error && <div className="auth-error error" role="alert">{message(error)}<button className="text-button" onClick={() => setError('')}>{t('Dismiss')}</button></div>}<Auth emailMigrationRequired={auth.emailMigrationRequired} onAuthenticated={state => { requests.current++; setError(''); setAuth(state) }} /></>
}

function FamilyApp({ email, onSignedOut, onWebsiteLanguageSaved }: { email: string; onSignedOut: () => void; onWebsiteLanguageSaved: (language: WebsiteLanguage) => void }) {
  const { t, message } = useI18n()
  const [tab, setTab] = useState<'home' | 'collection' | 'statistics' | 'settings' | 'resources'>('home')
  const { words, wordLists, preferences, loading, error, refresh, saveLanguages } = useWords(tab)
  const [signingOut, setSigningOut] = useState(false)
  const [authError, setAuthError] = useState('')
  const [accountOpen, setAccountOpen] = useState(false)
  const accountMenu = useRef<HTMLDivElement>(null)
  const accountToggle = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const openPractice = (event: MessageEvent) => {
      if (event.data?.type === 'OPEN_PRACTICE') { setTab('home'); setAccountOpen(false) }
    }
    navigator.serviceWorker.addEventListener('message', openPractice)
    return () => navigator.serviceWorker.removeEventListener('message', openPractice)
  }, [])

  useEffect(() => {
    if (!accountOpen) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !accountMenu.current?.contains(event.target)) setAccountOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setAccountOpen(false); accountToggle.current?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [accountOpen])

  async function signOut() {
    setSigningOut(true)
    setAuthError('')
    try {
      const subscription = await currentPushSubscription()
      if (subscription) { await api.removeReminder(subscription.endpoint); await subscription.unsubscribe() }
      await api.logout()
      onSignedOut()
    }
    catch (error) { setAuthError(errorMessage(error)) }
    finally { setSigningOut(false) }
  }

  const pageTitle = t(tab === 'home' ? 'Home' : tab === 'collection' ? 'Collection' : tab === 'statistics' ? 'Progress' : tab === 'resources' ? 'Word lists' : 'Settings')
  const showPageTitle = tab === 'settings' || tab === 'resources'

  return <div className="app-shell">
    <header className="site-header"><Brand /><div className="account" ref={accountMenu} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setAccountOpen(false) }}>
      <button ref={accountToggle} className="account-toggle" aria-label={t('Account menu')} title={email} aria-expanded={accountOpen} aria-controls="account-actions" onClick={() => setAccountOpen(previous => !previous)}><CircleUserRound /><ChevronDown size={16} /></button>
      {accountOpen && <div id="account-actions" className="account-panel" role="group" aria-label={t('Account')}>
        <p className="account-identity">{email}</p>
        <button onClick={() => { setTab('settings'); setAccountOpen(false) }}><Settings size={18} />{t('Settings')}</button>
        {!installedWebApp() && <button onClick={() => { setTab('settings'); setAccountOpen(false) }}><Download size={18} />{t('Install app')}</button>}
        <button disabled={signingOut} onClick={() => void signOut()}><LogOut size={18} />{t(signingOut ? 'Signing out…' : 'Sign out')}</button>
      </div>}
    </div></header>
    <nav className="main-nav" aria-label={t('Main navigation')}><button aria-current={tab === 'home' ? 'page' : undefined} onClick={() => { setAccountOpen(false); setTab('home') }}>{t('Home')}</button><button aria-current={tab === 'collection' || tab === 'resources' ? 'page' : undefined} onClick={() => { setAccountOpen(false); setTab('collection') }}>{t('Collection')}</button><button aria-current={tab === 'statistics' ? 'page' : undefined} onClick={() => { setAccountOpen(false); setTab('statistics') }}>{t('Progress')}</button></nav>
    <main className={showPageTitle ? undefined : 'workspace-content'}>
      {showPageTitle ? <div className="page-heading"><h1>{pageTitle}</h1></div> : <h1 className="visually-hidden">{pageTitle}</h1>}
      {authError && <p className="error" role="alert">{t('Could not sign out: {error}', { error: message(authError) })}</p>}
      {error && <div className="error" role="alert">{error} <button className="text-button" disabled={loading} onClick={() => void refresh()}>{t('Retry loading')}</button></div>}
      {tab === 'settings' ? <div className="settings-layout">
        <div>{preferences ? <LanguageSettings preferences={preferences} onSave={saveLanguages} onSaved={() => setTab('home')} /> : !error && <p role="status">{t('Loading your languages…')}</p>}</div>
        <div className="settings-secondary">
          <InstallWebApp />
          <ReminderSettings />
          <WebsiteLanguageSettings onSaved={onWebsiteLanguageSaved} />
          <section className="settings-panel word-panel" aria-labelledby="export-title"><h2 id="export-title">{t('Your data')}</h2><DataExport /></section>
          <section className="settings-panel word-panel" aria-labelledby="account-title"><h2 id="account-title">{t('Account')}</h2><p className="settings-email">{email}</p><PasswordSettings /></section>
        </div>
      </div> : !preferences ? !error && <p role="status">{t('Loading your languages…')}</p> : tab === 'resources' ? <WordResources words={words} wordLists={wordLists} preferences={preferences} onUpdated={refresh} onBack={() => setTab('collection')} /> : tab === 'collection' ? <Collection words={words} loading={loading} refresh={refresh} preferences={preferences} onOpenWordLists={() => setTab('resources')} /> : tab === 'statistics' ? <Statistics words={words} preferences={preferences} loading={loading} refresh={refresh} /> : <div className="home-actions">
        <Practice words={words} wordLists={wordLists} loading={loading} onUpdated={refresh} preferences={preferences} />
      </div>}
    </main>
    <footer><span>{t('Little by little is a lot.')}</span><span>{t('Private spelling practice')}</span></footer>
  </div>
}
