import { Component } from 'react'

/* Without a boundary, a route chunk that fails for good takes the whole app
 * down to a blank white page, because React unmounts the tree when nothing catches the
 * error. lazyWithRetry already absorbs transient failures, so reaching this
 * means the chunk is genuinely unreachable; the only honest recovery is a fresh
 * load, so offer it rather than leaving the visitor on an empty screen. */
export default class RouteBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  // One page failing must not take every other page with it. Moving to another page
  // tries again, and that page may well work.
  componentDidUpdate(previous) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }

  componentDidCatch(error) {
    console.error('Route failed to load:', error)
    // AppReady lives inside the subtree this just replaced, so nothing else
    // will dismiss the boot splash. Without this the message sits hidden
    // behind the animation until the failsafe in index.html fires.
    window.__dikhoAppReady?.()
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <div className="route-boundary" role="alert">
        <strong>We couldn&rsquo;t load this page</strong>
        <p>Something stopped this page from loading. Check your connection and try again.</p>
        <button type="button" className="primary-button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    )
  }
}
