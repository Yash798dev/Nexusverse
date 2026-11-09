import { Component } from '@angular/core';
import { ThemeService } from '../../core/theme.service';

let nextId = 0;

/**
 * Sun / moon theme switch. The moon's crescent is a masked circle: switching to
 * light slides the "bite" away and the rays grow out; switching back reverses it.
 * Colours follow `currentColor`, so it reads correctly on any surface — including
 * the landing hero, which stays dark in both themes.
 */
@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  template: `
    <button
      type="button"
      class="toggle"
      [class.is-light]="!theme.isDark()"
      [attr.aria-label]="theme.isDark() ? 'Switch to light theme' : 'Switch to dark theme'"
      [attr.title]="theme.isDark() ? 'Light theme' : 'Dark theme'"
      (click)="onToggle($event)">
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
        <mask [attr.id]="maskId">
          <rect x="-4" y="-4" width="32" height="32" fill="white" />
          <circle class="bite" cx="19" cy="5" r="7.5" fill="black" />
        </mask>
        <circle class="core" cx="12" cy="12" r="5" [attr.mask]="'url(#' + maskId + ')'" />
        <g class="rays">
          <line x1="12" y1="1.5" x2="12" y2="3.5" />
          <line x1="12" y1="20.5" x2="12" y2="22.5" />
          <line x1="1.5" y1="12" x2="3.5" y2="12" />
          <line x1="20.5" y1="12" x2="22.5" y2="12" />
          <line x1="4.6" y1="4.6" x2="6" y2="6" />
          <line x1="18" y1="18" x2="19.4" y2="19.4" />
          <line x1="4.6" y1="19.4" x2="6" y2="18" />
          <line x1="18" y1="6" x2="19.4" y2="4.6" />
        </g>
      </svg>
    </button>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        flex: none;
      }
      .toggle {
        --size: var(--ay-toggle-size, 38px);
        position: relative;
        display: grid;
        place-items: center;
        width: var(--size);
        height: var(--size);
        padding: 0;
        border-radius: 999px;
        border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
        background: color-mix(in srgb, currentColor 4%, transparent);
        color: inherit;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition: border-color 0.35s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.35s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .toggle:hover {
        border-color: color-mix(in srgb, currentColor 40%, transparent);
        background: color-mix(in srgb, currentColor 8%, transparent);
      }
      .toggle:focus-visible {
        outline: 2px solid var(--ay-accent);
        outline-offset: 3px;
      }

      .icon {
        width: 46%;
        height: 46%;
        overflow: visible;
      }
      .core,
      .bite,
      .rays line {
        transform-box: view-box;
        transform-origin: 12px 12px;
        transition: transform 0.6s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.35s cubic-bezier(0.22, 1, 0.36, 1),
          fill 0.3s ease;
      }

      /* Dark (moon) */
      .core {
        fill: currentColor;
        transform: scale(1.7);
      }
      .rays line {
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        opacity: 0;
        transform: scale(0.5);
      }
      /* Moon is the creative hour — a magenta glint on hover */
      .toggle:hover .core { fill: var(--ay-magenta); }

      /* Light (sun) */
      .is-light .core { transform: scale(1); }
      .is-light .bite { transform: translate(9px, -9px); }
      .is-light .rays line { opacity: 1; transform: scale(1); }
      .is-light .rays line:nth-child(2) { transition-delay: 0.03s; }
      .is-light .rays line:nth-child(3) { transition-delay: 0.06s; }
      .is-light .rays line:nth-child(4) { transition-delay: 0.09s; }
      .is-light .rays line:nth-child(5) { transition-delay: 0.12s; }
      .is-light .rays line:nth-child(6) { transition-delay: 0.15s; }
      .is-light .rays line:nth-child(7) { transition-delay: 0.18s; }
      .is-light .rays line:nth-child(8) { transition-delay: 0.21s; }
      /* Sun is AI energy — yellow on hover */
      .is-light.toggle:hover .core { fill: #e0ac12; }
      .is-light.toggle:hover .rays line { stroke: #e0ac12; }

      @media (prefers-reduced-motion: reduce) {
        .core, .bite, .rays line { transition: none; }
      }
    `,
  ],
})
export class ThemeToggleComponent {
  readonly maskId = `ay-theme-mask-${nextId++}`;

  constructor(public theme: ThemeService) {}

  onToggle(event: MouseEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.theme.toggle({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }
}
