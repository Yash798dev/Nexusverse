import { Component, Input, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { QuizQuestion } from '../../services/knowledge.service';

type Phase = 'intro' | 'playing' | 'answered' | 'finished';

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];
const SECONDS_PER_QUESTION = 12;
/** Sentinel submitted when the clock runs out; never equals a real option. */
const TIMED_OUT = '__timed_out__';

/**
 * The generated quiz, as a timed game: speed bonus, combo streaks, a grade at
 * the end. Ported from the NexusNotes quiz panel, recoloured onto this
 * platform's tokens.
 */
@Component({
  selector: 'app-knowledge-quiz',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- Intro -->
    <div class="intro" *ngIf="phase === 'intro'">
      <h2>Knowledge check</h2>
      <p class="sub">{{ questions.length }} questions · {{ seconds }}s each · streak bonuses</p>
      <div class="facts">
        <div><b>Speed</b><span>Answer fast for bonus points</span></div>
        <div><b>Combo</b><span>Consecutive answers score higher</span></div>
        <div><b>Grade</b><span>S / A / B / C / D</span></div>
      </div>
      <button type="button" class="primary" (click)="start()">Start</button>
    </div>

    <!-- Finished -->
    <div class="done" *ngIf="phase === 'finished'">
      <p class="kicker">Complete</p>
      <h2 class="grade" [attr.data-grade]="grade.label">Grade {{ grade.label }}</h2>
      <p class="sub">{{ grade.message }}</p>

      <div class="stats">
        <div><b>{{ score | number }}</b><span>Score</span></div>
        <div><b>{{ correct }}/{{ questions.length }}</b><span>Correct</span></div>
        <div><b>{{ accuracy }}%</b><span>Accuracy</span></div>
      </div>

      <ul class="recap">
        <li *ngFor="let q of questions; let i = index">
          <span class="n">{{ i + 1 }}</span>
          <span class="q">{{ q.question }}</span>
          <span class="r" [class.ok]="results[i]">{{ results[i] ? '✓' : '✕' }}</span>
        </li>
      </ul>

      <button type="button" class="ghost" (click)="restart()">Try again</button>
    </div>

    <!-- Playing -->
    <div class="play" *ngIf="phase === 'playing' || phase === 'answered'">
      <div class="hud">
        <div><span class="lbl">Score</span><b>{{ score | number }}</b></div>
        <div class="mid">
          <span class="lbl">Q {{ index + 1 }} / {{ questions.length }}</span>
          <span class="pips">
            <i *ngFor="let q of questions; let i = index"
               [class.done]="i < index" [class.now]="i === index"></i>
          </span>
        </div>
        <div class="right"><span class="lbl">Combo</span><b [class.hot]="combo > 1">{{ combo > 1 ? '×' + combo : '–' }}</b></div>
      </div>

      <div class="timer"><div class="fill" [style.width.%]="timePercent" [attr.data-low]="timeLeft <= 4"></div></div>

      <div class="question">
        <p class="kicker">Question {{ index + 1 }}</p>
        <p class="text">{{ current.question }}</p>
      </div>

      <div class="options">
        <button
          type="button"
          *ngFor="let opt of current.options; let i = index"
          [attr.data-state]="optionState(opt)"
          [disabled]="phase === 'answered'"
          (click)="answer(opt)">
          <span class="letter">{{ letterFor(opt, i) }}</span>
          <span class="opt">{{ opt }}</span>
        </button>
      </div>

      <div class="explain" *ngIf="phase === 'answered' && current.explanation">
        <p class="kicker">Explanation</p>
        <p>{{ current.explanation }}</p>
      </div>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      h2 { font-size: 20px; font-weight: 700; color: var(--ay-ink); margin: 0 0 6px; }
      .kicker { font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ay-yellow); margin-bottom: 6px; }
      .sub { color: var(--ay-text-3); font-size: 13px; }
      .lbl { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ay-text-3); }

      .intro, .done { text-align: center; padding: 26px 8px; }
      .facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; max-width: 400px; margin: 22px auto; }
      .facts div { padding: 12px 8px; border-radius: 12px; border: 1px solid var(--ay-line); }
      .facts b { display: block; font-size: 12.5px; color: var(--ay-ink); margin-bottom: 3px; }
      .facts span { font-size: 10.5px; color: var(--ay-text-3); line-height: 1.4; }

      .primary {
        padding: 12px 34px; border-radius: 999px;
        border: 1px solid var(--ay-yellow-edge); background: var(--ay-yellow-soft);
        color: var(--ay-ink); font: inherit; font-weight: 650; font-size: 14px; cursor: pointer;
      }
      .primary:hover { border-color: var(--ay-yellow); }
      .ghost {
        padding: 10px 26px; border-radius: 999px; border: 1px solid var(--ay-line-strong);
        background: none; color: var(--ay-text-2); font: inherit; font-size: 13px; cursor: pointer;
      }
      .ghost:hover { color: var(--ay-ink); }

      .grade { font-size: 32px; font-weight: 800; }
      .grade[data-grade='S'], .grade[data-grade='A'] { color: var(--ay-yellow-bright); }
      .grade[data-grade='B'] { color: var(--ay-pink-bright); }
      .grade[data-grade='C'], .grade[data-grade='D'] { color: var(--ay-text-2); }

      .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; max-width: 400px; margin: 20px auto; }
      .stats div { padding: 14px 8px; border-radius: 13px; border: 1px solid var(--ay-line); }
      .stats b { display: block; font-size: 19px; font-weight: 700; color: var(--ay-ink); font-variant-numeric: tabular-nums; }
      .stats span { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ay-text-3); }

      .recap { list-style: none; margin: 0 auto 20px; padding: 0; max-width: 480px; text-align: left; display: grid; gap: 3px; }
      .recap li { display: flex; align-items: center; gap: 9px; padding: 6px 9px; border-radius: 8px; background: rgba(var(--ay-ink-rgb), 0.03); }
      .recap .n { font-size: 11px; color: var(--ay-text-3); flex: none; width: 16px; }
      .recap .q { flex: 1; font-size: 12px; color: var(--ay-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .recap .r { font-size: 12px; color: var(--ay-danger); flex: none; }
      .recap .r.ok { color: var(--ay-yellow-bright); }

      .play { display: flex; flex-direction: column; gap: 14px; }
      .hud { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px; }
      .hud b { display: block; font-size: 17px; font-weight: 700; color: var(--ay-ink); font-variant-numeric: tabular-nums; }
      .hud b.hot { color: var(--ay-yellow-bright); }
      .hud .mid { text-align: center; }
      .hud .right { text-align: right; }
      .pips { display: flex; gap: 3px; margin-top: 5px; justify-content: center; }
      .pips i { width: 15px; height: 3px; border-radius: 99px; background: rgba(var(--ay-ink-rgb), 0.12); }
      .pips i.done { background: var(--ay-text-2); }
      .pips i.now { background: var(--ay-yellow); }

      .timer { height: 4px; border-radius: 99px; background: rgba(var(--ay-ink-rgb), 0.1); overflow: hidden; }
      .timer .fill { height: 100%; background: var(--ay-yellow); transition: width 1s linear; }
      .timer .fill[data-low='true'] { background: var(--ay-danger); }

      .question { padding: 16px; border-radius: 13px; border: 1px solid var(--ay-line); background: var(--ay-surface); }
      .question .text { font-size: 15px; font-weight: 600; color: var(--ay-ink); line-height: 1.5; }

      .options { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .options button {
        display: flex; align-items: flex-start; gap: 10px; text-align: left;
        padding: 13px 14px; border-radius: 12px;
        border: 1px solid var(--ay-line); background: var(--ay-surface);
        color: var(--ay-text-2); font: inherit; font-size: 13.5px; cursor: pointer;
        transition: border-color 0.2s var(--ay-ease);
      }
      .options button:hover:not(:disabled) { border-color: var(--ay-line-strong); color: var(--ay-ink); }
      .options button:disabled { cursor: default; }
      .options button[data-state='right'] { border-color: var(--ay-yellow); background: var(--ay-yellow-soft); color: var(--ay-ink); }
      .options button[data-state='wrong'] { border-color: rgba(var(--ay-danger-rgb), 0.55); background: rgba(var(--ay-danger-rgb), 0.07); color: var(--ay-danger); }
      .letter {
        flex: none; width: 23px; height: 23px; border-radius: 6px;
        display: grid; place-items: center; font-size: 11.5px; font-weight: 700;
        background: rgba(var(--ay-ink-rgb), 0.07);
      }

      .explain { padding: 13px 15px; border-radius: 12px; border: 1px solid var(--ay-pink-edge); background: var(--ay-pink-soft); }
      .explain p:last-child { font-size: 13px; color: var(--ay-text-2); line-height: 1.55; }

      @media (max-width: 560px) { .options { grid-template-columns: 1fr; } }
      @media (prefers-reduced-motion: reduce) { .timer .fill { transition: none; } }
    `,
  ],
})
export class KnowledgeQuizComponent implements OnDestroy {
  @Input() questions: QuizQuestion[] = [];

  readonly seconds = SECONDS_PER_QUESTION;

  phase: Phase = 'intro';
  index = 0;
  selected: string | null = null;
  score = 0;
  combo = 0;
  correct = 0;
  results: boolean[] = [];
  timeLeft = SECONDS_PER_QUESTION;

  private ticker?: ReturnType<typeof setInterval>;
  private advanceTimer?: ReturnType<typeof setTimeout>;

  ngOnDestroy(): void {
    this.stopTimer();
    clearTimeout(this.advanceTimer);
  }

  get current(): QuizQuestion {
    return this.questions[this.index] ?? { question: '', options: [], answer: '', explanation: '' };
  }

  get accuracy(): number {
    return this.questions.length ? Math.round((this.correct / this.questions.length) * 100) : 0;
  }

  get timePercent(): number {
    return (this.timeLeft / SECONDS_PER_QUESTION) * 100;
  }

  get grade(): { label: string; message: string } {
    const p = this.accuracy;
    if (p >= 90) return { label: 'S', message: 'Near-perfect understanding.' };
    if (p >= 75) return { label: 'A', message: 'Excellent — you know this material.' };
    if (p >= 60) return { label: 'B', message: 'Solid grasp, with a few gaps.' };
    if (p >= 40) return { label: 'C', message: 'A decent start. Worth another read.' };
    return { label: 'D', message: 'Review the notes and try again.' };
  }

  start(): void {
    this.phase = 'playing';
    this.runTimer();
  }

  letterFor(opt: string, i: number): string {
    if (this.phase === 'answered') {
      if (opt.trim() === this.current.answer.trim()) return '✓';
      if (opt === this.selected) return '✕';
    }
    return OPTION_LETTERS[i] ?? String(i + 1);
  }

  optionState(opt: string): string {
    if (this.phase !== 'answered') return 'idle';
    if (opt.trim() === this.current.answer.trim()) return 'right';
    return opt === this.selected ? 'wrong' : 'idle';
  }

  answer(option: string): void {
    if (this.phase !== 'playing') return;
    this.stopTimer();
    this.selected = option;
    this.phase = 'answered';

    // Trimmed on both sides: the model's answer string often carries stray space.
    const isRight = option.trim() === this.current.answer.trim();
    this.results[this.index] = isRight;

    if (isRight) {
      const speedBonus = Math.ceil((this.timeLeft / SECONDS_PER_QUESTION) * 50);
      this.score += 100 + speedBonus + this.combo * 25;
      this.correct += 1;
      this.combo += 1;
    } else {
      this.combo = 0;
    }

    // Hold on the revealed answer before moving on.
    this.advanceTimer = setTimeout(() => this.next(), 1800);
  }

  restart(): void {
    this.stopTimer();
    clearTimeout(this.advanceTimer);
    this.phase = 'intro';
    this.index = 0;
    this.selected = null;
    this.score = 0;
    this.combo = 0;
    this.correct = 0;
    this.results = [];
    this.timeLeft = SECONDS_PER_QUESTION;
  }

  private next(): void {
    if (this.index + 1 < this.questions.length) {
      this.index += 1;
      this.selected = null;
      this.timeLeft = SECONDS_PER_QUESTION;
      this.phase = 'playing';
      this.runTimer();
    } else {
      this.phase = 'finished';
    }
  }

  private runTimer(): void {
    this.stopTimer();
    this.ticker = setInterval(() => {
      if (this.timeLeft <= 1) {
        this.timeLeft = 0;
        this.answer(TIMED_OUT); // counts as wrong, never matches an option
        return;
      }
      this.timeLeft -= 1;
    }, 1000);
  }

  private stopTimer(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = undefined;
  }
}
