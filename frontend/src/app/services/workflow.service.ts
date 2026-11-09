// src/app/services/workflow.service.ts
import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable, Subject } from 'rxjs';
import { AuthService } from './auth.service';
import { StudioArtifact, normalizeArtifact } from './workflow-artifacts';
import { environment } from '../../environments/environment';

/** Server accepted the prompt, charged the credits and launched main_new.py. */
export interface WorkflowStarted {
  jobId: string;
  prompt: string;
  /** Credit balance after this video was charged. */
  credits: number;
}

/** Server refused to start a run. */
export interface WorkflowRejected {
  code: 'INVALID_PROMPT' | 'INSUFFICIENT_CREDITS' | 'ALREADY_RUNNING' | 'FAILED';
  error: string;
  needed?: number;
  current?: number;
}

/** Sent on connect when this account already has a run in progress (e.g. after a reload). */
export interface WorkflowActive {
  jobId: string;
  prompt: string;
  paused: boolean;
  progress: number;
  stage: string | null;
  /** Everything the run has produced so far, in order. */
  artifacts: StudioArtifact[];
}

/** Server refused or failed a pause / resume / cancel / submit_script request. */
export interface WorkflowControlError {
  action: 'pause' | 'resume' | 'cancel' | 'submit_script';
  /** NO_JOB: this account has no running job to control. */
  code: 'NO_JOB' | 'FAILED';
  error: string;
}

/**
 * Per-video settings chosen in the Studio. Every field is optional — an empty
 * config is a normal run with the pipeline's long-standing defaults. The server
 * whitelists all of it again (sanitizeConfig), so nothing here is trusted.
 */
export interface WorkflowConfig {
  /** Target length in seconds; drives script length and scene count. */
  durationSeconds?: number;
  tone?: string;
  /** Edge-TTS voice name, e.g. "en-US-AvaNeural". */
  voice?: string;
  language?: string;
  orientation?: 'portrait' | 'landscape';
  /** Pause once the script is final and wait for the user's edit. */
  reviewScript?: boolean;
}

/** UNAUTHORIZED: the token was rejected. OFFLINE: the server could not be reached. */
export type WorkflowConnectionError = 'UNAUTHORIZED' | 'OFFLINE';

/**
 * The line between the app and the server's job runner. Runs start only from
 * the Workflow page: the page sends the prompt, the server authenticates the
 * socket with the user's JWT, checks and charges credits, creates the job and
 * launches main_new.py. Every page of the app can listen (see JobTrackerService).
 */
@Injectable({
  providedIn: 'root',
})
export class WorkflowService {
  private socket: Socket | null = null;
  /** The token the current socket authenticated with. */
  private socketToken: string | null = null;

  private progress$ = new Subject<number>();
  private stage$ = new Subject<{ stage: string; info: string }>();
  private log$ = new Subject<string>();
  private error$ = new Subject<string>();
  private complete$ = new Subject<string>();
  private started$ = new Subject<WorkflowStarted>();
  private rejected$ = new Subject<WorkflowRejected>();
  private active$ = new Subject<WorkflowActive>();
  private artifact$ = new Subject<StudioArtifact>();
  private paused$ = new Subject<void>();
  private resumed$ = new Subject<void>();
  private cancelled$ = new Subject<void>();
  private controlError$ = new Subject<WorkflowControlError>();
  private connectionError$ = new Subject<WorkflowConnectionError>();
  /** The pipeline has paused with a finished draft and is waiting for an edit. */
  private scriptReview$ = new Subject<void>();
  /** The edited script (or a cancellation) reached the pipeline. */
  private scriptAccepted$ = new Subject<{ cancelled: boolean }>();

  constructor(private auth: AuthService) {}

