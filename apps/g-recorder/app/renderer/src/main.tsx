import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './styles/index.css'
// After the sheet that pulls in the base tokens: this overrides the accent the
// base sheet just defined. Imported here rather than with a CSS @import, which
// is how g-snap does it and the only form Vite resolves for a package path.
import '@garam/theme/accent-violet.css'

/*
 * A file dropped anywhere but a drop target would otherwise make Chromium
 * navigate to it — the whole interface replaced by a bare video, with no way
 * back short of restarting. The drop targets stop the event before it reaches
 * here, so this only ever catches the misses.
 */
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (event) => event.preventDefault())
}

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
)
