import { Component, Input, OnChanges } from '@angular/core';
import { NgFor, NgIf, SlicePipe } from '@angular/common';
import {
  AudioArtifact,
  CriticArtifact,
  ImageArtifact,
  MetadataArtifact,
  QaArtifact,
  ResearchArtifact,
  ScenesArtifact,
  ScriptArtifact,
  StudioArtifact,
  VideoArtifact,
} from '../../services/workflow-artifacts';

interface FeedStep {
  no: string;
  title: string;
  waiting: string;
}

interface SourceLink {
  label: string;
  href: string | null;
}

interface QaRow {
  label: string;
  ok: boolean | null;
  value: string;
}

const STEPS: Record<'research' | 'script' | 'scenes' | 'visuals' | 'voice' | 'video' | 'qa' | 'metadata', FeedStep> = {
  research: { no: '01', title: 'Research', waiting: 'Researching your topic across live sources…' },
  script: { no: '02', title: 'Script', waiting: 'Writing the narration and having the critic review it…' },
  scenes: { no: '03', title: 'Scenes & hook', waiting: 'Planning the scenes and the opening hook…' },
  visuals: { no: '04', title: 'Visuals', waiting: 'Finding real photos and generating the rest…' },
  voice: { no: '05', title: 'Voice', waiting: 'Recording the narration…' },
  video: { no: '06', title: 'Video', waiting: 'Editing the cut, adding music and captions…' },
  qa: { no: '07', title: 'Quality check', waiting: 'Reviewing the final video before publishing…' },
  metadata: { no: '08', title: 'Packaging', waiting: 'Writing the title, description and tags…' },
};

const VARIANT_LABEL: Record<VideoArtifact['variant'], string> = {
  draft: 'Rough cut',
  music: 'With music',
  captions: 'With captions',
};

/**
 * "Behind the scenes" — everything the agents have produced so far in this run,
 * newest first, with a live "in progress" card for the step they are on.
 */
