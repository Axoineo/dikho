import { useEffect, useState } from 'react'
import { TYPING_MS } from './chat'

/** True while the other side's last "typing" signal is fresh. `now` only
 *  moves when that signal runs out, so until then it is older than it. */
export function useTyping(typingAt) {
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!typingAt) return undefined
    const t = setTimeout(() => setNow(Date.now()), Math.max(typingAt + TYPING_MS - Date.now(), 0) + 50)
    return () => clearTimeout(t)
  }, [typingAt])
  return typingAt > 0 && now < typingAt + TYPING_MS
}
