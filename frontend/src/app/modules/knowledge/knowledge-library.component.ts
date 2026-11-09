import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { KnowledgeService, KnowledgeSource } from '../../services/knowledge.service';
import { ToastService } from '../../core/toast.service';
import { AppNavComponent } from '../../shared/app-nav/app-nav.component';

/**
 * Knowledge Hub — the library of everything this user has ingested.
 *
 * NexusNotes on its own had no such screen: a job could only be reached by
 * knowing its UUID, because the service has no concept of users. The library
 * exists because /api/knowledge attaches an owner to every job.
 */
@Component({
  selector: 'app-knowledge-library',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, AppNavComponent],
  template: `
    <app-nav></app-nav>
    <div class="wrap">
      <header class="head">
        <div>
          <p class="eyebrow">Knowledge Hub</p>
          <h1>Your library</h1>
          <p class="lede">
            Turn any lecture or talk into structured notes, a timeline and a quiz.
          </p>
        </div>
      </header>

      <!-- Add knowledge -->
      <form class="add" [formGroup]="form" (ngSubmit)="submit()">
        <label for="ytUrl" class="label">Add knowledge</label>
        <div class="add-row">
          <input
            id="ytUrl"
            type="url"
            formControlName="url"
            placeholder="https://www.youtube.com/watch?v=…"
            autocomplete="off"
            [attr.aria-invalid]="form.controls.url.invalid && form.controls.url.touched ? 'true' : null" />
          <button type="submit" class="btn" [disabled]="submitting">
            {{ submitting ? 'Starting…' : 'Process' }}
          </button>
        </div>
        <p class="err" *ngIf="error">{{ error }}</p>
      </form>

      <!-- Library -->
      <section class="list" aria-live="polite">
        <div class="list-head">
          <h2>
            {{ filtered.length }}{{ filtered.length !== sources.length ? ' of ' + sources.length : '' }}
            {{ sources.length === 1 ? 'source' : 'sources' }}
          </h2>
          <button type="button" class="ghost" (click)="refresh()" [disabled]="loading">Refresh</button>
        </div>

        <!-- Search and filters appear only once there is something to search. -->
        <div class="filters" *ngIf="sources.length > 1">
          <input
            type="search"
            class="search"
            [(ngModel)]="query"
            [ngModelOptions]="{ standalone: true }"
            placeholder="Search your library…"
            aria-label="Search knowledge sources" />
          <div class="chips" role="group" aria-label="Filter by status">
            <button
              type="button"
              *ngFor="let f of statusFilters"
              [class.on]="status === f.value"
              (click)="status = f.value">
              {{ f.label }}<span class="n" *ngIf="countFor(f.value) as n">{{ n }}</span>
            </button>
          </div>
        </div>

        <!-- Empty: offer a first action rather than just stating absence. -->
        <div class="empty-state" *ngIf="!loading && !sources.length">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          <h3>No knowledge yet</h3>
          <p>
            Paste a YouTube lecture or talk above. It gets transcribed, the board is
            captured, and you get notes, a mind map and a quiz — then you can turn
            any of it into a video.
          </p>
        </div>

        <!-- Loading: show the shape of what is coming, not the word "loading". -->
        <ul class="cards" *ngIf="loading && !sources.length" aria-hidden="true">
          <li *ngFor="let n of [1, 2, 3]"><span class="skeleton"></span></li>
        </ul>

        <!-- Searched into nothing: distinct from having no sources at all. -->
        <p class="empty" *ngIf="sources.length && !filtered.length">
          Nothing matches “{{ query }}”{{ status !== 'all' ? ' in ' + status + ' sources' : '' }}.
          <button type="button" class="ghost" (click)="clearFilters()">Clear filters</button>
        </p>

        <ul class="cards" *ngIf="filtered.length">
          <li *ngFor="let s of filtered">
            <button type="button" class="card" (click)="open(s)">
              <span class="badge" [attr.data-status]="s.status">{{ s.status }}</span>
              <span class="title">{{ s.title || 'Untitled — still processing' }}</span>
              <span class="url">{{ s.sourceUrl }}</span>
              <span class="when">{{ s.createdAt | date: 'mediumDate' }}</span>
            </button>
          </li>
        </ul>
      </section>
    </div>
  `,
  styles: [
    `
      :host { display: block; min-height: 100vh; background: var(--ay-bg); color: var(--ay-ink); font-family: var(--ay-font); }
      /* Top padding clears the fixed navbar. */
      .wrap { max-width: 980px; margin: 0 auto; padding: 104px 20px 80px; }

      .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 36px; }
      .eyebrow { font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ay-yellow); margin-bottom: 8px; }
      h1 { font-size: clamp(28px, 4vw, 40px); font-weight: 700; margin: 0 0 8px; }
      .lede { color: var(--ay-text-2); font-size: 15px; max-width: 46ch; }

      .add { margin-bottom: 40px; }
      .label { display: block; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ay-text-3); margin-bottom: 10px; }
      .add-row { display: flex; gap: 10px; flex-wrap: wrap; }
      input {
        flex: 1 1 320px; min-width: 0;
        padding: 13px 16px;
        border-radius: 12px;
        border: 1px solid var(--ay-border);
        background: var(--ay-surface);
        color: var(--ay-ink);
        font: inherit; font-size: 14px;
        transition: border-color 0.25s var(--ay-ease);
      }
      input:focus { outline: none; border-color: var(--ay-yellow); }
      input[aria-invalid='true'] { border-color: var(--ay-danger); }

      .btn {
        padding: 13px 26px;
        border-radius: 12px;
        border: 1px solid var(--ay-yellow-edge);
        background: var(--ay-yellow-soft);
        color: var(--ay-ink);
        font: inherit; font-weight: 600; font-size: 14px;
        cursor: pointer;
        transition: transform 0.25s var(--ay-ease), border-color 0.25s;
      }
      .btn:hover:not(:disabled) { transform: translateY(-1px); border-color: var(--ay-yellow); }
      .btn:disabled { opacity: 0.55; cursor: not-allowed; }

      .err { margin-top: 10px; font-size: 13px; color: var(--ay-danger); }

      .filters { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 16px; }
      .search {
        flex: 1 1 240px; min-width: 0;
        padding: 9px 13px; border-radius: 10px;
        border: 1px solid var(--ay-line); background: var(--ay-surface);
        color: var(--ay-ink); font: inherit; font-size: 13.5px;
      }
      .search:focus { outline: none; border-color: var(--ay-yellow); }
      .chips { display: flex; gap: 5px; flex-wrap: wrap; }
      .chips button {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 6px 12px; border-radius: 999px;
        border: 1px solid var(--ay-line); background: none;
        color: var(--ay-text-3); font: inherit; font-size: 12px; font-weight: 600;
        cursor: pointer; transition: border-color 0.2s var(--ay-ease), color 0.2s;
      }
      .chips button:hover { color: var(--ay-ink); }
      .chips button.on { border-color: var(--ay-yellow-edge); background: var(--ay-yellow-soft); color: var(--ay-yellow-bright); }
      .chips .n { font-variant-numeric: tabular-nums; opacity: 0.75; }

      .list-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 16px; }
      .list-head h2 { font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ay-text-3); font-weight: 600; }
      .ghost { background: none; border: none; color: var(--ay-text-2); font: inherit; font-size: 13px; cursor: pointer; padding: 4px 8px; border-radius: 8px; }
      .ghost:hover:not(:disabled) { color: var(--ay-ink); }
      .ghost:disabled { opacity: 0.5; cursor: default; }

      .empty { color: var(--ay-text-3); font-size: 14px; padding: 28px 0; }

      .empty-state {
        text-align: center; padding: 56px 24px;
        border: 1px dashed var(--ay-line-strong); border-radius: 16px;
      }
      .empty-state svg { width: 34px; height: 34px; color: var(--ay-text-3); margin-bottom: 14px; }
      .empty-state h3 { font-size: 16px; font-weight: 650; color: var(--ay-ink); margin: 0 0 8px; }
      .empty-state p { font-size: 13.5px; color: var(--ay-text-3); line-height: 1.65; max-width: 46ch; margin: 0 auto; }

      .skeleton {
        display: block; height: 74px; border-radius: 14px;
        border: 1px solid var(--ay-line);
        background: linear-gradient(90deg, rgba(var(--ay-ink-rgb), 0.03) 25%,
                    rgba(var(--ay-ink-rgb), 0.07) 37%, rgba(var(--ay-ink-rgb), 0.03) 63%);
        background-size: 400% 100%;
        animation: kb-shimmer 1.4s ease-in-out infinite;
      }
      @keyframes kb-shimmer { from { background-position: 100% 50%; } to { background-position: 0 50%; } }
      @media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } }

      .cards { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
      .card {
        width: 100%;
        display: grid;
        grid-template-columns: auto 1fr auto;
        grid-template-areas: 'badge title when' 'badge url when';
        gap: 2px 14px;
        align-items: center;
        text-align: left;
        padding: 16px 18px;
        border-radius: 14px;
        border: 1px solid var(--ay-line);
        background: var(--ay-surface);
        color: inherit;
        font: inherit;
        cursor: pointer;
        transition: border-color 0.25s var(--ay-ease), transform 0.25s var(--ay-ease);
      }
      .card:hover { border-color: var(--ay-line-strong); transform: translateY(-1px); }
      .card:focus-visible { outline: 2px solid var(--ay-yellow); outline-offset: 2px; }

      .badge {
        grid-area: badge;
        font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 700;
        padding: 5px 10px; border-radius: 999px;
        border: 1px solid var(--ay-line-strong); color: var(--ay-text-2);
      }
      .badge[data-status='completed'] { color: var(--ay-pink-bright); border-color: var(--ay-pink-edge); background: var(--ay-pink-soft); }
      .badge[data-status='processing'] { color: var(--ay-yellow-bright); border-color: var(--ay-yellow-edge); background: var(--ay-yellow-soft); }
      .badge[data-status='failed'] { color: var(--ay-danger); border-color: rgba(var(--ay-danger-rgb), 0.45); }

      .title { grid-area: title; font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .url { grid-area: url; font-size: 12px; color: var(--ay-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .when { grid-area: when; font-size: 12px; color: var(--ay-text-3); white-space: nowrap; }

      @media (max-width: 560px) {
        .card { grid-template-columns: auto 1fr; grid-template-areas: 'badge title' 'badge url' 'when when'; }
        .when { margin-top: 6px; }
      }
    `,
  ],
})
export class KnowledgeLibraryComponent implements OnInit, OnDestroy {
  form = this.fb.group({ url: ['', [Validators.required]] });

