import { Directive, ElementRef, Inject, Input, NgZone, OnDestroy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Counts the element's text up to `appCountUp` once it is on screen (ease-out,
 * ~1.4s), and from the previous value whenever the number changes afterwards.
 * `null` shows an em dash while data loads. Writes textContent directly in
 * animation frames, outside Angular's zone.
 */
@Directive({
  selector: '[appCountUp]',
  standalone: true,
})
export class CountUpDirective implements OnDestroy {
  @Input() countUpDuration = 1400;

  @Input()
  set appCountUp(value: number | null | undefined) {
    this.target = value ?? null;
    if (!this.isBrowser) return;
    if (this.target === null) {
      this.el.nativeElement.textContent = '—';
      return;
    }
    if (this.visible) this.animate();
    else this.observe();
  }

  private target: number | null = null;
  private shown = 0;
  private frame = 0;
  private visible = false;
  private observer?: IntersectionObserver;
  private readonly isBrowser: boolean;

  constructor(
    private el: ElementRef<HTMLElement>,
    private zone: NgZone,
    @Inject(PLATFORM_ID) platformId: object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
  }

  private observe(): void {
    if (this.observer) return;
    if (!('IntersectionObserver' in window)) {
      this.visible = true;
      this.animate();
      return;
    }
    this.zone.runOutsideAngular(() => {
      this.observer = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting) return;
        this.visible = true;
        this.observer?.disconnect();
        this.animate();
      });
      this.observer.observe(this.el.nativeElement);
    });
  }

  private animate(): void {
    const target = this.target;
    if (target === null) return;
    cancelAnimationFrame(this.frame);

    const node = this.el.nativeElement;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.shown = target;
      node.textContent = format(target);
      return;
    }

    const from = this.shown;
    const start = performance.now();
    this.zone.runOutsideAngular(() => {
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / this.countUpDuration);
        const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t); // ease-out expo
        this.shown = Math.round(from + (target - from) * eased);
        node.textContent = format(this.shown);
        if (t < 1) this.frame = requestAnimationFrame(step);
      };
      this.frame = requestAnimationFrame(step);
    });
  }
}

function format(n: number): string {
  return n.toLocaleString();
}
