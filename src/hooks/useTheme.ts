// Explicit light/dark theme like the other tc apps: defaults to light, applied as
// data-theme on <html> (index.html applies it before first paint) and persisted.
import { useEffect, useState } from 'preact/hooks'

export type Theme = 'light' | 'dark'

export const THEME_KEY = 'tc-papers:theme'

function initialTheme(): Theme {
  try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light' } catch { return 'light' }
}

export function useTheme(): { theme: Theme; toggleTheme(): void } {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem(THEME_KEY, theme) } catch { /* private mode: session-only */ }
  }, [theme])
  return { theme, toggleTheme: () => setTheme(t => t === 'light' ? 'dark' : 'light') }
}