  sources: KnowledgeSource[] = [];

  /** Free-text filter over title and source URL. */
  query = '';
  /** Status filter. Counts are shown so an empty bucket is obvious. */
  status: 'all' | 'completed' | 'processing' | 'failed' = 'all';
  readonly statusFilters: { value: 'all' | 'completed' | 'processing' | 'failed'; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'completed', label: 'Ready' },
    { value: 'processing', label: 'Processing' },
    { value: 'failed', label: 'Failed' },
  ];

  loading = false;
  submitting = false;
  error: string | null = null;

  /** Anything still processing means the list needs to keep refreshing. */
  private poll?: ReturnType<typeof setInterval>;
  private subs: Subscription[] = [];

  constructor(
    private fb: FormBuilder,
    private knowledge: KnowledgeService,
    private router: Router,
    private toast: ToastService
  ) {}

  ngOnInit(): void {
    this.refresh();
    // Titles and statuses land asynchronously as the pipeline runs; a slow poll
    // keeps the library honest without a socket for a screen this quiet.
    this.poll = setInterval(() => {
      if (this.sources.some((s) => s.status === 'processing')) this.refresh();
    }, 10000);
  }

  ngOnDestroy(): void {
    clearInterval(this.poll);
    this.subs.forEach((s) => s.unsubscribe());
  }

  /** The library after search and status filtering. */
  get filtered(): KnowledgeSource[] {
    const q = this.query.trim().toLowerCase();
    return this.sources.filter((s) => {
      if (this.status !== 'all' && s.status !== this.status) return false;
      if (!q) return true;
      return `${s.title || ''} ${s.sourceUrl || ''}`.toLowerCase().includes(q);
    });
  }

  /** How many sources sit in a status bucket (undefined hides the badge). */
  countFor(value: 'all' | 'completed' | 'processing' | 'failed'): number | undefined {
    const n = value === 'all' ? this.sources.length : this.sources.filter((s) => s.status === value).length;
    return n || undefined;
  }

  clearFilters(): void {
    this.query = '';
    this.status = 'all';
  }

  refresh(): void {
    this.loading = true;
    this.subs.push(
      this.knowledge.list().subscribe({
        next: (res) => {
          this.sources = res.sources ?? [];
          this.loading = false;
        },
        error: (err) => {
          this.loading = false;
          this.toast.error('Could not load your library', this.reason(err));
        },
      })
    );
  }

  submit(): void {
    this.error = null;
    const url = (this.form.value.url || '').trim();

    if (!url) {
      this.error = 'Paste a YouTube URL to get started.';
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      this.error = 'That does not look like a URL.';
      return;
    }
    if (this.submitting) return;

    this.submitting = true;
    this.subs.push(
      this.knowledge.add(url).subscribe({
        next: (res) => {
          this.submitting = false;
          this.form.reset();
          this.toast.info('Processing started', 'Downloading and transcribing — this takes a few minutes.');
          this.router.navigate(['/knowledge', res.source._id]);
        },
        error: (err) => {
          this.submitting = false;
          this.error = this.reason(err);
          this.toast.error('Could not start processing', this.error);
        },
      })
    );
  }

  open(source: KnowledgeSource): void {
    this.router.navigate(['/knowledge', source._id]);
  }

  /** Server messages are more useful than "Http failure response…". */
  private reason(err: any): string {
    return err?.error?.error || err?.message || 'Something went wrong.';
  }
}
