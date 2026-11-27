import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import './styles.css'
import App from './App'

// apply saved theme before first paint (App keeps it in sync afterwards)
const savedTheme = localStorage.getItem('theme')
document.documentElement.dataset.theme =
  savedTheme === 'light' || savedTheme === 'dark'
    ? savedTheme
    : matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'

async function boot() {
  // In a plain browser (no Electron preload) use fake data so the UI can be previewed.
  if (!window.api && import.meta.env.DEV) {
    const { installMockApi } = await import('./mockApi')
    installMockApi()
  }
  createRoot(document.getElementById('root')!).render(<App />)
}
boot()
