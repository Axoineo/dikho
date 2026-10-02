import { Suspense, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import BrandLoader, { AppReady } from '../components/BrandLoader'
import RouteBoundary from '../components/RouteBoundary'

export default function PublicLayout() {
  useEffect(() => {
    // Public pages are customer-facing — keep the internal "CRM" wording out of
    // the browser tab. (The authenticated app sets "Dikho CRM".)
    document.title = 'Dikho'
  }, [])

  return (
    <RouteBoundary>
      <Suspense fallback={<BrandLoader />}>
        <Outlet />
        <AppReady />
      </Suspense>
    </RouteBoundary>
  )
}
