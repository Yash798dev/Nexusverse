import { Directive, ElementRef, HostListener, Input, Renderer2 } from '@angular/core';

/**
 * Pairs with the .tilt-parent / .tilt-target CSS in styles.css: on mousemove,
 * sets --tilt-x/--tilt-y custom properties proportional to cursor position
 * relative to the element's center, which the CSS transform reads. Cheap 3D
 * depth for cards (pricing tiers, history entries, admin stat tiles) without
 * a WebGL context per card — reserve actual Three.js scenes for hero sections.
 */
@Directive({
  selector: '[appTilt3d]',
  standalone: true,
})
export class Tilt3dDirective {
  @Input() tiltMax = 10; // degrees

  constructor(private el: ElementRef<HTMLElement>, private renderer: Renderer2) {}

  @HostListener('mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    const rect = this.el.nativeElement.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    this.renderer.setStyle(this.el.nativeElement, '--tilt-x', `${px * this.tiltMax * 2}deg`);
    this.renderer.setStyle(this.el.nativeElement, '--tilt-y', `${-py * this.tiltMax * 2}deg`);
  }

  @HostListener('mouseleave')
  onMouseLeave() {
    this.renderer.setStyle(this.el.nativeElement, '--tilt-x', '0deg');
    this.renderer.setStyle(this.el.nativeElement, '--tilt-y', '0deg');
  }
}
