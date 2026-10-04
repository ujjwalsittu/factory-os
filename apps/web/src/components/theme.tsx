'use client';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

/** Runs before paint to avoid a flash of the wrong theme (docs/13 U4). */
export const themeScript = `(function(){try{var t=localStorage.getItem('fos.theme');if(!t){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}})()`;

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<string | null>(null);
  useEffect(() => setTheme(document.documentElement.dataset.theme ?? 'light'), []);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('fos.theme', next);
    } catch {}
    setTheme(next);
  };
  return (
    <button
      type="button"
      onClick={toggle}
      className={className ?? 'inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg'}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
