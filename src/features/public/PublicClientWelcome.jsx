import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiPublicPost } from '../../lib/api'
import { DIAL_CODES } from './dialCodes'
import { CLIENT_LOGOS } from './clientele'
import './corporate-gifting.css'

/* ═══════════════════════════════════════════════════════════════════════
   Dikho — Corporate Gifting lead capture
   ───────────────────────────────────────────────────────────────────────
   Public, mobile-first landing page. Order is hero → form → Happy Clients
   → quote: the form comes before the proof, so a visitor who already knows
   Dikho never has to scroll past a logo reel to reach it.

   The copy on this page is the copy that was here before, deliberately. The
   redesign is presentation only — headline, form title, privacy note and the
   success message are unchanged. The one wording change is the submit button,
   now "Explore The Catalogue" rather than "…Collection", to match what the
   visitor actually receives.

   The one change that is not cosmetic: the country list is a frozen module
   (./dialCodes) rather than an import of `country-state-city`. That package
   statically pulls an 8.4 MB city dataset into whatever chunk touches it,
   and this page was shipping all of it to mobile visitors to render a "+91"
   picker.
   ═══════════════════════════════════════════════════════════════════════ */

/* ─── Constants ────────────────────────────────────────────────────── */

const TURNSTILE_SITEKEY = '0x4AAAAAAEnxgBvSPuBu7S85'
// Bound into the token and re-checked by the Worker, so a token minted on the
// vendor form cannot be replayed against lead submission.
// Must match ACTION_CG_LEAD in src/api/routes/public/index.js.
const TURNSTILE_ACTION = 'cg-lead'
const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

// How long a submit will wait for the invisible challenge to produce a token
// before giving up. It normally lands within a second of page load, long
// before anyone has filled five fields; this only covers a slow or blocked
// connection to Cloudflare.
const CAPTCHA_WAIT_MS = 12000

const DRIVE_CATALOGUE_URL = 'https://www.dropbox.com/scl/fo/hvs3nrxa5zfwyols7undr/AFJBK3hZ5JMtl0XUEyPY9sI?rlkey=9n71uwcr2splnw6de89q7ie9d&st=xknk2n8z&dl=0'

/* Each entry in `highlights` must be a verbatim substring of `quote`. They are
   drawn as a marker-pen wash BEHIND the words — the text itself stays the same
   colour as the rest of the quote, so the emphasis comes from the highlight
   rather than from a second text colour. */
const TESTIMONIAL = {
  quote: 'We craft smart campaigns that make your brand shine, stick in minds, and turn eyeballs into real growth.',
  highlights: ['smart campaigns', 'turn eyeballs into real growth'],
  name: 'Anil Singh Rathod',
  role: 'CEO & Founder, Dikho',
  // Content hash for the same reason the logos carry one: public/ is served
  // at a stable path with a long cache lifetime, so replacing the file in
  // place would leave returning visitors on the previous photo. Update this
  // whenever the image changes — `sha256sum public/clientele/anil.webp`.
  photo: '/clientele/anil.webp?v=4c5b8a80',
}

/* ─── Turnstile ────────────────────────────────────────────────────── */

// Fetching the challenge script is kept separate from rendering the widget so
// the network work can start on the visitor's first keystroke rather than
// blocking anything at page load.
let turnstileScriptPromise = null

function preloadTurnstile() {
  if (turnstileScriptPromise) return turnstileScriptPromise
  turnstileScriptPromise = new Promise((resolve) => {
    if (typeof window === 'undefined') return
    if (window.turnstile) return resolve()
    const existing = document.querySelector('script[src*="turnstile"]')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      return
    }
    const s = document.createElement('script')
    s.src = TURNSTILE_SRC
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => resolve() // let the widget's own retry surface the failure
    document.head.appendChild(s)
  })
  return turnstileScriptPromise
}

