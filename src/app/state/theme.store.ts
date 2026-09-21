import { Injectable, effect, signal } from '@angular/core';

export type Theme = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'json-viewer.theme';

/**
 * The colour scheme, applied as `data-theme` on `<html>`.
 *
 * `styles.css` declares every colour once with `light-dark()`, so the only
 * thing this has to do is narrow `color-scheme` -- removing the attribute hands
 * the choice back to the OS.
 *
 * Storage is wrapped: a browser with site data blocked throws on access rather
 * than returning null, and a viewer that cannot remember a preference should
 * still open.
 */
@Injectable({ providedIn: 'root' })
export class ThemeStore {
  readonly theme = signal<Theme>(read());

  constructor() {
    effect(() => {
      const theme = this.theme();
      const root = document.documentElement;
      if (theme === 'system') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', theme);
      write(theme);
    });
  }

  cycle(): void {
    this.theme.update((current) =>
      current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system',
    );
  }

  set(theme: Theme): void {
    this.theme.set(theme);
  }
}

function read(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Site data blocked. The OS preference is a fine default.
  }
  return 'system';
}

function write(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not being able to remember the choice is not worth failing over.
  }
}
