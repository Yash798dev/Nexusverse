import {
  AfterViewInit,
  Component,
  ElementRef,
  Inject,
  Input,
  NgZone,
  OnDestroy,
  PLATFORM_ID,
  ViewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

type NodeKind = 'dot' | 'frame' | 'wave';

interface AgentNode {
  bx: number;
  by: number;
  x: number;
  y: number;
  phase: number;
  amp: number;
  kind: NodeKind;
  glow: number;
  glowRgb: string;
  near: number;
  links: number[];
}

interface Pulse {
  from: number;
  to: number;
  t: number;
  speed: number;
  hop: number;
}

interface Palette {
  /** Resting agents and connections — raw information. */
  data: string;
  /** Pulse colour by hop: yellow processing → yellow → pink creativity → output ink. */
  story: string[];
}

/**
 * Abstract "team of agents" backdrop. Faint grey nodes (a few drawn as tiny
 * video frames or waveform bars) are linked to their nearest neighbours; energy
 * pulses hop across the links and change colour as they travel — yellow while
 * processing, pink once they reach the creative stage, and the output colour
 * (white in dark theme, ink in light) when the work is done — lighting each agent
 * they arrive at.
 *
 * Colours are read from the theme's RGB tokens in styles.css and re-read when
 * <html data-theme> changes. Canvas 2D, drawn outside Angular's zone, paused when
 * off-screen, fewer nodes on small screens, and a single static frame under
 * prefers-reduced-motion. The cursor only nudges nearby nodes and warms them
 * slightly — no visible cursor glow.
 */
@Component({
  selector: 'app-agent-backdrop',
  standalone: true,
  template: `<canvas #canvas aria-hidden="true"></canvas>`,
  styles: [
    `
      :host {
        position: absolute;
        inset: 0;
        display: block;
        overflow: hidden;
        pointer-events: none;
        animation: agent-backdrop-in 1.2s cubic-bezier(0.22, 1, 0.36, 1) both;
      }
      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
      @keyframes agent-backdrop-in {
        from { opacity: 0; }
      }
      @media (prefers-reduced-motion: reduce) {
        :host { animation: none; }
      }
    `,
  ],
})
export class AgentBackdropComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  /** Multiplier on the default node count — lower it behind dense UI. */
  @Input() density = 1;

  private ctx?: CanvasRenderingContext2D;
  // Fallbacks only — readPalette() replaces these with the live design tokens.
  // They still need to match the current palette: a machine that fails to read
  // computed styles would otherwise render the previous product's colours.
  private palette: Palette = {
    data: '139,141,159',
    story: ['124,92,255', '124,92,255', '232,121,249', '245,246,250'],
  };
  private nodes: AgentNode[] = [];
  private edges: [number, number][] = [];
  private pulses: Pulse[] = [];
  private maxPulses = 5;
  private width = 0;
  private height = 0;
  private frameId = 0;
  private last = 0;
  private visible = true;
  private reducedMotion = false;
  private pointerX = -9999;
  private pointerY = -9999;
  private resizeObserver?: ResizeObserver;
  private intersectionObserver?: IntersectionObserver;
  private themeObserver?: MutationObserver;
  private readonly isBrowser: boolean;

  constructor(private zone: NgZone, @Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;
    this.zone.runOutsideAngular(() => this.init());
  }

  ngOnDestroy(): void {
    if (!this.isBrowser) return;
    cancelAnimationFrame(this.frameId);
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.themeObserver?.disconnect();
    window.removeEventListener('pointermove', this.onPointerMove);
  }

  private init(): void {
    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    this.ctx = ctx;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.readPalette();
    this.themeObserver = new MutationObserver(() => {
      this.readPalette();
      if (this.reducedMotion) this.draw(0);
    });
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    this.resize();
    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
      if (this.reducedMotion) this.draw(0);
    });
    this.resizeObserver.observe(canvas);

    if (this.reducedMotion) {
      this.draw(0);
      return;
    }

    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.visible) this.start();
    });
    this.intersectionObserver.observe(canvas);
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    this.start();
  }

  private readPalette(): void {
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
    // --ay-accent-rgb / --ay-magenta-rgb are the real names; the yellow/pink
    // tokens alias to them, so either resolves to the same values.
    const accent = token('--ay-accent-rgb', '124,92,255');
    const magenta = token('--ay-magenta-rgb', '232,121,249');
    const ink = token('--ay-ink-rgb', '245,246,250');
    this.palette = { data: token('--ay-data-rgb', '139,141,159'), story: [accent, accent, magenta, ink] };
  }

  private onPointerMove = (e: PointerEvent): void => {
    this.pointerX = e.clientX;
    this.pointerY = e.clientY;
  };

  private start(): void {
    if (this.frameId || this.reducedMotion) return;
    this.last = performance.now();
    this.frameId = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    if (!this.visible) {
      this.frameId = 0;
      return;
    }
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    const t = now / 1000;
    this.update(t, dt);
    this.draw(t);
    this.frameId = requestAnimationFrame(this.tick);
  };

  private resize(): void {
    const canvas = this.canvasRef.nativeElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h || !this.ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Only rebuild the graph when the size meaningfully changes (mobile URL-bar
    // show/hide fires resizes of a few pixels).
    const changed = Math.abs(w - this.width) > 40 || Math.abs(h - this.height) > 120;
    this.width = w;
    this.height = h;
    if (changed || !this.nodes.length) this.build();
  }

  private build(): void {
    const w = this.width;
    const h = this.height;
    const small = w < 640;
    const base = Math.max(10, Math.min(30, (w * Math.min(h, 1400)) / 46000));
    const count = Math.round((small ? Math.min(base, 12) : base) * this.density);
    this.maxPulses = small ? 2 : 5;

    // Jittered grid: even coverage without the regularity of an actual grid.
    const cols = Math.max(1, Math.ceil(Math.sqrt((count * w) / h)));
    const rows = Math.max(1, Math.ceil(count / cols));
    const cw = w / cols;
    const ch = h / rows;
    this.nodes = [];
    for (let i = 0; i < count; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const roll = Math.random();
      this.nodes.push({
        bx: (c + 0.5 + (Math.random() - 0.5) * 0.7) * cw,
        by: (r + 0.5 + (Math.random() - 0.5) * 0.7) * ch,
        x: 0,
        y: 0,
        phase: Math.random() * Math.PI * 2,
        amp: 5 + Math.random() * 9,
        kind: roll < 0.12 ? 'frame' : roll < 0.2 ? 'wave' : 'dot',
        glow: 0,
        glowRgb: this.palette.story[0],
        near: 0,
        links: [],
      });
    }

    // Link each node to its two nearest neighbours (within reach).
    const reach = Math.max(cw, ch) * 1.7;
    const seen = new Set<string>();
    this.edges = [];
    this.nodes.forEach((n, i) => {
      this.nodes
        .map((m, j) => ({ j, d: Math.hypot(m.bx - n.bx, m.by - n.by) }))
        .filter((o) => o.j !== i && o.d < reach)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2)
        .forEach(({ j }) => {
          const key = i < j ? `${i}-${j}` : `${j}-${i}`;
          if (seen.has(key)) return;
          seen.add(key);
          this.edges.push([i, j]);
          n.links.push(j);
          this.nodes[j].links.push(i);
        });
    });
    this.pulses = [];
    this.nodes.forEach((n) => {
      n.x = n.bx;
      n.y = n.by;
    });
  }

  private update(t: number, dt: number): void {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const px = this.pointerX - rect.left;
    const py = this.pointerY - rect.top;
    const story = this.palette.story;

    for (const n of this.nodes) {
      let x = n.bx + Math.sin(t * 0.12 + n.phase) * n.amp;
      let y = n.by + Math.cos(t * 0.1 + n.phase * 1.3) * n.amp;
      const dx = x - px;
      const dy = y - py;
      const d = Math.hypot(dx, dy);
      n.near = d < 160 ? 1 - d / 160 : 0;
      if (n.near > 0 && d > 0.001) {
        x += (dx / d) * n.near * 8;
        y += (dy / d) * n.near * 8;
      }
      n.x = x;
      n.y = y;
      n.glow = Math.max(0, n.glow - dt * 1.1);
    }

    if (this.edges.length && this.pulses.length < this.maxPulses && Math.random() < dt * 0.9) {
      const [a, b] = this.edges[Math.floor(Math.random() * this.edges.length)];
      const flip = Math.random() < 0.5;
      this.pulses.push({ from: flip ? b : a, to: flip ? a : b, t: 0, speed: 1 / (1.8 + Math.random() * 1.4), hop: 0 });
    }

    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.t += dt * p.speed;
      if (p.t < 1) continue;
      this.pulses.splice(i, 1);
      const arrived = this.nodes[p.to];
      arrived.glow = 1;
      arrived.glowRgb = story[Math.min(p.hop, story.length - 1)];
      // Hand the work on to another agent, advancing the colour story.
      if (p.hop < story.length - 1 && Math.random() < 0.75) {
        const next = arrived.links.filter((l) => l !== p.from);
        if (next.length) {
          this.pulses.push({
            from: p.to,
            to: next[Math.floor(Math.random() * next.length)],
            t: 0,
            speed: p.speed,
            hop: p.hop + 1,
          });
        }
      }
    }
  }

  private draw(t: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { data, story } = this.palette;
    ctx.clearRect(0, 0, this.width, this.height);

    // Connections: one path, one stroke.
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${data},0.075)`;
    ctx.beginPath();
    for (const [a, b] of this.edges) {
      ctx.moveTo(this.nodes[a].x, this.nodes[a].y);
      ctx.lineTo(this.nodes[b].x, this.nodes[b].y);
    }
    ctx.stroke();

    // Pulses: a short trail and a small bright head.
    for (const p of this.pulses) {
      const a = this.nodes[p.from];
      const b = this.nodes[p.to];
      const rgb = story[Math.min(p.hop, story.length - 1)];
      const hx = a.x + (b.x - a.x) * p.t;
      const hy = a.y + (b.y - a.y) * p.t;
      const tt = Math.max(0, p.t - 0.22);
      ctx.strokeStyle = `rgba(${rgb},0.32)`;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(a.x + (b.x - a.x) * tt, a.y + (b.y - a.y) * tt);
      ctx.lineTo(hx, hy);
      ctx.stroke();

      ctx.fillStyle = `rgba(${rgb},0.12)`;
      ctx.beginPath();
      ctx.arc(hx, hy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${rgb},0.95)`;
      ctx.beginPath();
      ctx.arc(hx, hy, 1.7, 0, Math.PI * 2);
      ctx.fill();
    }

    // Agents.
    for (const n of this.nodes) {
      const alpha = 0.2 + n.near * 0.3;
      const colour = `rgba(${data},${alpha})`;

      if (n.glow > 0) {
        ctx.fillStyle = `rgba(${n.glowRgb},${0.1 * n.glow})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 4 + 8 * n.glow, 0, Math.PI * 2);
        ctx.fill();
      }

      if (n.kind === 'frame') {
        ctx.strokeStyle = n.glow > 0.05 ? `rgba(${n.glowRgb},${Math.max(alpha, 0.8 * n.glow)})` : colour;
        ctx.lineWidth = 1;
        ctx.strokeRect(n.x - 3.5, n.y - 6, 7, 12);
      } else if (n.kind === 'wave') {
        ctx.fillStyle = n.glow > 0.05 ? `rgba(${n.glowRgb},${Math.max(alpha, 0.8 * n.glow)})` : colour;
        for (let k = -1; k <= 1; k++) {
          const bh = 3 + (Math.sin(t * 2.2 + n.phase + k * 1.4) + 1) * 2.5;
          ctx.fillRect(n.x + k * 3 - 0.6, n.y - bh / 2, 1.2, bh);
        }
      } else {
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
        const warm = Math.max(n.glow, n.near * 0.35);
        if (warm > 0.02) {
          ctx.fillStyle = `rgba(${n.glow > n.near * 0.35 ? n.glowRgb : story[0]},${warm})`;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 1.6 + n.glow * 0.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
}
