import { createClient } from '@supabase/supabase-js'
import { shellSessionStorage } from './shellVault'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables')
}

// In the Android app the app signs people in and owns the session; this page reads it
// from the app's vault. The page must never spend the refresh token itself: two
// refreshers racing on one token would end the session, so a refresh is asked of the
// app, which answers with the session it holds (refreshed first if it needed to be).
// See docs/decisions/0013-native-sign-in.md.
const appAuth = typeof window === 'undefined' ? null : window.__dikhoNative?.auth
export const appOwnsSession = Boolean(shellSessionStorage && appAuth?.owner === 'app' && typeof appAuth.refresh === 'function')
const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
// As supabase-js builds it, whether or not the address ends in a slash.
const refreshUrl = `${new URL('auth/v1', supabaseUrl.replace(/\/?$/, '/')).href}/token?grant_type=refresh_token`

function appFetch(input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url
  if (typeof url === 'string' && url.startsWith(refreshUrl)) {
    return appAuth.refresh(storageKey).then((session) => {
      // A network-style failure: supabase-js keeps the session and tries again later.
      if (!session) throw new TypeError('The app could not refresh the session')
      return new Response(session, { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
  }
  return fetch(input, init)
}

const options = appOwnsSession
  ? {
      auth: { storage: shellSessionStorage, storageKey, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: appFetch },
    }
  : shellSessionStorage
    ? { auth: { storage: shellSessionStorage } }
    : undefined

export const supabase = createClient(supabaseUrl, supabaseKey, options)
