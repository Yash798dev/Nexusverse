
import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { HistoryService, VideoJobItem } from '../../services/history.service';
import { KnowledgeService, KnowledgeSource } from '../../services/knowledge.service';
import { JobTrackerService } from '../../core/job-tracker.service';
import { ToastService } from '../../core/toast.service';
import { AgentBackdropComponent } from '../../shared/agent-backdrop/agent-backdrop.component';
import { PipelineStripComponent } from '../../shared/pipeline-strip/pipeline-strip.component';
import { RevealDirective } from '../../shared/directives/reveal.directive';
import { CountUpDirective } from '../../shared/directives/count-up.directive';
import { AppNavComponent } from '../../shared/app-nav/app-nav.component';
interface Particle {
  left: number;
  top: number;
  delay: string;
  duration: string;
}

/** localStorage flag: the keyboard-shortcuts tip has been shown once. */
const SHORTCUTS_TIP_KEY = 'ay-shortcuts-tip';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    AgentBackdropComponent,
    PipelineStripComponent,
    RevealDirective,
    CountUpDirective,
    AppNavComponent,
    RouterLink,
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})


export class HomeComponent implements OnInit, OnDestroy {
  isScrolled = false;
  credits:number|null=null;
  /** Total videos this account has created (null while loading). */
  videosCreated: number | null = null;
  /** Agents in the production pipeline: script, visuals, voice, video, music, captions, publish. */
  readonly agentCount = 7;
  mousePos = { x: 0, y: 0 };
  particles: Particle[] = [];

  /** Dashboard data — all of it real; nothing here is placeholder. */
  documentsCount = 0;
  recentKnowledge: KnowledgeSource[] = [];
  recentVideos: VideoJobItem[] = [];
  loadingKnowledge = true;
  loadingVideos = true;

  private tipTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private router:Router,
    private userService:AuthService,
    private historyService: HistoryService,
    private knowledge: KnowledgeService,
    public jobs: JobTrackerService,
    private toast: ToastService
  ) {}

  /** Show the setup steps only until both are genuinely done. */
  get showChecklist(): boolean {
    if (this.loadingKnowledge || this.loadingVideos) return false;
    return this.documentsCount === 0 || !this.videosCreated;
  }

  /** What the live strip says while a run is in flight. */
  get liveLabel(): string {
    switch (this.jobs.state()) {
      case 'paused': return 'Paused · ' + (this.jobs.stage() || 'mid-stage');
      case 'done': return 'Video ready';
      case 'failed': return 'Run failed';
      default: return this.jobs.stage() || 'Starting…';
    }
  }

  ngOnInit(): void {
    this.generateParticles();

    this.userService.getCredits().subscribe({
      next: (res) => {
        this.credits = res.credits;
      },
      error: (err) => {
        console.error('Failed to load credits', err);
      }
    });

    // /api/history/my is the working route; the sibling /api/history/videos
    // queries the wrong field and always returns empty.
    this.historyService.getMyVideos(1, 4).subscribe({
      next: (res) => {
        this.videosCreated = res.total ?? 0;
        this.recentVideos = res.videos || [];
        this.loadingVideos = false;
      },
      error: (err) => {
        this.loadingVideos = false;
        console.error('Failed to load videos', err);
      }
    });

    this.knowledge.list().subscribe({
      next: (res) => {
        const sources = res.sources || [];
        this.documentsCount = sources.length;
        this.recentKnowledge = sources.slice(0, 4);
        this.loadingKnowledge = false;
      },
      error: (err) => {
        this.loadingKnowledge = false;
        console.error('Failed to load knowledge', err);
      }
    });

    this.showShortcutsTipOnce();
  }

  ngOnDestroy(): void {
    clearTimeout(this.tipTimer);
  }

  /**
   * Generate random particles for background animation
   */
  private generateParticles(): void {
    for (let i = 0; i < 20; i++) {
      this.particles.push({
        left: Math.random() * 100,
        top: Math.random() * 100,
        delay: `${Math.random() * 3}s`,
        duration: `${2 + Math.random() * 3}s`
      });
    }
  }

  /** First visit to the dashboard: point out the keyboard shortcuts. */
  private showShortcutsTipOnce(): void {
    try {
      if (localStorage.getItem(SHORTCUTS_TIP_KEY)) return;
      localStorage.setItem(SHORTCUTS_TIP_KEY, '1');
    } catch {
      return;
    }
    this.tipTimer = setTimeout(
      () => this.toast.info('Tip: press ? for keyboard shortcuts', 'T switches theme · G then W opens Workflow'),
      2200
    );
  }

  /**
   * Track scroll position for navbar styling
   */
  @HostListener('window:scroll', [])
  onWindowScroll(): void {
    this.isScrolled = window.pageYOffset > 20;
  }

  /**
   * Track mouse position for gradient effect
   */
  @HostListener('window:mousemove', ['$event'])
  onMouseMove(event: MouseEvent): void {
    this.mousePos = {
      x: event.clientX,
      y: event.clientY
    };
  }

  /**
   * Navigation button handlers
   */
  onWorkflow(): void {
    console.log('Navigate to Workflows');
    this.router.navigate(['/workflow']);
  }

  /** Knowledge Hub — the NexusNotes module. */
  onKnowledge(): void {
    this.router.navigate(['/knowledge']);
  }

  onProfile(): void {
    this.router.navigate(['/profile']);
  }

  onLogout(): void {
    this.userService.logout();
  }

  /**
   * CTA button handlers
   */
  onGetStarted(): void {
    this.router.navigate(['/workflow']);
  }

  onViewDemo(): void {
    // Sends the user to the landing page's cinematic overview rather than
    // logging to the console, which is all this used to do.
    this.router.navigate(['/']);
  }

  pricing(): void {
    this.router.navigate(['/subscription']);
  }
}
