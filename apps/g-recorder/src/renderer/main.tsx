// Thin shim — re-exports the real renderer entry so electron-vite's dev server
// can serve it via a URL within its root (src/renderer/). The actual source
// lives in app/renderer/src/ to follow the project's folder structure.
import '../../app/renderer/src/main.tsx'
