import { Component, ElementRef, ViewChild } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { ShortcutsService } from '../../core/shortcuts.service';

/** The "?" keyboard-shortcuts panel. */
@Component({
  selector: 'app-shortcuts-panel',
  standalone: true,
  imports: [NgFor, NgIf],
  template: `
    <div class="backdrop" *ngIf="shortcuts.open()" (click)="shortcuts.close()">
      <section
        class="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ay-shortcuts-title"
        (click)="$event.stopPropagation()">
        <header class="head">
          <div>
            <span class="eyebrow"><span class="ay-live-dot"></span> Keyboard</span>
            <h2 id="ay-shortcuts-title">Shortcuts</h2>
          </div>
          <button #closeBtn type="button" class="close" (click)="shortcuts.close()" aria-label="Close shortcuts">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
          </button>
        </header>
        <ul class="list">
          <li *ngFor="let s of shortcuts.shortcuts; let i = index" [style.animation-delay.ms]="120 + i * 35">
            <span class="label">{{ s.label }}</span>
            <span class="keys">
              <ng-container *ngFor="let k of s.keys; let last = last">
                <kbd>{{ k }}</kbd><span class="then" *ngIf="!last">{{ s.keys[0] === 'G' ? 'then' : '+' }}</span>
              </ng-container>
            </span>
          </li>
        </ul>
      </section>
    </div>
  `,
  styles: [
    `
      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 1200;
        display: grid;
        place-items: center;
        padding: 20px;
        background: rgba(var(--ay-bg-rgb), 0.72);
        -webkit-backdrop-filter: blur(8px);
        backdrop-filter: blur(8px);
        animation: fade-in 0.35s var(--ay-ease) both;
      }
      @keyframes fade-in { from { opacity: 0; } }

      .panel {
        position: relative;
        width: min(460px, 100%);
        max-height: calc(100vh - 40px);
        overflow: auto;
        box-sizing: border-box;
        padding: 22px 22px 14px;
        border-radius: 20px;
        border: 1px solid var(--ay-line-strong);
        background: var(--ay-surface);
        box-shadow: var(--ay-shadow-lg);
        color: var(--ay-ink);
        font-family: var(--ay-font);
        animation: panel-in 0.55s var(--ay-ease) both;
      }
      .panel::before {
        content: '';
        position: absolute;
        left: 24px;
        right: 24px;
        top: -1px;
        height: 1px;
        background: linear-gradient(90deg, transparent, var(--ay-yellow), var(--ay-pink), transparent);
      }
      @keyframes panel-in {
        from { opacity: 0; transform: translateY(18px) scale(0.96); filter: blur(8px); }
      }

      .head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        margin-bottom: 14px;
      }
      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--ay-text-3);
      }
      h2 { margin: 6px 0 0; font-size: 22px; font-weight: 500; letter-spacing: -0.01em; }

      .close {
        display: grid;
        place-items: center;
        width: 34px;
        height: 34px;
        padding: 0;
        border: 1px solid var(--ay-line-strong);
        border-radius: 999px;
        background: transparent;
        color: var(--ay-text-2);
        cursor: pointer;
        transition: color 0.3s var(--ay-ease), border-color 0.3s var(--ay-ease);
      }
      .close:hover { color: var(--ay-ink); border-color: rgba(var(--ay-ink-rgb), 0.4); }
      .close:focus-visible { outline: 2px solid var(--ay-yellow); outline-offset: 2px; }
      .close svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }

      .list { list-style: none; margin: 0; padding: 0; }
      .list li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 11px 0;
        border-top: 1px solid var(--ay-line);
        animation: row-in 0.5s var(--ay-ease) both;
      }
      @keyframes row-in { from { opacity: 0; transform: translateY(8px); } }
      .label { font-size: 14px; color: var(--ay-text-2); }
      .keys { display: inline-flex; align-items: center; gap: 6px; flex: none; }
      .then { font-size: 11px; color: var(--ay-text-3); }
      kbd {
        min-width: 26px;
        box-sizing: border-box;
        padding: 4px 8px;
        border-radius: 7px;
        border: 1px solid var(--ay-line-strong);
        border-bottom-width: 2px;
        background: var(--ay-surface-2);
        color: var(--ay-ink);
        font: 600 12px/1 var(--ay-mono);
        text-align: center;
      }

      @media (prefers-reduced-motion: reduce) {
        .backdrop, .panel, .list li { animation: none; }
      }
    `,
  ],
})
export class ShortcutsPanelComponent {
  @ViewChild('closeBtn')
  set closeButton(ref: ElementRef<HTMLButtonElement> | undefined) {
    // Move focus into the dialog when it opens.
    ref?.nativeElement.focus();
  }

  constructor(public shortcuts: ShortcutsService) {}
}
