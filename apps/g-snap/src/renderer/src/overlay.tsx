import React from 'react'
import ReactDOM from 'react-dom/client'
import '@garam/theme/all.css'
// After all.css: it overrides the accent tokens the base sheet just defined.
import '@garam/theme/accent-violet.css'
import '@garam/ui/styles.css'
import './styles/overlay.css'
import { OverlayApp } from './overlay/OverlayApp'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <OverlayApp />
  </React.StrictMode>,
)
