import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './styles/index.css'
// After the sheet that pulls in the base tokens: this overrides the accent the
// base sheet just defined. Imported here rather than with a CSS @import, which
// is how g-snap does it and the only form Vite resolves for a package path.
import '@garam/theme/accent-violet.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
)
