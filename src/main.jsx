import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './components/ContactDetails.css'
import './tailwind.css'
import App from './app/App.jsx'
import AppErrorBoundary from './components/AppErrorBoundary.jsx'
import ConnectionStatus from './components/ConnectionStatus.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
    <ConnectionStatus />
  </StrictMode>,
)