@Component({
  selector: 'app-studio-feed',
  standalone: true,
  imports: [NgFor, NgIf, SlicePipe],
  template: `
    <div class="feed">
      <p class="empty" *ngIf="!artifacts.length && !running">
        Start a run and every piece your agents make shows up here the moment it exists —
        research, script, scenes, visuals, narration and the final cut.
      </p>

      <!-- In progress -->
      <article class="feed-card is-pending" *ngIf="running && nextStep" aria-live="polite">
        <header class="card-head">
          <span class="step">{{ nextStep.no }}</span>
          <h4>{{ nextStep.title }}</h4>
          <span class="meta">In progress</span>
        </header>
        <p class="pending-text"><span class="ay-live-dot"></span>{{ nextStep.waiting }}</p>
        <div class="shimmer" aria-hidden="true"><i></i><i></i><i></i></div>
      </article>

      <!-- 08 Packaging -->
      <article class="feed-card" *ngIf="metadata" data-kind="metadata">
        <header class="card-head">
          <span class="step">08</span>
          <h4>Packaging</h4>
          <span class="meta">{{ metadata.title.length }}/100 title · {{ metadata.tags.length }} tags</span>
          <button type="button" class="link-btn" (click)="copyMetadata()">{{ copiedMeta ? 'Copied' : 'Copy' }}</button>
        </header>
        <p class="yt-title">{{ metadata.title }}</p>
        <p class="yt-desc">{{ metadata.description }}</p>
        <div class="sources" *ngIf="metadata.tags.length">
          <span class="source" *ngFor="let t of metadata.tags">{{ t }}</span>
        </div>
      </article>

      <!-- 07 Quality -->
      <article class="feed-card" *ngIf="qa" data-kind="qa" [class.is-fail]="!qa.passed">
        <header class="card-head">
          <span class="step">07</span>
          <h4>Quality check</h4>
          <span class="meta">{{ qa.passed ? 'Passed' : 'Needs attention' }}</span>
        </header>
        <ul class="checks" *ngIf="qaRows.length">
          <li *ngFor="let row of qaRows" [class.is-bad]="row.ok === false">
            <span class="mark">{{ row.ok === false ? '✕' : '✓' }}</span>
            <span>{{ row.label }}</span>
            <span class="value" *ngIf="row.value">{{ row.value }}</span>
          </li>
        </ul>
        <ul class="notes" *ngIf="qa.issues.length">
          <li *ngFor="let issue of qa.issues">{{ issue }}</li>
        </ul>
      </article>

      <!-- 06 Video -->
      <article class="feed-card" *ngIf="videos.length" data-kind="video">
        <header class="card-head">
          <span class="step">06</span>
          <h4>Video</h4>
          <span class="meta">{{ videos.length }} {{ videos.length === 1 ? 'cut' : 'cuts' }} so far</span>
        </header>
        <div class="cuts">
          <button
            *ngFor="let v of videos"
            type="button"
            class="cut"
            [class.is-open]="openVariant === v.variant"
            [disabled]="!v.url"
            (click)="toggleVideo(v.variant)">
            <span class="cut-play" aria-hidden="true"></span>{{ variantLabel(v.variant) }}
          </button>
        </div>
        <video *ngIf="openVideoUrl" class="cut-player" controls preload="metadata" [src]="openVideoUrl"></video>
      </article>

      <!-- 05 Voice -->
      <article class="feed-card" *ngIf="audio?.url" data-kind="voice">
        <header class="card-head">
          <span class="step">05</span>
          <h4>Voice</h4>
          <span class="meta">Narration recorded</span>
        </header>
        <audio class="narration" controls preload="none" [src]="abs(audio?.url)"></audio>
      </article>

      <!-- 04 Visuals -->
      <article class="feed-card" *ngIf="imageSlots.length" data-kind="visuals">
        <header class="card-head">
          <span class="step">04</span>
          <h4>Visuals</h4>
          <span class="meta">{{ readyImages }}/{{ imageSlots.length }} ready<ng-container *ngIf="realImages"> · {{ realImages }} real photos</ng-container></span>
        </header>
        <div class="gallery">
          <figure *ngFor="let slot of imageSlots; let i = index" class="shot" [class.is-ready]="!!slot?.url" [attr.title]="slot?.prompt || scenes?.prompts?.[i] || null">
            <img *ngIf="slot?.url" [src]="abs(slot?.url)" [alt]="'Scene ' + (i + 1)" loading="lazy" />
            <span class="shot-badge" *ngIf="slot">{{ slot.source === 'real' ? 'Real photo' : 'AI' }}</span>
            <figcaption>Scene {{ i + 1 }}</figcaption>
          </figure>
        </div>
      </article>

      <!-- 03 Scenes & hook -->
      <article class="feed-card" *ngIf="scenes" data-kind="scenes">
        <header class="card-head">
          <span class="step">03</span>
          <h4>Scenes & hook</h4>
          <span class="meta">{{ scenes.prompts.length }} scenes</span>
        </header>
        <p class="hook" *ngIf="scenes.hook"><span class="hook-label">Opening hook</span>“{{ scenes.hook }}”</p>
        <ol class="scene-list">
          <li *ngFor="let p of scenes.prompts; let i = index" [style.animation-delay.ms]="i * 60">
            <span class="scene-no">{{ i + 1 }}</span><span>{{ p }}</span>
          </li>
        </ol>
      </article>

      <!-- 02 Script -->
      <article class="feed-card" *ngIf="script" data-kind="script">
        <header class="card-head">
          <span class="step">02</span>
          <h4>Script</h4>
          <span class="meta">Draft {{ script.revision }} · {{ scriptWords }} words · ~{{ scriptSeconds }}s</span>
          <button type="button" class="link-btn" (click)="copyScript()">{{ copied ? 'Copied' : 'Copy' }}</button>
        </header>
        <p class="script">
          <span *ngFor="let line of scriptLines; let i = index; trackBy: trackScriptLine" class="script-line" [style.animation-delay.ms]="i * 110">{{ line }} </span>
        </p>
        <div class="critic" *ngFor="let c of critics" [class.is-pass]="c.passed">
          <span class="critic-tag">{{ c.passed ? 'Critic approved draft ' + c.revision : 'Critic notes on draft ' + c.revision }}</span>
          <ul *ngIf="!c.passed && c.issues.length">
            <li *ngFor="let issue of c.issues">{{ issue }}</li>
          </ul>
        </div>
      </article>

      <!-- 01 Research -->
      <article class="feed-card" *ngIf="research" data-kind="research">
        <header class="card-head">
          <span class="step">01</span>
          <h4>Research</h4>
          <span class="meta">
            {{ research.facts.length }} facts · {{ research.sources.length }} sources<ng-container *ngIf="research.newsDate"> · news from {{ research.newsDate }}</ng-container>
          </span>
        </header>
        <ul class="facts">
          <li *ngFor="let fact of (showAllFacts ? research.facts : (research.facts | slice: 0 : 4)); let i = index" [style.animation-delay.ms]="i * 70">{{ fact }}</li>
        </ul>
        <button *ngIf="research.facts.length > 4" type="button" class="link-btn" (click)="showAllFacts = !showAllFacts">
          {{ showAllFacts ? 'Show fewer' : 'Show all ' + research.facts.length + ' facts' }}
        </button>
        <div class="sources" *ngIf="sourceLinks.length">
          <ng-container *ngFor="let s of sourceLinks">
            <a *ngIf="s.href" class="source" [href]="s.href" target="_blank" rel="noopener">{{ s.label }}</a>
            <span *ngIf="!s.href" class="source">{{ s.label }}</span>
          </ng-container>
        </div>
      </article>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .feed {
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-height: 760px;
        overflow-y: auto;
        padding-right: 4px;
        scrollbar-width: thin;
        scrollbar-color: var(--ay-border) transparent;
      }
      .empty {
        margin: 0;
        padding: 26px 18px;
        border: 1px dashed var(--ay-line-strong);
        border-radius: 12px;
        color: var(--ay-text-3);
        font-size: 14px;
        line-height: 1.6;
        text-align: center;
      }

      .feed-card {
        --tone: var(--ay-yellow);
        position: relative;
        padding: 14px 16px 16px 18px;
        border-radius: 12px;
        border: 1px solid var(--ay-line);
        background: var(--ay-bg);
        animation: feed-in 0.7s var(--ay-ease) both;
      }
      .feed-card::before {
        content: '';
        position: absolute;
        left: 0;
        top: 14px;
        bottom: 14px;
        width: 2px;
        border-radius: 2px;
        background: var(--tone);
        opacity: 0.8;
      }
      .feed-card[data-kind='research'] { --tone: var(--ay-text-2); }
      .feed-card[data-kind='visuals'] { --tone: var(--ay-pink); }
      .feed-card[data-kind='qa'] { --tone: var(--ay-ink); }
      .feed-card[data-kind='metadata'] { --tone: var(--ay-pink); }
      .feed-card.is-fail { --tone: var(--ay-danger); }
      @keyframes feed-in {
        from { opacity: 0; transform: translateY(12px); filter: blur(6px); }
      }

      .card-head {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 4px 10px;
        margin-bottom: 10px;
      }
      .step { font: 600 11px var(--ay-mono); color: var(--ay-text-3); }
      h4 { margin: 0; font-size: 14.5px; font-weight: 600; color: var(--ay-ink); }
      .meta { font-size: 12px; color: var(--ay-text-3); }
      .link-btn {
        margin-left: auto;
        padding: 0;
        border: 0;
        background: none;
        color: var(--ay-ink);
        font: 600 12px var(--ay-font);
        cursor: pointer;
        background-image: var(--ay-energy);
        background-size: 0 1px;
        background-position: 0 100%;
        background-repeat: no-repeat;
        transition: background-size 0.4s var(--ay-ease);
      }
      .link-btn:hover { background-size: 100% 1px; }
      .facts + .link-btn { margin: 8px 0 0; }

      /* Pending */
      .is-pending { border-style: dashed; border-color: var(--ay-yellow-edge); background: var(--ay-yellow-soft); }
      .pending-text { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; font-size: 13.5px; color: var(--ay-text-2); }
      .shimmer { display: grid; gap: 7px; }
      .shimmer i {
        display: block;
        height: 8px;
        border-radius: 4px;
        background: linear-gradient(90deg, rgba(var(--ay-ink-rgb), 0.05), rgba(var(--ay-ink-rgb), 0.14), rgba(var(--ay-ink-rgb), 0.05)) 0 0 / 200% 100%;
        animation: shimmer 1.6s linear infinite;
      }
      .shimmer i:nth-child(2) { width: 82%; }
      .shimmer i:nth-child(3) { width: 58%; }
      @keyframes shimmer { to { background-position: -200% 0; } }

      /* Research */
      .facts { margin: 0; padding-left: 18px; display: grid; gap: 6px; }
      .facts li, .scene-list li {
        font-size: 13.5px;
        line-height: 1.55;
        color: var(--ay-text-2);
        animation: line-in 0.6s var(--ay-ease) both;
      }
      .sources { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
      .source {
        padding: 3px 9px;
        border-radius: 999px;
        border: 1px solid var(--ay-line-strong);
        color: var(--ay-text-2);
        font-size: 11.5px;
        text-decoration: none;
        transition: border-color 0.3s, color 0.3s;
      }
      a.source:hover { border-color: var(--ay-yellow-edge); color: var(--ay-ink); }

      /* Script */
      .script { margin: 0; font-size: 14px; line-height: 1.75; color: var(--ay-ink); }
      .script-line { animation: line-in 0.6s var(--ay-ease) both; }
      @keyframes line-in { from { opacity: 0; filter: blur(4px); } }
      .critic {
        margin-top: 10px;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid var(--ay-pink-edge);
        background: var(--ay-pink-soft);
      }
      .critic.is-pass { border-color: rgba(var(--ay-ink-rgb), 0.2); background: rgba(var(--ay-ink-rgb), 0.03); }
      .critic-tag { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ay-pink-bright); }
      .critic.is-pass .critic-tag { color: var(--ay-text-2); }
      .critic ul { margin: 6px 0 0; padding-left: 18px; font-size: 13px; color: var(--ay-text-2); }

      /* Scenes */
      .hook {
        margin: 0 0 10px;
        padding: 10px 12px;
        border-radius: 10px;
        background: var(--ay-yellow-soft);
        border: 1px solid var(--ay-yellow-edge);
        color: var(--ay-ink);
        font-size: 15px;
        font-weight: 500;
      }
      .hook-label { display: block; margin-bottom: 3px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ay-yellow-bright); }
      .scene-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
      .scene-list li { display: flex; gap: 10px; }
      .scene-no {
        flex: none;
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
        border-radius: 6px;
        background: rgba(var(--ay-ink-rgb), 0.06);
        color: var(--ay-text-2);
        font: 600 11px var(--ay-mono);
      }

      /* Visuals */
      .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
      .shot {
        position: relative;
        margin: 0;
        aspect-ratio: 3 / 4;
        overflow: hidden;
        border-radius: 8px;
        border: 1px solid var(--ay-line);
        background: linear-gradient(90deg, rgba(var(--ay-ink-rgb), 0.04), rgba(var(--ay-ink-rgb), 0.1), rgba(var(--ay-ink-rgb), 0.04)) 0 0 / 200% 100%;
        animation: shimmer 1.6s linear infinite;
      }
      .shot.is-ready { animation: none; background: var(--ay-surface-2); border-color: var(--ay-pink-edge); }
      .shot img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        animation: ay-materialize 0.9s var(--ay-ease) both;
        transition: transform 0.6s var(--ay-ease);
      }
      .shot:hover img { transform: scale(1.06); }
      .shot-badge {
        position: absolute;
        top: 5px;
        left: 5px;
        padding: 2px 6px;
        border-radius: 999px;
        background: rgba(var(--ay-bg-rgb), 0.8);
        color: var(--ay-ink);
        font-size: 9.5px;
        font-weight: 600;
      }
      .shot figcaption {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        padding: 14px 6px 5px;
        background: linear-gradient(transparent, rgba(0, 0, 0, 0.6));
        color: #fafafa;
        font-size: 10.5px;
      }

      /* Packaging */
      .yt-title { margin: 0 0 8px; font-size: 15px; font-weight: 650; line-height: 1.4; color: var(--ay-ink); }
      .yt-desc { margin: 0 0 10px; font-size: 13px; line-height: 1.6; color: var(--ay-text-2); white-space: pre-line; }

      /* Voice */
      .narration { width: 100%; height: 38px; }

      /* Video */
      .cuts { display: flex; flex-wrap: wrap; gap: 8px; }
      .cut {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 7px 12px;
        border-radius: 999px;
        border: 1px solid var(--ay-line-strong);
        background: transparent;
        color: var(--ay-text-2);
        font: 500 12.5px var(--ay-font);
        cursor: pointer;
        transition: border-color 0.3s, color 0.3s, background-color 0.3s;
      }
      .cut:hover:not(:disabled), .cut.is-open { color: var(--ay-ink); border-color: rgba(var(--ay-ink-rgb), 0.4); background: rgba(var(--ay-ink-rgb), 0.04); }
      .cut:disabled { opacity: 0.5; cursor: not-allowed; }
      .cut-play { width: 8px; height: 10px; background: currentColor; clip-path: polygon(0 0, 100% 50%, 0 100%); }
      .cut-player { width: 100%; max-height: 360px; margin-top: 10px; border-radius: 10px; background: #000; animation: ay-materialize 0.9s var(--ay-ease) both; }

      /* Quality */
      .checks, .notes { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
      .checks li { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ay-text-2); }
      .mark { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--ay-ink); color: var(--ay-bg); font-size: 10px; font-weight: 700; }
      .checks li.is-bad .mark { background: var(--ay-danger); }
      .value { margin-left: auto; font: 500 12px var(--ay-mono); color: var(--ay-text-3); }
      .notes { margin-top: 10px; }
      .notes li { font-size: 12.5px; color: var(--ay-danger); }

      /* Newest first: the pending step on top, then the latest output downwards. */
      .is-pending { order: -1; }

      @media (prefers-reduced-motion: reduce) {
        .feed-card, .facts li, .scene-list li, .script-line, .shimmer i, .shot, .shot img, .cut-player { animation: none; }
      }
    `,
  ],
})
export class StudioFeedComponent implements OnChanges {
  @Input() artifacts: StudioArtifact[] = [];
  /** Base URL of the server that serves /uploads. */
  @Input() serverBase = '';
  /** A job is running or paused — shows the "in progress" card. */
  @Input() running = false;

