// src/app/services/knowledge.service.ts
//
// The Knowledge Hub's line to the server. Everything goes through Express at
// /api/knowledge — never directly to the notes service, which has no auth of
// its own and no idea who a user is.

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

/** One ingested source in the user's library. */
export interface KnowledgeSource {
  _id: string;
  externalId: string;
  kind: 'youtube';
  sourceUrl: string;
  title: string;
  status: 'processing' | 'completed' | 'failed';
  createdAt: string;
}

/** An event on the fused speech+visual timeline. */
export interface TimelineEvent {
  type: 'speech' | 'visual';
  time_sec: number;
  time_str: string;
  text?: string;
  ocr_text?: string;
  image_path?: string;
}

export interface KnowledgeNotes {
  markdown_content: string;
  fused_timeline_json: TimelineEvent[];
}

export interface QuizQuestion {
  question: string;
  options: string[];
  answer: string;
  explanation: string;
}

/** Live pipeline progress, as reported by the notes service's SSE stream. */
export interface KnowledgeProgress {
  status: string;
  current_step: number;
  step_name: string;
  step_message: string;
  step_progress: number;
  stats: Record<string, unknown>;
  logs: string[];
}

/** How the four grading buttons are labelled — each shows its real next interval. */
export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  hint: string;
  dueAt: string;
  repetitions: number;
  lapses: number;
  /** Due for review now. */
  due: boolean;
  /** What each button would schedule, e.g. { good: 'tomorrow' }. */
  intervals: Record<ReviewGrade, string>;
}

export interface FlashcardDeck {
  ok: boolean;
  deckId: string;
  total: number;
  dueCount: number;
  reviewCount: number;
  lastReviewedAt: string | null;
  cards: Flashcard[];
}

export interface ReviewResult {
  ok: boolean;
  card: Flashcard;
  dueCount: number;
  reviewCount: number;
}

/** State of a podcast render for one source. */
export interface PodcastState {
  ok?: boolean;
  status: 'idle' | 'rendering' | 'ready' | 'failed';
  progress: number;
  /** Relative /uploads URL once ready. */
  url: string | null;
  error: string | null;
}

/** A moment in the video an answer was drawn from. */
export interface ChatCitation {
  time_sec: number;
  time_str: string;
  quote: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: ChatCitation[];
}

export interface ChatAnswer {
  ok: boolean;
  answer: string;
  citations: ChatCitation[];
  /** False when the model was unreachable — the answer is then an apology. */
  grounded: boolean;
}

export interface KnowledgeDetail {
  ok: boolean;
  source: KnowledgeSource;
  status: {
    video_id: string;
    title: string;
    status: string;
    youtube_url?: string;
    current_step: number;
    step_message: string;
    step_progress: number;
    stats: Record<string, unknown>;
  };
  notes: KnowledgeNotes | null;
  quiz: QuizQuestion[] | null;
}

@Injectable({ providedIn: 'root' })
export class KnowledgeService {
  private readonly base = `${environment.apiBase}/knowledge`;

  constructor(private http: HttpClient, private auth: AuthService) {}

  /** Everything this user has ingested, newest first. */
  list(): Observable<{ ok: boolean; sources: KnowledgeSource[] }> {
    return this.http.get<{ ok: boolean; sources: KnowledgeSource[] }>(this.base);
  }

  /** Start ingesting a YouTube URL. */
  add(url: string): Observable<{ ok: boolean; source: KnowledgeSource }> {
    return this.http.post<{ ok: boolean; source: KnowledgeSource }>(this.base, { url });
  }

  detail(id: string): Observable<KnowledgeDetail> {
    return this.http.get<KnowledgeDetail>(`${this.base}/${id}`);
  }

