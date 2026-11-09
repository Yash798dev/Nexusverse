// src/app/components/workflow/workflow.component.ts
import { Component, OnInit, OnDestroy,ElementRef, ViewChild, AfterViewChecked  } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { WorkflowService, WorkflowConfig } from '../../services/workflow.service';
import { StudioArtifact } from '../../services/workflow-artifacts';
import { ApiService } from '../../services/api.service';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { KnowledgeService } from '../../services/knowledge.service';
import { ToastService } from '../../core/toast.service';
import { AgentBackdropComponent } from '../../shared/agent-backdrop/agent-backdrop.component';
import { AppNavComponent } from '../../shared/app-nav/app-nav.component';
import { PipelineStripComponent, StripStage } from '../../shared/pipeline-strip/pipeline-strip.component';
import { StudioFeedComponent } from '../../shared/studio/studio-feed.component';
import { WaitingRoomComponent } from '../../shared/studio/waiting-room.component';
import { environment } from '../../../environments/environment';

/** Lifecycle of the job shown on this page. */
type JobState = 'idle' | 'running' | 'paused' | 'done' | 'failed';

/** Average time each pipeline stage took on this browser's previous runs. */
interface StageTimings {
  runs: number;
  avg: (number | null)[];
}

/** How long the server gets to answer start / pause / resume / stop before we give up waiting. */
const CONTROL_TIMEOUT_MS = 15000;

/** Must match MAX_PROMPT_LENGTH in server/src/sockets/workflowSocket.js. */
const MAX_PROMPT_LENGTH = 500;

const TIMINGS_KEY = 'ay-stage-timings-v1';
const NO_FACTS: string[] = [];

@Component({
  selector: 'app-workflow',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    CommonModule,
    AgentBackdropComponent,
    AppNavComponent,
    PipelineStripComponent,
    StudioFeedComponent,
    WaitingRoomComponent,
  ],
  templateUrl: './workflow.component.html',
  styleUrls: ['./workflow.component.css'],
})
export class WorkflowComponent implements OnInit, OnDestroy, AfterViewChecked {
  // form is always constructed in constructor, so not nullable.
  form = this.fb.group({ prompt: ['', [Validators.required, Validators.maxLength(MAX_PROMPT_LENGTH)]] });
  readonly maxPromptLength = MAX_PROMPT_LENGTH;

  /** Waiting for the server to accept (or reject) a submitted prompt. */
  loading = false;
  err: string | null = null;

  progress = 0;
  logs: string[] = [];
  currentStage = '';
  stageInfo: { [key: string]: string } = {};
  videoUrl: string | null = null;

  stages = [
    'Info Generation',
    'Image Generation',
    'Text to Speech',
    'Video Generation',
    'Adding Background Music',
    'captioning',
    'Packaging',
    'Upload to YouTube',
  ];

  // ---- Behind the scenes ----
  /** Everything the agents have produced in this run, in arrival order. */
  artifacts: StudioArtifact[] = [];
  notifyPermission: NotificationPermission | 'unsupported' = 'unsupported';

  // ---- Job control ----
  jobState: JobState = 'idle';
  /** Server-side VideoJob id of the run on screen. */
  jobId: string | null = null;
  /** Waiting for the server to confirm a pause / resume / stop. */
  controlBusy = false;
  /** "Clear job" on a running job asks for a second click. */
  confirmClear = false;
  private controlTimer?: ReturnType<typeof setTimeout>;
  private confirmTimer?: ReturnType<typeof setTimeout>;
  private startTimer?: ReturnType<typeof setTimeout>;
  private lastOfflineToastAt = 0;

  // ---- Live pipeline (one strip stage per entry in `stages`, same order) ----
  pipelineStages: StripStage[] = [
    { label: 'Script', tone: 'yellow' },
    { label: 'Visuals', tone: 'pink' },
    { label: 'Voice', tone: 'yellow' },
    { label: 'Video', tone: 'yellow' },
    { label: 'Music', tone: 'yellow' },
    { label: 'Captions', tone: 'yellow' },
    { label: 'Packaging', tone: 'pink' },
    { label: 'Publish', tone: 'white' },
  ];
  /** -1 idle, 0..6 running, 7 complete. */
  pipelineIndex = -1;
  /** Per-stage timer text shown under the strip. */
  pipelineMeta: string[] = [];
  runStartedAt: number | null = null;
  elapsedLabel = '0:00';
  /** Estimated time left, or null when there is nothing to estimate. */
  remainingLabel: string | null = null;
  private runFinishedAt: number | null = null;
  /** While paused, clocks read this instant instead of now. */
  private pausedAt: number | null = null;
  private stageStartedAt: number[] = [];
  private stageDurations: (number | null)[] = [];
  private clock?: ReturnType<typeof setInterval>;
  private notifiedReady = false;
  private lastErrorToastAt = 0;
  private timings: StageTimings | null = null;

