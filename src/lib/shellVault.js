// Where the Supabase session is kept. In a browser that stays localStorage, the
// default. In the Android app, page_bridge.js offers window.__dikhoNative.vault,
// which lands in the Android Keystore through flutter_secure_storage, so the
// session is encrypted at rest and a write is on disk before it resolves.
// See docs/decisions/0012-android-native-screens.md.
const vault = typeof window === 'undefined' ? null : window.__dikhoNative?.vault

export const shellSessionStorage = vault
  ? {
      async getItem(key) {
        const stored = await vault.get(key)
        if (stored !== null) return stored
        // Moved once, from where the app's first version left it.
        let earlier = null
        try { earlier = window.localStorage.getItem(key) } catch { /* blocked: nothing to move */ }
        if (earlier !== null) {
          await vault.set(key, earlier)
          window.localStorage.removeItem(key)
        }
        return earlier
      },
      setItem: (key, value) => vault.set(key, value),
      removeItem: (key) => vault.remove(key),
    }
  : null
