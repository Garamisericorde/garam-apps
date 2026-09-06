import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@garam/theme/all.css'
import '@garam/theme/accent-violet.css'
import '@garam/ui/styles.css'
import './styles/index.css'
import { App } from './ui/App'

const container = document.getElementById('root')
if (!container) throw new Error('Root element missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
