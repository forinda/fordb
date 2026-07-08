import './index.css'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { queryClient } from './query/client'

// Stamp the theme class before React mounts so first paint is correct (no flash).
const initial = window.fordb.appearance.initialTheme
document.documentElement.classList.toggle('dark', initial === 'dark')
document.documentElement.classList.toggle('light', initial === 'light')

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
)
