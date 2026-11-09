import { Component, EventEmitter, Inject, Input, OnChanges, OnInit, Output, PLATFORM_ID, SimpleChanges } from '@angular/core';
import { NgFor, NgIf, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { QuizQuestion, buildQuiz } from './quiz';

type Tab = 'facts' | 'quiz' | 'ideas';

interface Idea {
  id: string;
  text: string;
  at: number;
}

const IDEAS_KEY = 'ay-idea-board';
const MAX_IDEAS = 30;

/** Spin-off angles for the next video, built from the current topic. */
const SPIN_OFFS: ((topic: string) => string)[] = [
  (t) => `The biggest myths about ${t}`,
  (t) => `What changed this year in ${t}`,
  (t) => `5 beginner mistakes with ${t}`,
  (t) => `The future of ${t} in 60 seconds`,
  (t) => `${capitalize(t)} explained with one simple analogy`,
];

/**
 * "While you wait" — something to do during a long render:
 *  - Did you know: rotating facts from this run's own research
 *  - Quiz: true/false questions built from those facts
 *  - Ideas: a small board for next-video prompts, saved in this browser
 */
@Component({
  selector: 'app-waiting-room',
  standalone: true,
  imports: [NgFor, NgIf, FormsModule],
  template: `
    <div class="room">
      <header class="room-head">
        <span class="label"><span class="ay-live-dot ay-live-dot--pink" [class.ay-live-dot--idle]="!running"></span> While you wait</span>
      </header>

      <div class="tabs" role="tablist" aria-label="While you wait">
        <button
          *ngFor="let t of tabs; let i = index"
          type="button"
          role="tab"
          class="tab"
          [class.is-active]="tab === t.key"
          [attr.aria-selected]="tab === t.key"
          (click)="tab = t.key">
          {{ t.label }}<span class="tab-count" *ngIf="t.key === 'ideas' && ideas.length">{{ ideas.length }}</span>
        </button>
        <span class="tab-ink" [style.transform]="'translateX(' + tabIndex * 100 + '%)'" aria-hidden="true"></span>
      </div>

      <!-- Did you know -->
      <section *ngIf="tab === 'facts'" class="panel" role="tabpanel">
        <ng-container *ngIf="facts.length; else noFacts">
          <span class="eyebrow">Did you know · {{ factIndex + 1 }}/{{ facts.length }}</span>
          <ng-container *ngFor="let fact of [facts[factIndex]]; trackBy: trackFact">
            <p class="fact" (mouseenter)="factsPaused = true" (mouseleave)="factsPaused = false">{{ fact }}</p>
            <div class="fact-timer" [class.is-paused]="factsPaused" aria-hidden="true">
              <i (animationend)="nextFact()"></i>
            </div>
          </ng-container>
          <div class="row">
            <span class="hint">From your agents' research on this topic</span>
            <div class="nav">
              <button type="button" class="round" (click)="prevFact()" aria-label="Previous fact">‹</button>
              <button type="button" class="round" (click)="nextFact()" aria-label="Next fact">›</button>
            </div>
          </div>
        </ng-container>
        <ng-template #noFacts>
          <div class="placeholder">
            <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
            <p>{{ running ? 'Your agents are researching your topic — facts appear here in a moment.' : 'Facts about your topic appear here once a run finishes its research.' }}</p>
          </div>
        </ng-template>
      </section>

      <!-- Quiz -->
      <section *ngIf="tab === 'quiz'" class="panel" role="tabpanel">
        <ng-container *ngIf="quiz.length; else noQuiz">
          <ng-container *ngIf="quizStep < quiz.length; else quizDone">
            <span class="eyebrow">True or false · {{ quizStep + 1 }}/{{ quiz.length }} · score {{ quizScore }}</span>
            <p class="statement">{{ quiz[quizStep].statement }}</p>

            <div class="answers" *ngIf="quizAnswer === null">
              <button type="button" class="answer" (click)="answer(true)">True</button>
              <button type="button" class="answer" (click)="answer(false)">False</button>
            </div>

            <div class="verdict" *ngIf="quizAnswer !== null" [class.is-right]="quizAnswer === quiz[quizStep].answer">
              <strong>{{ quizAnswer === quiz[quizStep].answer ? 'Correct!' : 'Not quite.' }}</strong>
              <span *ngIf="!quiz[quizStep].answer">The research actually says: {{ quiz[quizStep].fact }}</span>
              <span *ngIf="quiz[quizStep].answer">That one is straight from the research.</span>
              <button type="button" class="ay-btn ay-btn-outline ay-btn-sm" (click)="nextQuestion()">
                {{ quizStep + 1 < quiz.length ? 'Next question' : 'See my score' }}
              </button>
            </div>
          </ng-container>

          <ng-template #quizDone>
            <div class="score">
              <span class="score-value">{{ quizScore }}/{{ quiz.length }}</span>
              <p>{{ scoreMessage }}</p>
              <button type="button" class="ay-btn ay-btn-primary ay-btn-sm" (click)="restartQuiz()">Play again</button>
            </div>
          </ng-template>
        </ng-container>

        <ng-template #noQuiz>
          <div class="placeholder">
            <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
            <p *ngIf="!facts.length">{{ running ? 'The quiz unlocks as soon as your agents finish researching.' : 'Start a run to unlock a quick quiz about your topic.' }}</p>
            <p *ngIf="facts.length">This topic's research doesn't have enough numbers for a quiz — the Did you know tab has every fact.</p>
          </div>
        </ng-template>
      </section>

      <!-- Ideas -->
      <section *ngIf="tab === 'ideas'" class="panel" role="tabpanel">
        <form class="idea-form" (ngSubmit)="addDraft()">
          <input
            name="idea"
            [(ngModel)]="draft"
            maxlength="500"
            autocomplete="off"
            placeholder="Jot down your next video idea"
            aria-label="New video idea" />
          <button type="submit" class="ay-btn ay-btn-primary ay-btn-sm" [disabled]="!draft.trim()">Save</button>
        </form>

        <div class="suggest" *ngIf="suggestions.length">
          <span class="eyebrow">Spin-offs of this topic</span>
          <div class="chips">
            <button *ngFor="let s of suggestions" type="button" class="chip" (click)="saveIdea(s)">+ {{ s }}</button>
          </div>
        </div>

        <ul class="ideas" *ngIf="ideas.length; else noIdeas">
          <li *ngFor="let idea of ideas; trackBy: trackIdea" class="idea">
            <span class="idea-text">{{ idea.text }}</span>
            <button type="button" class="use" (click)="useIdea.emit(idea.text)">Use</button>
            <button type="button" class="remove" (click)="removeIdea(idea.id)" aria-label="Delete idea">✕</button>
          </li>
        </ul>
        <ng-template #noIdeas>
          <p class="muted">Ideas you save stay in this browser, ready for your next run.</p>
        </ng-template>
      </section>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .room { display: flex; flex-direction: column; gap: 14px; }
      .label {
        display: flex;
        align-items: center;
        gap: 0.55rem;
        font-size: 11.5px;
        font-weight: 500;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--ay-text-2);
      }

      .tabs {
        position: relative;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        padding: 3px;
        border-radius: 999px;
        border: 1px solid var(--ay-line);
        background: var(--ay-bg);
      }
      .tab {
        position: relative;
        z-index: 1;
        padding: 8px 6px;
        border: 0;
        background: none;
        color: var(--ay-text-3);
        font: 500 13px var(--ay-font);
        cursor: pointer;
        transition: color 0.35s var(--ay-ease);
      }
      .tab.is-active { color: var(--ay-bg); }
      .tab:focus-visible { outline: 2px solid var(--ay-yellow); outline-offset: 1px; border-radius: 999px; }
      .tab-count {
        margin-left: 6px;
        padding: 0 6px;
        border-radius: 999px;
        background: var(--ay-yellow);
        color: #050505;
        font-size: 10.5px;
        font-weight: 700;
      }
      .tab-ink {
        position: absolute;
        top: 3px;
        bottom: 3px;
        left: 3px;
        width: calc((100% - 6px) / 3);
        border-radius: 999px;
        background: var(--ay-ink);
        transition: transform 0.5s var(--ay-ease);
      }

      .panel { min-height: 220px; animation: panel-in 0.5s var(--ay-ease) both; }
      @keyframes panel-in { from { opacity: 0; transform: translateY(8px); } }
      .eyebrow {
        display: block;
        margin-bottom: 10px;
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ay-text-3);
      }

      /* Facts */
      .fact {
        margin: 0;
        min-height: 110px;
        font-size: 17px;
        line-height: 1.55;
        color: var(--ay-ink);
        animation: fact-in 0.7s var(--ay-ease) both;
      }
      @keyframes fact-in { from { opacity: 0; transform: translateY(10px); filter: blur(6px); } }
      .fact-timer { height: 2px; margin: 14px 0 10px; border-radius: 2px; background: rgba(var(--ay-ink-rgb), 0.08); overflow: hidden; }
      .fact-timer i {
        display: block;
        height: 100%;
        background: var(--ay-energy);
        transform-origin: left center;
        animation: fact-timer 9s linear both;
      }
      .fact-timer.is-paused i { animation-play-state: paused; }
      @keyframes fact-timer { from { transform: scaleX(0); } to { transform: scaleX(1); } }
      .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .hint { font-size: 12px; color: var(--ay-text-3); }
      .nav { display: flex; gap: 6px; }
      .round {
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        padding: 0;
        border-radius: 50%;
        border: 1px solid var(--ay-line-strong);
        background: transparent;
        color: var(--ay-ink);
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
        transition: border-color 0.3s, background-color 0.3s;
      }
      .round:hover { border-color: rgba(var(--ay-ink-rgb), 0.4); background: rgba(var(--ay-ink-rgb), 0.05); }

      /* Placeholder */
      .placeholder { display: grid; place-items: center; gap: 14px; min-height: 200px; text-align: center; }
      .placeholder p { margin: 0; max-width: 300px; font-size: 13.5px; line-height: 1.6; color: var(--ay-text-3); }
      .dots { display: flex; gap: 6px; }
      .dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--ay-text-3); animation: dot 1.2s ease-in-out infinite; }
      .dots i:nth-child(2) { background: var(--ay-yellow); animation-delay: 0.15s; }
      .dots i:nth-child(3) { background: var(--ay-pink); animation-delay: 0.3s; }
      @keyframes dot { 0%, 100% { transform: translateY(0); opacity: 0.5; } 50% { transform: translateY(-6px); opacity: 1; } }

      /* Quiz */
      .statement { margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: var(--ay-ink); animation: fact-in 0.6s var(--ay-ease) both; }
      .answers { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .answer {
        padding: 12px;
        border-radius: 12px;
        border: 1px solid var(--ay-line-strong);
        background: var(--ay-bg);
        color: var(--ay-ink);
        font: 600 14px var(--ay-font);
        cursor: pointer;
        transition: border-color 0.3s var(--ay-ease), transform 0.3s var(--ay-ease), background-color 0.3s;
      }
      .answer:hover { border-color: var(--ay-yellow-edge); background: var(--ay-yellow-soft); transform: translateY(-2px); }
      .verdict {
        display: grid;
        gap: 8px;
        padding: 12px 14px;
        border-radius: 12px;
        border: 1px solid rgba(var(--ay-danger-rgb), 0.35);
        background: rgba(var(--ay-danger-rgb), 0.05);
        color: var(--ay-text-2);
        font-size: 13.5px;
        line-height: 1.55;
        animation: fact-in 0.5s var(--ay-ease) both;
      }
      .verdict strong { color: var(--ay-danger); font-size: 15px; }
      .verdict.is-right { border-color: var(--ay-yellow-edge); background: var(--ay-yellow-soft); }
      .verdict.is-right strong { color: var(--ay-ink); }
      .verdict .ay-btn { justify-self: start; }
      .score { display: grid; place-items: center; gap: 8px; min-height: 200px; text-align: center; }
      .score-value { font-size: 44px; font-weight: 300; color: var(--ay-ink); font-variant-numeric: tabular-nums; animation: fact-in 0.7s var(--ay-ease) both; }
      .score p { margin: 0 0 6px; color: var(--ay-text-2); font-size: 14px; }

      /* Ideas */
      .idea-form { display: flex; gap: 8px; }
      .idea-form input {
        flex: 1;
        min-width: 0;
        height: 34px;
        box-sizing: border-box;
        padding: 0 12px;
        border-radius: 999px;
        border: 1px solid var(--ay-line-strong);
        background: var(--ay-bg);
        color: var(--ay-ink);
        font: 400 13.5px var(--ay-font);
        transition: border-color 0.3s, box-shadow 0.3s;
      }
      .idea-form input:focus { outline: none; border-color: var(--ay-yellow-edge); box-shadow: 0 0 0 3px rgba(var(--ay-yellow-rgb), 0.12); }
      .suggest { margin-top: 14px; }
      .chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .chip {
        padding: 5px 10px;
        border-radius: 999px;
        border: 1px dashed var(--ay-line-strong);
        background: none;
        color: var(--ay-text-2);
        font: 500 12px var(--ay-font);
        text-align: left;
        cursor: pointer;
        transition: border-color 0.3s, color 0.3s;
      }
      .chip:hover { border-color: var(--ay-pink-edge); color: var(--ay-ink); }
      .ideas { list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 6px; max-height: 240px; overflow-y: auto; }
      .idea {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px solid var(--ay-line);
        background: var(--ay-bg);
        animation: fact-in 0.4s var(--ay-ease) both;
      }
      .idea-text { flex: 1; min-width: 0; font-size: 13.5px; color: var(--ay-ink); overflow-wrap: anywhere; }
      .use, .remove { flex: none; padding: 4px 8px; border: 0; border-radius: 6px; background: none; font: 600 12px var(--ay-font); cursor: pointer; }
      .use { color: var(--ay-ink); background: rgba(var(--ay-ink-rgb), 0.06); }
      .use:hover { background: var(--ay-yellow); color: #050505; }
      .remove { color: var(--ay-text-3); }
      .remove:hover { color: var(--ay-danger); }
      .muted { margin: 14px 0 0; font-size: 13px; color: var(--ay-text-3); }

      @media (prefers-reduced-motion: reduce) {
        .panel, .fact, .statement, .verdict, .score-value, .idea, .dots i { animation: none; }
        .fact-timer { display: none; }
        .tab-ink { transition: none; }
      }
    `,
  ],
})
export class WaitingRoomComponent implements OnInit, OnChanges {
  /** This run's research facts. */
  @Input() facts: string[] = [];
  /** The current prompt, used for spin-off suggestions. */
  @Input() topic = '';
  @Input() running = false;
  /** Put a saved idea into the prompt box. */
  @Output() useIdea = new EventEmitter<string>();