// The sitekey is configured as an INVISIBLE widget: this renders nothing and
// occupies no space.
//
// It is also deliberately set to `execution: 'execute'`, meaning it does NOT
// solve on page load — the form asks for a token at the moment of submit. That
// is the whole point. A Turnstile token is valid for 300 seconds and is
// single-use, so a widget that solves on load hands the form a token that has
// already expired by the time anyone has read the page and filled five fields,
// and siteverify answers `timeout-or-duplicate`. Minting on submit means the
// token is always seconds old.
//
// `executeRef` is filled with a function that resets and re-runs the challenge;
// the fresh token arrives via `onVerify`.
function TurnstileWidget({ onVerify, onExpire, onError, executeRef }) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)

  // Callbacks live in refs so the render effect below never has to re-run when
  // the parent re-renders with fresh inline functions — re-running it would
  // tear down and remount the challenge on every keystroke.
  const onVerifyRef = useRef(onVerify)
  const onExpireRef = useRef(onExpire)
  const onErrorRef = useRef(onError)
  useEffect(() => { onVerifyRef.current = onVerify }, [onVerify])
  useEffect(() => { onExpireRef.current = onExpire }, [onExpire])
  useEffect(() => { onErrorRef.current = onError }, [onError])

  useEffect(() => {
    let cancelled = false

    function init() {
      if (cancelled || !window.turnstile || !containerRef.current || widgetIdRef.current != null) return
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITEKEY,
        action: TURNSTILE_ACTION,
        // Hold the challenge until the form explicitly asks for it.
        execution: 'execute',
        callback: (token) => { if (!cancelled) onVerifyRef.current(token) },
        'expired-callback': () => { if (!cancelled) onExpireRef.current() },
        // Without this Turnstile throws an uncaught TurnstileError on any
        // challenge failure — a repeated reset() is enough to trigger one.
        // Returning true tells it the host page has taken responsibility, so
        // it stops throwing and leaves the recovery to us.
        'error-callback': (code) => {
          if (!cancelled) onErrorRef.current?.(code)
          return true
        },
        // Nothing is drawn unless Cloudflare decides this visitor needs an
        // interactive challenge, in which case it puts up its own overlay.
        // 'always' would reserve a visible slot that invisible mode never fills.
        appearance: 'interaction-only',
        theme: 'light',
        'refresh-expired': 'auto',
        language: 'en',
      })
    }

    preloadTurnstile().then(() => { if (!cancelled) init() })

    if (executeRef) {
      executeRef.current = () => {
        const id = widgetIdRef.current
        if (id == null || !window.turnstile) return false
        // Reset ONLY when a token has already been issued. A widget that has
        // not run yet is armed and ready; resetting it in that state puts it
        // back to un-armed and the execute() that follows does nothing, which
        // is a silent hang rather than an error.
        let issued = null
        try { issued = window.turnstile.getResponse(id) } catch { /* never run */ }
        if (issued) {
          try { window.turnstile.reset(id) } catch { /* already clear */ }
        }
        try {
          window.turnstile.execute(id)
        } catch (err) {
          console.warn('Turnstile execute failed', err)
          return false
        }
        return true
      }
    }

    return () => {
      cancelled = true
      if (widgetIdRef.current != null && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current) } catch { /* widget already gone */ }
        widgetIdRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // ← empty array: mount once, never re-run

  return <div className="cg-captcha" ref={containerRef} />
}

/* ─── Icons ────────────────────────────────────────────────────────── */

const base = (props) => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  ...props,
})

