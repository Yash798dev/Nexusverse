import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

interface MapSection {
  title: string;
  subsections: string[];
  bullets: string[];
}

/** Four tones from the platform palette, cycled per branch. */
const TONES = ['yellow', 'pink', 'ink', 'grey'] as const;

/**
 * The notes as a constellation of topic cards.
 *
 * Despite markmap being listed in NexusNotes' dependencies, its mind-map view
 * never imported it — the map is built by parsing the markdown's own heading
 * structure. That is ported faithfully here (no extra dependency), recoloured
 * from the original purple/cyan onto this platform's tokens.
 */
@Component({
  selector: 'app-knowledge-mindmap',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="map" *ngIf="sections.length; else empty">
      <div class="root">
        <p class="kicker">Knowledge map</p>
        <h2>{{ title }}</h2>
        <p class="counts">{{ sections.length }} topics · {{ conceptCount }} concepts</p>
      </div>

      <div class="branches" aria-hidden="true">
        <span *ngFor="let s of sections; let i = index" [attr.data-tone]="tone(i)"></span>
      </div>

      <div class="cards">
        <button
          type="button"
          class="card"
          *ngFor="let sec of sections; let i = index"
          [attr.data-tone]="tone(i)"
          [class.is-open]="expanded === i"
          [attr.aria-expanded]="expanded === i"
          (click)="toggle(i)">
          <span class="head">
            <span class="idx">{{ i + 1 }}</span>
            <span class="meta">
              <span class="t">{{ sec.title }}</span>
              <span class="c">{{ items(sec).length }} concepts {{ expanded === i ? '▲' : '▼' }}</span>
            </span>
          </span>
          <span class="chips">
            <span
              class="chip"
              *ngFor="let item of visibleItems(sec, i); let j = index"
              [class.is-sub]="j < sec.subsections.length">
              {{ j < sec.subsections.length ? '◆ ' : '· ' }}{{ trim(item) }}
            </span>
            <span class="chip more" *ngIf="expanded !== i && items(sec).length > 3">
              +{{ items(sec).length - 3 }} more
            </span>
          </span>
        </button>
      </div>

      <p class="hint">Select a card to expand it</p>
    </div>

    <ng-template #empty>
      <p class="none">No sections found in these notes.</p>
    </ng-template>
  `,
  styles: [
    `
      :host { display: block; }
      .map { display: flex; flex-direction: column; gap: 18px; }

      .root { text-align: center; padding: 22px 24px; border-radius: 18px; border: 1px solid var(--ay-line); background: var(--ay-surface); }
      .kicker { font-size: 10.5px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ay-yellow); margin-bottom: 7px; }
      .root h2 { font-size: 19px; font-weight: 700; line-height: 1.35; color: var(--ay-ink); margin: 0; }
      .counts { font-size: 12px; color: var(--ay-text-3); margin-top: 8px; }

      .branches { display: flex; gap: 4px; padding: 0 8px; }
      .branches span { flex: 1; height: 2px; border-radius: 2px; background: var(--ay-text-3); opacity: 0.5; }
      .branches span[data-tone='yellow'] { background: var(--ay-yellow); }
      .branches span[data-tone='pink'] { background: var(--ay-pink); }
      .branches span[data-tone='ink'] { background: var(--ay-ink); }

      .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
      .card {
        --tone: var(--ay-text-3);
        display: flex; flex-direction: column; gap: 12px;
        text-align: left; padding: 15px 16px;
        border-radius: 15px; border: 1px solid var(--ay-line);
        background: var(--ay-surface); color: inherit; font: inherit;
        cursor: pointer;
        transition: transform 0.25s var(--ay-ease), border-color 0.25s var(--ay-ease);
      }
      .card[data-tone='yellow'] { --tone: var(--ay-yellow); }
      .card[data-tone='pink'] { --tone: var(--ay-pink); }
      .card[data-tone='ink'] { --tone: var(--ay-ink); }
      .card:hover { transform: translateY(-2px); border-color: var(--tone); }
      .card:focus-visible { outline: 2px solid var(--ay-yellow); outline-offset: 2px; }

      .head { display: flex; align-items: flex-start; gap: 11px; }
      .idx {
        flex: none; width: 27px; height: 27px; border-radius: 8px;
        display: grid; place-items: center;
        font-size: 12px; font-weight: 700;
        background: var(--tone); color: var(--ay-bg);
      }
      .card[data-tone='grey'] .idx { color: var(--ay-surface); }
      .meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
      .t { font-size: 13.5px; font-weight: 650; color: var(--ay-ink); line-height: 1.35; }
      .c { font-size: 11px; color: var(--ay-text-3); }

      .chips { display: flex; flex-wrap: wrap; gap: 5px; }
      .chip {
        font-size: 11px; line-height: 1.45;
        padding: 3px 8px; border-radius: 999px;
        border: 1px solid var(--ay-line); color: var(--ay-text-2);
      }
      .chip.is-sub { border-color: var(--tone); color: var(--ay-ink); }
      .chip.more { color: var(--ay-text-3); }

      .hint { text-align: center; font-size: 11.5px; color: var(--ay-text-3); }
      .none { color: var(--ay-text-3); font-size: 14px; padding: 40px 0; text-align: center; }
    `,
  ],
})
export class KnowledgeMindmapComponent {
  @Input() set markdown(value: string) {
    const parsed = parseSections(value || '');
    this.title = parsed.title;
    this.sections = parsed.sections;
  }

  title = 'Knowledge map';
  sections: MapSection[] = [];
  expanded: number | null = null;

  tone(i: number): string {
    return TONES[i % TONES.length];
  }

  toggle(i: number): void {
    this.expanded = this.expanded === i ? null : i;
  }

  items(sec: MapSection): string[] {
    return [...sec.subsections, ...sec.bullets.slice(0, 4)];
  }

  visibleItems(sec: MapSection, i: number): string[] {
    const all = this.items(sec);
    return this.expanded === i ? all : all.slice(0, 3);
  }

  trim(item: string): string {
    return item.length > 55 ? `${item.slice(0, 55)}…` : item;
  }

  get conceptCount(): number {
    return this.sections.reduce((n, s) => n + s.subsections.length + s.bullets.length, 0);
  }
}

/** Build the map from the markdown's heading/bullet structure. */
function parseSections(md: string): { title: string; sections: MapSection[] } {
  let title = 'Knowledge map';
  const sections: MapSection[] = [];
  let current: MapSection | null = null;

  for (const raw of md.split('\n')) {
    const line = raw.trim();
    const clean = (s: string) => s.replace(/\*\*/g, '').trim();

    if (line.startsWith('# ')) {
      title = clean(line.slice(2));
    } else if (line.startsWith('## ')) {
      if (current) sections.push(current);
      current = { title: clean(line.slice(3)), subsections: [], bullets: [] };
    } else if (line.startsWith('### ') && current) {
      current.subsections.push(clean(line.slice(4)));
    } else if ((line.startsWith('- ') || line.startsWith('* ')) && current) {
      // Drop markdown links so timestamp anchors do not leak into the map.
      const bullet = clean(line.slice(2)).replace(/\[.*?\]\(.*?\)/g, '').trim();
      if (bullet.length > 2 && bullet.length < 100) current.bullets.push(bullet);
    }
  }
  if (current) sections.push(current);
  return { title, sections };
}
