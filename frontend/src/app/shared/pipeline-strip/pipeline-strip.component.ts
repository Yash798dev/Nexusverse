import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Inject,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  PLATFORM_ID,
} from '@angular/core';
import { NgFor, NgIf, isPlatformBrowser } from '@angular/common';

export interface StripStage {
  label: string;
  /** grey = input, yellow = AI processing, pink = creative, white = output */
  tone: 'grey' | 'yellow' | 'pink' | 'white';
}

const DEMO_STAGES: StripStage[] = [
  { label: 'Prompt', tone: 'grey' },
  { label: 'Plan', tone: 'yellow' },
  { label: 'Script', tone: 'yellow' },
  { label: 'Visuals', tone: 'pink' },
  { label: 'Voice', tone: 'yellow' },
  { label: 'Video', tone: 'yellow' },
  { label: 'Publish', tone: 'white' },
];

/**
 * The production pipeline as a strip of agents joined by an energy line.
 *
 * Demo mode (default): runs through the stages on a loop once scrolled into view;
 * on completion the final stage resolves into a play symbol, holds, and restarts.
 *
 * Live mode (`[live]="true"`): shows a real job — pass `activeIndex` (-1 idle,
 * 0..n-1 running, n complete), optional per-stage `meta` text such as timers,
 * and `paused` to freeze the active stage.
 * Colours come from the theme tokens in styles.css.
 */
