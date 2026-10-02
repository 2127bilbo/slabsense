/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'
import { detectModelPassCrash } from './services/cornerEdgeModels.js'

// Before anything renders: if the last page died during a model pass, switch the models off on this device.
detectModelPassCrash()

// A rejected promise nobody awaited used to vanish; log it with its stack (audit E-01).
window.addEventListener('unhandledrejection', (e) => console.error('[unhandledrejection]', e.reason))

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
