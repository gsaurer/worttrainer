import { Component, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { translate } from './i18n/messages'

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Worttrainer render failed', error, info.componentStack) }
  render() {
    if (this.state.failed) {
      const language = document.documentElement.lang === 'de' ? 'de' : 'en'
      return <main className="setup-card"><h1>{translate(language, 'A little hiccup.')}</h1><p>{translate(language, 'The app could not display this page. Reload to reconnect to your saved collection.')}</p><button className="button primary" onClick={() => window.location.reload()}>{translate(language, 'Reload the app')}</button></main>
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>)
