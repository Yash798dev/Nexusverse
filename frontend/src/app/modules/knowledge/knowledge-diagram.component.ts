import { AfterViewInit, Component, ElementRef, Input, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Mermaid flowcharts found in the generated notes.
 *
 * Gemini is told to emit ```mermaid blocks when it spots a process, but models
 * routinely break Mermaid's label rules (quotes, ampersands, parentheses,
 * slashes), which makes the whole diagram fail to parse. `sanitizeMermaid`
 * below is ported from NexusNotes and rewrites labels into a safe form before
 * rendering, which is the difference between a diagram and an error box.
 *
 * mermaid is imported dynamically so its considerable bundle only loads for
 * someone who actually opens this tab.
 */
@Component({
  selector: 'app-knowledge-diagram',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="head">
      <p class="kicker">Process flows</p>
      <span class="count" *ngIf="blocks.length">{{ blocks.length }} found</span>
    </div>

    <p class="none" *ngIf="!blocks.length">
      No process flows in these notes — they appear when the source explains a
      step-by-step process.
    </p>

    <div #host class="host" [class.hidden]="!blocks.length"></div>
  `,
  styles: [
    `
      :host { display: block; }
      .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
      .kicker { font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ay-text-3); font-weight: 700; }
      .count {
        font-size: 11px; padding: 2px 9px; border-radius: 999px;
        background: var(--ay-pink-soft); border: 1px solid var(--ay-pink-edge); color: var(--ay-pink-bright);
      }
      .none { color: var(--ay-text-3); font-size: 13.5px; padding: 34px 0; text-align: center; line-height: 1.6; }
      .hidden { display: none; }

      .host ::ng-deep .flow {
        margin-bottom: 20px; padding: 16px;
        border-radius: 14px; border: 1px solid var(--ay-line);
        background: var(--ay-surface); overflow-x: auto;
      }
      .host ::ng-deep .flow-label {
        font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase;
        color: var(--ay-text-3); margin-bottom: 9px;
      }
      .host ::ng-deep svg { width: 100%; max-width: 100%; height: auto; }
      .host ::ng-deep .flow-error { border-color: rgba(var(--ay-danger-rgb), 0.4); }
      .host ::ng-deep .flow-error p { color: var(--ay-danger); font-size: 12.5px; margin-bottom: 7px; }
      .host ::ng-deep .flow-error pre {
        font: 400 11px/1.6 var(--ay-mono); color: var(--ay-text-3);
        white-space: pre-wrap; word-break: break-word;
      }
    `,
  ],
})
export class KnowledgeDiagramComponent implements AfterViewInit {
  @ViewChild('host') hostRef?: ElementRef<HTMLDivElement>;

  @Input() set markdown(value: string) {
    this.blocks = extractMermaidBlocks(value || '');
    if (this.viewReady) void this.render();
  }

  blocks: string[] = [];
  private viewReady = false;

  ngAfterViewInit(): void {
    this.viewReady = true;
    void this.render();
  }

  private async render(): Promise<void> {
    const host = this.hostRef?.nativeElement;
    if (!host) return;

    host.innerHTML = '';
    if (!this.blocks.length) return;

    const mermaid = (await import('mermaid')).default;

    // Follow the app's theme so diagrams are legible in both.
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: isLight ? 'default' : 'dark',
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--ay-font') || 'sans-serif',
    });

    for (let i = 0; i < this.blocks.length; i++) {
      const wrapper = document.createElement('div');
      wrapper.className = 'flow';

      const label = document.createElement('p');
      label.className = 'flow-label';
      label.textContent = `Flow ${i + 1}`;
      wrapper.appendChild(label);

      const body = document.createElement('div');
      wrapper.appendChild(body);
      host.appendChild(wrapper);

      const source = sanitizeMermaid(this.blocks[i]);
      try {
        const { svg } = await mermaid.render(`nx-mermaid-${i}-${Date.now()}`, source);
        body.innerHTML = svg;
      } catch {
        // Show the source rather than an empty box, so a malformed diagram is
        // still inspectable. textContent, never innerHTML — this is model output.
        wrapper.classList.add('flow-error');
        const msg = document.createElement('p');
        msg.textContent = 'Could not render this diagram. Source:';
        const pre = document.createElement('pre');
        pre.textContent = source;
        body.replaceChildren(msg, pre);
      }
    }
  }
}

/** Pull every ```mermaid fenced block out of the markdown. */
function extractMermaidBlocks(md: string): string[] {
  const blocks: string[] = [];
  const re = /```mermaid\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(md))) blocks.push(match[1].trim());
  return blocks;
}

/**
 * Rewrite node labels into characters Mermaid can actually parse.
 * Ported from NexusNotes' DiagramView.
 */
function sanitizeMermaid(code: string): string {
  const UNSAFE = /["&<>()?,:/]/;

  const quote = (body: string) =>
    '"' +
    body
      .replace(/"/g, "'")
      .replace(/\(([^)]*)\)/g, ' $1 ')
      .replace(/&/g, ' and ')
      .replace(/</g, 'lt')
      .replace(/>/g, 'gt')
      .replace(/:/g, ' -')
      .replace(/\//g, ' or ')
      .replace(/\s+/g, ' ')
      .trim() +
    '"';

  const requote = (quoted: string) =>
    `"${quoted
      .slice(1, -1)
      .replace(/\(([^)]*)\)/g, ' $1 ')
      .replace(/&/g, ' and ')
      .replace(/:/g, ' -')
      .replace(/\//g, ' or ')
      .replace(/\s+/g, ' ')
      .trim()}"`;

  return code
    .replace(/\{([^{}\n]+)\}/g, (_, body: string) => {
      const t = body.trim();
      return `{${t.startsWith('"') && t.endsWith('"') ? requote(t) : quote(body)}}`;
    })
    .replace(/\[([^\][\n]+)\]/g, (_, body: string) => {
      const t = body.trim();
      if (t.startsWith('"') && t.endsWith('"')) return UNSAFE.test(t) ? `[${requote(t)}]` : `[${body}]`;
      return UNSAFE.test(body) ? `[${quote(body)}]` : `[${body}]`;
    });
}
