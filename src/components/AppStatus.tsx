import { useEffect, useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import type { BuildInfo, ServiceStatus } from '../../shared/status'
import { api } from '../lib/api'
import { useI18n } from '../i18n/context'

declare const __BUILD_INFO__: BuildInfo

function BuildDetails({ build }: { build: BuildInfo }) {
  const { t, date } = useI18n()
  return <>
    <div className="build-detail"><span>v{build.version}</span>{build.commit && <code title={build.commit}>{build.commit.slice(0, 12)}</code>}{build.dirty && <span>{t('Local changes')}</span>}</div>
    <div className="build-detail"><span>{t('Build')}: <code title={build.buildId}>{build.buildId.slice(0, 12)}</code></span><time dateTime={build.builtAt}>{date(build.builtAt)}</time></div>
  </>
}

export function AppStatus() {
  const { t } = useI18n()
  const [status, setStatus] = useState<ServiceStatus | null>(null)
  const [failed, setFailed] = useState(false)
  const [check, setCheck] = useState(0)

  useEffect(() => {
    let active = true
    let pending: AbortController | undefined
    let timeout: number | undefined
    async function refresh() {
      window.clearTimeout(timeout)
      pending?.abort()
      const controller = new AbortController()
      pending = controller
      timeout = window.setTimeout(() => controller.abort(), 5000)
      const requestTimeout = timeout
      try {
        const next = await api.status(controller.signal)
        if (active && pending === controller) { setStatus(next); setFailed(false) }
      } catch {
        if (active && pending === controller) { setStatus(null); setFailed(true) }
      } finally { window.clearTimeout(requestTimeout) }
    }
    const whenVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    void refresh()
    const interval = window.setInterval(whenVisible, 30_000)
    window.addEventListener('focus', whenVisible)
    document.addEventListener('visibilitychange', whenVisible)
    return () => {
      active = false
      pending?.abort()
      window.clearTimeout(timeout)
      window.clearInterval(interval)
      window.removeEventListener('focus', whenVisible)
      document.removeEventListener('visibilitychange', whenVisible)
    }
  }, [check])

  const differentBuild = !import.meta.env.DEV && status && status.frontend.buildId !== __BUILD_INFO__.buildId
  return <section className="settings-panel word-panel" aria-labelledby="app-status-title">
    <h2 id="app-status-title">{t('App status')}</h2>
    {import.meta.env.DEV && <p className="fine-print">{t('Development build')}</p>}
    <dl className="status-versions" aria-live="polite">
      <div role="group" aria-label={t('Frontend')}><dt>{t('Frontend')}</dt><dd><strong>{t('Loaded')}</strong><BuildDetails build={__BUILD_INFO__} /></dd></div>
      <div role="group" aria-label={t('Backend')}><dt>{t('Backend')}</dt><dd><strong>{t(failed ? 'Unreachable' : status ? 'Online' : 'Checking status...')}</strong>{status && <BuildDetails build={status.backend} />}</dd></div>
    </dl>
    {failed && <p className="error" role="alert">{t('Could not reach the status API.')}</p>}
    {differentBuild && <div className="status-update"><p role="alert">{t('The frontend and server builds differ. Reload the app.')}</p><button className="button secondary" onClick={() => window.location.reload()}><RefreshCw size={16} />{t('Reload app')}</button></div>}
    <div className="status-actions"><a href="/api/status" target="_blank" rel="noopener noreferrer">{t('Status API')}<ExternalLink size={16} aria-hidden="true" /><span className="visually-hidden">{t('Opens in a new tab')}</span></a><button className="text-button status-refresh" title={t('Refresh status')} aria-label={t('Refresh status')} onClick={() => setCheck(previous => previous + 1)}><RefreshCw size={18} aria-hidden="true" /></button></div>
  </section>
}