  research: ResearchArtifact | null = null;
  script: ScriptArtifact | null = null;
  critics: CriticArtifact[] = [];
  scenes: ScenesArtifact | null = null;
  imageSlots: (ImageArtifact | null)[] = [];
  audio: AudioArtifact | null = null;
  videos: VideoArtifact[] = [];
  qa: QaArtifact | null = null;
  metadata: MetadataArtifact | null = null;

  scriptLines: string[] = [];
  scriptWords = 0;
  scriptSeconds = 0;
  sourceLinks: SourceLink[] = [];
  qaRows: QaRow[] = [];
  readyImages = 0;
  realImages = 0;
  nextStep: FeedStep | null = null;

  showAllFacts = false;
  copied = false;
  copiedMeta = false;
  openVariant: VideoArtifact['variant'] | null = null;

  ngOnChanges(): void {
    this.research = null;
    this.script = null;
    this.critics = [];
    this.scenes = null;
    this.audio = null;
    this.qa = null;
    this.metadata = null;
    const images: ImageArtifact[] = [];
    const videos = new Map<VideoArtifact['variant'], VideoArtifact>();

    for (const a of this.artifacts) {
      switch (a.kind) {
        case 'research': this.research = a; break;
        case 'script': this.script = a; break;
        case 'critic': this.critics = [...this.critics, a]; break;
        case 'scenes': this.scenes = a; break;
        case 'image': images[a.index] = a; break;
        case 'audio': this.audio = a; break;
        case 'video': videos.set(a.variant, a); break;
        case 'qa': this.qa = a; break;
        case 'metadata': this.metadata = a; break;
      }
    }

    const slotCount = Math.max(this.scenes?.prompts.length ?? 0, images.length);
    this.imageSlots = images.some(Boolean) ? Array.from({ length: slotCount }, (_, i) => images[i] ?? null) : [];
    this.readyImages = this.imageSlots.filter((s) => s?.url).length;
    this.realImages = this.imageSlots.filter((s) => s?.source === 'real').length;
    this.videos = (['draft', 'music', 'captions'] as const).map((v) => videos.get(v)).filter((v): v is VideoArtifact => !!v);
    if (this.openVariant && !videos.has(this.openVariant)) this.openVariant = null;

    const scriptText = (this.script?.text || '').trim();
    this.scriptLines = scriptText ? scriptText.split(/(?<=[.!?])\s+/) : [];
    this.scriptWords = scriptText ? scriptText.split(/\s+/).length : 0;
    this.scriptSeconds = Math.round(this.scriptWords / 2.5);

    this.sourceLinks = (this.research?.sources ?? []).slice(0, 8).map(toSourceLink);
    this.qaRows = this.qa ? toQaRows(this.qa.checks) : [];

    const present: Record<keyof typeof STEPS, boolean> = {
      research: !!this.research,
      script: !!this.script,
      scenes: !!this.scenes,
      visuals: this.imageSlots.length > 0,
      voice: !!this.audio,
      video: this.videos.length > 0,
      qa: !!this.qa,
      metadata: !!this.metadata,
    };
    const next = (Object.keys(STEPS) as (keyof typeof STEPS)[]).find((key) => !present[key]);
    this.nextStep = next ? STEPS[next] : null;
  }

