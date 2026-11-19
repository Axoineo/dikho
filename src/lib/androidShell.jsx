import { useEffect } from 'react'
import { supabase } from './supabase'
import { canOpen, hasPermission, EMAIL_HUB_BUILD } from './access'
import { useLiveAssist } from '../features/live-assist/liveAssistContext'

// The page's half of the Android app. The app draws its own drawer, top bar and
// WhatsApp inbox, while this page keeps the session, the access check and every
// other module. window.__dikhoNative exists only inside the app, and only on the
// CRM's own origin (WebViewBridge.kt pins it), so in a browser all of this is
// inert. It only ever tells the app things the signed-in person may already see:
// authorization stays in RLS and the API.
const native = typeof window === 'undefined' ? null : window.__dikhoNative

export const inAndroidApp = Boolean(native)

// The screens this copy of the app draws itself. The page goes live before an APK
// reaches everyone, so it asks rather than assumes: 1.1.0 predates the list and has
// the inbox only.
export const nativeScreens = new Set(native ? (Array.isArray(native.screens) ? native.screens : ['inbox']) : [])

const post = (message) => native?.post(message)

// The pages the app's drawer can link to. It shows only the ones reported here,
// so what each person sees has one source of truth: PAGE_ACCESS.
const DRAWER_PATHS = [
  '/clients', '/leads', '/sales-orders', '/vendors', '/purchase-orders',
  '/whatsapp', '/whatsapp/inbox', '/whatsapp/contacts', '/whatsapp/campaigns', '/whatsapp/templates',
  '/users', '/settings',
]
const EMAIL_PATHS = ['/email', '/email/inbox', '/email/campaigns', '/email/templates', '/email/consent', '/email/analytics', '/email/settings']

const handlers = {}
export function setShellHandlers(next) {
  Object.assign(handlers, next)
}

// Called by the app with fixed scripts: nothing from a page or a message is ever
// put into them.
if (native) {
  window.__dikhoShell = {
    sendToken(id) {
      supabase.auth.getSession().then(
        ({ data }) => post({ t: 'token', id, token: data.session?.access_token ?? null }),
        () => post({ t: 'token', id, token: null }),
      )
    },
    signOut: () => supabase.auth.signOut(),
    noteActivity: (section) => handlers.noteActivity?.(section),
    askForHelp: () => handlers.askForHelp?.(),
    settingsChanged: () => handlers.settingsChanged?.(),
  }
}

// [reason], when the person did not choose it: 'forced', 'ended', 'idle', 'suspended',
// 'archived' or 'not_staff'. The app's sign-in screen says why.
export function reportSignedOut(reason = null) {
  post({ t: 'signedOut', ...(reason ? { reason } : {}) })
}

// The person used the page. In an app that owns the session, the app keeps the idle
// clock, so the page tells it, at most every 30 seconds.
let lastActivityReport = 0
export function reportActivity() {
  const now = Date.now()
  if (now - lastActivityReport < 30_000) return
  lastActivityReport = now
  post({ t: 'active' })
}

export function reportSessionWarning(showing) {
  post({ t: 'warning', showing })
}

// Tells the app what to draw once this person's access is known, and takes it
// back when it no longer applies.
export function AndroidShellBridge({ access, session }) {
  const liveAssist = useLiveAssist()
  const askForHelp = liveAssist?.openAskHelp
  const helpRequested = Boolean(liveAssist?.hasOpenHelpRequest)

  useEffect(() => {
    setShellHandlers({ askForHelp })
    return () => setShellHandlers({ askForHelp: null })
  }, [askForHelp])

  useEffect(() => {
    const user = session?.user
    const email = user?.email ?? ''
    post({
      t: 'access',
      userId: access.user_id,
      name: access.full_name || user?.user_metadata?.full_name || email.split('@')[0] || '',
      email,
      allowed: [...DRAWER_PATHS, ...(EMAIL_HUB_BUILD ? EMAIL_PATHS : [])].filter((path) => canOpen(access, path)),
      permissions: Object.keys(access.permissions ?? {}).filter((key) => hasPermission(access, key)),
      // 'own' or 'all' for each: the app offers Edit only on orders this person may change.
      scopes: Object.fromEntries(Object.entries(access.permissions ?? {}).filter(([key]) => hasPermission(access, key))),
      helpOffered: Boolean(liveAssist),
      helpRequested,
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
      publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    })
  }, [access, session, liveAssist, helpRequested])

  useEffect(() => reportSignedOut, [])

  return null
}

// A native screen in the app. A link to it from any page opens that screen instead of
// downloading the browser's copy.
export function NativeHandoff({ screen }) {
  useEffect(() => { post({ t: 'open', screen }) }, [screen])
  return null
}
