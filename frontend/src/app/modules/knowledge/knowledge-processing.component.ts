import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { KnowledgeProgress, KnowledgeService } from '../../services/knowledge.service';

/** The pipeline's steps, in the order main.py runs them (STEP_NAMES, index 1-7). */
const STEP_LABELS = [
  'Downloading streams',
  'Extracting keyframes',
  'Transcribing audio',
  'Fusing context',
  'Generating quiz',
  'Saving results',
];

/** How many captured frames to keep on screen. */
const MAX_FRAMES = 12;

/**
 * Live view of an ingest job, driven by the SSE stream.
 *
 * The filmstrip shows board snapshots as the vision pipeline captures them.
 * Frames are fetched as blobs rather than set as <img src>: the keyframe route
 * is JWT-guarded and an image element cannot send an Authorization header, so
 * the alternative would be putting the token in a URL.
 */
@Component({
  selector: 'app-knowledge-processing',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="proc">
      <div class="statusline">
        <span class="dot" [attr.data-state]="state"></span>
        <span class="state">{{ headline }}</span>
        <span class="pct" *ngIf="state === 'processing'">{{ progress.step_progress | number: '1.0-0' }}%</span>
      </div>

      <p class="msg">{{ progress.step_message || 'Waiting for the pipeline to start…' }}</p>

      <div class="bar" *ngIf="state === 'processing'" role="progressbar"
           [attr.aria-valuenow]="progress.step_progress | number: '1.0-0'" aria-valuemin="0" aria-valuemax="100">
        <div class="fill" [style.width.%]="progress.step_progress"></div>
      </div>

      <ol class="steps">
        <li *ngFor="let label of stepLabels; let i = index"
            [class.is-done]="isDone(i)"
            [class.is-active]="isActive(i)"
            [class.is-failed]="state === 'failed' && isActive(i)">
          <span class="mark">{{ isDone(i) ? '✓' : state === 'failed' && isActive(i) ? '✕' : i + 1 }}</span>
          <span class="lbl">{{ label }}</span>
        </li>
      </ol>

      <!-- Board captures -->
      <div class="film" *ngIf="frames.length">
        <p class="film-title">Board captures</p>
        <div class="strip">
          <img *ngFor="let f of frames; let last = last" [src]="f.url" [class.newest]="last" alt="Captured board frame" />
        </div>
      </div>

      <div class="stats" *ngIf="hasStats">
        <div *ngIf="stat('keyframes_saved') !== null">
          <b>{{ stat('keyframes_saved') }}</b><span>keyframes</span>
        </div>
        <div *ngIf="stat('transcript_segments') !== null">
          <b>{{ stat('transcript_segments') }}</b><span>segments</span>
        </div>
        <div *ngIf="stat('quiz_questions') !== null">
          <b>{{ stat('quiz_questions') }}</b><span>questions</span>
        </div>
      </div>

      <details class="logs" *ngIf="progress.logs?.length">
        <summary>Pipeline log</summary>
        <div class="loglines">
          <p *ngFor="let line of progress.logs">{{ line }}</p>
        </div>
      </details>

      <button type="button" class="retry" *ngIf="state === 'failed'" (click)="retry.emit()">
        Resume from checkpoint
      </button>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .proc { border: 1px solid var(--ay-line); border-radius: 16px; background: var(--ay-surface); padding: 24px; }

      .statusline { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ay-text-3); flex: none; }
      .dot[data-state='processing'] { background: var(--ay-yellow); animation: live 1.6s ease-in-out infinite; }
      .dot[data-state='completed'] { background: var(--ay-pink); }
      .dot[data-state='failed'] { background: var(--ay-danger); }
      @keyframes live { 50% { transform: scale(1.45); opacity: 0.55; } }

      .state { font-size: 15px; font-weight: 600; }
      .pct { margin-left: auto; font: 600 13px/1 var(--ay-mono); color: var(--ay-yellow-bright); font-variant-numeric: tabular-nums; }
      .msg { color: var(--ay-text-2); font-size: 13.5px; margin-bottom: 16px; min-height: 20px; }

      .bar { height: 5px; border-radius: 999px; background: rgba(var(--ay-ink-rgb), 0.1); overflow: hidden; margin-bottom: 22px; }
      .fill { height: 100%; border-radius: 999px; background: var(--ay-energy); transition: width 0.7s var(--ay-ease); }

      .steps { list-style: none; margin: 0 0 20px; padding: 0; display: grid; gap: 4px; }
      .steps li { display: flex; align-items: center; gap: 11px; padding: 7px 10px; border-radius: 9px; border: 1px solid transparent; }
      .steps li.is-active { background: var(--ay-yellow-soft); border-color: var(--ay-yellow-edge); }
      .steps li.is-failed { background: rgba(var(--ay-danger-rgb), 0.07); border-color: rgba(var(--ay-danger-rgb), 0.4); }

      .mark {
        width: 22px; height: 22px; flex: none;
        display: grid; place-items: center;
        border-radius: 50%; font-size: 11px; font-weight: 700;
        border: 1px solid var(--ay-border); color: var(--ay-text-3);
      }
      .steps li.is-done .mark { border-color: transparent; background: rgba(var(--ay-ink-rgb), 0.82); color: var(--ay-bg); }
      .steps li.is-active .mark { border-color: transparent; background: var(--ay-yellow); color: #050505; }
      .steps li.is-failed .mark { background: var(--ay-danger); border-color: transparent; color: #050505; }

      .lbl { font-size: 13.5px; color: var(--ay-text-3); }
      .steps li.is-done .lbl { color: var(--ay-text-2); }
      .steps li.is-active .lbl { color: var(--ay-ink); font-weight: 600; }

      .film { margin-bottom: 20px; }
      .film-title { font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ay-text-3); font-weight: 700; margin-bottom: 9px; }
      .strip { display: flex; gap: 7px; overflow-x: auto; padding-bottom: 4px; }
      .strip img {
        height: 74px; width: auto; flex: none;
        border-radius: 8px; border: 1px solid var(--ay-line);
        object-fit: cover;
      }
      .strip img.newest { border-color: var(--ay-yellow); }

      .stats { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 18px; }
      .stats div { flex: 1 1 110px; text-align: center; padding: 12px; border-radius: 12px; border: 1px solid var(--ay-line); }
      .stats b { display: block; font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
      .stats span { font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ay-text-3); }

      .logs summary { cursor: pointer; font-size: 12px; color: var(--ay-text-3); padding: 6px 0; }
      .logs summary:hover { color: var(--ay-text-2); }
      .loglines { max-height: 190px; overflow-y: auto; border-radius: 10px; background: rgba(var(--ay-bg-rgb), 0.6); border: 1px solid var(--ay-line); padding: 10px 12px; }
      .loglines p { font: 400 11.5px/1.6 var(--ay-mono); color: var(--ay-text-2); word-break: break-word; }

      .retry {
        margin-top: 16px; padding: 11px 22px; border-radius: 11px;
        border: 1px solid var(--ay-yellow-edge); background: var(--ay-yellow-soft);
        color: var(--ay-ink); font: inherit; font-weight: 600; font-size: 13.5px; cursor: pointer;
      }
      .retry:hover { border-color: var(--ay-yellow); }

      @media (prefers-reduced-motion: reduce) { .dot, .fill { animation: none; transition: none; } }
    `,
  ],
})
export class KnowledgeProcessingComponent implements OnInit, OnDestroy {
  /** KnowledgeSource id (the Mongo _id, not the notes service's video_id). */
  @Input({ required: true }) sourceId!: string;
  /** Status already known from the detail fetch, so the view starts populated. */
  @Input() initialStatus = 'processing';

  @Output() completed = new EventEmitter<void>();
  @Output() retry = new EventEmitter<void>();

  readonly stepLabels = STEP_LABELS;

  progress: KnowledgeProgress = {
    status: 'processing',
    current_step: 0,
    step_name: 'Initializing',
    step_message: '',
    step_progress: 0,
    stats: {},
    logs: [],
  };

  /** Captured board frames, oldest first. `url` is an object URL we own. */
  frames: { path: string; url: string }[] = [];

  private sub?: Subscription;
  private seenFrames = new Set<string>();

  constructor(private knowledge: KnowledgeService) {}

  ngOnInit(): void {
    this.progress = { ...this.progress, status: this.initialStatus };

    this.sub = this.knowledge.streamProgress(this.sourceId).subscribe({
      next: (p) => {
        this.progress = p;
        this.captureFrame(p);
        if (p.status === 'completed') this.completed.emit();
      },
      // A dropped stream is not worth an error state: the parent still polls
      // the detail endpoint, so the page recovers on its own.
      error: () => {},
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    // Blob URLs are held by the document until explicitly released.
    this.frames.forEach((f) => URL.revokeObjectURL(f.url));
    this.frames = [];
  }

  /** Pick up the newest board snapshot the vision pipeline reported. */
  private captureFrame(p: KnowledgeProgress): void {
    const latest = p.stats?.['latest_frame'];
    if (typeof latest !== 'string' || !latest || this.seenFrames.has(latest)) return;
    this.seenFrames.add(latest);

    this.knowledge.loadKeyframe(this.sourceId, latest).then((url) => {
      if (!url) return;
      this.frames = [...this.frames, { path: latest, url }];
      while (this.frames.length > MAX_FRAMES) {
        const dropped = this.frames.shift();
        if (dropped) URL.revokeObjectURL(dropped.url);
      }
    });
  }

  get state(): string {
    return this.progress.status;
  }

  get headline(): string {
    if (this.state === 'completed') return 'Notes ready';
    if (this.state === 'failed') return 'Processing failed';
    return this.progress.step_name || 'Starting…';
  }

  /** Steps are 1-indexed in the pipeline; this list is 0-indexed. */
  isDone(i: number): boolean {
    return this.state === 'completed' || this.progress.current_step > i + 1;
  }

  isActive(i: number): boolean {
    return this.state !== 'completed' && this.progress.current_step === i + 1;
  }

  get hasStats(): boolean {
    return ['keyframes_saved', 'transcript_segments', 'quiz_questions'].some((k) => this.stat(k) !== null);
  }

  stat(key: string): number | null {
    const value = this.progress.stats?.[key];
    return typeof value === 'number' ? value : null;
  }
}
