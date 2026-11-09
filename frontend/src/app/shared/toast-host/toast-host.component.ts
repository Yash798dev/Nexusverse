import { Component } from '@angular/core';
import { NgFor, NgIf, NgSwitch, NgSwitchCase } from '@angular/common';
import { ToastService } from '../../core/toast.service';

/** Renders ToastService's stack in the top-right corner (top-centre on phones). */
@Component({
  selector: 'app-toast-host',
  standalone: true,
  imports: [NgFor, NgIf, NgSwitch, NgSwitchCase],
  template: `
    <div class="stack" role="status" aria-live="polite">
      <div
        *ngFor="let t of toasts.toasts(); trackBy: trackById"
        class="toast"
        [class.is-leaving]="t.leaving"
        [attr.data-tone]="t.tone">
        <span class="icon" [ngSwitch]="t.tone" aria-hidden="true">
          <svg *ngSwitchCase="'success'" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          <svg *ngSwitchCase="'info'" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
          <svg *ngSwitchCase="'creative'" viewBox="0 0 24 24"><path d="M9 7.5l8 4.5-8 4.5z" /></svg>
          <svg *ngSwitchCase="'error'" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></svg>
        </span>
        <div class="body">
          <p class="title">{{ t.title }}</p>
          <p class="message" *ngIf="t.message">{{ t.message }}</p>
        </div>
        <button type="button" class="close" (click)="toasts.dismiss(t.id)" aria-label="Dismiss notification">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
        </button>
        <span class="timer" [style.animation-duration.ms]="t.duration" aria-hidden="true"></span>
      </div>
    </div>
  `,
  styles: [
    `
      .stack {
        position: fixed;
        top: 84px;
        right: 20px;
        z-index: 1100;
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: min(360px, calc(100vw - 32px));
        pointer-events: none;
      }

      .toast {
        --tone: var(--ay-text-2);
        position: relative;
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: start;
        gap: 12px;
        padding: 14px 12px 16px 14px;
        overflow: hidden;
        border-radius: 14px;
        border: 1px solid var(--ay-line-strong);
        background: var(--ay-surface);
        box-shadow: var(--ay-shadow-lg);
        color: var(--ay-ink);
        font-family: var(--ay-font);
        pointer-events: auto;
        animation: toast-in 0.55s var(--ay-ease) both;
      }
      .toast[data-tone='success'] { --tone: var(--ay-ink); }
      .toast[data-tone='creative'] { --tone: var(--ay-pink-bright); }
      .toast[data-tone='error'] { --tone: var(--ay-danger); }
      .toast.is-leaving { animation: toast-out 0.32s var(--ay-ease-in-out) both; }

      @keyframes toast-in {
        from { opacity: 0; transform: translate3d(28px, 0, 0) scale(0.96); filter: blur(6px); }
      }
      @keyframes toast-out {
        to { opacity: 0; transform: translate3d(28px, 0, 0) scale(0.97); }
      }

      .icon {
        position: relative;
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border-radius: 9px;
        border: 1px solid var(--ay-line-strong);
        color: var(--tone);
      }
      /* A yellow ping on arrival — an agent just finished something. */
      .icon::after {
        content: '';
        position: absolute;
        inset: -1px;
        border-radius: inherit;
        border: 1px solid var(--ay-yellow);
        animation: toast-ping 1.1s var(--ay-ease) 0.2s both;
      }
      .toast[data-tone='creative'] .icon::after { border-color: var(--ay-pink); }
      .toast[data-tone='error'] .icon::after { border-color: var(--ay-danger); }
      @keyframes toast-ping {
        from { opacity: 0.9; transform: scale(1); }
        to { opacity: 0; transform: scale(1.7); }
      }
      .icon svg,
      .close svg {
        width: 16px;
        height: 16px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .toast[data-tone='creative'] .icon svg { fill: currentColor; }

      .body { min-width: 0; padding-top: 1px; }
      .title {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        line-height: 1.35;
      }
      .message {
        margin: 3px 0 0;
        font-size: 13px;
        line-height: 1.45;
        color: var(--ay-text-2);
        overflow-wrap: anywhere;
      }

      .close {
        display: grid;
        place-items: center;
        width: 26px;
        height: 26px;
        padding: 0;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: var(--ay-text-3);
        cursor: pointer;
        transition: color 0.3s var(--ay-ease), background-color 0.3s var(--ay-ease);
      }
      .close:hover { color: var(--ay-ink); background: rgba(var(--ay-ink-rgb), 0.06); }
      .close:focus-visible { outline: 2px solid var(--ay-yellow); outline-offset: 1px; }

      /* Countdown: an energy line draining toward the right. */
      .timer {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 2px;
        background: var(--ay-energy);
        transform-origin: right center;
        animation: toast-timer linear both;
      }
      .toast[data-tone='error'] .timer { background: var(--ay-danger); }
      @keyframes toast-timer {
        from { transform: scaleX(1); }
        to { transform: scaleX(0); }
      }

      @media (max-width: 560px) {
        .stack { top: 72px; right: 16px; left: 16px; width: auto; }
      }
      @media (prefers-reduced-motion: reduce) {
        .toast, .toast.is-leaving, .icon::after { animation: none; }
        .timer { display: none; }
      }
    `,
  ],
})
export class ToastHostComponent {
  constructor(public toasts: ToastService) {}

  trackById(_: number, t: { id: number }): number {
    return t.id;
  }
}
