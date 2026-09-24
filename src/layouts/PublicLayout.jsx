import { Suspense, useEffect } from 'react'
import { Outlet } from 'react-router-dom'

export default function PublicLayout() {
  useEffect(() => {
    // Public pages are customer-facing — keep the internal "CRM" wording out of
    // the browser tab. (The authenticated app sets "Dikho CRM".)
    document.title = 'Dikho'
  }, [])

  return (
    <Suspense fallback={<div className="loading-screen">Loading...</div>}>
      <Outlet />
    </Suspense>
  )
}
