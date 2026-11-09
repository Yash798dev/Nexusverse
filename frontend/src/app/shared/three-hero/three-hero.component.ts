import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  Inject,
  Input,
  NgZone,
  OnDestroy,
  PLATFORM_ID,
  ViewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/**
 * "Content Stream" — an infinite corridor of 9:16 video panels rushing past the
 * camera through black fog, over a receding grid floor/ceiling, with bloom on the
 * yellow accents. Panels recycle behind the camera so the tunnel never ends.
 *
 * Panel faces are drawn procedurally to a 2D canvas (play glyph, progress bar,
 * text bars) rather than shipping image assets — keeps the bundle free of media
 * and lets every panel be a slightly different variation.
 *
 * The render loop runs outside Angular's zone: a 60fps rAF inside the zone would
 * trigger 60fps of change detection across the whole app for a purely decorative
 * background.
 */
@Component({
  selector: 'app-three-hero',
  standalone: true,
  template: `<canvas #canvas class="three-hero-canvas"></canvas>`,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      .three-hero-canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
    `,
  ],
})
export class ThreeHeroComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  /** Number of panels in the corridor. Lower it where the scene is secondary. */
  @Input() panelCount = 34;
  @Input() interactive = true;
  /** Bloom strength — the glow around yellow accents. 0 disables postprocessing. */
  @Input() bloom = 0.85;

  private renderer?: THREE.WebGLRenderer;
  private composer?: EffectComposer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private panels: THREE.Group[] = [];
  private motes?: THREE.Points;
  private frameId = 0;
  private resizeObserver?: ResizeObserver;
  private targetX = 0;
  private targetY = 0;
  private disposables: { dispose(): void }[] = [];

  private readonly YELLOW = '#ffd60a';
  private readonly DEPTH = 90; // corridor length before a panel recycles
  private isBrowser: boolean;

  constructor(private zone: NgZone, @Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngAfterViewInit(): void {
    // No WebGL / window / rAF during SSR — the server renders a bare <canvas>
    // and the scene only comes alive after hydration in the browser.
    if (!this.isBrowser) return;
    this.zone.runOutsideAngular(() => this.init());
  }

  ngOnDestroy(): void {
    if (!this.isBrowser) return;
    cancelAnimationFrame(this.frameId);
    this.resizeObserver?.disconnect();
    this.disposables.forEach((d) => d.dispose());
    this.composer?.dispose();
    this.renderer?.dispose();
  }

  @HostListener('window:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    if (!this.interactive) return;
    this.targetX = (event.clientX / window.innerWidth) * 2 - 1;
    this.targetY = (event.clientY / window.innerHeight) * 2 - 1;
  }

  private init(): void {
    const canvas = this.canvasRef.nativeElement;
    const parent = canvas.parentElement!;

    this.scene = new THREE.Scene();
    // Exponential fog is what sells the "infinite tunnel": panels fade into pure
    // black well before they'd pop out of the far clipping plane.
    this.scene.fog = new THREE.FogExp2(0x0a0a0a, 0.022);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 200);
    this.camera.position.set(0, 0, 12);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.buildCorridor();
    this.buildGrids();
    this.buildMotes();

    this.resize(parent);
    this.resizeObserver = new ResizeObserver(() => this.resize(parent));
    this.resizeObserver.observe(parent);

    const clock = new THREE.Clock();
    const animate = () => {
      this.frameId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const dt = Math.min(clock.getDelta(), 0.05); // clamp: tab-switch shouldn't teleport panels

      this.panels.forEach((panel) => {
        panel.position.z += panel.userData['speed'] * dt;
        // Recycle past-camera panels to the far end — the corridor is really 34
        // panels on a loop, not an endless spawn.
        if (panel.position.z > 16) {
          panel.position.z -= this.DEPTH;
          this.placeOnRing(panel);
        }
        panel.rotation.y = panel.userData['baseRotY'] + Math.sin(t * 0.4 + panel.userData['phase']) * 0.12;
        panel.position.y = panel.userData['baseY'] + Math.sin(t * 0.6 + panel.userData['phase']) * 0.25;
      });

      if (this.motes) this.motes.rotation.z = t * 0.015;

      if (this.camera) {
        // Mouse parallax + a slow autonomous sway, eased rather than snapped.
        const tx = this.targetX * 2.2 + Math.sin(t * 0.13) * 0.6;
        const ty = -this.targetY * 1.4 + Math.cos(t * 0.11) * 0.4;
        this.camera.position.x += (tx - this.camera.position.x) * 0.035;
        this.camera.position.y += (ty - this.camera.position.y) * 0.035;
        this.camera.rotation.z = this.camera.position.x * -0.012; // faint banking roll
        this.camera.lookAt(this.camera.position.x * 0.35, this.camera.position.y * 0.35, -30);
      }

      if (this.composer) this.composer.render();
      else this.renderer!.render(this.scene!, this.camera!);
    };
    animate();
  }

  /** Scatter a panel around the tunnel wall, avoiding the centre where text sits. */
  private placeOnRing(panel: THREE.Group): void {
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = side * (5.5 + Math.random() * 9);
    const y = (Math.random() - 0.5) * 11;
    panel.position.x = x;
    panel.userData['baseY'] = y;
    panel.position.y = y;
    // Panels angle inward toward the camera axis, like screens lining a hallway.
    panel.userData['baseRotY'] = -side * (0.25 + Math.random() * 0.35);
    panel.rotation.y = panel.userData['baseRotY'];
  }

  private buildCorridor(): void {
    for (let i = 0; i < this.panelCount; i++) {
      const isAccent = i % 6 === 0; // sparse yellow "featured" panels
      const group = new THREE.Group();

      const w = 2.6;
      const h = w * (16 / 9); // Shorts aspect — the format this product outputs

      // Glowing border: a slightly larger unlit quad behind the face.
      const borderGeo = new THREE.PlaneGeometry(w + 0.14, h + 0.14);
      const borderMat = new THREE.MeshBasicMaterial({
        color: isAccent ? this.YELLOW : 0x3a3a3a,
        transparent: true,
        opacity: isAccent ? 0.95 : 0.55,
      });
      const border = new THREE.Mesh(borderGeo, borderMat);
      border.position.z = -0.01;
      group.add(border);
      this.disposables.push(borderGeo, borderMat);

      const faceGeo = new THREE.PlaneGeometry(w, h);
      const texture = this.makePanelTexture(isAccent);
      const faceMat = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
      group.add(new THREE.Mesh(faceGeo, faceMat));
      this.disposables.push(faceGeo, faceMat, texture);

      group.position.z = -Math.random() * this.DEPTH + 10;
      group.userData['speed'] = 5.5 + Math.random() * 3.5;
      group.userData['phase'] = Math.random() * Math.PI * 2;
      this.placeOnRing(group);

      this.scene!.add(group);
      this.panels.push(group);
    }
  }

  /**
   * Draws a stylised video-card face to a canvas: play glyph, title bars and a
   * progress track. Procedural so each panel differs slightly and no image
   * assets need to ship with the bundle.
   */
  private makePanelTexture(isAccent: boolean): THREE.CanvasTexture {
    const W = 288;
    const H = 512;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;

    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, isAccent ? '#241f04' : '#17171a');
    bg.addColorStop(1, '#0d0d0f');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    // faint scanlines — reads as "screen" rather than "flat rectangle"
    g.fillStyle = 'rgba(255,255,255,0.025)';
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);

    // centre play glyph
    const cx = W / 2;
    const cy = H * 0.42;
    g.beginPath();
    g.arc(cx, cy, 40, 0, Math.PI * 2);
    g.fillStyle = isAccent ? 'rgba(255,214,10,0.22)' : 'rgba(255,255,255,0.07)';
    g.fill();
    g.beginPath();
    g.moveTo(cx - 12, cy - 18);
    g.lineTo(cx + 22, cy);
    g.lineTo(cx - 12, cy + 18);
    g.closePath();
    g.fillStyle = isAccent ? this.YELLOW : 'rgba(255,255,255,0.65)';
    g.fill();

    // title / meta bars
    const barY = H * 0.72;
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(24, barY, W - 48 - Math.random() * 60, 12);
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.fillRect(24, barY + 26, (W - 48) * (0.4 + Math.random() * 0.3), 9);

    // progress track with a partially-filled yellow bar
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(24, H - 44, W - 48, 5);
    g.fillStyle = this.YELLOW;
    g.fillRect(24, H - 44, (W - 48) * (0.25 + Math.random() * 0.6), 5);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** Receding floor + ceiling grids — the main cue for speed and depth. */
  private buildGrids(): void {
    [-9, 9].forEach((y) => {
      const grid = new THREE.GridHelper(160, 60, 0x2a2a2a, 0x1c1c1c);
      grid.position.set(0, y, -40);
      const mat = grid.material as THREE.Material | THREE.Material[];
      const mats = Array.isArray(mat) ? mat : [mat];
      mats.forEach((m) => {
        m.transparent = true;
        m.opacity = 0.5;
        this.disposables.push(m);
      });
      this.disposables.push(grid.geometry);
      this.scene!.add(grid);
    });
  }

  /** Drifting dust motes — cheap atmosphere that catches the bloom. */
  private buildMotes(): void {
    const count = 300;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 60;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 30;
      pos[i * 3 + 2] = -Math.random() * this.DEPTH;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffd60a,
      size: 0.08,
      transparent: true,
      opacity: 0.45,
    });
    this.motes = new THREE.Points(geo, mat);
    this.scene!.add(this.motes);
    this.disposables.push(geo, mat);
  }

  private resize(parent: HTMLElement): void {
    if (!this.renderer || !this.camera) return;
    const w = parent.clientWidth;
    const h = Math.max(parent.clientHeight, 1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    if (this.bloom > 0) {
      // Composer holds sized render targets, so it's rebuilt rather than resized
      // in place — resize events here are rare (window/orientation changes only).
      this.composer?.dispose();
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene!, this.camera));
      this.composer.addPass(
        new UnrealBloomPass(new THREE.Vector2(w, h), this.bloom, 0.5, 0.2)
      );
      this.composer.setSize(w, h);
    }
  }
}
