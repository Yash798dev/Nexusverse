import { Component, HostListener, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { JobPillComponent } from '../job-pill/job-pill.component';
import { ThemeToggleComponent } from '../theme-toggle/theme-toggle.component';

/**
 * The platform's one navigation bar.
 *
 * Until now every signed-in page carried its own hand-copied <nav>, and the four
 * copies had already drifted apart: the Studio and Profile had no way back to
 * the Knowledge Hub at all, Subscription had two "Home" buttons and no Pricing
 * link, and nothing anywhere showed which page you were actually on.
 *
 * The markup keeps the existing global class names (.ay-nav, .nav-btn, …) from
 * styles.css, so this is the same navbar visually — it is just defined once, and
 * the current section is now highlighted via routerLinkActive.
 */
@Component({
  selector: 'app-nav',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, JobPillComponent, ThemeToggleComponent],
  template: `
    <nav class="navbar ay-nav" [class.scrolled]="isScrolled">
      <div class="nav-content">
        <a class="logo-section" routerLink="/home" aria-label="Go to dashboard">
          <svg class="ay-brand-glyph" viewBox="0 0 38 42" aria-hidden="true">
            <defs>
              <linearGradient id="ayBrandGrad" x1="4" y1="2" x2="34" y2="40" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="#cfcfcf" />
                <stop offset=".42" stop-color="#8e8e8e" />
                <stop offset=".62" stop-color="#3f3f3f" />
                <stop offset="1" stop-color="#e6e6e6" />
              </linearGradient>
            </defs>
            <path d="M6 3.6 L30 20.4 L6 37.2 Z" fill="url(#ayBrandGrad)" />
            <path class="ay-brand-links" d="M6 3.6 L34 8.2 M30 20.4 L34 8.2 M30 20.4 L34 33.6 M6 37.2 L34 33.6" stroke="#8b8a8a" stroke-width="1.1" fill="none" />
            <circle class="ay-brand-node" cx="34" cy="8.2" r="2.9" fill="#fdfdfd" />
            <circle class="ay-brand-node ay-brand-node--b" cx="34" cy="33.6" r="2.9" fill="#fdfdfd" />
          </svg>
          <span class="logo-text">Agentic YouTube</span>
        </a>

        <div class="nav-buttons">
          <app-job-pill></app-job-pill>

          <div class="nav-credits">
            <div class="credits-box" *ngIf="credits !== null">
              <span class="ay-live-dot"></span> Credits <span class="credits-count">{{ credits }}</span>
            </div>
            <a class="credits-box" routerLink="/subscription">Pricing</a>
          </div>

          <a class="nav-btn" routerLink="/home" routerLinkActive="is-active"
             [routerLinkActiveOptions]="{ exact: true }">
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 10.5 12 3l9 7.5" />
              <path d="M5 9.5V21h14V9.5" />
            </svg>
            <span>Dashboard</span>
          </a>

          <a class="nav-btn" routerLink="/knowledge" routerLinkActive="is-active">
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            <span>Knowledge</span>
          </a>

          <a class="nav-btn" routerLink="/workflow" routerLinkActive="is-active">
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
            <span>Studio</span>
          </a>

          <a class="nav-btn" routerLink="/videos" routerLinkActive="is-active">
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" stroke="none" />
            </svg>
            <span>Videos</span>
          </a>

          <a class="nav-btn" routerLink="/profile" routerLinkActive="is-active">
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span>Profile</span>
          </a>

          <app-theme-toggle class="nav-theme"></app-theme-toggle>

          <button type="button" class="nav-btn logout-btn" (click)="logout()">
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>Logout</span>
          </button>
        </div>
      </div>
    </nav>
  `,
  styles: [
    `
      /* Structure only — colour and spacing come from .ay-nav in styles.css. */
      :host { display: contents; }
      .logo-section { text-decoration: none; color: inherit; cursor: pointer; }
      .nav-btn { text-decoration: none; }
      .credits-box[routerLink] { cursor: pointer; text-decoration: none; color: inherit; }
    `,
  ],
})
export class AppNavComponent implements OnInit {
  /** Credit balance, or null while it loads (the box stays hidden until then). */
  credits: number | null = null;
  isScrolled = false;

  constructor(private auth: AuthService, private router: Router) {}

  ngOnInit(): void {
    // Every page used to fetch this itself; doing it here means one request and
    // one place for the badge to be wrong.
    this.auth.getCredits().subscribe({
      next: (res) => (this.credits = res.credits),
      error: () => (this.credits = null),
    });
  }

  @HostListener('window:scroll')
  onScroll(): void {
    this.isScrolled = window.pageYOffset > 20;
  }

  logout(): void {
    this.auth.logout();
  }
}
