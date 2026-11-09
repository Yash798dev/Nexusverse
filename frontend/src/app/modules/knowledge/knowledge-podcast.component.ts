import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { KnowledgeService, PodcastState } from '../../services/knowledge.service';
import { environment } from '../../../environments/environment';

/** A render takes ~90-120s, so poll at a rate that is responsive but not chatty. */
const POLL_MS = 3000;

/**
 * "Podcast from your notes" — two AI hosts discussing this source.
 *
 * The render runs on the server and takes a couple of minutes, so this starts
 * the job and then polls. Nothing is held open waiting, and leaving the tab and
 * coming back picks the job up again because the state lives server-side.
 */
@Component({
  selector: 'app-knowledge-podcast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="pod">
      <!-- Nothing yet -->
      <div class="intro" *ngIf="state.status === 'idle'">
        <h3>Turn these notes into a podcast</h3>
        <p>
          Two hosts talk through this material, using only what the notes actually say.
          Takes about two minutes to produce.
        </p>
        <button type="button" class="go" (click)="start()">Generate podcast</button>
      </div>

      <!-- Rendering -->
      <div class="working" *ngIf="state.status === 'rendering'">
        <div class="working-top">
          <span class="ay-live-dot"></span>
          <span class="working-label">{{ stageLabel }}</span>
          <span class="working-pct">{{ state.progress }}%</span>
        </div>
        <div class="bar"><div class="fill" [style.width.%]="state.progress"></div></div>
        <p class="hint">You can leave this tab — it keeps rendering on the server.</p>
      </div>

      <!-- Done -->
      <div class="ready" *ngIf="state.status === 'ready' && state.url">
        <div class="ready-head">
          <h3>Your episode</h3>
          <button type="button" class="again" (click)="start()">Regenerate</button>
        </div>
        <audio class="player" controls preload="metadata" [src]="absolute(state.url)"></audio>
        <a class="download" [href]="absolute(state.url)" download>Download mp3</a>
      </div>

      <!-- Failed -->
      <div class="failed" *ngIf="state.status === 'failed'">
        <p class="err">{{ state.error || 'The podcast could not be rendered.' }}</p>
        <button type="button" class="go" (click)="start()">Try again</button>
      </div>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .pod { padding: 4px 0; }

      .intro, .failed { text-align: center; padding: 36px 20px; border: 1px dashed var(--ay-line-strong); border-radius: 16px; }
      h3 { margin: 0 0 8px; font-size: 16px; font-weight: 650; color: var(--ay-ink); }
      .intro p { margin: 0 auto 20px; max-width: 46ch; font-size: 13.5px; line-height: 1.65; color: var(--ay-text-3); }

      .go, .again {
        padding: 11px 26px; border-radius: 999px;
        border: 1px solid var(--ay-pink-edge); background: var(--ay-pink-soft);
        color: var(--ay-ink); font: inherit; font-weight: 600; font-size: 13.5px; cursor: pointer;
      }
      .go:hover, .again:hover { border-color: var(--ay-pink-bright); }
      .again { padding: 6px 15px; font-size: 12px; }

      .working { padding: 26px 22px; border: 1px solid var(--ay-line); border-radius: 16px; background: var(--ay-surface); }
      .working-top { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
      .working-label { font-size: 14px; font-weight: 600; color: var(--ay-ink); }
      .working-pct { margin-left: auto; font: 600 13px/1 var(--ay-mono); color: var(--ay-pink-bright); font-variant-numeric: tabular-nums; }
      .bar { height: 5px; border-radius: 999px; background: rgba(var(--ay-ink-rgb), 0.1); overflow: hidden; }
      .fill { height: 100%; border-radius: 999px; background: var(--ay-energy); transition: width 0.8s var(--ay-ease); }
      .hint { margin: 12px 0 0; font-size: 12.5px; color: var(--ay-text-3); }

      .ready { padding: 22px; border: 1px solid var(--ay-pink-edge); border-radius: 16px; background: var(--ay-pink-soft); }
      .ready-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
      .ready-head h3 { margin: 0; }
      .player { width: 100%; height: 42px; }
      .download { display: inline-block; margin-top: 12px; font-size: 12.5px; font-weight: 600; color: var(--ay-ink); }

      .err { margin: 0 0 16px; font-size: 13.5px; color: var(--ay-danger); }

      @media (prefers-reduced-motion: reduce) { .fill { transition: none; } }
    `,
  ],
})
export class KnowledgePodcastComponent implements OnInit, OnDestroy {
  @Input({ required: true }) sourceId!: string;

  state: PodcastState = { status: 'idle', progress: 0, url: null, error: null };

  private poll?: ReturnType<typeof setInterval>;
  private subs: Subscription[] = [];

  constructor(private knowledge: KnowledgeService) {}

  ngOnInit(): void {
    // A render started earlier may still be going, or already be finished.
    this.refresh();
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.subs.forEach((s) => s.unsubscribe());
  }

  /** Rough narrative for the progress number, so it is not a bare percentage. */
  get stageLabel(): string {
    if (this.state.progress < 10) return 'Writing the conversation…';
    if (this.state.progress < 90) return 'Recording the hosts…';
    return 'Mastering the audio…';
  }

  absolute(url: string): string {
    return /^https?:\/\//.test(url) ? url : `${environment.uploadsBase}${url}`;
  }

  start(): void {
    this.state = { status: 'rendering', progress: 0, url: null, error: null };
    this.subs.push(
      this.knowledge.startPodcast(this.sourceId).subscribe({
        next: (s) => {
          this.state = s;
          this.startPolling();
        },
        error: (err) => {
          this.state = {
            status: 'failed',
            progress: 0,
            url: null,
            error: err?.error?.error || 'Could not start the podcast.',
          };
        },
      })
    );
  }

  private refresh(): void {
    this.subs.push(
      this.knowledge.podcastStatus(this.sourceId).subscribe({
        next: (s) => {
          this.state = s;
          if (s.status === 'rendering') this.startPolling();
          else this.stopPolling();
        },
        // A failed status check is not worth surfacing; the next poll may work.
        error: () => {},
      })
    );
  }

  private startPolling(): void {
    this.stopPolling();
    this.poll = setInterval(() => this.refresh(), POLL_MS);
  }

  private stopPolling(): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = undefined;
  }
}
