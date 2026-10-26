import { useEffect, useRef, useState } from 'react'
import { Check, Copy, ExternalLink, Link2, Unplug, X } from 'lucide-react'
import type { ConnectedAppsState, ConnectionRequest, OAuthScope } from '../../shared/oauth'
import { api } from '../lib/api'
import { errorMessage } from '../lib/words'
import { useI18n } from '../i18n/context'
import { Brand } from './Icons'

const permissionKey = (scope: OAuthScope) => scope === 'words:read' ? 'Read your words and progress' : 'Add words to your collection'

export function OAuthConsent({ requestId, onComplete, onSwitchAccount }: {
  requestId: string
  onComplete: (redirect: string) => void
  onSwitchAccount: () => Promise<void>
}) {
  const { t, message } = useI18n()
  const [details, setDetails] = useState<ConnectionRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = useRef(false)
  useEffect(() => {
    active.current = true
    let current = true
    void api.connectionRequest(requestId).then(result => { if (current) setDetails(result) })
      .catch(error => { if (current) setError(errorMessage(error)) })
    return () => { current = false; active.current = false }
  }, [requestId])

  async function decide(approve: boolean) {
    if (busy || !details) return
    setBusy(true)
    setError('')
    try {
      const result = await api.decideConnection(requestId, approve)
      if (active.current) onComplete(result.redirect)
    } catch (error) { if (active.current) { setError(errorMessage(error)); setBusy(false) } }
  }
  async function switchAccount() {
    setBusy(true)
    setError('')
    try { await onSwitchAccount() }
    catch (error) { if (active.current) { setError(errorMessage(error)); setBusy(false) } }
  }

  return <div className="app-shell">
    <header className="site-header"><Brand /></header>
    <main className="oauth-consent" aria-labelledby="oauth-title">
      <h1 id="oauth-title">{t('Connect an app')}</h1>
      {!details && !error && <p role="status">{t('Loading connection request...')}</p>}
      {details && <>
        <h2>{details.clientName}</h2>
        <dl className="connection-details">
          <dt>{t('App website')}</dt><dd>{details.clientOrigin}</dd>
          <dt>{t('Account')}</dt><dd>{details.accountEmail}</dd>
        </dl>
        <button className="text-button" disabled={busy} onClick={() => void switchAccount()}>{t('Use another account')}</button>
        <h3>{t('Requested permissions')}</h3>
        <ul className="connection-permissions">{details.scopes.map(scope => <li key={scope}><Check size={18} aria-hidden="true" />{t(permissionKey(scope))}</li>)}</ul>
        <p className="fine-print">{t('Only approve apps and websites you trust. You can revoke access in Settings.')}</p>
        <div className="oauth-actions">
          <button className="button primary" disabled={busy} onClick={() => void decide(true)}><Link2 size={18} />{t(busy ? 'Connecting...' : 'Connect')}</button>
          <button className="button secondary" disabled={busy} onClick={() => void decide(false)}><X size={18} />{t('Cancel')}</button>
        </div>
      </>}
      {error && <p role="alert" className="error">{message(error)}</p>}
      <a className="text-button connection-back" href="/">{t('Back to Worttrainer')}</a>
    </main>
  </div>
}

export function ConnectedApps() {
  const { language, t, message } = useI18n()
  const [data, setData] = useState<ConnectedAppsState | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const active = useRef(false)
  const generation = useRef(0)
  useEffect(() => {
    active.current = true
    let current = true
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      const request = ++generation.current
      void api.connectedApps().then(result => { if (current && request === generation.current) { setData(result); setError('') } })
        .catch(error => { if (current && request === generation.current) setError(errorMessage(error)) })
    }
    refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    const timer = window.setInterval(refresh, 30_000)
    return () => { current = false; active.current = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [reload])

  async function copyAddress() {
    if (!data) return
    try { await navigator.clipboard.writeText(data.endpoint); if (active.current) setCopied(true) }
    catch { if (active.current) setError('Could not copy the address.') }
  }
  async function disconnect(id: string) {
    setBusyId(id)
    setError('')
    try {
      await api.disconnectApp(id)
      if (active.current) {
        generation.current++
        setData(current => current ? { ...current, connections: current.connections.filter(connection => connection.id !== id) } : current)
        setConfirmId(null)
      }
    } catch (error) { if (active.current) setError(errorMessage(error)) }
    finally { if (active.current) setBusyId(null) }
  }

  return <section className="settings-panel word-panel connected-apps" aria-labelledby="connected-apps-title">
    <h2 id="connected-apps-title">{t('Connected apps')}</h2>
    {!data && !error && <p role="status">{t('Loading connected apps...')}</p>}
    {data && <>
      <label htmlFor="mcp-address">{t('MCP address')}</label>
      <div className="connection-address"><input id="mcp-address" readOnly value={data.endpoint} onFocus={event => event.target.select()} /><button className="button secondary connection-icon" aria-label={t('Copy MCP address')} title={t('Copy MCP address')} onClick={() => void copyAddress()}>{copied ? <Check size={18} /> : <Copy size={18} />}</button></div>
      {copied && <p role="status" className="fine-print">{t('Address copied.')}</p>}
      {!data.endpoint.startsWith('https://') && <p className="fine-print">{t('Web connections require a public HTTPS address.')}</p>}
      <div className="connection-links"><a href="https://chatgpt.com/plugins" target="_blank" rel="noopener noreferrer">ChatGPT<ExternalLink size={14} aria-hidden="true" /><span className="visually-hidden">{t('Opens in a new tab')}</span></a><a href="https://claude.ai/customize/connectors" target="_blank" rel="noopener noreferrer">Claude<ExternalLink size={14} aria-hidden="true" /><span className="visually-hidden">{t('Opens in a new tab')}</span></a></div>
      {data.connections.length === 0 ? <p className="fine-print">{t('No apps connected.')}</p> : <ul className="connected-apps-list">{data.connections.map(connection => <li key={connection.id}>
        <div className="connection-heading"><strong>{connection.clientName}</strong><button className="button secondary connection-icon" disabled={busyId !== null} aria-label={t('Disconnect {name}', { name: connection.clientName })} title={t('Disconnect {name}', { name: connection.clientName })} onClick={() => setConfirmId(connection.id)}><Unplug size={18} /></button></div>
        <p className="connection-origin">{connection.clientOrigin}</p>
        <ul className="connection-permissions">{connection.scopes.map(scope => <li key={scope}>{t(permissionKey(scope))}</li>)}</ul>
        <p className="fine-print">{t('Connected {date}', { date: new Date(connection.createdAt).toLocaleDateString(language) })}</p>
        {confirmId === connection.id && <div className="connection-confirm" role="group" aria-label={t('Disconnect {name}?', { name: connection.clientName })}><p>{t('Disconnect {name}?', { name: connection.clientName })}</p><div className="oauth-actions"><button className="button secondary" disabled={busyId !== null} onClick={() => void disconnect(connection.id)}>{t(busyId ? 'Disconnecting...' : 'Disconnect')}</button><button className="text-button" disabled={busyId !== null} onClick={() => setConfirmId(null)}>{t('Cancel')}</button></div></div>}
      </li>)}</ul>}
    </>}
    {error && <div className="error" role="alert">{message(error)} <button className="text-button" onClick={() => setReload(previous => previous + 1)}>{t('Retry loading')}</button></div>}
  </section>
}