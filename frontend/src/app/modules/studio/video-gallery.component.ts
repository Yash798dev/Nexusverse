import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HistoryService, VideoJobItem } from '../../services/history.service';
import { AppNavComponent } from '../../shared/app-nav/app-nav.component';
import { environment } from '../../../environments/environment';

type StatusFilter = 'all' | 'ready' | 'published' | 'failed';

/**
 * Everything this account has made, as something you can actually watch.
 *
 * The history page listed prompts as plain text, so there was no way to see
 * your own output without digging through /uploads. Each card now carries a
 * real frame grab from the video, plays inline, and shows the settings it was
 * made with — including the documents it was grounded in.
 */
@Component({
  selector: 'app-video-gallery',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, AppNavComponent],
  template: `
    <app-nav></app-nav>

    <div class="wrap ay-page-offset">
      <header class="head">
        <div>
          <h1>Your videos</h1>
          <p class="sub" *ngIf="!loading">
            {{ total }} {{ total === 1 ? 'run' : 'runs' }}<ng-container *ngIf="readyCount">
              · {{ readyCount }} ready to watch</ng-container>
          </p>
        </div>
        <a class="make" routerLink="/workflow">Create a video</a>
      </header>

      <p class="state" *ngIf="loading">Loading your videos…</p>
      <p class="state err" *ngIf="error">{{ error }}</p>

      <!-- Never made one yet -->
      <div class="empty" *ngIf="!loading && !error && !videos.length">
        <h2>No videos yet</h2>
        <p>Your finished runs appear here, with a preview you can play.</p>
        <a class="make" routerLink="/workflow">Create your first video</a>
      </div>

      <ng-container *ngIf="!loading && videos.length">
        <div class="filters">
          <button
            type="button"
            *ngFor="let f of filters"
            [class.on]="filter === f.value"
            (click)="filter = f.value">
            {{ f.label }}<span class="n" *ngIf="countFor(f.value) as n">{{ n }}</span>
          </button>
        </div>

        <p class="state" *ngIf="!filtered.length">Nothing in this filter.</p>

        <div class="grid">
          <article class="card" *ngFor="let v of filtered">
            <!-- Preview: the frame grab until you press play, then the player -->
            <div class="shot" [class.is-playing]="playing === v._id">
              <video
                *ngIf="playing === v._id && v.videoUrl"
                class="player"
                controls
                autoplay
                preload="metadata"
                [src]="absolute(v.videoUrl)"></video>

              <ng-container *ngIf="playing !== v._id">
                <img *ngIf="v.thumbnailUrl" [src]="absolute(v.thumbnailUrl)" [alt]="v.prompt" loading="lazy" />
                <div class="noshot" *ngIf="!v.thumbnailUrl">
                  <span>{{ statusLabel(v) }}</span>
                </div>
                <button
                  type="button"
                  class="play"
                  *ngIf="v.videoUrl"
                  [attr.aria-label]="'Play ' + v.prompt"
                  (click)="playing = v._id || null"></button>
              </ng-container>
            </div>

            <div class="body">
              <h3 [title]="v.prompt">{{ v.prompt }}</h3>

              <div class="chips">
                <!-- The shared status badge, so a "Ready" here reads identically
                     to a "Ready" in the Knowledge Hub or the studio feed. -->
                <span class="ay-status" [ngClass]="statusClass(v)">{{ statusLabel(v) }}</span>
                <span class="chip" *ngIf="v.config?.durationSeconds">{{ durationLabel(v) }}</span>
                <span class="chip" *ngIf="v.config?.orientation">
                  {{ v.config?.orientation === 'landscape' ? '16:9' : '9:16' }}
                </span>
                <span class="chip" *ngIf="v.config?.tone">{{ v.config?.tone }}</span>
              </div>

              <p class="grounded" *ngIf="v.knowledgeTitles?.length" [title]="v.knowledgeTitles?.join(', ')">
                From your notes: {{ v.knowledgeTitles?.join(', ') }}
              </p>

              <p class="failed" *ngIf="v.status === 'failed' && v.error">{{ v.error }}</p>

              <div class="row">
                <span class="when">{{ v.completedAt || v.createdAt | date: 'MMM d, y' }}</span>
                <a class="act" *ngIf="v.videoUrl" [href]="absolute(v.videoUrl)" download>Download</a>
                <a class="act" *ngIf="v.youtubeUrl" [href]="v.youtubeUrl" target="_blank" rel="noopener">YouTube</a>
              </div>
            </div>
          </article>
        </div>

        <div class="pager" *ngIf="total > limit">
          <button type="button" [disabled]="page <= 1" (click)="go(page - 1)">Previous</button>
          <span>Page {{ page }} of {{ lastPage }}</span>
          <button type="button" [disabled]="page >= lastPage" (click)="go(page + 1)">Next</button>
        </div>
      </ng-container>
    </div>
  `,
  styles: [
    `
      :host { display: block; min-height: 100vh; background: var(--ay-bg); color: var(--ay-ink); }
      .wrap { max-width: 1180px; margin: 0 auto; padding: 24px 20px 64px; }

      .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
      h1 { margin: 0 0 4px; font-size: 24px; font-weight: 300; letter-spacing: -0.02em; }
      .sub { margin: 0; font-size: 13px; color: var(--ay-text-3); }
      .make {
        padding: 9px 20px; border-radius: 999px;
        border: 1px solid var(--ay-yellow-edge); background: var(--ay-yellow-soft);
        color: var(--ay-ink); font-size: 13px; font-weight: 600; text-decoration: none; white-space: nowrap;
      }
      .make:hover { border-color: var(--ay-yellow); }

      .state { padding: 28px 0; font-size: 13.5px; color: var(--ay-text-3); }
      .err { color: var(--ay-danger); }

      .empty { text-align: center; padding: 64px 20px; border: 1px dashed var(--ay-line-strong); border-radius: 16px; }
      .empty h2 { margin: 0 0 8px; font-size: 17px; font-weight: 650; }
      .empty p { margin: 0 0 20px; font-size: 13.5px; color: var(--ay-text-3); }

      .filters { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 18px; }
      .filters button {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 6px 13px; border-radius: 999px;
        border: 1px solid var(--ay-line); background: none;
        color: var(--ay-text-3); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
      }
      .filters button:hover { color: var(--ay-ink); }
      .filters button.on { border-color: var(--ay-yellow-edge); background: var(--ay-yellow-soft); color: var(--ay-yellow-bright); }
      .filters .n { opacity: 0.75; font-variant-numeric: tabular-nums; }

      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }

      .card { border: 1px solid var(--ay-line); border-radius: 14px; overflow: hidden; background: var(--ay-surface); }
      .card:hover { border-color: var(--ay-line-strong); }

      .shot { position: relative; aspect-ratio: 16 / 9; background: #000; overflow: hidden; }
      .shot img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .shot.is-playing { aspect-ratio: auto; }
      .player { width: 100%; max-height: 320px; display: block; background: #000; }
      .noshot { display: grid; place-items: center; height: 100%; color: var(--ay-text-3); font-size: 12px; }
      .play {
        position: absolute; inset: 0; margin: auto;
        width: 52px; height: 52px; border-radius: 50%;
        border: 0; background: rgba(0, 0, 0, 0.55); cursor: pointer;
      }
      .play::after {
        content: ''; position: absolute; inset: 0; margin: auto;
        width: 0; height: 0; border-left: 15px solid #fff;
        border-top: 9px solid transparent; border-bottom: 9px solid transparent;
        transform: translateX(2px);
      }
      .play:hover { background: rgba(0, 0, 0, 0.75); }

      .body { padding: 12px 14px 14px; }
      h3 {
        margin: 0 0 8px; font-size: 14px; font-weight: 600; line-height: 1.4;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      }

      /* Status uses the shared .ay-status badge; .chip is only for the neutral
         metadata beside it (duration, aspect, tone). */
      .chips { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-bottom: 8px; }
      .chip {
        padding: 2px 8px; border-radius: 999px;
        border: 1px solid var(--ay-line); color: var(--ay-text-3); font-size: 10.5px; font-weight: 600;
      }

      .grounded {
        margin: 0 0 8px; font-size: 11.5px; color: var(--ay-text-3);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .failed { margin: 0 0 8px; font-size: 11.5px; color: var(--ay-danger); }

      .row { display: flex; align-items: center; gap: 12px; }
      .when { font-size: 11.5px; color: var(--ay-text-3); }
      .act { margin-left: auto; font-size: 12px; font-weight: 600; color: var(--ay-ink); text-decoration: none; }
      .act + .act { margin-left: 0; }
      .act:hover { text-decoration: underline; text-underline-offset: 3px; }

      .pager { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 26px; font-size: 12.5px; color: var(--ay-text-3); }
      .pager button {
        padding: 7px 16px; border-radius: 999px;
        border: 1px solid var(--ay-line); background: none;
        color: var(--ay-text-2); font: inherit; font-size: 12.5px; cursor: pointer;
      }
      .pager button:disabled { opacity: 0.4; cursor: not-allowed; }
    `,
  ],
})
export class VideoGalleryComponent implements OnInit {
  videos: VideoJobItem[] = [];
  total = 0;
  page = 1;
  readonly limit = 24;
  loading = true;
  error: string | null = null;

