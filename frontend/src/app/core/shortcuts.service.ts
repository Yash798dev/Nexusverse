import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Inject, Injectable, NgZone, PLATFORM_ID, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ThemeService } from './theme.service';

export interface Shortcut {
  keys: string[];
  label: string;
}

const GO_TO: Record<string, string> = {
  h: '/home',
  k: '/knowledge',
  w: '/workflow',
  p: '/profile',
  s: '/subscription',
  l: '/',
};

/**
 * Global keyboard shortcuts. Ignored while typing in a field, and when Ctrl,
 * Cmd or Alt are held so browser/OS shortcuts keep working.
 *   T        toggle theme
 *   G then H/K/W/P/S/L  go to a page
 *   ?        open/close the shortcuts panel (Esc closes)
 */
@Injectable({ providedIn: 'root' })
export class ShortcutsService {
  readonly open = signal(false);

  readonly shortcuts: Shortcut[] = [
    { keys: ['T'], label: 'Toggle dark / light theme' },
    { keys: ['G', 'H'], label: 'Go to Dashboard' },
    { keys: ['G', 'K'], label: 'Go to Knowledge Hub' },
    { keys: ['G', 'W'], label: 'Go to Studio' },
    { keys: ['G', 'P'], label: 'Go to Profile' },
    { keys: ['G', 'S'], label: 'Go to Pricing' },
    { keys: ['G', 'L'], label: 'Go to the landing page' },
    { keys: ['Ctrl', 'Enter'], label: 'Start the workflow (in the prompt box)' },
    { keys: ['?'], label: 'Show or hide this panel' },
    { keys: ['Esc'], label: 'Close' },
  ];

  private started = false;
  private awaitingGoTo = false;
  private goToTimer?: ReturnType<typeof setTimeout>;
  private readonly isBrowser: boolean;

  constructor(
    private zone: NgZone,
    private router: Router,
    private theme: ThemeService,
    @Inject(DOCUMENT) private document: Document,
    @Inject(PLATFORM_ID) platformId: object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  start(): void {
    if (!this.isBrowser || this.started) return;
    this.started = true;
    this.zone.runOutsideAngular(() => this.document.addEventListener('keydown', this.onKeyDown));
  }

  toggle(): void {
    this.open.update((v) => !v);
  }

  close(): void {
    this.open.set(false);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;

    if (e.key === 'Escape') {
      if (this.open()) this.zone.run(() => this.close());
      return;
    }

    const target = e.target instanceof HTMLElement ? e.target : null;
    if (target?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;

    const key = e.key.toLowerCase();

    if (this.awaitingGoTo) {
      this.awaitingGoTo = false;
      clearTimeout(this.goToTimer);
      const url = GO_TO[key];
      if (url) {
        e.preventDefault();
        this.zone.run(() => {
          this.close();
          this.router.navigateByUrl(url);
        });
      }
      return;
    }

    if (e.key === '?') {
      e.preventDefault();
      this.zone.run(() => this.toggle());
    } else if (key === 'g') {
      this.awaitingGoTo = true;
      this.goToTimer = setTimeout(() => (this.awaitingGoTo = false), 1200);
    } else if (key === 't') {
      e.preventDefault();
      this.zone.run(() => this.theme.toggle());
    }
  };
}