const Icon = {
  Check: (p) => (
    <svg width={p?.size || 14} height={p?.size || 14} {...base({ strokeWidth: 3 })}><path d="M20 6L9 17l-5-5" /></svg>
  ),
  // A wrapped gift. The briefcase this replaces said "corporate" but nothing
  // about gifting, and read as generic admin chrome at 20px.
  Gift: () => (
    <svg width="21" height="21" {...base({ strokeWidth: 1.7 })}>
      <rect x="3" y="11.5" width="18" height="9.5" rx="1.8" />
      <rect x="1.8" y="7.2" width="20.4" height="4.3" rx="1.4" />
      <path d="M12 7.2V21" />
      <path d="M12 7.2H8.1a2.1 2.1 0 1 1 0-4.2C10.5 3 12 7.2 12 7.2z" />
      <path d="M12 7.2h3.9a2.1 2.1 0 1 0 0-4.2C13.5 3 12 7.2 12 7.2z" />
    </svg>
  ),
  Alert: () => (
    <svg width="15" height="15" {...base({ strokeWidth: 2.4 })}>
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  // The diagonal arrow from the old circular submit button.
  ArrowNE: () => (
    <svg width="20" height="20" {...base({ strokeWidth: 2.5 })}>
      <line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" />
    </svg>
  ),
  Chevron: () => (
    <svg width="12" height="12" className="cg-dial-chev" {...base({ strokeWidth: 2.6 })}><polyline points="6 9 12 15 18 9" /></svg>
  ),
  Search: () => (
    <svg width="14" height="14" {...base({})}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
  ),
  Mail: () => (
    <svg width="15" height="15" {...base({})}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
  ),
  Phone: () => (
    <svg width="15" height="15" {...base({})}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
  ),
  Globe: () => (
    <svg width="14" height="14" {...base({})}><circle cx="12" cy="12" r="10" /><path d="M14.83 14.83a4 4 0 1 1 0-5.66" /></svg>
  ),
  Facebook: () => (
    <svg width="17" height="17" {...base({})}><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></svg>
  ),
  Instagram: () => (
    <svg width="17" height="17" {...base({})}><rect x="2" y="2" width="20" height="20" rx="5" /><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" /><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" /></svg>
  ),
  LinkedIn: () => (
    <svg width="17" height="17" {...base({})}><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" /><rect x="2" y="9" width="4" height="12" /><circle cx="4" cy="4" r="2" /></svg>
  ),
  X: () => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
  ),
}

/* Splits `text` so that every phrase in `phrases` lands on an ODD index and
   everything else on an even one — which is what lets the caller wrap just the
   matches without handling any markup. */
function splitOnPhrases(text, phrases) {
  const wanted = (phrases || []).filter(Boolean)
  if (!wanted.length) return [text]
  const escaped = wanted.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return text.split(new RegExp(`(${escaped.join('|')})`, 'g'))
}

/* ─── Scroll reveal ────────────────────────────────────────────────── */

// Adds `is-in` the first time the element enters the viewport. Used only on
// the two dark bands: it both fades them up AND is what starts the logo
// marquee, so the wall is at its first frame when the visitor arrives rather
// than halfway through a loop nobody watched.
function useReveal() {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const show = () => el.classList.add('is-in')

    if (typeof IntersectionObserver === 'undefined') { show(); return }

    let heardBack = false
    const io = new IntersectionObserver(([entry]) => {
      heardBack = true
      if (entry.isIntersecting) { show(); io.disconnect() }
    }, { threshold: 0, rootMargin: '0px 0px -60px 0px' })
    io.observe(el)

    // An observer reports on every element it is given shortly after
    // observe(), whether or not it intersects. Silence therefore means the
    // observer is not running at all — not that the section is merely still
    // below the fold. These bands open at opacity 0, so being wrong about
    // that would leave the logo wall permanently invisible; when in doubt,
    // show it and lose the animation.
    const failsafe = setTimeout(() => { if (!heardBack) { show(); io.disconnect() } }, 1200)

    return () => { clearTimeout(failsafe); io.disconnect() }
  }, [])
  return ref
}

/* ─── Happy Clients marquee ────────────────────────────────────────── */

