import {
  AfterViewInit,
  Component,
  ElementRef,
  Inject,
  NgZone,
  OnDestroy,
  PLATFORM_ID,
  ViewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Reading-progress line along the top edge and a back-to-top button whose ring
 * fills with scroll progress. Both update by writing styles directly in an
 * animation frame — scrolling never triggers change detection.
 */
@Component({
  selector: 'app-scroll-fx',
  standalone: true,
  template: `
    <div #bar class="progress" aria-hidden="true"></div>
    <button
      #toTop
      type="button"
      class="to-top"
      data-magnetic
      tabindex="-1"
      aria-label="Back to top"
      (click)="scrollToTop()">
      <svg class="ring" viewBox="0 0 44 44" aria-hidden="true">
        <circle class="ring-track" cx="22" cy="22" r="20" />
        <circle #ring class="ring-value" cx="22" cy="22" r="20" pathLength="100" />
      </svg>
      <svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" /></svg>
    </button>
  `,
  styles: [
    `
      .progress {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 60;
        height: 2px;
        background: var(--ay-energy);
        transform: scaleX(0);
        transform-origin: left center;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.4s var(--ay-ease);
      }
      .progress.is-on { opacity: 1; }

      .to-top {
        position: fixed;
        right: 24px;
        bottom: 24px;
        z-index: 55;
        display: grid;
        place-items: center;
        width: 50px;
        height: 50px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: var(--ay-surface);
        box-shadow: var(--ay-shadow-md), inset 0 0 0 1px var(--ay-line-strong);
        color: var(--ay-ink);
        cursor: pointer;
        opacity: 0;
        transform: translateY(18px) scale(0.85);
        pointer-events: none;
        transition: opacity 0.45s var(--ay-ease), transform 0.55s var(--ay-ease), translate 0.35s var(--ay-ease);
      }
      .to-top.is-visible {
        opacity: 1;
        transform: none;
        pointer-events: auto;
      }
      .to-top:focus-visible { outline: 2px solid var(--ay-yellow); outline-offset: 3px; }

      .ring {
        position: absolute;
        inset: 3px;
        width: calc(100% - 6px);
        height: calc(100% - 6px);
        transform: rotate(-90deg);
      }
      .ring circle { fill: none; stroke-width: 2; }
      .ring-track { stroke: rgba(var(--ay-ink-rgb), 0.08); }
      .ring-value {
        stroke: var(--ay-yellow);
        stroke-linecap: round;
        stroke-dasharray: 100;
        stroke-dashoffset: 100;
      }

      .arrow {
        position: relative;
        width: 18px;
        height: 18px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
        transition: transform 0.45s var(--ay-ease);
      }
      .to-top:hover .arrow { transform: translateY(-3px); }

      @media (max-width: 560px) {
        .to-top { right: 16px; bottom: 16px; width: 44px; height: 44px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .to-top, .progress { transition: none; }
      }
    `,
  ],
})
export class ScrollFxComponent implements AfterViewInit, OnDestroy {
  @ViewChild('bar', { static: true }) bar!: ElementRef<HTMLElement>;
  @ViewChild('toTop', { static: true }) toTop!: ElementRef<HTMLButtonElement>;
  @ViewChild('ring', { static: true }) ring!: ElementRef<SVGCircleElement>;

  private frame = 0;
  private resizeObserver?: ResizeObserver;
  private readonly isBrowser: boolean;

  constructor(private zone: NgZone, @Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;
    this.zone.runOutsideAngular(() => {
      window.addEventListener('scroll', this.schedule, { passive: true });
      window.addEventListener('resize', this.schedule, { passive: true });
      // Route changes and loaded data change the page height without scrolling.
      this.resizeObserver = new ResizeObserver(this.schedule);
      this.resizeObserver.observe(document.body);
      this.schedule();
    });
  }

  ngOnDestroy(): void {
    if (!this.isBrowser) return;
    window.removeEventListener('scroll', this.schedule);
    window.removeEventListener('resize', this.schedule);
    this.resizeObserver?.disconnect();
    cancelAnimationFrame(this.frame);
  }

  scrollToTop(): void {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  }

  private schedule = (): void => {
    if (!this.frame) this.frame = requestAnimationFrame(this.update);
  };

  private update = (): void => {
    this.frame = 0;
    const y = window.scrollY;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, y / max) : 0;
    const scrollable = max > 240;

    const bar = this.bar.nativeElement;
    bar.style.transform = `scaleX(${p.toFixed(4)})`;
    bar.classList.toggle('is-on', scrollable && y > 4);

    const visible = scrollable && y > 560;
    const button = this.toTop.nativeElement;
    button.classList.toggle('is-visible', visible);
    button.tabIndex = visible ? 0 : -1;
    this.ring.nativeElement.style.strokeDashoffset = String((100 - p * 100).toFixed(2));
  };
}
