import { AfterViewInit, Directive, ElementRef, Inject, Input, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Cinematic headline entrance: splits the element's (static) text into words
 * that rise, un-rotate and resolve from blur to sharp one after another
 * (.ay-word in styles.css). Only for literal text — the words replace the text
 * node, so do not use it on interpolated content that changes later.
 * Screen readers get the original sentence through aria-label.
 */
@Directive({
  selector: '[appSplitReveal]',
  standalone: true,
})
export class SplitRevealDirective implements AfterViewInit {
  /** Seconds before the first word starts. */
  @Input() splitDelay = 0;
  /** Seconds between words. */
  @Input() splitStagger = 0.07;

  constructor(private el: ElementRef<HTMLElement>, @Inject(PLATFORM_ID) private platformId: object) {}

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const node = this.el.nativeElement;
    const text = (node.textContent || '').trim();
    if (!text) return;

    node.setAttribute('aria-label', text);
    node.textContent = '';
    text.split(/\s+/).forEach((word, i, words) => {
      const outer = document.createElement('span');
      outer.className = 'ay-word';
      outer.setAttribute('aria-hidden', 'true');
      const inner = document.createElement('span');
      inner.className = 'ay-word__inner';
      inner.style.setProperty('--ay-wd', `${(this.splitDelay + i * this.splitStagger).toFixed(2)}s`);
      inner.textContent = word;
      outer.appendChild(inner);
      node.appendChild(outer);
      if (i < words.length - 1) node.appendChild(document.createTextNode(' '));
    });
  }
}