  // ---- Prompt starters ----
  promptStarters = [
    { tag: 'Tech', label: 'AI in healthcare', prompt: 'How AI is revolutionizing healthcare' },
    { tag: 'Science', label: 'Quantum computing', prompt: 'Quantum computing explained simply in 60 seconds' },
    { tag: 'Finance', label: 'Money habits', prompt: '5 personal finance habits that quietly build wealth' },
    { tag: 'History', label: 'Fall of Rome', prompt: 'Why the Roman Empire fell, explained in under a minute' },
    { tag: 'Space', label: 'Space discoveries', prompt: 'The most surprising space discoveries of this decade' },
  ];

  // ---- Video settings ----
  /** The settings panel starts closed: the defaults are a complete, sane run. */
  settingsOpen = false;

  readonly durationOptions = [
    { label: '30 sec', value: 30 },
    { label: '1 min', value: 60 },
    { label: '3 min', value: 180 },
    { label: '5 min', value: 300 },
    { label: '10 min', value: 600 },
  ];
  /** Values must match TONES in server/src/sockets/workflowSocket.js. */
  readonly toneOptions = [
    { label: 'Default', value: '' },
    { label: 'Educational', value: 'educational' },
    { label: 'Conversational', value: 'conversational' },
    { label: 'Punchy', value: 'punchy' },
    { label: 'Storytelling', value: 'storytelling' },
    { label: 'Professional', value: 'professional' },
  ];
  /** Edge-TTS voices. Empty keeps the configured studio voice (XTTS). */
  readonly voiceOptions = [
    { label: 'Studio voice (default)', value: '' },
    { label: 'Ava — US English', value: 'en-US-AvaNeural' },
    { label: 'Andrew — US English', value: 'en-US-AndrewNeural' },
    { label: 'Emma — US English', value: 'en-US-EmmaNeural' },
    { label: 'Brian — US English', value: 'en-US-BrianNeural' },
    { label: 'Sonia — UK English', value: 'en-GB-SoniaNeural' },
  ];
  readonly languageOptions = [
    { label: 'English', value: 'en' },
    { label: 'Spanish', value: 'es' },
    { label: 'French', value: 'fr' },
    { label: 'German', value: 'de' },
    { label: 'Hindi', value: 'hi' },
  ];

  config = {
    durationSeconds: 60,
    tone: '',
    voice: '',
    language: 'en',
    orientation: 'portrait' as 'portrait' | 'landscape',
    reviewScript: false,
  };

  // ---- Script review (opt-in) ----
  /** The pipeline is paused and the editor is open. */
  scriptReviewOpen = false;
  /** The draft being edited. Seeded from the `script_review` artifact. */
  scriptDraft = '';
  private originalDraft = '';
  submittingScript = false;

  // ---- Knowledge grounding ----
  /** Knowledge Hub sources this run is grounded in (from ?knowledge=). */
  groundedSourceIds: string[] = [];
  /** Their titles, for the "Grounded in" chip. */
  groundedTitles: string[] = [];

  private subs: Subscription[] = [];

  /** Server origin, for /uploads URLs. */
  serverBase = environment.uploadsBase;

  constructor(
    private fb: FormBuilder,
    private workflowService: WorkflowService,
    private api: ApiService,
    private router: Router,
    private userService:AuthService,
    private toast: ToastService,
    private route: ActivatedRoute,
    private knowledge: KnowledgeService
  ) {}

