import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'

export default function PublicLayout() {
  return (
    <Suspense fallback={<div className="loading-screen">Loading...</div>}>
      <Outlet />
    </Suspense>
  )
}
