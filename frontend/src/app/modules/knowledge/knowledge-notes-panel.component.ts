import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { marked } from 'marked';
import { TimelineEvent } from '../../services/knowledge.service';

/**
 * The generated study notes, plus the fused speech/visual timeline.
 *
 * Two things worth knowing about the rendering:
 *
 * 1. The markdown is language-model output, so it is rendered through Angular's
 *    default [innerHTML] sanitizer — NOT bypassSecurityTrustHtml. Anything
 *    script-like the model emitted is stripped before it reaches the DOM.
 * 2. Gemini is instructed to write timestamps as [00:04:10](#t=250) links. Rather
 *    than injecting click handlers into the generated HTML, clicks are caught by
 *    delegation on the container and matched against that href shape.
 */
@Component({
  selector: 'app-knowledge-notes-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="panel">
      <!-- Timeline -->
      <details class="timeline" *ngIf="timeline?.length">
        <summary>
          <span class="sum-title">Timeline</span>
          <span class="chip">{{ timeline.length }} events</span>
          <span class="counts">{{ speechCount }} speech · {{ visualCount }} visual</span>
        </summary>

        <div class="filters" role="group" aria-label="Filter timeline">
          <button type="button" *ngFor="let f of filters"
                  [class.on]="filter === f"
                  (click)="filter = f">
            {{ f === 'all' ? 'All' : f === 'speech' ? 'Speech' : 'Visual' }}
          </button>
        </div>

        <ul class="events">
          <li *ngFor="let ev of visibleEvents">
            <button type="button" (click)="seek.emit(ev.time_sec)" [title]="ev.text || ev.ocr_text || ''">
              <span class="ev-dot" [attr.data-type]="ev.type"></span>
              <span class="ev-time">{{ ev.time_str }}</span>
              <span class="ev-text">{{ label(ev) }}</span>
            </button>
          </li>
        </ul>
      </details>

      <!-- Notes -->
      <article class="notes" (click)="onNotesClick($event)" [innerHTML]="html"></article>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .panel { display: flex; flex-direction: column; gap: 22px; }

      .timeline { border: 1px solid var(--ay-line); border-radius: 13px; background: var(--ay-surface); overflow: hidden; }
      summary { display: flex; align-items: center; gap: 10px; padding: 13px 16px; cursor: pointer; list-style: none; flex-wrap: wrap; }
      summary::-webkit-details-marker { display: none; }
      .sum-title { font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 700; color: var(--ay-text-2); }
      .chip { font-size: 11px; padding: 2px 9px; border-radius: 999px; background: var(--ay-yellow-soft); border: 1px solid var(--ay-yellow-edge); color: var(--ay-yellow-bright); }
      .counts { font-size: 11.5px; color: var(--ay-text-3); margin-left: auto; }

      .filters { display: flex; gap: 6px; padding: 0 16px 10px; border-bottom: 1px solid var(--ay-line); }
      .filters button {
        padding: 4px 12px; border-radius: 999px; font: inherit; font-size: 11.5px; font-weight: 600;
        border: 1px solid var(--ay-line); background: none; color: var(--ay-text-3); cursor: pointer;
      }
      .filters button.on { border-color: var(--ay-yellow-edge); background: var(--ay-yellow-soft); color: var(--ay-yellow-bright); }

      .events { list-style: none; margin: 0; padding: 8px; max-height: 300px; overflow-y: auto; display: grid; gap: 2px; }
      .events button {
        width: 100%; display: flex; align-items: center; gap: 10px;
        padding: 7px 10px; border-radius: 8px; border: 1px solid transparent;
        background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
      }
      .events button:hover { background: rgba(var(--ay-ink-rgb), 0.05); border-color: var(--ay-line); }
      .ev-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: var(--ay-yellow); }
      .ev-dot[data-type='visual'] { background: var(--ay-pink); }
      .ev-time { font: 500 11.5px/1 var(--ay-mono); color: var(--ay-text-3); flex: none; }
      .ev-text { font-size: 12.5px; color: var(--ay-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      /* ── Generated notes ─────────────────────────────────────────────── */
      .notes { font-size: 15px; line-height: 1.72; color: var(--ay-text-2); }
      .notes ::ng-deep h1 { font-size: 25px; font-weight: 700; color: var(--ay-ink); margin: 0 0 18px; letter-spacing: -0.01em; }
      .notes ::ng-deep h2 {
        font-size: 18px; font-weight: 700; color: var(--ay-ink);
        margin: 30px 0 12px; padding-bottom: 7px; border-bottom: 1px solid var(--ay-line);
      }
      .notes ::ng-deep h3 { font-size: 15px; font-weight: 700; color: var(--ay-ink-soft); margin: 22px 0 8px; }
      .notes ::ng-deep p { margin: 0 0 13px; }
      .notes ::ng-deep ul, .notes ::ng-deep ol { margin: 0 0 15px; padding-left: 22px; }
      .notes ::ng-deep li { margin-bottom: 6px; }
      .notes ::ng-deep strong { color: var(--ay-ink); font-weight: 650; }
      .notes ::ng-deep code {
        font: 500 13px/1.5 var(--ay-mono);
        background: rgba(var(--ay-ink-rgb), 0.07);
        padding: 2px 6px; border-radius: 5px; color: var(--ay-ink-soft);
      }
      .notes ::ng-deep pre {
        background: rgba(var(--ay-bg-rgb), 0.65); border: 1px solid var(--ay-line);
        border-radius: 11px; padding: 14px 16px; overflow-x: auto; margin: 0 0 16px;
      }
      .notes ::ng-deep pre code { background: none; padding: 0; }
      .notes ::ng-deep blockquote {
        margin: 0 0 15px; padding: 3px 0 3px 15px;
        border-left: 2px solid var(--ay-yellow-edge); color: var(--ay-text-3);
      }
      .notes ::ng-deep table { width: 100%; border-collapse: collapse; margin: 0 0 16px; font-size: 13.5px; display: block; overflow-x: auto; }
      .notes ::ng-deep th, .notes ::ng-deep td { border: 1px solid var(--ay-line); padding: 8px 11px; text-align: left; }
      .notes ::ng-deep th { background: rgba(var(--ay-ink-rgb), 0.05); color: var(--ay-ink); font-weight: 650; }
      /* Timestamp links are the one interactive element inside generated HTML. */
      .notes ::ng-deep a[href^='#t='] {
        display: inline-block;
        font: 600 12px/1 var(--ay-mono);
        color: var(--ay-yellow-bright); text-decoration: none;
        background: var(--ay-yellow-soft); border: 1px solid var(--ay-yellow-edge);
        padding: 3px 8px; border-radius: 6px; cursor: pointer;
      }
      .notes ::ng-deep a[href^='#t=']:hover { border-color: var(--ay-yellow); }
      .notes ::ng-deep a:not([href^='#t=']) { color: var(--ay-ink); text-underline-offset: 3px; }
    `,
  ],
})
export class KnowledgeNotesPanelComponent {
  @Input() set markdown(value: string) {
    // marked.parse is synchronous unless async options are enabled.
    this.html = value ? (marked.parse(value, { async: false }) as string) : '';
  }
  @Input() timeline: TimelineEvent[] = [];

  /** Seconds to seek the player to. */
  @Output() seek = new EventEmitter<number>();

  html = '';
  filter: 'all' | 'speech' | 'visual' = 'all';
  readonly filters: ('all' | 'speech' | 'visual')[] = ['all', 'speech', 'visual'];

  get speechCount(): number {
    return this.timeline.filter((e) => e.type === 'speech').length;
  }

  get visualCount(): number {
    return this.timeline.filter((e) => e.type === 'visual').length;
  }

  get visibleEvents(): TimelineEvent[] {
    if (this.filter === 'all') return this.timeline;
    return this.timeline.filter((e) => e.type === this.filter);
  }

  label(ev: TimelineEvent): string {
    const text = ev.type === 'visual' ? ev.ocr_text || 'Board snapshot' : ev.text || '';
    return text.length > 90 ? `${text.slice(0, 90)}…` : text;
  }

  /**
   * Catch clicks on generated timestamp links. Delegation keeps the rendered
   * HTML inert — no handlers are injected into model output.
   */
  onNotesClick(event: MouseEvent): void {
    const anchor = (event.target as HTMLElement)?.closest('a');
    if (!anchor) return;

    const match = anchor.getAttribute('href')?.match(/^#t=(\d+)$/);
    if (!match) return;

    event.preventDefault();
    this.seek.emit(Number(match[1]));
  }
}