  ngOnInit(): void {
    this.timings = loadTimings();
    this.notifyPermission = this.toast.notificationPermission();
    this.readKnowledgeSelection();

    this.subs.push(
      this.workflowService.onStarted().subscribe(({ jobId, prompt, credits }) => {
        this.loading = false;
        clearTimeout(this.startTimer);
        this.progress = 0;
        this.logs = [];
        this.stageInfo = {};
        this.currentStage = '';
        this.videoUrl = null;
        this.err = null;
        this.artifacts = [];
        this.resetPipeline();
        this.jobState = 'running';
        this.jobId = jobId;
        if (Number.isFinite(credits)) this.credits = credits;
        this.pushLog(`Job ${jobId} started on the server for prompt: "${prompt}"`);
        this.currentStage = 'Info Generation';
        this.syncPipeline();
        this.toast.info('Agents started', prompt);
      })
    );

    this.subs.push(
      this.workflowService.onRejected().subscribe(({ code, error, needed, current }) => {
        this.loading = false;
        clearTimeout(this.startTimer);
        this.err = error;
        if (code === 'INSUFFICIENT_CREDITS') {
          this.toast.error('Not enough credits', `You have ${current ?? 0}; a video needs ${needed}. Top up from Pricing.`);
        } else if (code === 'ALREADY_RUNNING') {
          this.toast.info('A job is already running', error);
        } else {
          this.toast.error('Could not start the job', error);
        }
      })
    );

    this.subs.push(
      this.workflowService.onActive().subscribe(({ jobId, prompt, paused, progress, artifacts }) => {
        if (this.isJobActive) return;
        this.jobId = jobId;
        this.jobState = paused ? 'paused' : 'running';
        this.progress = Math.round(progress);
        this.artifacts = artifacts;
        if (!this.form.value.prompt) this.form.patchValue({ prompt });
        this.pushLog(`Reconnected to your running job ${jobId}${paused ? ' (paused)' : ''}`);
      })
    );

    this.subs.push(
      this.workflowService.onArtifact().subscribe((artifact) => {
        this.adoptRunningJob();
        this.artifacts = [...this.artifacts, artifact];
        // The draft arrives just before the pause notice, so hold on to it.
        if (artifact.kind === 'script_review') {
          this.originalDraft = artifact.text;
          this.scriptDraft = artifact.text;
        }
      })
    );

    this.subs.push(
      this.workflowService.onScriptReview().subscribe(() => {
        this.adoptRunningJob();
        this.scriptReviewOpen = true;
        this.submittingScript = false;
        this.pushLog('[REVIEW] The script is ready for your approval');
        this.toast.creative('Your script is ready', 'Review or edit it, then continue the run.');
      })
    );

    this.subs.push(
      this.workflowService.onScriptAccepted().subscribe(({ cancelled }) => {
        this.scriptReviewOpen = false;
        this.submittingScript = false;
        if (cancelled) {
          this.pushLog('[REVIEW] Run cancelled from the script review');
        } else {
          this.pushLog('[REVIEW] Script accepted — the agents are continuing');
          this.toast.success('Script accepted', 'Visuals, narration and the cut are next.');
        }
      })
    );

    this.subs.push(
      this.workflowService.onConnectionError().subscribe((kind) => {
        if (kind === 'UNAUTHORIZED') {
          this.loading = false;
          this.toast.error('Session expired', 'Sign in again to use the studio.');
          this.userService.logout();
          return;
        }
        // Socket.io retries on its own; don't toast every attempt.
        const now = Date.now();
        if (now - this.lastOfflineToastAt > 20000) {
          this.lastOfflineToastAt = now;
          this.toast.error('Cannot reach the server', 'Retrying… make sure the server is running.');
        }
      })
    );

    this.subs.push(
      this.workflowService.onProgress().subscribe((pct) => {
        this.adoptRunningJob();
        this.progress = Math.round(pct);
        this.syncPipeline();
      })
    );

    this.subs.push(
      this.workflowService.onStage().subscribe(({ stage, info }) => {
        this.adoptRunningJob();
        this.currentStage = stage || this.detectStageFromLog(info || '') || this.currentStage;
        if (info) this.stageInfo[stage] = info;
        this.pushLog(`[STAGE] ${stage}: ${info || '-'}`);
        this.syncPipeline();
      })
    );

    this.subs.push(
      this.workflowService.onLog().subscribe((log) => {
        this.adoptRunningJob();
        this.pushLog(log);
        const detected = this.detectStageFromLog(log);
        if (detected) {
          this.currentStage = detected;
        }
        const maybePath = this.extractPathFromLog(log);
        if (maybePath) this.setVideoPath(maybePath);
        const yt = this.extractYoutubeIdFromLog(log);
        if (yt) {
          this.stageInfo['Upload to YouTube'] = `YouTube ID: ${yt}`;
          this.currentStage = 'Upload to YouTube';
          this.progress = 100;
        }
        this.syncPipeline();
      })
    );

    this.subs.push(
      this.workflowService.onError().subscribe((err) => {
        this.pushLog(`ERROR: ${err}`);
        this.err = typeof err === 'string' ? err : JSON.stringify(err);
        if (/^process exited with code/.test(this.err)) {
          // The pipeline process itself died — there is nothing left to pause.
          this.jobState = 'failed';
          this.runFinishedAt = Date.now();
          this.stopClock();
          this.refreshClock();
        }
        // The server forwards every stderr chunk as an error; one toast per burst is enough.
        const now = Date.now();
        if (now - this.lastErrorToastAt > 8000) {
          this.lastErrorToastAt = now;
          this.toast.error('An agent reported an error', this.err.slice(0, 140));
        }
      })
    );

    this.subs.push(
      this.workflowService.onComplete().subscribe((msg) => {
        this.pushLog(`COMPLETE: ${msg}`);
        this.progress = 100;
        this.currentStage = 'Done';
        this.jobState = 'done';
        this.syncPipeline();
      })
    );

    this.subs.push(
      this.workflowService.onPaused().subscribe(() => {
        this.controlDone();
        if (this.jobState !== 'running') return;
        this.jobState = 'paused';
        this.pausedAt = Date.now();
        this.stopClock();
        this.refreshClock();
        this.pushLog('[CONTROL] Job paused');
        this.toast.info('Job paused', 'Every agent is frozen mid-stage. Resume whenever you are ready.');
      })
    );

    this.subs.push(
      this.workflowService.onResumed().subscribe(() => {
        this.controlDone();
        if (this.jobState !== 'paused') return;
        // Shift the clocks forward by the pause so timers only count working time.
        if (this.pausedAt !== null) {
          const gap = Date.now() - this.pausedAt;
          if (this.runStartedAt !== null) this.runStartedAt += gap;
          const i = this.pipelineIndex;
          if (i >= 0 && i < this.pipelineStages.length && this.stageStartedAt[i] != null) {
            this.stageStartedAt[i] += gap;
          }
        }
        this.pausedAt = null;
        this.jobState = 'running';
        if (this.runStartedAt !== null && this.runFinishedAt === null) this.startClock();
        this.pushLog('[CONTROL] Job resumed');
        this.toast.success('Job resumed', 'Agents picked up exactly where they stopped.');
      })
    );

    this.subs.push(
      this.workflowService.onCancelled().subscribe(() => {
        this.controlDone();
        if (this.jobState === 'idle') return;
        this.resetJobView();
        this.toast.success('Job stopped and cleared', 'Your prompt is still here if you want to run it again.');
      })
    );

    this.subs.push(
      this.workflowService.onControlError().subscribe(({ action, code, error }) => {
        this.controlDone();
        if (action === 'cancel' && code === 'NO_JOB') {
          // The job already ended on the server — only the view is left to clear.
          this.resetJobView();
          this.toast.info('Job cleared', 'It had already finished on the server.');
          return;
        }
        const verb = action === 'cancel' ? 'stop' : action;
        this.toast.error(`Could not ${verb} the job`, error);
      })
    );

    // Open the authenticated socket now so a job already running for this
    // account (e.g. before a reload) is reported straight away.
    this.workflowService.connect();

    this.userService.getCredits().subscribe({
      next: (res) => {
        this.credits = res.credits;
      },
      error: (err) => {
        console.error('Failed to load credits', err);
      }
    });
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    this.stopClock();
    clearTimeout(this.controlTimer);
    clearTimeout(this.confirmTimer);
    clearTimeout(this.startTimer);
  }

