import './index.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'

// Stamp the theme class before React mounts so first paint is correct (no flash).
const initial = window.fordb.appearance.initialTheme
document.documentElement.classList.toggle('dark', initial === 'dark')
document.documentElement.classList.toggle('light', initial === 'light')

createRoot(document.getElementById('root')!).render(<App />)