  /**
   * Open the socket as the signed-in user. Safe to call repeatedly: reconnects
   * with the new identity if a different user has signed in since, and closes
   * the socket once nobody is signed in. Returns false when nobody is signed in.
   */
  connect(): boolean {
    const token = this.auth.getToken();
    if (!token) {
      this.closeSocket();
      return false;
    }

    if (this.socket) {
      if (this.socketToken === token) {
        if (!this.socket.connected && !this.socket.active) this.socket.connect();
        return true;
      }
      this.closeSocket();
    }

    this.socketToken = token;
    // Server origin comes from environment.socketBase (see environments/environment.ts).
    const socket = io(environment.socketBase, { auth: { token } });
    this.socket = socket;

    socket.on('connect', () => {
      console.log('WorkflowService: socket connected', socket.id);
    });

    socket.on('connect_error', (err: Error) => {
      this.connectionError$.next(err?.message === 'UNAUTHORIZED' ? 'UNAUTHORIZED' : 'OFFLINE');
    });

    socket.on('workflow_started', (data: any) => {
      this.started$.next({ jobId: String(data?.jobId ?? ''), prompt: String(data?.prompt ?? ''), credits: Number(data?.credits) });
    });

    socket.on('workflow_rejected', (data: any) => {
      this.rejected$.next({
        code: data?.code ?? 'FAILED',
        error: data?.error || 'The server could not start the job.',
        needed: data?.needed,
        current: data?.current,
      });
    });

    socket.on('workflow_active', (data: any) => {
      this.active$.next({
        jobId: String(data?.jobId ?? ''),
        prompt: String(data?.prompt ?? ''),
        paused: !!data?.paused,
        progress: Number(data?.progress) || 0,
        stage: data?.stage ? String(data.stage) : null,
        artifacts: (Array.isArray(data?.artifacts) ? data.artifacts : [])
          .map(normalizeArtifact)
          .filter((a: StudioArtifact | null): a is StudioArtifact => !!a),
      });
    });

    socket.on('workflow_artifact', (data: any) => {
      const artifact = normalizeArtifact(data?.artifact);
      if (artifact) this.artifact$.next(artifact);
    });

    socket.on('workflow_progress', (data: any) => {
      const pct = typeof data === 'number' ? data : data?.pct ?? 0;
      this.progress$.next(Number(pct));
    });

    socket.on('workflow_stage', (data: any) => {
      // expected { stage, info }
      this.stage$.next({ stage: data?.stage || 'Stage', info: data?.info || '' });
    });

    socket.on('workflow_log', (data: any) => {
      const log = typeof data === 'string' ? data : data?.message ?? data?.log ?? JSON.stringify(data);
      this.log$.next(log);
    });

    socket.on('workflow_error', (data: any) => {
      const err = typeof data === 'string' ? data : data?.error || JSON.stringify(data);
      this.error$.next(err);
    });

    socket.on('workflow_complete', (data: any) => {
      const msg = typeof data === 'string' ? data : data?.message || 'complete';
      this.complete$.next(msg);
    });

    // The draft itself arrives just before this as a `script_review` artifact,
    // so the page already holds the text to put in the editor.
    socket.on('workflow_script_review', () => this.scriptReview$.next());
    socket.on('workflow_script_accepted', (data: any) =>
      this.scriptAccepted$.next({ cancelled: !!data?.cancelled })
    );

    socket.on('workflow_paused', () => this.paused$.next());
    socket.on('workflow_resumed', () => this.resumed$.next());
    socket.on('workflow_cancelled', () => this.cancelled$.next());
    socket.on('workflow_control_error', (data: any) => {
      this.controlError$.next({
        action: data?.action,
        code: data?.code === 'NO_JOB' ? 'NO_JOB' : 'FAILED',
        error: data?.error || 'Unknown error',
      });
    });

    socket.on('disconnect', (reason: any) => {
      console.log('WorkflowService: socket disconnected', reason);
      // do not null socket — allow reconnection attempts
    });

    return true;
  }

  private closeSocket(): void {
    if (!this.socket) return;
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.socket = null;
    this.socketToken = null;
  }

  /**
   * Ask the server to start a run for this prompt. The answer arrives as
   * `onStarted` or `onRejected`. Returns false when nobody is signed in.
   */
  startWorkflow(
    prompt: string,
    knowledgeSourceIds: string[] = [],
    config: WorkflowConfig = {}
  ): boolean {
    if (!this.connect()) return false;
    // Sending ids (not note text) keeps the payload small and lets the server
    // re-check ownership rather than trusting anything the page supplies.
    this.socket?.emit('start_workflow', { prompt, knowledgeSourceIds, config });
    return true;
  }

  /**
   * Answer a script review. The pipeline is blocked on a single line of stdin,
   * so exactly one of these ends the pause: an edit, the draft unchanged
   * (script = null), or a cancellation.
   */
  submitScript(script: string | null, cancel = false): void {
    this.socket?.emit('submit_script', cancel ? { cancel: true } : { script });
  }

  /** Freeze the running pipeline (and every process it started). */
  pauseWorkflow() {
    this.socket?.emit('pause_workflow');
  }

  resumeWorkflow() {
    this.socket?.emit('resume_workflow');
  }

  /** Stop the running pipeline for good. */
  cancelWorkflow() {
    this.socket?.emit('cancel_workflow');
  }

  // Request server to upload (server must implement listener 'request_upload')
  requestUpload(videoUrl: string, email: string) {
    this.socket?.emit('request_upload', { videoUrl, email });
  }

  // Observables consumers use
  onStarted(): Observable<WorkflowStarted> {
    return this.started$.asObservable();
  }
  onRejected(): Observable<WorkflowRejected> {
    return this.rejected$.asObservable();
  }
  onActive(): Observable<WorkflowActive> {
    return this.active$.asObservable();
  }
  onArtifact(): Observable<StudioArtifact> {
    return this.artifact$.asObservable();
  }
  onProgress(): Observable<number> {
    return this.progress$.asObservable();
  }
  onStage(): Observable<{ stage: string; info: string }> {
    return this.stage$.asObservable();
  }
  onLog(): Observable<string> {
    return this.log$.asObservable();
  }
  onError(): Observable<string> {
    return this.error$.asObservable();
  }
  onComplete(): Observable<string> {
    return this.complete$.asObservable();
  }
  onPaused(): Observable<void> {
    return this.paused$.asObservable();
  }
  onResumed(): Observable<void> {
    return this.resumed$.asObservable();
  }
  onCancelled(): Observable<void> {
    return this.cancelled$.asObservable();
  }
  onControlError(): Observable<WorkflowControlError> {
    return this.controlError$.asObservable();
  }
  onScriptReview(): Observable<void> {
    return this.scriptReview$.asObservable();
  }
  onScriptAccepted(): Observable<{ cancelled: boolean }> {
    return this.scriptAccepted$.asObservable();
  }
  onConnectionError(): Observable<WorkflowConnectionError> {
    return this.connectionError$.asObservable();
  }
}