  /**
   * Submit the prompt to the server. The server validates it, charges the
   * video's credits, creates the job and launches main_new.py; the page switches
   * to the running state only once the server confirms (onStarted).
   */
  startWorkflow() {
    this.err = null;
    // safe check: ensure form exists (it does) and get the control value safely
    const control = this.form.get('prompt');
    const rawValue = control?.value;
    // normalize to string to avoid "possibly null" type errors
    const prompt = (typeof rawValue === 'string' ? rawValue.trim() : '');

    if (!prompt) {
      this.err = 'Enter a prompt';
      this.toast.info('Enter a prompt first', 'Or pick one of the starters below the prompt box.');
      return;
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      this.err = `Keep the prompt under ${MAX_PROMPT_LENGTH} characters`;
      this.toast.info('Prompt too long', `Keep it under ${MAX_PROMPT_LENGTH} characters.`);
      return;
    }
    if (this.loading) return;
    if (this.isJobActive) {
      this.toast.info('A job is already running', 'Pause it, or clear it before starting another.');
      return;
    }

    if (!this.workflowService.startWorkflow(prompt, this.groundedSourceIds, this.buildConfig())) {
      this.toast.error('Session expired', 'Sign in again to use the studio.');
      this.userService.logout();
      return;
    }

    this.loading = true;
    clearTimeout(this.startTimer);
    this.startTimer = setTimeout(() => {
      if (!this.loading) return;
      this.loading = false;
      this.toast.error('Could not start the job', 'The server did not respond. Is it running?');
    }, CONTROL_TIMEOUT_MS);
  }

  /**
   * "Create video from this" in the Knowledge Hub arrives as ?knowledge=<ids>.
   * Only the ids travel in the URL; titles are looked up from the library, and
   * the server re-checks ownership regardless of what the page sends.
   */
  private readKnowledgeSelection(): void {
    const raw = this.route.snapshot.queryParamMap.get('knowledge');
    if (!raw) return;

    this.groundedSourceIds = raw.split(',').map((id) => id.trim()).filter(Boolean);
    if (!this.groundedSourceIds.length) return;

    this.subs.push(
      this.knowledge.list().subscribe({
        next: (res) => {
          const byId = new Map((res.sources || []).map((s) => [s._id, s.title]));
          this.groundedTitles = this.groundedSourceIds.map(
            (id) => byId.get(id) || 'Selected notes'
          );
          if (!this.form.value.prompt && this.groundedTitles.length) {
            // A sensible starting topic; the user can rewrite it before starting.
            this.form.patchValue({ prompt: this.groundedTitles[0].slice(0, MAX_PROMPT_LENGTH) });
          }
        },
        // Falling back to a generic label is better than blocking the run.
        error: () => {
          this.groundedTitles = this.groundedSourceIds.map(() => 'Selected notes');
        },
      })
    );
  }

