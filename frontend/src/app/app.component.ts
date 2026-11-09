import { Component, ElementRef, Inject, PLATFORM_ID, ViewChild } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  RouterOutlet,
} from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import gsap from 'gsap';
import { MotionFxService } from './core/motion-fx.service';
import { ShortcutsService } from './core/shortcuts.service';
import { JobTrackerService } from './core/job-tracker.service';
import { ToastHostComponent } from './shared/toast-host/toast-host.component';
import { ScrollFxComponent } from './shared/scroll-fx/scroll-fx.component';
import { ShortcutsPanelComponent } from './shared/shortcuts-panel/shortcuts-panel.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, MatButtonModule, ToastHostComponent, ScrollFxComponent, ShortcutsPanelComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  title = 'Webapp';

  /** Drives the yellow→pink energy line at the top while a lazy route loads. */
  navigating = false;

  @ViewChild('routeContainer', { static: true }) routeContainer!: ElementRef<HTMLElement>;

  constructor(
    private router: Router,
    motion: MotionFxService,
    shortcuts: ShortcutsService,
    jobs: JobTrackerService,
    @Inject(PLATFORM_ID) platformId: object
  ) {
    const isBrowser = isPlatformBrowser(platformId);

    // App-wide magnetic buttons, card tilt/spotlight, parallax and keyboard shortcuts.
    motion.start();
    shortcuts.start();

    // Follows the user's video job from any page (nav pill, "video ready" notices).
    if (isBrowser) jobs.start();

    // Page transitions come from withViewTransitions() (app.config.ts) with the
    // ::view-transition-old/new(root) keyframes in styles.css — the old page sinks
    // back while the new one wipes up behind an energy line. Browsers without the
    // View Transitions API fall back to animating the incoming view only, with GSAP.
    const fallbackFade =
      isBrowser &&
      !('startViewTransition' in document) &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.router.events.subscribe((e) => {
      if (e instanceof NavigationStart) {
        this.navigating = true;
        return;
      }
      if (e instanceof NavigationEnd || e instanceof NavigationCancel || e instanceof NavigationError) {
        this.navigating = false;
      }
      if (e instanceof NavigationEnd) {
        if (isBrowser) setTimeout(() => motion.refresh());
        if (fallbackFade) {
          const el = this.routeContainer?.nativeElement;
          if (!el) return;
          gsap.fromTo(el, { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' });
        }
      }
    });
  }
}