@Component({
  selector: 'app-pipeline-strip',
  standalone: true,
  imports: [NgFor, NgIf],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="strip" [class.is-complete]="active >= stages.length" [class.is-live]="live" [class.is-paused]="paused">
      <div class="track" aria-hidden="true">
        <div class="track-fill" [style.transform]="'scaleX(' + fill + ')'"></div>
        <div class="track-spark" [style.left.%]="fill * 100" [class.is-on]="active >= 0 && active < stages.length"></div>
      </div>
      <ol class="nodes" [style.grid-template-columns]="'repeat(' + stages.length + ', 1fr)'">
        <li
          *ngFor="let s of stages; let i = index"
          class="node"
          [class.is-active]="i === active"
          [class.is-done]="i < active"
          [attr.data-tone]="s.tone"
          [attr.aria-current]="i === active ? 'step' : null">
          <span class="dot"></span>
          <span class="label">{{ s.label }}</span>
          <span class="meta" *ngIf="meta[i]">{{ meta[i] }}</span>
        </li>
      </ol>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .strip { position: relative; padding: 6px 0 0; }

      .track {
        position: absolute;
        left: calc(100% / var(--n, 14));
        right: calc(100% / var(--n, 14));
        top: 11px;
        height: 1px;
        background: rgba(var(--ay-ink-rgb), 0.12);
      }
      .track-fill {
        position: absolute;
        inset: 0;
        transform-origin: left center;
        background: linear-gradient(90deg, var(--ay-text-3), var(--ay-yellow) 38%, var(--ay-pink) 68%, var(--ay-ink));
        transition: transform 0.9s cubic-bezier(0.22, 1, 0.36, 1);
      }
      /* Bright head riding the front of the energy line */
      .track-spark {
        position: absolute;
        top: 50%;
        width: 26px;
        height: 3px;
        margin: -1.5px 0 0 -26px;
        border-radius: 2px;
        background: linear-gradient(90deg, transparent, var(--ay-yellow));
        opacity: 0;
        transition: left 0.9s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.4s;
      }
      .track-spark.is-on { opacity: 1; animation: spark-flicker 1.4s ease-in-out infinite; }
      @keyframes spark-flicker { 50% { opacity: 0.55; } }

      .nodes {
        position: relative;
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
      }
      .node {
        --tone: var(--ay-text-2);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .node[data-tone='yellow'] { --tone: var(--ay-yellow); }
      .node[data-tone='pink'] { --tone: var(--ay-pink); }
      .node[data-tone='white'] { --tone: var(--ay-ink); }

      .dot {
        position: relative;
        width: 11px;
        height: 11px;
        box-sizing: border-box;
        border-radius: 50%;
        border: 1px solid var(--ay-border);
        background: var(--ay-surface);
        transition: background-color 0.5s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.5s,
                    transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .dot::after {
        content: '';
        position: absolute;
        inset: -1px;
        border-radius: 50%;
        background: var(--tone);
        opacity: 0;
      }
      .node.is-done .dot { background: rgba(var(--ay-ink-rgb), 0.75); border-color: transparent; transform: scale(0.8); }
      .node.is-active .dot { background: var(--tone); border-color: transparent; transform: scale(1.35); }
      .node.is-active .dot::after { animation: strip-ping 1.2s cubic-bezier(0.22, 1, 0.36, 1) infinite; }
      .strip:not(.is-live) .node.is-active .dot::after { animation-iteration-count: 1; }

      /* Completion: the final agent becomes the play symbol, with a publish pulse. */
      .strip.is-complete .node:last-child .dot {
        border-color: transparent;
        border-radius: 0;
        background: var(--ay-ink);
        clip-path: polygon(15% 0, 100% 50%, 15% 100%);
        transform: scale(1.5);
      }
      .strip.is-complete .node:last-child .label { color: var(--ay-ink); }
      .strip.is-complete .track-fill { background: var(--ay-ink); }

      /* Paused job: the active agent holds still and drains to grey. */
      .strip.is-paused .node.is-active .dot::after,
      .strip.is-paused .track-spark.is-on { animation-play-state: paused; }
      .strip.is-paused .node.is-active .dot { background: var(--ay-text-2); }
      .strip.is-paused .node.is-active .meta { color: var(--ay-text-3); }

      .label {
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 11px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ay-text-3);
        white-space: nowrap;
        transition: color 0.5s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .node.is-done .label { color: var(--ay-text-2); }
      .node.is-active .label { color: var(--ay-ink); font-weight: 600; }

      .meta {
        margin-top: -4px;
        font: 500 11px/1 var(--ay-mono);
        color: var(--ay-text-3);
        font-variant-numeric: tabular-nums;
      }
      .node.is-active .meta { color: var(--ay-yellow-bright); }

      @keyframes strip-ping {
        0% { transform: scale(1); opacity: 0.55; }
        100% { transform: scale(3.2); opacity: 0; }
      }

      @media (max-width: 640px) {
        .label { font-size: 9px; letter-spacing: 0.06em; }
        .meta { font-size: 9.5px; }
      }
      @media (max-width: 440px) {
        .label { display: none; }
        .meta { display: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        .track-fill, .track-spark, .dot, .label { transition: none; }
        .node.is-active .dot::after, .track-spark.is-on { animation: none; }
      }
    `,
  ],
  host: { '[style.--n]': 'stages.length * 2' },
})
export class PipelineStripComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() stages: StripStage[] = DEMO_STAGES;
  /** Show a real job instead of the demo loop. */
  @Input() live = false;
  /** Live mode: -1 idle, 0..n-1 running, n complete. */
  @Input() activeIndex = -1;
  /** Live mode: small text under each stage (e.g. elapsed time). */
  @Input() meta: string[] = [];
  /** Live mode: the job is paused. */
  @Input() paused = false;

  active = -1;
  fill = 0;

  private timer?: ReturnType<typeof setTimeout>;
  private observer?: IntersectionObserver;
  private started = false;
  private readonly isBrowser: boolean;

  constructor(
    private host: ElementRef<HTMLElement>,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) platformId: object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnChanges(): void {
    if (this.live) this.apply(this.activeIndex);
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser || this.live) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.apply(this.stages.length);
      this.cdr.detectChanges();
      return;
    }
    this.zone.runOutsideAngular(() => {
      this.observer = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting || this.started) return;
        this.started = true;
        this.observer?.disconnect();
        this.timer = setTimeout(() => this.step(), 600);
      });
      this.observer.observe(this.host.nativeElement);
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
    this.observer?.disconnect();
  }

  private step(): void {
    const n = this.stages.length;
    const next = this.active >= n ? -1 : this.active + 1;
    this.apply(next);
    this.cdr.detectChanges();
    const hold = next === n ? 2400 : next === -1 ? 700 : 950;
    this.timer = setTimeout(() => this.step(), hold);
  }

  private apply(active: number): void {
    const n = this.stages.length;
    this.active = Math.max(-1, Math.min(active, n));
    this.fill = this.active <= 0 ? 0 : Math.min(this.active, n - 1) / (n - 1);
  }
}
