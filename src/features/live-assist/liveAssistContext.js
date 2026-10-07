import { createContext, useContext } from 'react'

// Live Assist for the rest of the app: who is asking for help, starting a
// session, asking for help. Null outside the signed-in layout.
export const LiveAssistContext = createContext(null)

export function useLiveAssist() {
  return useContext(LiveAssistContext)
}
