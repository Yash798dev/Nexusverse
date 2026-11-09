import { Component, OnDestroy, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { KnowledgeDetail, KnowledgeService } from '../../services/knowledge.service';
import { ToastService } from '../../core/toast.service';
import { KnowledgeProcessingComponent } from './knowledge-processing.component';
import { KnowledgeNotesPanelComponent } from './knowledge-notes-panel.component';
import { KnowledgeMindmapComponent } from './knowledge-mindmap.component';
import { KnowledgeDiagramComponent } from './knowledge-diagram.component';
import { KnowledgeQuizComponent } from './knowledge-quiz.component';
import { KnowledgeChatComponent } from './knowledge-chat.component';
import { KnowledgePodcastComponent } from './knowledge-podcast.component';
import { KnowledgeFlashcardsComponent } from './knowledge-flashcards.component';
import { AppNavComponent } from '../../shared/app-nav/app-nav.component';

type Tab = 'notes' | 'chat' | 'podcast' | 'mindmap' | 'diagrams' | 'flashcards' | 'quiz';

/** Pull the video id out of any YouTube URL shape. */
function youtubeId(url: string): string | null {
  for (const p of [/[?&]v=([^&#]+)/, /youtu\.be\/([^?&#]+)/, /\/embed\/([^?&#]+)/, /\/shorts\/([^?&#]+)/]) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

/**
 * One knowledge source: the video alongside everything generated from it.
 *
 * While the pipeline runs this shows the live processing view; once it finishes
 * it swaps to the split view with the four output tabs.
 */
@Component({
  selector: 'app-knowledge-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    AppNavComponent,
    KnowledgeProcessingComponent,
    KnowledgeNotesPanelComponent,
    KnowledgeMindmapComponent,
    KnowledgeDiagramComponent,
    KnowledgeQuizComponent,
    KnowledgeChatComponent,
    KnowledgePodcastComponent,
    KnowledgeFlashcardsComponent,
  ],
  template: `
    <app-nav></app-nav>
    <div class="wrap">
      <header class="bar">
        <!-- Breadcrumb: says where you are, not just how to leave. -->
        <nav class="crumbs" aria-label="Breadcrumb">
          <a routerLink="/knowledge">Knowledge</a>
          <span class="sep" aria-hidden="true">/</span>
          <span class="crumb-current" [title]="detail?.source?.title || ''">{{ detail?.source?.title || 'Loading…' }}</span>
        </nav>
        <span class="badge" *ngIf="detail" [attr.data-status]="detail.source.status">{{ detail.source.status }}</span>
        <!-- Export: nothing could previously leave the app. -->
        <div class="export" *ngIf="isComplete">
          <button type="button" class="export-btn" (click)="exportOpen = !exportOpen" [attr.aria-expanded]="exportOpen">
            Export ▾
          </button>
          <div class="export-menu" *ngIf="exportOpen">
            <button type="button" (click)="downloadMarkdown()">Notes as Markdown</button>
            <button type="button" (click)="downloadAnki()" [disabled]="!detail?.quiz?.length">
              Quiz as Anki deck
            </button>
            <button type="button" (click)="printNotes()">Print / Save as PDF</button>
          </div>
        </div>
        <button type="button" class="make-video" *ngIf="isComplete" (click)="createVideo()">
          Create video from this
        </button>
      </header>

      <!-- Loading: mirror the finished layout so the page does not jump. -->
      <div class="split" *ngIf="loading && !detail" aria-hidden="true">
        <div class="left"><span class="skeleton player-skeleton"></span></div>
        <div class="right">
          <span class="skeleton line short"></span>
          <span class="skeleton line"></span>
          <span class="skeleton line"></span>
          <span class="skeleton line medium"></span>
        </div>
      </div>
      <p class="loading err" *ngIf="loadError">{{ loadError }}</p>

      <ng-container *ngIf="detail">
        <!-- Still working (or failed) -->
        <app-knowledge-processing
          *ngIf="!isComplete"
          [sourceId]="detail.source._id"
          [initialStatus]="detail.source.status"
          (completed)="onCompleted()"
          (retry)="onRetry()"></app-knowledge-processing>

        <!-- Finished -->
        <div class="split" *ngIf="isComplete">
          <div class="left">
            <div class="player" *ngIf="embedUrl; else noVideo">
              <iframe
                #player
                [src]="embedUrl"
                title="Source video"
                frameborder="0"
                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowfullscreen></iframe>
            </div>
            <ng-template #noVideo>
              <div class="player placeholder"><span>No playable video for this source</span></div>
            </ng-template>
          </div>

          <div class="right">
            <div class="tabs" role="tablist">
              <button
                type="button"
                role="tab"
                *ngFor="let t of tabs"
                [class.on]="tab === t.id"
                [attr.aria-selected]="tab === t.id"
                [disabled]="!available(t.id)"
                (click)="tab = t.id">
                {{ t.label }}
              </button>
            </div>

            <div class="panel" [ngSwitch]="tab">
              <app-knowledge-notes-panel
                *ngSwitchCase="'notes'"
                [markdown]="detail.notes?.markdown_content || ''"
                [timeline]="detail.notes?.fused_timeline_json || []"
                (seek)="seekTo($event)"></app-knowledge-notes-panel>

              <app-knowledge-chat
                *ngSwitchCase="'chat'"
                [sourceId]="detail.source._id"
                (seek)="seekTo($event)"></app-knowledge-chat>

              <app-knowledge-podcast
                *ngSwitchCase="'podcast'"
                [sourceId]="detail.source._id"></app-knowledge-podcast>

              <app-knowledge-mindmap
                *ngSwitchCase="'mindmap'"
                [markdown]="detail.notes?.markdown_content || ''"></app-knowledge-mindmap>

              <app-knowledge-diagram
                *ngSwitchCase="'diagrams'"
                [markdown]="detail.notes?.markdown_content || ''"></app-knowledge-diagram>

              <app-knowledge-flashcards
                *ngSwitchCase="'flashcards'"
                [sourceId]="detail.source._id"></app-knowledge-flashcards>

              <app-knowledge-quiz
                *ngSwitchCase="'quiz'"
                [questions]="detail.quiz || []"></app-knowledge-quiz>
            </div>
          </div>
        </div>
      </ng-container>
    </div>
  `,
  styles: [
    `
      :host { display: block; min-height: 100vh; background: var(--ay-bg); color: var(--ay-ink); font-family: var(--ay-font); }
      /* Top padding clears the fixed navbar. */
      .wrap { max-width: 1320px; margin: 0 auto; padding: 92px 20px 70px; }

      .bar {
        display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
        padding-bottom: 16px; margin-bottom: 26px; border-bottom: 1px solid var(--ay-line);
      }
      .crumbs { display: flex; align-items: center; gap: 9px; min-width: 0; flex: 1 1 220px; font-size: 13.5px; }
      .crumbs a { color: var(--ay-text-2); text-decoration: none; white-space: nowrap; }
      .crumbs a:hover { color: var(--ay-ink); text-decoration: underline; text-underline-offset: 3px; }
      .crumbs .sep { color: var(--ay-text-3); }
      .crumb-current {
        font-weight: 600; color: var(--ay-ink);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .badge {
        font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 700;
        padding: 5px 10px; border-radius: 999px; border: 1px solid var(--ay-line-strong); color: var(--ay-text-2);
      }
      .badge[data-status='completed'] { color: var(--ay-pink-bright); border-color: var(--ay-pink-edge); background: var(--ay-pink-soft); }
      .badge[data-status='processing'] { color: var(--ay-yellow-bright); border-color: var(--ay-yellow-edge); background: var(--ay-yellow-soft); }
      .badge[data-status='failed'] { color: var(--ay-danger); border-color: rgba(var(--ay-danger-rgb), 0.45); }

      .export { position: relative; }
      .export-btn {
        padding: 7px 14px; border-radius: 999px;
        border: 1px solid var(--ay-line-strong); background: none;
        color: var(--ay-text-2); font: inherit; font-size: 12.5px; font-weight: 600;
        cursor: pointer; white-space: nowrap;
      }
      .export-btn:hover { color: var(--ay-ink); border-color: var(--ay-ink); }
      .export-menu {
        position: absolute; right: 0; top: calc(100% + 6px); z-index: 20;
        display: grid; min-width: 210px; padding: 5px;
        border-radius: 12px; border: 1px solid var(--ay-line);
        background: var(--ay-surface); box-shadow: var(--ay-shadow-md);
      }
      .export-menu button {
        padding: 9px 11px; border: 0; border-radius: 8px;
        background: none; color: var(--ay-text-2);
        font: inherit; font-size: 13px; text-align: left; cursor: pointer;
      }
      .export-menu button:hover:not(:disabled) { background: rgba(var(--ay-ink-rgb), 0.06); color: var(--ay-ink); }
      .export-menu button:disabled { opacity: 0.45; cursor: not-allowed; }

      /* Printing: drop the chrome and let the notes fill the page. */
      @media print {
        .bar, .export, .make-video, .tabs, .left { display: none !important; }
        .split { grid-template-columns: 1fr; }
        .wrap { padding: 0; max-width: none; }
        :host { background: #fff; color: #000; }
      }

      .make-video {
        padding: 7px 15px; border-radius: 999px;
        border: 1px solid var(--ay-pink-edge); background: var(--ay-pink-soft);
        color: var(--ay-ink); font: inherit; font-size: 12.5px; font-weight: 600;
        cursor: pointer; white-space: nowrap;
        transition: border-color 0.25s var(--ay-ease), transform 0.25s var(--ay-ease);
      }
      .make-video:hover { border-color: var(--ay-pink-bright); transform: translateY(-1px); }
      .make-video:focus-visible { outline: 2px solid var(--ay-yellow); outline-offset: 2px; }

      .loading { color: var(--ay-text-3); font-size: 14px; padding: 30px 0; }
      .loading.err { color: var(--ay-danger); }

      .split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 26px; align-items: start; }
      .left { position: sticky; top: 20px; }
      .player {
        aspect-ratio: 16 / 9; width: 100%;
        border-radius: 14px; overflow: hidden;
        border: 1px solid var(--ay-line); background: #000;
      }
      .player iframe { width: 100%; height: 100%; display: block; border: 0; }
      .placeholder { display: grid; place-items: center; background: var(--ay-surface); }
      .placeholder span { color: var(--ay-text-3); font-size: 13px; }

      .skeleton {
        display: block; border-radius: 10px;
        background: linear-gradient(90deg, rgba(var(--ay-ink-rgb), 0.03) 25%,
                    rgba(var(--ay-ink-rgb), 0.07) 37%, rgba(var(--ay-ink-rgb), 0.03) 63%);
        background-size: 400% 100%;
        animation: kd-shimmer 1.4s ease-in-out infinite;
      }
      .player-skeleton { aspect-ratio: 16 / 9; width: 100%; border-radius: 14px; }
      .skeleton.line { height: 15px; margin-bottom: 13px; }
      .skeleton.line.short { width: 42%; height: 22px; margin-bottom: 20px; }
      .skeleton.line.medium { width: 72%; }
      @keyframes kd-shimmer { from { background-position: 100% 50%; } to { background-position: 0 50%; } }
      @media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } }

      .right { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
      .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--ay-line); }
      .tabs button {
        position: relative;
        padding: 9px 14px; border: 0; background: none;
        color: var(--ay-text-3); font: inherit; font-size: 13px; font-weight: 600;
        cursor: pointer; transition: color 0.25s var(--ay-ease);
      }
      .tabs button:hover:not(:disabled) { color: var(--ay-ink); }
      .tabs button:disabled { opacity: 0.4; cursor: not-allowed; }
      .tabs button.on { color: var(--ay-ink); }
      .tabs button.on::after {
        content: ''; position: absolute; left: 10px; right: 10px; bottom: -1px;
        height: 2px; border-radius: 2px; background: var(--ay-energy);
      }

      .panel { min-height: 50vh; }

      @media (max-width: 900px) {
        .split { grid-template-columns: 1fr; }
        .left { position: static; }
      }
    `,
  ],
})
export class KnowledgeDetailComponent implements OnInit, OnDestroy {
  @ViewChild('player') playerRef?: ElementRef<HTMLIFrameElement>;

  readonly tabs: { id: Tab; label: string }[] = [
    { id: 'notes', label: 'Notes' },
    { id: 'chat', label: 'Ask AI' },
    { id: 'podcast', label: 'Podcast' },
    { id: 'mindmap', label: 'Mind map' },
    { id: 'diagrams', label: 'Diagrams' },
    { id: 'flashcards', label: 'Flashcards' },
    { id: 'quiz', label: 'Quiz' },
  ];

  tab: Tab = 'notes';
  exportOpen = false;
  detail: KnowledgeDetail | null = null;
  loading = false;
  loadError: string | null = null;
  videoId: string | null = null;
  /**
   * Angular refuses a plain string in an <iframe [src]> binding — it is a
   * resource URL, so it must be explicitly trusted. Safe here because the URL is
   * assembled from a video id matched out of the stored source URL, never from
   * free-form input.
   */
  embedUrl: SafeResourceUrl | null = null;

  private sourceId = '';
  private poll?: ReturnType<typeof setInterval>;
  private subs: Subscription[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private knowledge: KnowledgeService,
    private toast: ToastService,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.sourceId = this.route.snapshot.paramMap.get('id') || '';
    if (!this.sourceId) {
      this.loadError = 'No knowledge source specified.';
      return;
    }
    this.load();

    // The SSE stream drives the processing view; this is the backstop that
    // notices a finish even if that stream dropped.
    this.poll = setInterval(() => {
      if (this.detail && !this.isComplete) this.load();
    }, 15000);
  }

  ngOnDestroy(): void {
    clearInterval(this.poll);
    this.subs.forEach((s) => s.unsubscribe());
  }

  get isComplete(): boolean {
    return this.detail?.source.status === 'completed';
  }

  /** Notes drive three of the four tabs; the quiz needs its own data. */
  available(tab: Tab): boolean {
    if (tab === 'quiz') return !!this.detail?.quiz?.length;
    return !!this.detail?.notes?.markdown_content;
  }

  private load(): void {
    this.loading = true;
    this.subs.push(
      this.knowledge.detail(this.sourceId).subscribe({
        next: (d) => {
          this.detail = d;
          this.loading = false;
          this.loadError = null;

          const url = d.source.sourceUrl || d.status?.youtube_url || '';
          const id = url ? youtubeId(url) : null;
          if (id && id !== this.videoId) {
            this.videoId = id;
            // enablejsapi lets seekTo be driven over postMessage, which avoids
            // pulling in the YouTube IFrame API script and its typings.
            this.embedUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
              `https://www.youtube.com/embed/${id}?enablejsapi=1&rel=0`
            );
          }
        },
        error: (err) => {
          this.loading = false;
          this.loadError = err?.status === 404
            ? 'That knowledge source does not exist, or it is not yours.'
            : err?.error?.error || 'Could not load this knowledge source.';
        },
      })
    );
  }

  onCompleted(): void {
    this.load();
    this.toast.success('Notes ready', 'Your study notes and quiz have been generated.');
  }

  onRetry(): void {
    this.subs.push(
      this.knowledge.retry(this.sourceId).subscribe({
        next: () => {
          this.toast.info('Resuming', 'Picking up from the last completed step.');
          this.load();
        },
        error: (err) => this.toast.error('Could not resume', err?.error?.error || 'Try again in a moment.'),
      })
    );
  }

  /** Seek the embedded player, driven by timestamp links in the notes. */
  seekTo(seconds: number): void {
    const frame = this.playerRef?.nativeElement;
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage(
      JSON.stringify({ event: 'command', func: 'seekTo', args: [seconds, true] }),
      'https://www.youtube.com'
    );
  }

  // ── Export ────────────────────────────────────────────────────────────
  // All client-side: the notes and quiz are already loaded, so nothing needs a
  // round trip and no PDF library is required.

  /** Safe, recognisable file name from the source title. */
  private fileName(extension: string): string {
    const base = (this.detail?.source.title || 'notes')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'notes';
    return `${base}.${extension}`;
  }

  private download(content: string, mime: string, filename: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    this.exportOpen = false;
  }

  downloadMarkdown(): void {
    const notes = this.detail?.notes?.markdown_content;
    if (!notes) return;
    const source = this.detail?.source;
    const header = `> Source: ${source?.title || ''}\n> ${source?.sourceUrl || ''}\n\n`;
    this.download(header + notes, 'text/markdown', this.fileName('md'));
  }

  /**
   * Anki imports tab-separated files directly, so a plain .tsv is a working
   * deck without the complexity of building an .apkg archive. Fields are
   * HTML, so newlines become <br> and tabs are stripped — a stray tab would
   * silently shift every later column.
   */
  downloadAnki(): void {
    const quiz = this.detail?.quiz;
    if (!quiz?.length) return;

    const field = (s: string) => (s || '').replace(/\t/g, ' ').replace(/\r?\n/g, '<br>').trim();
    const rows = quiz.map((q) => {
      const front = field(`${q.question}<br><br>${q.options.map((o, i) => `${'ABCD'[i] || i + 1}. ${o}`).join('<br>')}`);
      const back = field(`<b>${q.answer}</b>${q.explanation ? `<br><br>${q.explanation}` : ''}`);
      return `${front}\t${back}`;
    });

    // Anki reads these header lines and configures the import automatically.
    const content = ['#separator:tab', '#html:true', ...rows].join('\n');
    this.download(content, 'text/tab-separated-values', this.fileName('tsv'));
  }

  /** Browser print dialog — "Save as PDF" is a destination there on every OS. */
  printNotes(): void {
    this.exportOpen = false;
    this.tab = 'notes';
    setTimeout(() => window.print(), 80);
  }

  /**
   * Hand this source to the AI Studio. Only the id travels — the server loads
   * the notes itself and re-checks that they belong to the caller.
   */
  createVideo(): void {
    this.router.navigate(['/workflow'], { queryParams: { knowledge: this.sourceId } });
  }

}
