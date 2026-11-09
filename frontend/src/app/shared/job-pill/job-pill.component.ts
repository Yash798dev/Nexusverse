import { Component } from '@angular/core';
import { NgIf, NgSwitch, NgSwitchCase } from '@angular/common';
import { Router } from '@angular/router';
import { JobTrackerService } from '../../core/job-tracker.service';

/** Nav pill showing the user's video job on pages other than Workflow. Click to go back to it. */
@Component({
  selector: 'app-job-pill',
  standalone: true,
  imports: [NgIf, NgSwitch, NgSwitchCase],
  template: `
    <button
      *ngIf="jobs.state() !== 'idle'"
      type="button"
      class="pill"
      [attr.data-state]="jobs.state()"
      [attr.aria-label]="ariaLabel"
      [attr.title]="jobs.prompt() || null"
      (click)="open()">
      <span class="ring" aria-hidden="true">
        <svg viewBox="0 0 36 36">
          <circle class="track" cx="18" cy="18" r="15" />
          <circle class="value" cx="18" cy="18" r="15" pathLength="100" [style.stroke-dashoffset]="100 - jobs.progress()" />
        </svg>
        <span class="glyph" [ngSwitch]="jobs.state()">
          <i *ngSwitchCase="'running'" class="g-live"></i>
          <i *ngSwitchCase="'paused'" class="g-pause"></i>
          <i *ngSwitchCase="'done'" class="g-play"></i>
          <i *ngSwitchCase="'failed'" class="g-fail">!</i>
        </span>
      </span>
      <span class="text">
        <span class="title">{{ title }}</span>
        <span class="sub">{{ sub }}</span>
      </span>
    </button>
  `,
  styles: [
    `
      :host { display: inline-flex; }
      .pill {
        --tone: var(--ay-yellow);
        display: inline-flex;
        align-items: center;
        gap: 8px;
        max-width: 230px;
        padding: 3px 12px 3px 3px;
        border-radius: 999px;
        border: 1px solid var(--ay-yellow-edge);
        background: var(--ay-yellow-soft);
        color: var(--ay-ink);
        font-family: var(--ay-font);
        cursor: pointer;
        animation: pill-in 0.6s var(--ay-ease) both;
        transition: border-color 0.3s var(--ay-ease), transform 0.3s var(--ay-ease);
      }
      .pill:hover { transform: translateY(-1px); border-color: var(--tone); }
      .pill:focus-visible { outline: 2px solid var(--ay-yellow); outline-offset: 2px; }
      .pill[data-state='paused'] { --tone: var(--ay-text-2); border-color: var(--ay-line-strong); background: rgba(var(--ay-ink-rgb), 0.04); }
      .pill[data-state='done'] { --tone: var(--ay-pink); border-color: var(--ay-pink-edge); background: var(--ay-pink-soft); }
      .pill[data-state='failed'] { --tone: var(--ay-danger); border-color: rgba(var(--ay-danger-rgb), 0.45); background: rgba(var(--ay-danger-rgb), 0.06); }
      @keyframes pill-in { from { opacity: 0; transform: translateY(-6px) scale(0.95); } }

      .ring { position: relative; display: grid; place-items: center; width: 28px; height: 28px; flex: none; }
      .ring svg { position: absolute; inset: 0; transform: rotate(-90deg); }
      .ring circle { fill: none; stroke-width: 3; }
      .track { stroke: rgba(var(--ay-ink-rgb), 0.12); }
      .value {
        stroke: var(--tone);
        stroke-linecap: round;
        stroke-dasharray: 100;
        transition: stroke-dashoffset 0.8s var(--ay-ease);
      }
      .glyph { position: relative; display: grid; place-items: center; }
      .g-live { width: 6px; height: 6px; border-radius: 50%; background: var(--tone); animation: live 1.6s ease-in-out infinite; }
      @keyframes live { 50% { transform: scale(1.5); opacity: 0.6; } }
      .g-pause { width: 7px; height: 8px; border-left: 2px solid currentColor; border-right: 2px solid currentColor; box-sizing: border-box; }
      .g-play { width: 7px; height: 8px; margin-left: 2px; background: currentColor; clip-path: polygon(0 0, 100% 50%, 0 100%); }
      .g-fail { font-style: normal; font-size: 12px; font-weight: 800; color: var(--ay-danger); }

      .text { display: flex; flex-direction: column; min-width: 0; text-align: left; line-height: 1.15; }
      .title { font-size: 12.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
      .sub { font-size: 11px; color: var(--ay-text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

      @media (max-width: 768px) {
        .pill { padding-right: 3px; }
        .text { display: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        .pill, .g-live { animation: none; }
      }
    `,
  ],
})
export class JobPillComponent {
  constructor(public jobs: JobTrackerService, private router: Router) {}

  get title(): string {
    switch (this.jobs.state()) {
      case 'paused': return 'Paused';
      case 'done': return 'Video ready';
      case 'failed': return 'Run failed';
      default: return `${this.jobs.progress()}%`;
    }
  }

  get sub(): string {
    switch (this.jobs.state()) {
      case 'done': return 'Open to preview';
      case 'failed': return 'Open to see logs';
      default: return this.jobs.stage() || 'In progress';
    }
  }

  get ariaLabel(): string {
    return `Video job: ${this.title}. ${this.sub}. Open Workflow.`;
  }

  open(): void {
    this.router.navigate(['/workflow']);
  }
}