  readonly tabs: { key: Tab; label: string }[] = [
    { key: 'facts', label: 'Did you know' },
    { key: 'quiz', label: 'Quiz' },
    { key: 'ideas', label: 'Ideas' },
  ];
  tab: Tab = 'facts';

  factIndex = 0;
  factsPaused = false;

  quiz: QuizQuestion[] = [];
  quizStep = 0;
  quizScore = 0;
  quizAnswer: boolean | null = null;

  ideas: Idea[] = [];
  draft = '';
  suggestions: string[] = [];

  private readonly isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  get tabIndex(): number {
    return this.tabs.findIndex((t) => t.key === this.tab);
  }

  ngOnInit(): void {
    this.ideas = this.loadIdeas();
    this.refreshSuggestions();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['facts']) {
      if (this.factIndex >= this.facts.length) this.factIndex = 0;
      // Rebuild the quiz for new research, but never mid-game.
      const midGame = this.quizStep > 0 || this.quizAnswer !== null;
      if (!midGame || !this.facts.length) this.restartQuiz();
    }
    if (changes['topic']) this.refreshSuggestions();
  }

  // ---- facts ----

  trackFact = (): number => this.factIndex;

  nextFact(): void {
    if (this.facts.length) this.factIndex = (this.factIndex + 1) % this.facts.length;
  }

  prevFact(): void {
    if (this.facts.length) this.factIndex = (this.factIndex - 1 + this.facts.length) % this.facts.length;
  }

  // ---- quiz ----

  answer(value: boolean): void {
    if (this.quizAnswer !== null) return;
    this.quizAnswer = value;
    if (value === this.quiz[this.quizStep]?.answer) this.quizScore++;
  }

  nextQuestion(): void {
    this.quizStep++;
    this.quizAnswer = null;
  }

  restartQuiz(): void {
    this.quiz = buildQuiz(this.facts);
    this.quizStep = 0;
    this.quizScore = 0;
    this.quizAnswer = null;
  }

  get scoreMessage(): string {
    const ratio = this.quiz.length ? this.quizScore / this.quiz.length : 0;
    if (ratio === 1) return 'Perfect score — you could narrate this one yourself.';
    if (ratio >= 0.6) return 'Nicely done. Your video will fill in the rest.';
    return 'Tricky topic! Your finished video will make it stick.';
  }

  // ---- ideas ----

  trackIdea = (_: number, idea: Idea): string => idea.id;

  addDraft(): void {
    if (this.saveIdea(this.draft)) this.draft = '';
  }

  saveIdea(text: string): boolean {
    const value = text.trim().replace(/\s+/g, ' ').slice(0, 500);
    if (!value) return false;
    if (this.ideas.some((i) => i.text.toLowerCase() === value.toLowerCase())) return true;
    const idea: Idea = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text: value, at: Date.now() };
    this.ideas = [idea, ...this.ideas].slice(0, MAX_IDEAS);
    this.persistIdeas();
    this.refreshSuggestions();
    return true;
  }

  removeIdea(id: string): void {
    this.ideas = this.ideas.filter((i) => i.id !== id);
    this.persistIdeas();
    this.refreshSuggestions();
  }

  private refreshSuggestions(): void {
    const topic = this.topic.trim().replace(/[.?!]+$/, '');
    if (!topic || topic.length > 70) {
      this.suggestions = [];
      return;
    }
    const lowered = topic.charAt(0).toLowerCase() + topic.slice(1);
    const saved = new Set(this.ideas.map((i) => i.text.toLowerCase()));
    this.suggestions = SPIN_OFFS.map((make) => make(lowered)).filter((s) => !saved.has(s.toLowerCase())).slice(0, 4);
  }

  private loadIdeas(): Idea[] {
    if (!this.isBrowser) return [];
    try {
      const parsed = JSON.parse(localStorage.getItem(IDEAS_KEY) || '[]');
      return Array.isArray(parsed)
        ? parsed.filter((i) => i && typeof i.text === 'string' && typeof i.id === 'string').slice(0, MAX_IDEAS)
        : [];
    } catch {
      return [];
    }
  }

  private persistIdeas(): void {
    if (!this.isBrowser) return;
    try {
      localStorage.setItem(IDEAS_KEY, JSON.stringify(this.ideas));
    } catch {
      // storage unavailable — ideas last for this visit only
    }
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