  abs(url: string | null | undefined): string {
    if (!url) return '';
    return /^https?:\/\//.test(url) ? url : `${this.serverBase}${url}`;
  }

  get openVideoUrl(): string | null {
    const video = this.videos.find((v) => v.variant === this.openVariant);
    return video?.url ? this.abs(video.url) : null;
  }

  toggleVideo(variant: VideoArtifact['variant']): void {
    this.openVariant = this.openVariant === variant ? null : variant;
  }

  variantLabel(variant: VideoArtifact['variant']): string {
    return VARIANT_LABEL[variant];
  }

  copyScript(): void {
    const text = this.script?.text;
    if (!text || !navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      this.copied = true;
      setTimeout(() => (this.copied = false), 1800);
    });
  }

  /** Copy the packaging as title / description / tags, ready to paste. */
  copyMetadata(): void {
    const m = this.metadata;
    if (!m || !navigator.clipboard) return;
    const text = `${m.title}\n\n${m.description}\n\nTags: ${m.tags.join(', ')}`;
    navigator.clipboard.writeText(text).then(() => {
      this.copiedMeta = true;
      setTimeout(() => (this.copiedMeta = false), 1800);
    });
  }

  /** New draft → new DOM, so a revised script replays its line-by-line reveal. */
  trackScriptLine = (index: number): string => `${this.script?.revision ?? 0}:${index}`;
}

function toSourceLink(source: string): SourceLink {
  try {
    const url = new URL(source);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return { label: url.hostname.replace(/^www\./, ''), href: url.href };
    }
  } catch {
    // not a URL — show the source name as plain text
  }
  return { label: source.length > 40 ? source.slice(0, 40) + '…' : source, href: null };
}

function toQaRows(checks: Record<string, unknown>): QaRow[] {
  return Object.entries(checks).map(([key, value]) => {
    const label = key.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
    if (typeof value === 'boolean') return { label, ok: value, value: '' };
    if (typeof value === 'number') return { label, ok: null, value: String(Math.round(value * 100) / 100) };
    if (value && typeof value === 'object' && 'passed' in (value as object)) {
      const v = value as { passed?: unknown };
      return { label, ok: !!v.passed, value: '' };
    }
    return { label, ok: null, value: value === null || value === undefined ? '' : String(value).slice(0, 40) };
  });
}