  /**
   * Ask a question about one source. Only prior turns are sent as history —
   * the server re-checks ownership and forwards a fixed shape, so the page
   * cannot inject extra fields into the model prompt.
   */
  ask(id: string, question: string, history: ChatMessage[]): Observable<ChatAnswer> {
    const trimmed = history.map((m) => ({ role: m.role, content: m.content }));
    return this.http.post<ChatAnswer>(`${this.base}/${id}/chat`, { question, history: trimmed });
  }

  /** Resume a failed job from its last checkpoint. */
  retry(id: string): Observable<{ ok: boolean; message?: string }> {
    return this.http.post<{ ok: boolean; message?: string }>(`${this.base}/${id}/retry`, {});
  }

  /** The deck for this source. Generated server-side on first request. */
  flashcards(id: string): Observable<FlashcardDeck> {
    return this.http.get<FlashcardDeck>(`${this.base}/${id}/flashcards`);
  }

  /** Grade one card; the server reschedules it and returns its new state. */
  reviewCard(id: string, cardId: string, grade: ReviewGrade): Observable<ReviewResult> {
    return this.http.post<ReviewResult>(`${this.base}/${id}/flashcards/review`, { cardId, grade });
  }

  /** Start rendering the two-host podcast. Returns the initial state. */
  startPodcast(id: string): Observable<PodcastState> {
    return this.http.post<PodcastState>(`${this.base}/${id}/podcast`, {});
  }

  /** Poll how far the render has got, or fetch the finished episode. */
  podcastStatus(id: string): Observable<PodcastState> {
    return this.http.get<PodcastState>(`${this.base}/${id}/podcast`);
  }

  /**
   * Fetch one extracted keyframe as an object URL.
   *
   * The keyframe route is JWT-guarded and an <img src> cannot carry an
   * Authorization header, so the bytes are fetched here and wrapped in a blob
   * URL. Callers own the result and must revokeObjectURL it when done.
   * Returns null rather than throwing — a missing frame is cosmetic.
   */
  async loadKeyframe(id: string, framePath: string): Promise<string | null> {
    const token = this.auth.getToken();
    try {
      const res = await fetch(`${this.base}/${id}/keyframe?path=${encodeURIComponent(framePath)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return null;
      return URL.createObjectURL(await res.blob());
    } catch {
      return null;
    }
  }

  /**
   * Live progress for one job.
   *
   * Deliberately not EventSource: that API cannot send an Authorization header,
   * and this stream is JWT-guarded. The alternative — putting the token in the
   * query string — leaks it into server logs and browser history. fetch() with a
   * ReadableStream does support headers, so it is used instead and the SSE
   * framing ("data: {...}\n\n") is parsed here.
   *
   * Unsubscribing aborts the request, which tears down the proxy's upstream
   * connection to the notes service too.
   */
  streamProgress(id: string): Observable<KnowledgeProgress> {
    return new Observable<KnowledgeProgress>((subscriber) => {
      const controller = new AbortController();
      const token = this.auth.getToken();

      (async () => {
        try {
          const res = await fetch(`${this.base}/${id}/progress`, {
            headers: {
              Accept: 'text/event-stream',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            signal: controller.signal,
          });

          if (!res.ok || !res.body) {
            subscriber.error(new Error(`Progress stream unavailable (${res.status})`));
            return;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // SSE events are separated by a blank line; keep any partial tail.
            const chunks = buffer.split(/\r?\n\r?\n/);
            buffer = chunks.pop() ?? '';

            for (const chunk of chunks) {
              for (const line of chunk.split(/\r?\n/)) {
                // ": heartbeat" comments keep the connection alive — ignore them.
                if (!line.startsWith('data:')) continue;
                const payload = line.slice(5).trim();
                if (!payload) continue;
                try {
                  subscriber.next(JSON.parse(payload) as KnowledgeProgress);
                } catch {
                  // a malformed frame must not kill the stream
                }
              }
            }
          }
          subscriber.complete();
        } catch (err) {
          // An abort is how unsubscribing works, not a failure.
          if (!controller.signal.aborted) subscriber.error(err);
        }
      })();

      return () => controller.abort();
    });
  }
}