  /**
   * Only settings the user actually changed are sent. An empty string means
   * "leave the pipeline's default alone", and sending it would override a
   * configured studio voice with nothing.
   */
  private buildConfig(): WorkflowConfig {
    const config: WorkflowConfig = {
      durationSeconds: this.config.durationSeconds,
      orientation: this.config.orientation,
      reviewScript: this.config.reviewScript,
    };
    if (this.config.tone) config.tone = this.config.tone;
    if (this.config.voice) config.voice = this.config.voice;
    if (this.config.language) config.language = this.config.language;
    return config;
  }

  /** Roughly how long the narration will run, for the settings summary. */
  get durationLabel(): string {
    return this.durationOptions.find((d) => d.value === this.config.durationSeconds)?.label ?? '1 min';
  }

  /** One-line summary shown on the collapsed settings row. */
  get settingsSummary(): string {
    const voice = this.voiceOptions.find((v) => v.value === this.config.voice)?.label ?? 'Studio voice';
    const parts = [this.durationLabel, this.config.orientation === 'portrait' ? 'Portrait' : 'Landscape', voice.split(' —')[0]];
    if (this.config.tone) parts.push(this.config.tone);
    if (this.config.reviewScript) parts.push('review script');
    return parts.join(' · ');
  }

  // ---- Script review ----

  /**
   * Word count and spoken length of the draft being edited.
   *
   * These live here rather than in the template because Angular template
   * expressions do not support regex literals — `split(/\s+/)` there is a
   * compile error, not a runtime one.
   */
  get draftWordCount(): number {
    const text = (this.scriptDraft || '').trim();
    return text ? text.split(/\s+/).length : 0;
  }

  /** Narration runs at roughly 2.5 words a second (matches the pipeline). */
  get draftSeconds(): number {
    return Math.round(this.draftWordCount / 2.5);
  }

  /** Send the edited script back; the pipeline is blocked waiting for it. */
  submitScript(): void {
    if (this.submittingScript) return;
    const edited = (this.scriptDraft || '').trim();
    if (!edited) {
      this.toast.info('The script cannot be empty', 'Edit it, or keep the draft as written.');
      return;
    }
    this.submittingScript = true;
    // Unchanged text is sent as null so the pipeline keeps its own draft.
    this.workflowService.submitScript(edited === this.originalDraft ? null : edited);
  }

  /** Continue with the draft exactly as the agents wrote it. */
  acceptDraft(): void {
    if (this.submittingScript) return;
    this.submittingScript = true;
    this.workflowService.submitScript(null);
  }

  /** Abandon the run from the review step. */
  cancelFromReview(): void {
    if (this.submittingScript) return;
    this.submittingScript = true;
    this.workflowService.submitScript(null, true);
  }

  /** Drop the grounding and make this an ordinary web-researched video. */
  clearGrounding(): void {
    this.groundedSourceIds = [];
    this.groundedTitles = [];
    this.toast.info('Grounding removed', 'This video will be researched from the web instead.');
  }

  // Heuristics to detect the current stage based on log text
  detectStageFromLog(log: string): string | null {
    if (!log) return null;
    const L = log.toLowerCase();

    if (L.includes('info_generator') || L.includes('script generated') || L.includes('video_script_generator')) {
      return 'Info Generation';
    }
    if (L.includes('image_generation') || L.includes('generated images') || L.includes('unsplash') || L.includes('generate_images')) {
      return 'Image Generation';
    }
    if (L.includes('text_to_speech') || L.includes('generating audio') || L.includes('audio file saved')) {
      return 'Text to Speech';
    }
    if (L.includes('video_generation') || L.includes('moviepy') || L.includes('video generated') || L.includes('final_video.mp4')) {
      return 'Video Generation';
    }
    if (L.includes('bg_music') || L.includes('music-mixed') || L.includes('video_with_music') || L.includes('background music')) {
      return 'Adding Background Music';
    }
    if (L.includes('captioned_video') || L.includes('captions') || L.includes('caption') || L.includes('captioning')) {
      return 'Captioning';
    }
    if (L.includes('upload_to_yt') || L.includes('uploading video') || L.includes('upload complete') || L.includes('youtube id') || L.includes('video id')) {
      return 'Upload to YouTube';
    }
    return null;
  }

