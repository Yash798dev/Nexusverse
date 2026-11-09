import { isPlatformBrowser } from '@angular/common';
import { Inject, Injectable, PLATFORM_ID, signal } from '@angular/core';

/**
 * Tones follow the site's colour story:
 * success = completed output (ink), info = raw information (grey),
 * creative = generated content (pink), error = a stage that failed.
 */
export type ToastTone = 'success' | 'info' | 'creative' | 'error';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
  duration: number;
  leaving: boolean;
}

const MAX_VISIBLE = 4;
const LEAVE_MS = 320;

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);

  private nextId = 1;
  private recent = new Map<string, number>();
  private readonly isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  success(title: string, message?: string): void {
    this.show('success', title, message);
  }

  info(title: string, message?: string): void {
    this.show('info', title, message);
  }

  creative(title: string, message?: string): void {
    this.show('creative', title, message, 6000);
  }

  error(title: string, message?: string): void {
    this.show('error', title, message, 6000);
  }

  show(tone: ToastTone, title: string, message?: string, duration = 4200): void {
    // The socket can deliver the same event twice (e.g. COMPLETED line + process
    // exit); collapse identical toasts fired within a moment of each other.
    const key = `${tone}|${title}|${message ?? ''}`;
    const now = Date.now();
    if ((this.recent.get(key) ?? 0) > now - 1500) return;
    this.recent.set(key, now);

    const toast: Toast = { id: this.nextId++, tone, title, message, duration, leaving: false };
    this.toasts.update((list) => [...list, toast].slice(-MAX_VISIBLE));
    setTimeout(() => this.dismiss(toast.id), duration);
  }

  dismiss(id: number): void {
    const target = this.toasts().find((t) => t.id === id);
    if (!target || target.leaving) return;
    this.toasts.update((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => this.toasts.update((list) => list.filter((t) => t.id !== id)), LEAVE_MS);
  }

  /** Current browser notification permission; 'unsupported' where the API is missing. */
  notificationPermission(): NotificationPermission | 'unsupported' {
    if (!this.isBrowser || !('Notification' in window)) return 'unsupported';
    return Notification.permission;
  }

  /** Ask once, from a user gesture. Resolves with the resulting permission. */
  async requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
    if (!this.isBrowser || !('Notification' in window)) return 'unsupported';
    if (Notification.permission !== 'default') return Notification.permission;
    try {
      return await Notification.requestPermission();
    } catch {
      return Notification.permission;
    }
  }

  /** System notification — only while the tab is in the background, so it never doubles a toast. */
  notifyInBackground(title: string, body?: string): void {
    if (!this.isBrowser || !document.hidden) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      new Notification(title, { body, icon: 'favicon.ico' });
    } catch {
      // some browsers only allow notifications from a service worker
    }
  }
}
