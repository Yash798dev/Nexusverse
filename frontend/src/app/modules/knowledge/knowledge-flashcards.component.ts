import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import {
  Flashcard,
  KnowledgeService,
  ReviewGrade,
} from '../../services/knowledge.service';

/** The four buttons, in the order muscle memory expects. */
const GRADES: { value: ReviewGrade; label: string; tone: string }[] = [
  { value: 'again', label: 'Again', tone: 'again' },
  { value: 'hard', label: 'Hard', tone: 'hard' },
  { value: 'good', label: 'Good', tone: 'good' },
  { value: 'easy', label: 'Easy', tone: 'easy' },
];

/**
 * Spaced-repetition review for one source.
 *
 * The quiz already in the product tests you once and is then gone. This is the
 * part you come back to: only cards that are actually *due* are shown, and each
 * grading button says when you would next see the card — which is what makes
 * the scheduling legible rather than mysterious.
 *
 * Scheduling itself lives on the server (SM-2); this only reports how the
 * recall went and renders what comes back.
 */
@Component({
  selector: 'app-knowledge-flashcards',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="cards">
      <p class="loading" *ngIf="loading">Preparing your cards…</p>
      <p class="err" *ngIf="error">{{ error }}</p>

      <ng-container *ngIf="!loading && !error">
        <!-- Header -->
        <div class="bar" *ngIf="total">
          <span class="count">{{ queue.length }} due</span>
          <span class="of">of {{ total }} cards</span>
          <span class="reviewed" *ngIf="reviewCount">{{ reviewCount }} reviewed all time</span>
        </div>

        <!-- Nothing due -->
        <div class="done" *ngIf="total && !queue.length">
          <h3>Nothing due right now</h3>
          <p>
            You've reviewed everything that was ready.
            <ng-container *ngIf="nextDueLabel"> Next card is due {{ nextDueLabel }}.</ng-container>
          </p>
          <button type="button" class="ghost" (click)="load()">Refresh</button>
        </div>

        <!-- A card -->
        <div class="card" *ngIf="current as card">
          <p class="progress">Card {{ reviewedThisSession + 1 }} of {{ reviewedThisSession + queue.length }}</p>

          <div class="face front">
            <p>{{ card.front }}</p>
            <p class="hint" *ngIf="card.hint && !revealed">Hint: {{ card.hint }}</p>
          </div>

          <div class="face back" *ngIf="revealed">
            <p>{{ card.back }}</p>
          </div>

          <button type="button" class="reveal" *ngIf="!revealed" (click)="revealed = true">
            Show answer
          </button>

          <div class="grades" *ngIf="revealed">
            <button
              type="button"
              *ngFor="let g of grades"
              [attr.data-tone]="g.tone"
              [disabled]="grading"
              (click)="grade(g.value)">
              <b>{{ g.label }}</b>
              <i>{{ card.intervals[g.value] }}</i>
            </button>
          </div>
        </div>
      </ng-container>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .cards { min-height: 46vh; }
      .loading { color: var(--ay-text-3); font-size: 14px; padding: 40px 0; text-align: center; }
      .err { color: var(--ay-danger); font-size: 13.5px; padding: 24px 0; text-align: center; }

      .bar { display: flex; align-items: baseline; gap: 10px; margin-bottom: 18px; }
      .count { font-size: 13px; font-weight: 700; color: var(--ay-ink); }
      .of { font-size: 12.5px; color: var(--ay-text-3); }
      .reviewed { margin-left: auto; font-size: 11.5px; color: var(--ay-text-3); }

      .done { text-align: center; padding: 48px 20px; border: 1px dashed var(--ay-line-strong); border-radius: 16px; }
      .done h3 { margin: 0 0 8px; font-size: 16px; font-weight: 650; color: var(--ay-ink); }
      .done p { margin: 0 0 18px; font-size: 13.5px; color: var(--ay-text-3); line-height: 1.6; }
      .ghost {
        padding: 8px 18px; border-radius: 999px; border: 1px solid var(--ay-line-strong);
        background: none; color: var(--ay-text-2); font: inherit; font-size: 12.5px; cursor: pointer;
      }
      .ghost:hover { color: var(--ay-ink); }

      .card { display: flex; flex-direction: column; gap: 14px; }
      .progress { margin: 0; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ay-text-3); }

      .face { padding: 26px 22px; border-radius: 14px; border: 1px solid var(--ay-line); background: var(--ay-surface); }
      .face p { margin: 0; line-height: 1.6; }
      .front p { font-size: 16.5px; font-weight: 600; color: var(--ay-ink); }
      .front .hint { margin-top: 10px; font-size: 12.5px; font-weight: 400; color: var(--ay-text-3); }
      .back { border-color: var(--ay-pink-edge); background: var(--ay-pink-soft); }
      .back p { font-size: 14.5px; color: var(--ay-ink); }

      .reveal {
        align-self: flex-start;
        padding: 11px 26px; border-radius: 999px;
        border: 1px solid var(--ay-yellow-edge); background: var(--ay-yellow-soft);
        color: var(--ay-ink); font: inherit; font-weight: 600; font-size: 13.5px; cursor: pointer;
      }
      .reveal:hover { border-color: var(--ay-yellow); }

      .grades { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
      .grades button {
        display: flex; flex-direction: column; align-items: center; gap: 3px;
        padding: 11px 6px; border-radius: 11px;
        border: 1px solid var(--ay-line); background: var(--ay-surface);
        color: var(--ay-text-2); font: inherit; cursor: pointer;
        transition: border-color 0.2s var(--ay-ease), transform 0.2s var(--ay-ease);
      }
      .grades button:hover:not(:disabled) { transform: translateY(-1px); }
      .grades button:disabled { opacity: 0.5; cursor: not-allowed; }
      .grades b { font-size: 13px; font-weight: 650; color: var(--ay-ink); }
      .grades i { font-style: normal; font-size: 10.5px; color: var(--ay-text-3); }
      .grades button[data-tone='again']:hover:not(:disabled) { border-color: rgba(var(--ay-danger-rgb), 0.6); }
      .grades button[data-tone='hard']:hover:not(:disabled) { border-color: var(--ay-line-strong); }
      .grades button[data-tone='good']:hover:not(:disabled) { border-color: var(--ay-yellow-edge); }
      .grades button[data-tone='easy']:hover:not(:disabled) { border-color: var(--ay-pink-edge); }

      @media (max-width: 560px) { .grades { grid-template-columns: repeat(2, 1fr); } }
      @media (prefers-reduced-motion: reduce) { .grades button { transition: none; } }
    `,
  ],
})
export class KnowledgeFlashcardsComponent implements OnInit, OnDestroy {
  @Input({ required: true }) sourceId!: string;

  readonly grades = GRADES;

  /** Cards still to review in this sitting. */
  queue: Flashcard[] = [];
  total = 0;
  reviewCount = 0;
  reviewedThisSession = 0;
  revealed = false;
  loading = true;
  grading = false;
  error: string | null = null;
  nextDueLabel: string | null = null;

  private subs: Subscription[] = [];

  constructor(private knowledge: KnowledgeService) {}

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  get current(): Flashcard | null {
    return this.queue[0] ?? null;
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.subs.push(
      this.knowledge.flashcards(this.sourceId).subscribe({
        next: (deck) => {
          this.loading = false;
          this.total = deck.total;
          this.reviewCount = deck.reviewCount;
          this.reviewedThisSession = 0;
          this.revealed = false;
          this.queue = deck.cards.filter((c) => c.due);
          this.nextDueLabel = this.soonestDue(deck.cards);
        },
        error: (err) => {
          this.loading = false;
          this.error = err?.error?.error || 'Could not load your flashcards.';
        },
      })
    );
  }

  grade(grade: ReviewGrade): void {
    const card = this.current;
    if (!card || this.grading) return;

    this.grading = true;
    this.subs.push(
      this.knowledge.reviewCard(this.sourceId, card.id, grade).subscribe({
        next: (res) => {
          this.grading = false;
          this.revealed = false;
          this.reviewCount = res.reviewCount;
          this.reviewedThisSession += 1;

          // "Again" means it was not recalled, so it comes back this sitting
          // rather than disappearing until tomorrow.
          const rest = this.queue.slice(1);
          this.queue = res.card.due ? [...rest, res.card] : rest;
          if (!this.queue.length) this.nextDueLabel = this.relative(res.card.dueAt);
        },
        error: (err) => {
          this.grading = false;
          this.error = err?.error?.error || 'Could not save that review.';
        },
      })
    );
  }

  /** When the earliest not-yet-due card comes back. */
  private soonestDue(cards: Flashcard[]): string | null {
    const upcoming = cards.filter((c) => !c.due).map((c) => new Date(c.dueAt).getTime());
    return upcoming.length ? this.relative(new Date(Math.min(...upcoming)).toISOString()) : null;
  }

  private relative(iso: string): string {
    const days = Math.round((new Date(iso).getTime() - Date.now()) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days < 30) return `in ${days} days`;
    const months = Math.round(days / 30);
    return months === 1 ? 'in a month' : `in ${months} months`;
  }
}
