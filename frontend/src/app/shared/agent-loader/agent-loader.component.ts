import { Component, Input } from '@angular/core';
import { NgIf } from '@angular/common';

/**
 * Agentic YouTube loading mark — an idea splits into agents, they process and
 * converge into a play symbol. All motion is CSS (.ay-loader in styles.css) so the
 * same markup also works as the pre-bootstrap splash in index.html.
 */
@Component({
  selector: 'app-agent-loader',
  standalone: true,
  imports: [NgIf],
  template: `
    <div class="ay-loader" [style.--ay-loader-size]="size + 'px'" aria-hidden="true">
      <svg class="ay-loader__links" viewBox="0 0 100 100"><path d="M18 18 H82 V82 H18 Z" pathLength="100" /></svg>
      <i class="ay-loader__seed"></i>
      <i class="ay-loader__node ay-loader__node--1"></i>
      <i class="ay-loader__node ay-loader__node--2"></i>
      <i class="ay-loader__node ay-loader__node--3"></i>
      <i class="ay-loader__node ay-loader__node--4"></i>
      <i class="ay-loader__pulse"></i>
      <i class="ay-loader__play"></i>
    </div>
    <p class="ay-loader-label" *ngIf="label">{{ label }}</p>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 18px;
        padding: 2.5rem 1rem;
      }
    `,
  ],
  host: { role: 'status' },
})
export class AgentLoaderComponent {
  @Input() size = 64;
  @Input() label = '';
}
