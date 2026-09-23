import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { detectModelPassCrash } from './services/cornerEdgeModels.js'

// Before anything renders: if the last page died during a model pass, switch the models off on this device.
detectModelPassCrash()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
