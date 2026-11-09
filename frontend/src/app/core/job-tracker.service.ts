import { Injectable, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { WorkflowService } from '../services/workflow.service';
import { ToastService } from './toast.service';

export type TrackedJobState = 'idle' | 'running' | 'paused' | 'done' | 'failed';

/**
 * App-wide view of the signed-in user's video job, so people can leave the
 * Workflow page while it renders: drives the nav job pill on other pages and
 * announces completion or failure from wherever the user is.
 * (The Workflow page keeps its own detailed state.)
 */
@Injectable({ providedIn: 'root' })
export class JobTrackerService {
  readonly state = signal<TrackedJobState>('idle');
  readonly progress = signal(0);
  readonly stage = signal('');
  readonly prompt = signal('');

  private started = false;

  constructor(
    private workflow: WorkflowService,
    private router: Router,
    private toast: ToastService
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;

    this.workflow.onStarted().subscribe(({ prompt }) => {
      this.state.set('running');
      this.progress.set(0);
      this.stage.set('Starting');
      this.prompt.set(prompt);
    });

    this.workflow.onActive().subscribe(({ prompt, paused, progress, stage }) => {
      this.state.set(paused ? 'paused' : 'running');
      this.prompt.set(prompt);
      this.progress.set(Math.round(progress ?? 0));
      this.stage.set(stage || 'In progress');
    });

    this.workflow.onProgress().subscribe((pct) => {
      if (this.state() === 'idle') this.state.set('running');
      this.progress.set(Math.round(pct));
    });

    this.workflow.onStage().subscribe(({ stage }) => {
      if (this.state() === 'idle') this.state.set('running');
      if (stage) this.stage.set(stage);
    });

    this.workflow.onPaused().subscribe(() => {
      if (this.state() === 'running') this.state.set('paused');
    });

    this.workflow.onResumed().subscribe(() => {
      if (this.state() === 'paused') this.state.set('running');
    });

    this.workflow.onCancelled().subscribe(() => this.state.set('idle'));

    this.workflow.onComplete().subscribe(() => {
      // The server can report completion twice (COMPLETED line + clean exit).
      if (this.state() === 'done') return;
      this.state.set('done');
      this.progress.set(100);
      if (!this.onWorkflowPage()) {
        this.toast.creative('Video ready', 'Open Workflow to preview and download it.');
      }
      this.toast.notifyInBackground('Your video is ready', this.prompt() || 'Agentic YouTube finished your run.');
    });

    this.workflow.onError().subscribe((error) => {
      if (!/^process exited with code/.test(error) || this.state() === 'failed') return;
      this.state.set('failed');
      if (!this.onWorkflowPage()) {
        this.toast.error('Your video run failed', 'Open Workflow to see the logs.');
      }
      this.toast.notifyInBackground('Your video run failed', 'Open Agentic YouTube to see what happened.');
    });

    // Connect as soon as someone is signed in, on whatever page they are on, and
    // clear a finished job's pill once they have been to Workflow to see it.
    this.workflow.connect();
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe(() => {
      this.workflow.connect();
      if (this.onWorkflowPage() && (this.state() === 'done' || this.state() === 'failed')) {
        this.state.set('idle');
      }
    });
  }

  private onWorkflowPage(): boolean {
    return this.router.url.startsWith('/workflow');
  }
}
