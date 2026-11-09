import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Inject, Injectable, NgZone, PLATFORM_ID } from '@angular/core';

const MAGNET_SELECTOR = '.ay-btn-primary:not(:disabled), [data-magnetic]';
const CARD_SELECTOR = '.ay-card--lift, .ay-spot';
const MAGNET_PULL = 0.28;
const MAGNET_MAX = 10;
const TILT_DEG = 7;

/**
 * App-wide pointer and scroll effects, driven by class names so no page has to
 * wire anything up:
 *
 *  - Magnetic buttons: `.ay-btn-primary` (or `[data-magnetic]`) leans toward the
 *    cursor through the CSS `translate` property, so it composes with the
 *    button's own hover `transform`.
 *  - Cards: `.ay-card--lift` tilts in 3D (`--ay-rx` / `--ay-ry`); `.ay-card--lift`
 *    and `.ay-spot` get a light that follows the cursor (`--ay-mx` / `--ay-my`).
 *  - Parallax: `[data-parallax="0.2"]` drifts at that fraction of the scroll;
 *    `[data-parallax-fade]` also fades out over the first screen of scroll.
 *
 * One listener each, throttled to animation frames, outside Angular's zone.
 * Pointer effects only run on fine, hover-capable pointers; everything is off
 * under prefers-reduced-motion.
 */
@Injectable({ providedIn: 'root' })
export class MotionFxService {
  private started = false;
  private pointerEvent: PointerEvent | null = null;
  private pointerFrame = 0;
  private scrollFrame = 0;
  private magnet: HTMLElement | null = null;
  private card: HTMLElement | null = null;
  private readonly isBrowser: boolean;

  constructor(
    private zone: NgZone,
    @Inject(DOCUMENT) private document: Document,
    @Inject(PLATFORM_ID) platformId: object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  start(): void {
    if (!this.isBrowser || this.started) return;
    this.started = true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    this.zone.runOutsideAngular(() => {
      if (finePointer) {
        this.document.addEventListener('pointermove', this.onPointerMove, { passive: true });
        this.document.documentElement.addEventListener('pointerleave', this.releaseAll);
      }
      window.addEventListener('scroll', this.onScroll, { passive: true });
    });
  }

  /** Re-apply parallax after a route change swaps the page content. */
  refresh(): void {
    if (!this.started) return;
    this.releaseAll();
    this.onScroll();
  }

  private onPointerMove = (event: PointerEvent): void => {
    this.pointerEvent = event;
    if (!this.pointerFrame) this.pointerFrame = requestAnimationFrame(this.applyPointer);
  };

  private applyPointer = (): void => {
    this.pointerFrame = 0;
    const e = this.pointerEvent;
    if (!e) return;
    const target = e.target instanceof Element ? e.target : null;

    const magnet = target?.closest<HTMLElement>(MAGNET_SELECTOR) ?? null;
    if (this.magnet && this.magnet !== magnet) this.magnet.style.translate = '';
    this.magnet = magnet;
    if (magnet) {
      const r = magnet.getBoundingClientRect();
      const x = clamp((e.clientX - (r.left + r.width / 2)) * MAGNET_PULL, MAGNET_MAX);
      const y = clamp((e.clientY - (r.top + r.height / 2)) * MAGNET_PULL, MAGNET_MAX);
      magnet.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
    }

    const card = target?.closest<HTMLElement>(CARD_SELECTOR) ?? null;
    if (this.card && this.card !== card) this.resetTilt(this.card);
    this.card = card;
    if (card) {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      card.style.setProperty('--ay-mx', `${(px * 100).toFixed(1)}%`);
      card.style.setProperty('--ay-my', `${(py * 100).toFixed(1)}%`);
      if (card.classList.contains('ay-card--lift')) {
        card.style.setProperty('--ay-rx', `${((0.5 - py) * TILT_DEG).toFixed(2)}deg`);
        card.style.setProperty('--ay-ry', `${((px - 0.5) * TILT_DEG).toFixed(2)}deg`);
      }
    }
  };

  private resetTilt(card: HTMLElement): void {
    card.style.setProperty('--ay-rx', '0deg');
    card.style.setProperty('--ay-ry', '0deg');
  }

  private releaseAll = (): void => {
    if (this.magnet) this.magnet.style.translate = '';
    if (this.card) this.resetTilt(this.card);
    this.magnet = null;
    this.card = null;
  };

  private onScroll = (): void => {
    if (!this.scrollFrame) this.scrollFrame = requestAnimationFrame(this.applyScroll);
  };

  private applyScroll = (): void => {
    this.scrollFrame = 0;
    const y = window.scrollY;
    const viewport = window.innerHeight || 1;
    this.document.querySelectorAll<HTMLElement>('[data-parallax]').forEach((el) => {
      const factor = parseFloat(el.dataset['parallax'] || '0') || 0;
      el.style.translate = `0 ${(y * factor).toFixed(1)}px`;
      if (el.hasAttribute('data-parallax-fade')) {
        el.style.opacity = String(Math.max(0, 1 - y / (viewport * 0.85)).toFixed(3));
      }
    });
  };
}

function clamp(value: number, max: number): number {
  return Math.max(-max, Math.min(max, value));
}
