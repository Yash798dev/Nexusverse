import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, HostListener, Inject, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ThemeToggleComponent } from '../../shared/theme-toggle/theme-toggle.component';

interface Step {
  title: string;
  description: string;
}

interface Feature {
  title: string;
  description: string;
}

interface Tech {
  name: string;
  role: string;
}

/**
 * Landing page — Angular port of the "Dark cinematic AI landing page" design
 * canvas (Agentic YouTube.dc.html). The design was a single fixed, non-scrolling
 * artboard whose nav pointed at #how / #features / #tech / #about / #create,
 * none of which existed. Here the cinematic plate keeps its exact proportions as
 * a 100vh hero, and the page scrolls on to real sections for each of those
 * anchors, with #create resolving to a router navigation instead of a dead hash.
 */
@Component({
  selector: 'app-landingpage',
  standalone: true,
  imports: [CommonModule, RouterLink, ThemeToggleComponent],
  templateUrl: './landingpage.component.html',
  styleUrl: './landingpage.component.css',
})
export class LandingpageComponent implements OnInit {
  menuOpen = false;
  loggedIn = false;
  year = new Date().getFullYear();

  steps: Step[] = [
    { title: 'Research', description: 'Agents pull live web, news and paper sources so every claim in the script is grounded in something real.' },
    { title: 'Script', description: 'A writer agent drafts the narration; a critic agent rewrites it until the hook and the pacing earn the watch time.' },
    { title: 'Voice', description: 'Your cloned voice narrates the script, then a mastering chain levels the audio to broadcast loudness.' },
    { title: 'Edit', description: 'Stock footage, generated visuals and motion are cut to the beat, with word-level captions aligned by real ASR.' },
    { title: 'Publish', description: 'A QA gate reviews the cut, then the finished video uploads straight to your YouTube channel.' },
  ];

  features: Feature[] = [
    { title: 'Grounded content creation', description: 'Research agents cite live sources before a single line of script is written — no hallucinated facts shipped to your audience.' },
    { title: 'Cloned narration', description: 'Your own voice, cloned and mastered to −14 LUFS, so every upload sounds like you rather than a stock TTS engine.' },
    { title: 'Word-level captions', description: 'Captions driven by real speech alignment, not estimated timings, so they never drift out of sync with the narration.' },
    { title: 'Autonomous QA gate', description: 'Every element is evaluated before publish. Anything that fails the gate goes back through the pipeline instead of going live.' },
  ];

  tech: Tech[] = [
    { name: 'LangChain', role: 'Agent tooling and retrieval over live web, news and paper sources.' },
    { name: 'LangGraph', role: 'Stateful graph that orchestrates the research → script → voice → edit → publish run.' },
    { name: 'Stable Diffusion', role: 'Generated visuals and thumbnails composed to match each scene of the script.' },
    { name: 'YouTube API', role: 'Authenticated uploads, metadata and thumbnails pushed straight to your channel.' },
  ];

  constructor(
    private router: Router,
    private auth: AuthService,
    @Inject(DOCUMENT) private document: Document
  ) {}

  ngOnInit(): void {
    this.loggedIn = this.auth.isLoggedIn();
  }

  /** The design's Escape-to-close behaviour for the mobile menu. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.menuOpen = false;
  }

  /** The design closed the menu once the viewport went back to landscape/desktop. */
  @HostListener('window:resize')
  onResize(): void {
    if (window.innerWidth / window.innerHeight > 1.1) {
      this.menuOpen = false;
    }
  }

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
  }

  closeMenu(): void {
    this.menuOpen = false;
  }

  /**
   * In-page navigation for the design's hash links. Done in code rather than as
   * a bare href="#how" because the router owns the URL — a raw hash link on a
   * routed page navigates instead of scrolling.
   */
  scrollTo(id: string): void {
    this.closeMenu();
    const target = this.document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** The design's "Create a Video" CTA (#create). */
  createVideo(): void {
    this.closeMenu();
    this.router.navigate([this.auth.isLoggedIn() ? '/workflow' : '/register']);
  }

  signIn(): void {
    this.closeMenu();
    this.router.navigate(['/login']);
  }

  dashboard(): void {
    this.closeMenu();
    this.router.navigate(['/home']);
  }

  signOut(): void {
    this.closeMenu();
    this.auth.logout();
    this.loggedIn = false;
  }
}