// One row, scrolling left. The track holds the list twice and slides exactly
// half its width, so the second copy lands where the first began and the loop
// has no visible seam. The logos carry margin-right rather than the track
// carrying a flex `gap` for that reason — a gap would insert an extra space
// between the two copies and half the track would no longer be one full list.
function LogoMarquee() {
  return (
    <div className="cg-marquee">
      <div className="cg-marquee-track">
        {[0, 1].map((copy) => CLIENT_LOGOS.map((logo) => (
          <img
            key={`${copy}-${logo.src}`}
            className="cg-logo"
            // Sized off the row's base height by the logo's own measured
            // scale — see clientele.js. Matching heights across a mixed set
            // makes the square marks look shrunken next to the wordmarks.
            style={logo.scale === 1 ? undefined : { height: `calc(var(--cg-logo-h) * ${logo.scale})` }}
            src={logo.src}
            // The duplicate copy is decorative — announcing 42 client names
            // twice would make the wall unbearable on a screen reader.
            alt={copy === 0 ? logo.name : ''}
            aria-hidden={copy === 1 || undefined}
            // Intrinsic size from the manifest. The row is a single line of
            // 42 images; without these the browser has no aspect ratio to
            // reserve and the whole row reflows as they decode.
            width={logo.w}
            height={logo.h}
            decoding="async"
          />
        )))}
      </div>
    </div>
  )
}

/* ─── Floating-label field ─────────────────────────────────────────── */

// `placeholder=" "` is load-bearing: the label floats off `:placeholder-shown`,
// which is the only way to detect "has content" in CSS alone.
function Field({ id, label, required, optional, error, className = '', ...inputProps }) {
  return (
    <div className={`cg-field${error ? ' has-error' : ''}${className ? ` ${className}` : ''}`}>
      <input
        id={id}
        name={id}
        className="cg-input"
        placeholder=" "
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        {...inputProps}
      />
      <label className="cg-label" htmlFor={id}>
        {label}
        {required && <span className="cg-label-req"> *</span>}
        {optional && <span className="cg-label-opt"> (optional)</span>}
      </label>
      {error && <span className="cg-field-msg" id={`${id}-err`} role="alert">{error}</span>}
    </div>
  )
}

/* ─── Dial-code picker ─────────────────────────────────────────────── */

function DialPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const boxRef = useRef(null)
  const searchRef = useRef(null)

  useEffect(() => { if (!open) setQuery('') }, [open])
  useEffect(() => { if (open) searchRef.current?.focus() }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = useMemo(() => DIAL_CODES.find(c => c.dial === value), [value])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return DIAL_CODES
    return DIAL_CODES.filter(c =>
      c.name.toLowerCase().includes(q) || c.iso.toLowerCase().includes(q) || c.dial.includes(q),
    ).slice(0, 80)
  }, [query])

  return (
    <div ref={boxRef} className={`cg-dial${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="cg-dial-trigger"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-label={`Country dial code, currently ${value}`}
      >
        <span className="cg-dial-flag">{selected?.flag || '🌐'}</span>
        <span>{value}</span>
        <Icon.Chevron />
      </button>

      {open && (
        <div className="cg-dial-menu" role="dialog" aria-label="Choose a country">
          <div className="cg-dial-search">
            <Icon.Search />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search country…"
              autoComplete="off"
              aria-label="Search country"
            />
          </div>
          <div className="cg-dial-list">
            {results.length === 0
              ? <div className="cg-dial-empty">No matches</div>
              : results.map(c => (
                <button
                  type="button"
                  key={c.iso}
                  className={`cg-dial-opt${c.dial === value ? ' is-selected' : ''}`}
                  onClick={() => { onChange(c.dial); setOpen(false) }}
                >
                  <span className="cg-dial-flag">{c.flag}</span>
                  <span className="cg-dial-opt-name">{c.name}</span>
                  <span className="cg-dial-opt-code">{c.dial}</span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Chrome shared by the form and success views ──────────────────── */

function TopBar() {
  return (
    <header className="cg-topbar cg-fade-in">
      <a href="https://dikho.in" title="Visit Dikho.in" className="cg-topbar-logo-link">
        <img src="/dikho-logo.svg" alt="Dikho" className="cg-topbar-logo" />
      </a>
      <span className="cg-topbar-rule" aria-hidden="true" />
      <span className="cg-topbar-name">Corporate Gifting</span>
    </header>
  )
}

// Desktop shows two icons that unfurl the address and number on hover; phones
// have no hover, so they get a plain two-button bar instead.
function Contact() {
  return (
    <>
      <div className="cg-contact-pill">
        <a href="mailto:inquiry@dikho.in" className="cg-contact-item">
          <span className="cg-contact-icon"><Icon.Mail /></span>
          <span className="cg-contact-label">inquiry@dikho.in</span>
        </a>
        <span className="cg-contact-sep" aria-hidden="true" />
        <a href="tel:+918866008292" className="cg-contact-item">
          <span className="cg-contact-icon"><Icon.Phone /></span>
          <span className="cg-contact-label">+91 886600 8292</span>
        </a>
      </div>

      <div className="cg-contact-bar">
        <a href="mailto:inquiry@dikho.in"><Icon.Mail /> Email us</a>
        <a href="tel:+918866008292"><Icon.Phone /> Call us</a>
      </div>
    </>
  )
}

function Footer() {
  return (
    <footer className="cg-footer">
      <div className="cg-footer-row">
        <span className="cg-footer-copy"><Icon.Globe /> 2026 <strong>Dikho</strong>. All Rights Reserved.</span>
        <span className="cg-footer-sep" aria-hidden="true">|</span>
        <span className="cg-footer-social">
          <a href="https://www.facebook.com/share/1DRPCoKmUz/" target="_blank" rel="noreferrer" aria-label="Dikho on Facebook"><Icon.Facebook /></a>
          <a href="https://x.com/dikho0" target="_blank" rel="noreferrer" aria-label="Dikho on X"><Icon.X /></a>
          <a href="https://www.instagram.com/dikho0/" target="_blank" rel="noreferrer" aria-label="Dikho on Instagram"><Icon.Instagram /></a>
          <a href="https://www.linkedin.com/company/dikhoglobalmedia/" target="_blank" rel="noreferrer" aria-label="Dikho on LinkedIn"><Icon.LinkedIn /></a>
        </span>
      </div>
    </footer>
  )
}

/* ─── Success ──────────────────────────────────────────────────────── */

function SuccessView({ companyName }) {
  return (
    <div className="cg-shell">
      <TopBar />
      <main className="cg-main">
        <div className="cg-wrap" style={{ paddingTop: 36, paddingBottom: 12 }}>
          <div className="cg-card cg-fade-in">
            <div className="cg-success">
              <div className="cg-success-badge"><Icon.Check size={30} /></div>
              <h1 className="cg-success-title">
                Welcome to Dikho <span className="cg-hero-accent">Corporate Gifting</span>
              </h1>
              <p className="cg-success-body">
                Thank you, <strong>{companyName}</strong>, for sharing your details with us.
                We&rsquo;ve received your information successfully. Explore our curated corporate
                gifting catalogue to discover options for your team, clients and business partners.
              </p>
              <div className="cg-submit-row">
                <a href={DRIVE_CATALOGUE_URL} target="_blank" rel="noopener noreferrer" className="cg-btn-pill">
                  Explore Corporate Gifting Catalogue
                </a>
                <a
                  href={DRIVE_CATALOGUE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cg-btn-circle"
                  aria-label="Explore Corporate Gifting Catalogue"
                >
                  <Icon.ArrowNE />
                </a>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Contact />
      <Footer />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   PAGE
   ═══════════════════════════════════════════════════════════════════════ */

export default function PublicClientWelcome() {
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submittedCompany, setSubmittedCompany] = useState('')
  const [banner, setBanner] = useState('')
  const [errors, setErrors] = useState({})
  const [verifying, setVerifying] = useState(false)
  const captchaExecuteRef = useRef(null)
  const tokenWaitersRef = useRef([])

  const [form, setForm] = useState({
    company_name: '',
    contact_person: '',
    country_dialcode: '+91',
    contact: '',
    email: '',
    city: '',
  })

  const marqueeRef = useReveal()
  const quoteRef = useReveal()

  // Releases whoever is waiting on a token. No token is cached between
  // submits — see requestCaptchaToken.
  const settleWaiters = useCallback((token) => {
    const waiters = tokenWaitersRef.current
    tokenWaitersRef.current = []
    waiters.forEach(release => release(token))
  }, [])

  const handleVerified = useCallback((token) => settleWaiters(token), [settleWaiters])
  const handleExpired = useCallback(() => settleWaiters(null), [settleWaiters])

  const handleCaptchaError = useCallback((code) => {
    console.warn('Turnstile challenge failed', code)
    settleWaiters(null)
  }, [settleWaiters])

  // Runs the challenge NOW and resolves with the resulting token, or null if
  // it does not arrive in time. Nothing is cached: a token is good for 300
  // seconds and for exactly one use, so the only one worth having is the one
  // minted at the moment of submit.
  const requestCaptchaToken = useCallback(() => new Promise((resolve) => {
    let settled = false
    const release = (token) => { if (!settled) { settled = true; resolve(token) } }
    tokenWaitersRef.current.push(release)
    if (!captchaExecuteRef.current?.()) { release(null); return }
    setTimeout(() => release(null), CAPTCHA_WAIT_MS)
  }), [])

  const update = useCallback((key, val) => {
    setForm(f => ({ ...f, [key]: val }))
    setErrors(e => (e[key] ? { ...e, [key]: undefined } : e))
    setBanner('')
  }, [])

  /* ── Validation ─────────────────────────────────────────────────── */

  // +91 numbers are exactly 10 digits; elsewhere the length varies, so only a
  // sane floor is enforced rather than India's rule applied worldwide.
  function validate() {
    const next = {}
    if (!form.company_name.trim()) next.company_name = 'Company name is required.'
    if (!form.contact_person.trim()) next.contact_person = 'Contact person name is required.'

    const digits = form.contact.replace(/\D/g, '')
    if (!digits) next.contact = 'Mobile number is required.'
    else if (form.country_dialcode === '+91' && digits.length !== 10) next.contact = 'Please enter a valid 10-digit mobile number.'
    else if (digits.length < 6) next.contact = 'That number looks too short.'

    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      next.email = 'Please enter a valid email address.'
    }
    if (!form.city.trim()) next.city = 'City / Location is required.'
    return next
  }

  /* ── Submit ─────────────────────────────────────────────────────── */

  async function handleSubmit(e) {
    e.preventDefault()
    if (saving || verifying) return

    const fieldErrors = validate()
    if (Object.keys(fieldErrors).length) {
      setErrors(fieldErrors)
      const first = Object.keys(fieldErrors)[0]
      // Deferred so React has committed the error state before focus moves.
      // setTimeout, not rAF: rAF is tied to painting, and this has to run
      // even in a tab the browser is not currently painting.
      setTimeout(() => {
        const el = document.getElementById(first)
        el?.focus()
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 0)
      return
    }

    setErrors({})
    setBanner('')

    // Mint the token here rather than reusing one from page load — by now that
    // one would routinely be past its 300-second life.
    setVerifying(true)
    const token = await requestCaptchaToken()
    setVerifying(false)
    if (!token) {
      setBanner('The security check could not complete. Please try again.')
      return
    }

    setSaving(true)

    try {
      const payload = {
        company_name: form.company_name.trim(),
        name: form.contact_person.trim(),
        country_code: form.country_dialcode,
        mobile: form.contact.replace(/\D/g, ''),
        email: form.email.trim() || null,
        city: form.city.trim(),
      }

      // Corporate-gifting leads go to their own table (not the CRM clients
      // list), through a SECURITY DEFINER RPC — and via the API Worker rather
      // than supabase.rpc, so the Turnstile token is verified against
      // siteverify before anything is written. The anon role no longer has
      // EXECUTE on that function — see 20260927000000_turnstile_lockdown.sql.
      await apiPublicPost('/cg-lead', {
        'cf-turnstile-response': token,
        lead: payload,
      })

      setSubmittedCompany(payload.company_name)
      setSubmitted(true)
    } catch (err) {
      console.error(err)
      // `status` is only set when the API actually answered. Its absence means
      // the request never landed — DNS, offline, CORS — and "Failed to fetch"
      // is not something to show a visitor.
      setBanner(err?.status
        ? (err.message || 'Submission failed. Please try again.')
        : 'We could not reach our servers. Please check your connection and try again.')
      // Nothing to clean up: the spent token was never cached, and the next
      // submit runs a fresh challenge of its own.
    } finally {
      setSaving(false)
    }
  }

  if (submitted) return <SuccessView companyName={submittedCompany} />

  // Split the quote on its highlighted phrases so each can be wrapped in a
  // <mark>, rather than injecting markup — the copy stays plain text end to
  // end. Odd indices of a split with a capturing group are the matches.
  const quoteParts = splitOnPhrases(TESTIMONIAL.quote, TESTIMONIAL.highlights)

  return (
    <div className="cg-shell">
      <TopBar />

      <main className="cg-main">
        {/* ── Hero ─────────────────────────────────────────────────── */}
        <section className="cg-wrap cg-hero">
          <h1 className="cg-hero-title cg-fade-in" style={{ animationDelay: '60ms' }}>
            Welcome to Dikho <br />
            <span className="cg-hero-accent">Corporate Gifting.</span>
          </h1>
          <p className="cg-hero-sub cg-fade-in" style={{ animationDelay: '140ms' }}>
            Fill the details &amp; get instant access to 60+ exclusive Corporate &amp; Festive
            Gifting Catalogues 2026
          </p>
        </section>

        {/* ── Form ─────────────────────────────────────────────────── */}
        <section className="cg-wrap cg-form-section">
          <div className="cg-card cg-fade-in" style={{ animationDelay: '200ms' }}>
            <div className="cg-card-head">
              <span className="cg-card-icon"><Icon.Gift /></span>
              <div>
                <div className="cg-card-title">Quick Access Form</div>
                <div className="cg-card-sub">Please provide your details below to continue.</div>
              </div>
            </div>

            {banner && (
              <div className="cg-alert" role="alert">
                <Icon.Alert />
                <span>{banner}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate>
              <div className="cg-fields">
                <Field
                  id="company_name"
                  label="Company name"
                  required
                  value={form.company_name}
                  onChange={e => update('company_name', e.target.value)}
                  onFocus={preloadTurnstile}
                  error={errors.company_name}
                  autoComplete="organization"
                  enterKeyHint="next"
                  maxLength={120}
                />

                <Field
                  id="contact_person"
                  label="Your Name"
                  required
                  value={form.contact_person}
                  onChange={e => update('contact_person', e.target.value)}
                  onFocus={preloadTurnstile}
                  error={errors.contact_person}
                  autoComplete="name"
                  enterKeyHint="next"
                  maxLength={80}
                />

                <div className={`cg-field${errors.contact ? ' has-error' : ''}`}>
                  <div className="cg-phone">
                    <DialPicker
                      value={form.country_dialcode}
                      onChange={val => update('country_dialcode', val)}
                    />
                    <div className="cg-phone-num">
                      <input
                        id="contact"
                        name="contact"
                        className="cg-input"
                        placeholder=" "
                        // type="tel" + numeric inputMode is what opens the
                        // phone keypad instead of the full keyboard.
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel-national"
                        enterKeyHint="next"
                        maxLength={15}
                        value={form.contact}
                        onFocus={preloadTurnstile}
                        onChange={e => update('contact', e.target.value.replace(/\D/g, '').slice(0, 15))}
                        aria-invalid={errors.contact ? 'true' : undefined}
                        aria-describedby={errors.contact ? 'contact-err' : undefined}
                      />
                      <label className="cg-label" htmlFor="contact">
                        Mobile number<span className="cg-label-req"> *</span>
                      </label>
                    </div>
                  </div>
                  {errors.contact && <span className="cg-field-msg" id="contact-err" role="alert">{errors.contact}</span>}
                </div>

                <Field
                  id="email"
                  label="Email ID"
                  optional
                  type="email"
                  value={form.email}
                  onChange={e => update('email', e.target.value)}
                  error={errors.email}
                  autoComplete="email"
                  enterKeyHint="next"
                  maxLength={160}
                />

                <Field
                  id="city"
                  label="City / Location"
                  required
                  className="cg-field--full"
                  value={form.city}
                  onChange={e => update('city', e.target.value)}
                  error={errors.city}
                  autoComplete="address-level2"
                  enterKeyHint="done"
                  maxLength={80}
                />
              </div>

              {/* Renders nothing — invisible mode. It must still be mounted,
                  and mounted early, so the token is waiting by the time
                  anyone reaches the button. Deliberately does NOT clear the
                  banner on success: a failed submit resets the widget, the
                  widget re-solves itself immediately, and clearing here wiped
                  the error before anyone could read it. */}
              <TurnstileWidget
                onVerify={handleVerified}
                onExpire={handleExpired}
                onError={handleCaptchaError}
                executeRef={captchaExecuteRef}
              />

              <div className="cg-submit-row">
                <button type="submit" className="cg-btn-pill" disabled={saving || verifying}>
                  {verifying ? 'Verifying…' : saving ? 'Submitting…' : 'Explore The Catalogue'}
                </button>
                <button type="submit" className="cg-btn-circle" disabled={saving || verifying} aria-label="Explore The Catalogue">
                  <Icon.ArrowNE />
                </button>
              </div>
            </form>

            <p className="cg-assurance">
              🔒 <strong>Corporate Privacy Assured</strong><br />
              At Dikho, we value your time and confidentiality. Your information is strictly
              used for official communication only.
            </p>

          </div>
        </section>

        {/* ── Happy Clients ────────────────────────────────────────── */}
        <section className="cg-band cg-marquee-band cg-reveal" ref={marqueeRef} aria-label="Happy clients">
          <h2 className="cg-band-heading">
            <span className="cg-band-text">200+ Happy clients, What are you waiting for?</span>
          </h2>
          <LogoMarquee />
        </section>

        {/* ── Closing proof ────────────────────────────────────────── */}
        <section className="cg-band cg-testimonial-band cg-reveal" ref={quoteRef}>
          <figure className="cg-quote">
            <img
              className="cg-quote-photo"
              src={TESTIMONIAL.photo}
              alt={TESTIMONIAL.name}
              width="520"
              height="603"
            />
            <div className="cg-quote-body">
              <span className="cg-quote-mark" aria-hidden="true">&ldquo;</span>
              <blockquote className="cg-quote-text">
                {quoteParts.map((part, i) => (
                  i % 2 ? <mark key={i}>{part}</mark> : part
                ))}
              </blockquote>
              <figcaption>
                <span className="cg-quote-name">{TESTIMONIAL.name}</span>
                <span className="cg-quote-role">{TESTIMONIAL.role}</span>
              </figcaption>
            </div>
          </figure>
        </section>

        <Contact />
      </main>

      <Footer />
    </div>
  )
}
