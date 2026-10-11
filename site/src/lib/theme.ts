export type Theme = 'light' | 'dark' | 'system';

const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function currentTheme(): Theme {
  return (document.documentElement.dataset.theme as Theme) || 'system';
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  try {
    if (theme === 'system') localStorage.removeItem('od-theme');
    else localStorage.setItem('od-theme', theme);
  } catch {
    // Storage can be blocked; the choice then lasts for this page only.
  }
  root.dataset.theme = theme;
  root.classList.toggle('dark', theme === 'dark' || (theme === 'system' && media().matches));
  document.dispatchEvent(new CustomEvent('od:theme', { detail: theme }));
}

// Follow the system live while no explicit choice is stored.
if (typeof window !== 'undefined') {
  media().addEventListener('change', () => {
    if (currentTheme() === 'system') applyTheme('system');
  });
}
