import { AfterViewChecked, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatMessage, KnowledgeService } from '../../services/knowledge.service';

/** Openers, so the panel is never a blank box with a cursor in it. */
const STARTERS = [
  'Summarise the main argument',
  'What are the key terms I should know?',
  'Explain the hardest part simply',
];

/**
 * Ask questions about one source, answered strictly from its own notes and
 * transcript.
 *
 * Answers arrive with [t=SECONDS] markers inline. Those are stripped from the
 * displayed text and rendered as citation buttons instead — clicking one seeks
 * the video to the moment the claim came from, which is what makes the
 * grounding checkable rather than merely claimed.
 */
@Component({
  selector: 'app-knowledge-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="chat">
      <div class="log" #log>
        <!-- Empty state doubles as the prompt to start -->
        <div class="intro" *ngIf="!messages.length">
          <h3>Ask about this video</h3>
          <p>Answers come only from this source. If it isn't covered, you'll be told so.</p>
          <div class="starters">
            <button type="button" *ngFor="let s of starters" (click)="send(s)">{{ s }}</button>
          </div>
        </div>

        <div class="msg" *ngFor="let m of messages" [attr.data-role]="m.role">
          <p class="bubble">{{ display(m) }}</p>
          <div class="cites" *ngIf="m.citations?.length">
            <button
              type="button"
              class="cite"
              *ngFor="let c of m.citations"
              [title]="c.quote"
              (click)="seek.emit(c.time_sec)">
              ▶ {{ c.time_str }}
            </button>
          </div>
        </div>

        <p class="thinking" *ngIf="sending"><span class="ay-live-dot"></span> Reading the transcript…</p>
        <p class="err" *ngIf="error">{{ error }}</p>
      </div>

      <form class="composer" (ngSubmit)="send()">
        <input
          type="text"
          [(ngModel)]="draft"
          name="q"
          [disabled]="sending"
          placeholder="Ask a question…"
          aria-label="Ask a question about this video"
          autocomplete="off" />
        <button type="submit" [disabled]="sending || !draft.trim()">Ask</button>
      </form>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .chat { display: flex; flex-direction: column; gap: 12px; min-height: 48vh; }

      .log { flex: 1; display: flex; flex-direction: column; gap: 14px; max-height: 58vh; overflow-y: auto; padding-right: 4px; }

      .intro { padding: 26px 18px; border: 1px dashed var(--ay-line-strong); border-radius: 14px; text-align: center; }
      .intro h3 { margin: 0 0 6px; font-size: 15px; font-weight: 650; color: var(--ay-ink); }
      .intro p { margin: 0 0 16px; font-size: 13px; color: var(--ay-text-3); line-height: 1.6; }
      .starters { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
      .starters button {
        padding: 6px 13px; border-radius: 999px;
        border: 1px solid var(--ay-line); background: none;
        color: var(--ay-text-2); font: inherit; font-size: 12px; cursor: pointer;
      }
      .starters button:hover { border-color: var(--ay-yellow-edge); color: var(--ay-ink); }

      .msg { display: flex; flex-direction: column; gap: 6px; }
      .msg[data-role='user'] { align-items: flex-end; }
      .bubble {
        margin: 0; max-width: 85%;
        padding: 10px 13px; border-radius: 13px;
        font-size: 13.5px; line-height: 1.65;
        white-space: pre-line;
      }
      .msg[data-role='user'] .bubble {
        background: var(--ay-yellow-soft); border: 1px solid var(--ay-yellow-edge); color: var(--ay-ink);
      }
      .msg[data-role='assistant'] .bubble {
        background: var(--ay-surface); border: 1px solid var(--ay-line); color: var(--ay-text-2);
      }

      .cites { display: flex; flex-wrap: wrap; gap: 5px; }
      .cite {
        padding: 3px 9px; border-radius: 999px;
        border: 1px solid var(--ay-pink-edge); background: var(--ay-pink-soft);
        color: var(--ay-pink-bright); font: 600 11px/1 var(--ay-mono); cursor: pointer;
      }
      .cite:hover { border-color: var(--ay-pink-bright); color: var(--ay-ink); }

      .thinking { display: flex; align-items: center; gap: 9px; margin: 0; font-size: 13px; color: var(--ay-text-3); }
      .err { margin: 0; font-size: 13px; color: var(--ay-danger); }

      .composer { display: flex; gap: 8px; }
      .composer input {
        flex: 1; min-width: 0; padding: 11px 14px;
        border-radius: 11px; border: 1px solid var(--ay-line);
        background: var(--ay-surface); color: var(--ay-ink); font: inherit; font-size: 13.5px;
      }
      .composer input:focus { outline: none; border-color: var(--ay-yellow); }
      .composer button {
        padding: 11px 22px; border-radius: 11px;
        border: 1px solid var(--ay-yellow-edge); background: var(--ay-yellow-soft);
        color: var(--ay-ink); font: inherit; font-weight: 600; font-size: 13.5px; cursor: pointer;
      }
      .composer button:disabled { opacity: 0.5; cursor: not-allowed; }
    `,
  ],
})
export class KnowledgeChatComponent implements AfterViewChecked {
  @Input({ required: true }) sourceId!: string;
  /** Seconds to seek the player to, from a citation. */
  @Output() seek = new EventEmitter<number>();

  @ViewChild('log') logRef?: ElementRef<HTMLDivElement>;

  readonly starters = STARTERS;

  messages: ChatMessage[] = [];
  draft = '';
  sending = false;
  error: string | null = null;

  private shouldScroll = false;

  constructor(private knowledge: KnowledgeService) {}

  ngAfterViewChecked(): void {
    if (!this.shouldScroll) return;
    this.shouldScroll = false;
    const el = this.logRef?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }

  /**
   * Citation markers are shown as buttons, so strip them from the prose.
   * Matches the whole bracket rather than a single number: models merge
   * citations into one bracket ("[t=0, t=11]"), and a stricter pattern would
   * leave that raw marker visible in the answer.
   */
  display(m: ChatMessage): string {
    return m.role === 'assistant' ? m.content.replace(/\s*\[t=[^\]]{0,80}\]/g, '').trim() : m.content;
  }

  send(preset?: string): void {
    const question = (preset ?? this.draft).trim();
    if (!question || this.sending) return;

    this.error = null;
    this.draft = '';
    // History is what came before this question, not including it.
    const history = [...this.messages];
    this.messages = [...this.messages, { role: 'user', content: question }];
    this.sending = true;
    this.shouldScroll = true;

    this.knowledge.ask(this.sourceId, question, history).subscribe({
      next: (res) => {
        this.sending = false;
        this.shouldScroll = true;
        this.messages = [
          ...this.messages,
          { role: 'assistant', content: res.answer, citations: res.citations || [] },
        ];
      },
      error: (err) => {
        this.sending = false;
        this.error = err?.error?.error || 'Could not answer that. Try again in a moment.';
      },
    });
  }
}
