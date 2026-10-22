import { Component, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Worttrainer render failed', error, info.componentStack) }
  render() {
    if (this.state.failed) return <main className="setup-card"><h1>A little hiccup.</h1><p>The app could not display this page. Reload to reconnect to your saved collection.</p><button className="button primary" onClick={() => window.location.reload()}>Reload the app</button></main>
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>)