  filter: StatusFilter = 'all';
  readonly filters: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'ready', label: 'Ready' },
    { value: 'published', label: 'On YouTube' },
    { value: 'failed', label: 'Failed' },
  ];

  /** Id of the card currently playing, so only one video plays at a time. */
  playing: string | null = null;

  constructor(private history: HistoryService) {}

  ngOnInit(): void {
    this.load();
  }

  get lastPage(): number {
    return Math.max(1, Math.ceil(this.total / this.limit));
  }

  get readyCount(): number {
    return this.videos.filter((v) => !!v.videoUrl).length;
  }

  private matches(v: VideoJobItem, f: StatusFilter): boolean {
    switch (f) {
      case 'ready':
        return !!v.videoUrl;
      case 'published':
        return !!v.youtubeUrl;
      case 'failed':
        return v.status === 'failed';
      default:
        return true;
    }
  }

  get filtered(): VideoJobItem[] {
    return this.videos.filter((v) => this.matches(v, this.filter));
  }

  /**
   * Count for one filter chip. Deliberately does not borrow `filtered` by
   * swapping `this.filter` — a template-called method that mutates component
   * state, even briefly, is a trap for the next person to touch it.
   */
  countFor(value: StatusFilter): number | undefined {
    const n = this.videos.filter((v) => this.matches(v, value)).length;
    return n || undefined;
  }

  statusLabel(v: VideoJobItem): string {
    if (v.status === 'uploaded') return 'Published';
    if (v.status === 'completed') return 'Ready';
    if (v.status === 'failed') return 'Failed';
    if (v.status === 'running') return 'Rendering';
    return 'Queued';
  }

  /** Maps a job state onto the shared .ay-status modifiers in styles.css. */
  statusClass(v: VideoJobItem): string {
    switch (v.status) {
      case 'uploaded':
        return 'ay-status--success';
      case 'completed':
        return 'ay-status--ready';
      case 'failed':
        return 'ay-status--failed';
      case 'running':
        return 'ay-status--running';
      default:
        return 'ay-status--info';
    }
  }

  durationLabel(v: VideoJobItem): string {
    const s = v.config?.durationSeconds ?? 0;
    return s >= 60 ? `${Math.round(s / 60)} min` : `${s} sec`;
  }

  absolute(url: string): string {
    return /^https?:\/\//.test(url) ? url : `${environment.uploadsBase}${url}`;
  }

  go(page: number): void {
    if (page < 1 || page > this.lastPage) return;
    this.page = page;
    this.playing = null;
    this.load();
  }

  private load(): void {
    this.loading = true;
    this.error = null;
    this.history.getMyVideos(this.page, this.limit).subscribe({
      next: (res) => {
        this.loading = false;
        this.videos = res.videos || [];
        this.total = res.total ?? this.videos.length;
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.error || 'Could not load your videos.';
      },
    });
  }
}
