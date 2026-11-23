import { Component } from 'react'

/* The last line of defence: an error outside any page (the shell, the sign-in
 * check, a layout) would otherwise unmount everything and leave a blank white
 * page. This shows what happened and a way out instead. When the browser was
 * offline at the time, it reloads by itself as soon as the connection returns. */
export default class AppErrorBoundary extends Component {
  state = { failed: false, offline: false }

  static getDerivedStateFromError() {
    return { failed: true, offline: typeof navigator !== 'undefined' && navigator.onLine === false }
  }

  componentDidCatch(error) {
    console.error('Dikho stopped with an error:', error)
    window.__dikhoAppReady?.()
    window.addEventListener('online', this.reloadWhenOnline)
  }

  componentWillUnmount() {
    window.removeEventListener('online', this.reloadWhenOnline)
  }

  reloadWhenOnline = () => {
    if (this.state.offline) window.location.reload()
  }

  render() {
    if (!this.state.failed) return this.props.children
    const { offline } = this.state
    return (
      <main className="app-error" role="alert">
        <img src="/favicon.svg" alt="" width="48" height="48" />
        <h1>{offline ? 'You’re offline' : 'Something went wrong'}</h1>
        <p>
          {offline
            ? 'Dikho needs an internet connection. This page will load again by itself when you’re back online.'
            : 'Dikho hit a problem it could not recover from. Reloading usually fixes it; your saved work is safe.'}
        </p>
        <div className="app-error-actions">
          <button type="button" className="primary-button" onClick={() => window.location.reload()}>Reload</button>
          {!offline && (
            <button type="button" className="secondary-button" onClick={() => window.location.assign('/')}>Go to the start page</button>
          )}
        </div>
      </main>
    )
  }
}
