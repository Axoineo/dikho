import { Component } from 'react'

/* Without a boundary, a route chunk that fails for good takes the whole app
 * down to a blank white page — React unmounts the tree when nothing catches the
 * error. lazyWithRetry already absorbs transient failures, so reaching this
 * means the chunk is genuinely unreachable; the only honest recovery is a fresh
 * load, so offer it rather than leaving the visitor on an empty screen. */
export default class RouteBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    console.error('Route failed to load:', error)
    // AppReady lives inside the subtree this just replaced, so nothing else
    // will dismiss the boot splash — without this the message sits hidden
    // behind the animation until the failsafe in index.html fires.
    window.__dikhoAppReady?.()
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <div className="route-boundary" role="alert">
        <strong>This page didn&rsquo;t load</strong>
        <p>Your connection dropped while it was downloading. Reloading usually fixes it.</p>
        <button type="button" className="primary-button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}
