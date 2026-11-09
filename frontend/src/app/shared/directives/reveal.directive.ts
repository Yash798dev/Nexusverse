import { Directive, ElementRef, Inject, Input, NgZone, OnDestroy, OnInit, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Scroll-triggered entrance: fade + rise + slight scale (.ay-reveal in styles.css)
 * the first time the element enters the viewport. `revealDelay` (ms) staggers
 * siblings. Once settled, the reveal classes are removed so the element's own
 * transitions — e.g. a card's hover lift — aren't slowed by the stagger delay.
 */
@Directive({
  selector: '[appReveal]',
  standalone: true,
})
export class RevealDirective implements OnInit, OnDestroy {
  @Input() revealDelay = 0;

  private observer?: IntersectionObserver;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private el: ElementRef<HTMLElement>,
    private zone: NgZone,
    @Inject(PLATFORM_ID) private platformId: object
  ) {}

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!('IntersectionObserver' in window)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const node = this.el.nativeElement;
    node.classList.add('ay-reveal');
    node.style.setProperty('--ay-reveal-delay', `${this.revealDelay}ms`);

    this.zone.runOutsideAngular(() => {
      this.observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          this.observer?.disconnect();
          node.classList.add('ay-revealed');
          this.timer = setTimeout(() => {
            node.classList.remove('ay-reveal', 'ay-revealed');
            node.style.removeProperty('--ay-reveal-delay');
          }, this.revealDelay + 1300);
        },
        { threshold: 0, rootMargin: '0px 0px -8% 0px' }
      );
      this.observer.observe(node);
    });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    clearTimeout(this.timer);
  }
}
