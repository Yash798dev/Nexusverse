import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Inject, Injectable, NgZone, PLATFORM_ID, signal } from '@angular/core';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'ay-theme';
const THEME_COLOR: Record<Theme, string> = { dark: '#050505', light: '#fafafa' };

/**
 * Dark / light theme. The active theme lives on <html data-theme="…">; every
 * colour token in styles.css is redefined under [data-theme='light'].
 *
 * index.html sets the attribute from localStorage before Angular boots, so the
 * first paint is already in the right theme — this service picks it up from there.
 * Dark is the default: it is the product's cinematic identity.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>('dark');

  private readonly isBrowser: boolean;

  constructor(
    @Inject(DOCUMENT) private document: Document,
    @Inject(PLATFORM_ID) platformId: object,
    private zone: NgZone
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
    if (this.isBrowser) {
      const current = this.document.documentElement.getAttribute('data-theme');
      this.apply(current === 'light' ? 'light' : 'dark', false);
    }
  }

  isDark(): boolean {
    return this.theme() === 'dark';
  }

  /**
   * Switch themes. With the View Transitions API the new theme is revealed as a
   * circle growing out of `origin` (the toggle button); otherwise colours cross-fade.
   */
  toggle(origin?: { x: number; y: number }): void {
    const next: Theme = this.isDark() ? 'light' : 'dark';
    if (!this.isBrowser) {
      this.theme.set(next);
      return;
    }

    const root = this.document.documentElement;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const doc = this.document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };

    if (reduceMotion) {
      this.apply(next, true);
      return;
    }

    if (!doc.startViewTransition) {
      root.classList.add('ay-theme-fade');
      this.apply(next, true);
      setTimeout(() => root.classList.remove('ay-theme-fade'), 450);
      return;
    }

    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    root.style.setProperty('--ay-vt-x', `${x}px`);
    root.style.setProperty('--ay-vt-y', `${y}px`);
    root.style.setProperty('--ay-vt-r', `${radius}px`);
    root.classList.add('ay-theme-switching');

    const transition = doc.startViewTransition(() => this.zone.run(() => this.apply(next, true)));
    transition.finished.finally(() => root.classList.remove('ay-theme-switching'));
  }

  private apply(theme: Theme, persist: boolean): void {
    this.theme.set(theme);
    if (!this.isBrowser) return;

    this.document.documentElement.setAttribute('data-theme', theme);
    this.document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch {
        // storage unavailable (private mode) — the choice just won't persist
      }
    }
  }
}