  private extractPathFromLog(log: string): string | null {
    try {
      const win = log.match(/([A-Za-z]:\\[^\s'"]+?\.mp4)/);
      if (win) return win[1];
      const unix = log.match(/(\/[^\s'"]+?\.mp4)/);
      if (unix) return unix[1];
      const kv = log.match(/(?:VIDEO_PATH|COMPLETED):(.+?\.mp4)/i);
      if (kv) return kv[1].trim();
      return null;
    } catch {
      return null;
    }
  }

  private extractYoutubeIdFromLog(log: string): string | null {
    const m = log.match(/YouTube ID:\s*([A-Za-z0-9_\-]+)/i) || log.match(/YOUTUBE_ID:([A-Za-z0-9_\-]+)/i) || log.match(/Video ID:\s*([A-Za-z0-9_\-]+)/i);
    return m ? m[1] : null;
  }

  setVideoPath(localPath: string) {
    if (!localPath) return;
    try {
      const filename = localPath.split(/[\\/]/).pop();
      if (!filename) return;
      // Build preview url pointing to server's uploads folder
      this.videoUrl = `${this.serverBase}/uploads/${encodeURIComponent(filename)}`;
      this.stageInfo['Video Generation'] = this.videoUrl;
      this.pushLog(`Video available: ${this.videoUrl}`);
    } catch (e) {
      this.pushLog('Failed to convert path to URL: ' + String(e));
    }
  }

  // Map global progress into per-stage microprogress (0-100)
  getStageProgress(stage: string): number {
    const ranges: { [k: string]: [number, number] } = {
      'Info Generation': [0, 15],
      'Image Generation': [15, 45],
      'Text to Speech': [45, 68],
      'Video Generation': [68, 82],
      'Adding Background Music': [82, 90],
      'Captioning': [90, 96],
      'Packaging': [96, 99],
      'Upload to YouTube': [99, 100],
    };
    const r = ranges[stage];
    if (!r) return 0;
    const [lo, hi] = r;
    if (this.progress <= lo) return 0;
    if (this.progress >= hi) return 100;
    return Math.round(((this.progress - lo) / (hi - lo)) * 100);
  }

  // ---- Behind the scenes / while you wait ----

  /** This run's research facts, for the Did-you-know and Quiz tabs. */
  get researchFacts(): string[] {
    for (let i = this.artifacts.length - 1; i >= 0; i--) {
      const artifact = this.artifacts[i];
      if (artifact.kind === 'research') return artifact.facts;
    }
    return NO_FACTS;
  }

  async enableNotifications(): Promise<void> {
    this.notifyPermission = await this.toast.requestNotificationPermission();
    if (this.notifyPermission === 'granted') {
      this.toast.success("We'll notify you", 'Feel free to browse or switch tabs — the job keeps running on the server.');
    } else if (this.notifyPermission === 'denied') {
      this.toast.info('Notifications are blocked', 'Allow them for this site in your browser settings to get a ping when the video is ready.');
    }
  }

  /** An idea from the board goes into the prompt box. */
  usePromptIdea(prompt: string): void {
    this.form.patchValue({ prompt: prompt.slice(0, MAX_PROMPT_LENGTH) });
    const input = document.getElementById('promptInput') as HTMLTextAreaElement | null;
    input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input?.focus({ preventScroll: true });
    if (this.isJobActive) {
      this.toast.info('Saved in the prompt box', 'Start it once the current run finishes.');
    }
  }

  // ---- Job control ----

  get isJobActive(): boolean {
    return this.jobState === 'running' || this.jobState === 'paused';
  }

  /** Anything on screen worth clearing. */
  get canClear(): boolean {
    return this.jobState !== 'idle' || this.logs.length > 0 || this.progress > 0 || !!this.videoUrl || this.artifacts.length > 0;
  }

  pauseJob(): void {
    if (this.jobState !== 'running' || this.controlBusy) return;
    this.awaitControl('pause');
    this.pushLog('[CONTROL] Pause requested');
    this.workflowService.pauseWorkflow();
  }

  resumeJob(): void {
    if (this.jobState !== 'paused' || this.controlBusy) return;
    this.awaitControl('resume');
    this.pushLog('[CONTROL] Resume requested');
    this.workflowService.resumeWorkflow();
  }

  clearJob(): void {
    if (this.controlBusy) return;

    if (!this.isJobActive) {
      this.resetJobView();
      this.toast.info('Job cleared', 'Ready for the next prompt.');
      return;
    }

    // Stopping a live job can't be undone — ask for a second click.
    if (!this.confirmClear) {
      this.confirmClear = true;
      clearTimeout(this.confirmTimer);
      this.confirmTimer = setTimeout(() => (this.confirmClear = false), 4000);
      return;
    }

    this.confirmClear = false;
    clearTimeout(this.confirmTimer);
    this.awaitControl('stop');
    this.pushLog('[CONTROL] Stop requested');
    this.workflowService.cancelWorkflow();
  }

  private awaitControl(verb: string): void {
    this.controlBusy = true;
    clearTimeout(this.controlTimer);
    this.controlTimer = setTimeout(() => {
      if (!this.controlBusy) return;
      this.controlBusy = false;
      this.toast.error(`Could not ${verb} the job`, 'The server did not respond. Is it still running?');
    }, CONTROL_TIMEOUT_MS);
  }

  private controlDone(): void {
    this.controlBusy = false;
    clearTimeout(this.controlTimer);
  }

  /** Output arriving while idle belongs to this account's job that is already running. */
  private adoptRunningJob(): void {
    if (this.jobState === 'idle') this.jobState = 'running';
  }

  /** Back to a blank studio. The prompt text is kept. */
  private resetJobView(): void {
    this.progress = 0;
    this.logs = [];
    this.stageInfo = {};
    this.currentStage = '';
    this.videoUrl = null;
    this.err = null;
    this.artifacts = [];
    this.stopClock();
    this.pipelineIndex = -1;
    this.pipelineMeta = [];
    this.stageStartedAt = [];
    this.stageDurations = [];
    this.runStartedAt = null;
    this.runFinishedAt = null;
    this.pausedAt = null;
    this.elapsedLabel = '0:00';
    this.remainingLabel = null;
    this.notifiedReady = false;
    this.jobState = 'idle';
    this.jobId = null;
    this.confirmClear = false;
    clearTimeout(this.confirmTimer);
  }

  // ---- Live pipeline ----

  get isRunning(): boolean {
    return this.jobState === 'running' && this.pipelineIndex < this.pipelineStages.length;
  }

  get pipelineTitle(): string {
    const n = this.pipelineStages.length;
    if (this.pipelineIndex >= n) return 'Video ready';
    if (this.jobState === 'failed') return 'Run stopped with an error';
    if (this.loading) return 'Sending your prompt to the server…';
    if (this.pipelineIndex < 0) {
      if (this.runStartedAt) return 'Starting agents…';
      if (this.isJobActive) return 'Reconnected to your running job';
      return 'Waiting for a prompt';
    }
    return `${this.pipelineStages[this.pipelineIndex].label} · stage ${this.pipelineIndex + 1} of ${n}`;
  }

  private resetPipeline(): void {
    this.pipelineIndex = -1;
    this.stageStartedAt = [];
    this.stageDurations = [];
    this.runStartedAt = Date.now();
    this.runFinishedAt = null;
    this.pausedAt = null;
    this.notifiedReady = false;
    this.startClock();
    this.refreshClock();
  }

  /** Map the current stage/progress onto the strip and time each stage. */
  private syncPipeline(): void {
    const n = this.pipelineStages.length;
    let index = this.pipelineIndex;
    if (this.progress >= 100 || this.currentStage === 'Done') {
      index = n;
    } else {
      const found = this.stages.findIndex((s) => s.toLowerCase() === (this.currentStage || '').toLowerCase());
      // Never step backwards within a run (logs can mention earlier stages).
      if (found >= 0) index = Math.max(found, this.pipelineIndex);
    }

    if (index !== this.pipelineIndex) {
      const now = Date.now();
      for (let i = Math.max(0, this.pipelineIndex); i < Math.min(index, n); i++) {
        if (this.stageDurations[i] == null && this.stageStartedAt[i] != null) {
          this.stageDurations[i] = now - this.stageStartedAt[i];
        }
      }
      if (index >= 0 && index < n) this.stageStartedAt[index] = now;
      this.pipelineIndex = index;
      if (index >= n) this.onPipelineComplete();
    }
    this.refreshClock();
  }

  private onPipelineComplete(): void {
    this.jobState = 'done';
    this.runFinishedAt = Date.now();
    this.stopClock();
    this.saveTimings();
    if (this.notifiedReady) return;
    this.notifiedReady = true;
    // The app-wide JobTrackerService sends the system notification.
    this.toast.creative('Video ready', 'Your agents finished the run. Preview it below.');
  }

  private refreshClock(): void {
    const now = this.pausedAt ?? Date.now();
    this.pipelineMeta = this.pipelineStages.map((_, i) => {
      const done = this.stageDurations[i];
      if (done != null) return formatDuration(done);
      if (i === this.pipelineIndex && this.stageStartedAt[i] != null) return formatDuration(now - this.stageStartedAt[i]);
      return '';
    });
    if (this.runStartedAt !== null) {
      this.elapsedLabel = formatDuration((this.runFinishedAt ?? now) - this.runStartedAt);
    }
    this.remainingLabel = this.estimateRemaining(now);
  }

  /**
   * Time left: from this browser's average stage durations once every stage has
   * been timed at least once; otherwise extrapolated from the progress rate so far.
   */
  private estimateRemaining(now: number): string | null {
    const n = this.pipelineStages.length;
    if (!this.isJobActive || this.runStartedAt === null || this.pipelineIndex >= n) return null;

    const i = this.pipelineIndex;
    const avg = this.timings?.avg;
    if (avg && i >= 0 && avg.length >= n && avg.every((v) => v != null)) {
      const inStage = this.stageStartedAt[i] != null ? now - this.stageStartedAt[i] : 0;
      let ms = Math.max(avg[i]! - inStage, avg[i]! * 0.1);
      for (let k = i + 1; k < n; k++) ms += avg[k]!;
      return formatEta(ms);
    }

    if (this.progress >= 8) {
      const elapsed = now - this.runStartedAt;
      return formatEta((elapsed * (100 - this.progress)) / this.progress);
    }
    return 'Estimating…';
  }

  /** Blend this run's stage times into the running averages (60% history / 40% latest). */
  private saveTimings(): void {
    const n = this.pipelineStages.length;
    const run = this.stageDurations.slice(0, n);
    if (!run.some((d) => d != null)) return;
    const prev = this.timings;
    const avg = Array.from({ length: n }, (_, i) => {
      const latest = run[i];
      const old = prev?.avg[i] ?? null;
      if (latest == null) return old;
      return old == null ? latest : Math.round(old * 0.6 + latest * 0.4);
    });
    this.timings = { runs: (prev?.runs ?? 0) + 1, avg };
    try {
      localStorage.setItem(TIMINGS_KEY, JSON.stringify(this.timings));
    } catch {
      // storage unavailable — estimates fall back to the progress rate
    }
  }

  private startClock(): void {
    this.stopClock();
    this.clock = setInterval(() => this.refreshClock(), 1000);
  }

  private stopClock(): void {
    if (this.clock) clearInterval(this.clock);
    this.clock = undefined;
  }

  // ---- Prompt helpers ----

  get promptLength(): number {
    return (this.form.value.prompt || '').length;
  }

  useStarter(prompt: string, input: HTMLTextAreaElement): void {
    this.form.patchValue({ prompt });
    input.focus();
    input.setSelectionRange(prompt.length, prompt.length);
    // Restart the fill flash even when clicking starters back to back.
    input.classList.remove('is-filled');
    void input.offsetWidth;
    input.classList.add('is-filled');
  }

  // UI helpers
  pushLog(line: string) {
    const ts = new Date().toISOString();
    this.logs.push(`[${ts}] ${line}`);
    if (this.logs.length > 2000) this.logs.splice(0, this.logs.length - 2000);
  }

  clearLogs() {
    this.logs = [];
  }

  copyLogs() {
    try {
      const lines = this.logs.length;
      navigator.clipboard.writeText(this.logs.join('\n')).then(
        () => this.toast.success('Logs copied', `${lines} line${lines === 1 ? '' : 's'} on your clipboard.`),
        () => this.toast.error('Copy failed', 'Your browser blocked clipboard access.')
      );
      this.pushLog('Logs copied to clipboard');
    } catch (e) {
      this.pushLog('Copy failed: ' + String(e));
    }
  }

  downloadLatest() {
    if (!this.videoUrl) {
      this.pushLog('No video to download');
      this.toast.info('No video yet', 'It appears here as soon as the workflow renders it.');
      return;
    }
    window.open(this.videoUrl, '_blank');
  }

  previewInPlayer() {
    if (!this.videoUrl) {
      this.pushLog('No video to preview');
      this.toast.info('No video yet', 'It appears here as soon as the workflow renders it.');
      return;
    }
    window.open(this.videoUrl, '_blank');
  }

  // Ask user for an email and emit upload request to server
  async submitForUpload() {
    if (!this.videoUrl) {
      this.pushLog('No video available to upload');
      return;
    }
    const email = prompt('Enter YouTube owner email to use for upload (the server will check channel):');
    if (!email) return;
    this.pushLog(`Requesting upload for ${email}`);
    this.workflowService.requestUpload(this.videoUrl, email);
  }


@ViewChild('logsContainer') private logsContainer!: ElementRef;


  ngAfterViewChecked() {
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    if (this.logsContainer) {
      const el = this.logsContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }

  isScrolled = false;
  credits:number|null=null;

  onWorkflow(): void {
    console.log('Navigate to Workflows');
    this.router.navigate(['/workflow']);
  }

  home(): void {
    this.router.navigate(['/home']);
  }

  onLogout(): void {
    this.userService.logout();
  }
  pricing(){
    this.router.navigate(['/subscription']);
  }



}

/** 83000 → "1:23", 3723000 → "1:02:03". */
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Coarse, honest estimates: "< 1 min", "~4 min", "~1 h 10 min". */
function formatEta(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `~${minutes} min`;
  return `~${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function loadTimings(): StageTimings | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(TIMINGS_KEY) || 'null');
    return parsed && Array.isArray(parsed.avg) ? { runs: Number(parsed.runs) || 0, avg: parsed.avg } : null;
  } catch {
    return null;
  }
}
