import { ENERGY, HEART_DEPTH, STEP, WIDTH, ZONES, zoneAt } from '../config';
import type { GameState } from '../game/state';
import { Block, type GameEvent } from '../game/types';
import { getCell } from '../game/world';
import { BLOCK_COLORS, createTextures, type Textures } from './textures';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  gravity: number;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
}

interface Flash {
  x: number;
  y: number;
  radius: number;
  life: number;
}

const ORE_LIGHT: Record<number, number> = {
  [Block.Amethyst]: 1.5,
  [Block.Diamond]: 1.7,
  [Block.Ruby]: 1.2,
  [Block.Gold]: 0.9,
  [Block.Lava]: 2.0,
  [Block.LavaSource]: 1.6,
};

/** Zeichnet den Spielzustand auf ein Canvas. Verändert den Zustand nie. */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly dark: HTMLCanvasElement;
  private readonly dctx: CanvasRenderingContext2D;
  private tex: Textures;
  private T = 48;
  private W = 0;
  private H = 0;
  private offX = 0;
  private rows = 12;
  private camY = 0;
  private camInit = false;
  private shake = 0;
  private hurtFlash = 0;
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private flashes: Flash[] = [];
  private time = 0;
  /** Bildschirmposition des Spielers (Gerätepixel), für Tipp-Steuerung. */
  public playerScreen = { x: 0, y: 0, t: 48 };

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D nicht verfügbar');
    this.ctx = ctx;
    this.dark = document.createElement('canvas');
    const d = this.dark.getContext('2d');
    if (!d) throw new Error('Canvas 2D nicht verfügbar');
    this.dctx = d;
    this.tex = createTextures();
    this.resize();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cw = window.innerWidth;
    const ch = window.innerHeight;
    this.canvas.width = Math.floor(cw * dpr);
    this.canvas.height = Math.floor(ch * dpr);
    this.canvas.style.width = `${cw}px`;
    this.canvas.style.height = `${ch}px`;
    this.W = this.canvas.width;
    this.H = this.canvas.height;
    this.T = Math.max(16, Math.floor(Math.min(this.W / WIDTH, this.H / 9)));
    this.offX = Math.floor((this.W - this.T * WIDTH) / 2);
    this.rows = Math.ceil(this.H / this.T) + 2;
    this.dark.width = Math.ceil(this.W / 2);
    this.dark.height = Math.ceil(this.H / 2);
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Reagiert auf Spielereignisse mit Partikeln, Schwung und Zahlen. */
  handleEvents(events: readonly GameEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'dig':
          this.burst(e.x + 0.5, e.y + 0.5, BLOCK_COLORS[e.block] ?? '#7a5232', 7, 3);
          break;
        case 'ore':
          this.burst(e.x + 0.5, e.y + 0.5, BLOCK_COLORS[e.block] ?? '#fff', 10, 4);
          this.floaters.push({ x: e.x + 0.5, y: e.y, text: `+${e.value}${e.mult > 1 ? ` ×${e.mult.toFixed(2).replace(/\.?0+$/, '')}` : ''}`, color: '#ffd23a', life: 1.1 });
          break;
        case 'coal':
          this.floaters.push({ x: e.x + 0.5, y: e.y, text: `+${e.energy} ⚡`, color: '#9be0ff', life: 1 });
          break;
        case 'chest':
          this.burst(e.x + 0.5, e.y + 0.5, '#f5c542', 16, 5);
          this.floaters.push({ x: e.x + 0.5, y: e.y - 0.2, text: e.text, color: '#fff3a8', life: 1.6 });
          break;
        case 'explosion':
          this.shake = Math.max(this.shake, 0.5 + e.radius * 0.15);
          this.flashes.push({ x: e.x + 0.5, y: e.y + 0.5, radius: e.radius + 1.5, life: 0.35 });
          for (let i = 0; i < 26; i++) {
            this.burst(e.x + 0.5, e.y + 0.5, i % 3 === 0 ? '#ffd23a' : i % 3 === 1 ? '#ff7a1a' : '#555', 1, 6, e.radius);
          }
          break;
        case 'hurt':
          this.hurtFlash = 0.45;
          this.shake = Math.max(this.shake, 0.35);
          break;
        case 'rockLand':
          this.shake = Math.max(this.shake, 0.15);
          this.burst(e.x + 0.5, e.y + 1, '#7b7f8a', 6, 2);
          break;
        case 'lavaDrip':
          this.burst(e.x + 0.5, e.y, '#ff8a1f', 2, 1);
          break;
        case 'batDie':
          this.burst(e.x + 0.5, e.y + 0.5, '#6a4a8c', 10, 3);
          break;
        case 'land':
          if (e.fall > 2) this.burst(e.x + 0.5, e.y + 1, '#b9a58a', 6, 2);
          break;
        case 'win':
          for (let i = 0; i < 6; i++) this.burst(WIDTH / 2, HEART_DEPTH, i % 2 ? '#ffd23a' : '#e0334a', 12, 6, 3);
          break;
        default:
          break;
      }
    }
  }

  private burst(x: number, y: number, color: string, n: number, speed: number, spread = 0.3): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.4 + Math.random()) * speed * 0.5;
      this.particles.push({
        x: x + (Math.random() - 0.5) * spread,
        y: y + (Math.random() - 0.5) * spread,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 1,
        life: 0.4 + Math.random() * 0.5,
        max: 0.9,
        color,
        size: 0.06 + Math.random() * 0.08,
        gravity: 7,
      });
    }
    if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);
  }

  private visualPos(s: GameState, alpha: number): { x: number; y: number; swing: number } {
    const p = s.player;
    const a = p.action;
    if (!a) return { x: p.x, y: p.y, swing: 0 };
    const remaining = Math.max(0, a.left - alpha * STEP);
    const prog = Math.min(1, Math.max(0, 1 - remaining / a.dur));
    if (a.kind === 'move' || a.kind === 'fall') {
      return { x: p.px + (p.x - p.px) * prog, y: p.py + (p.y - p.py) * prog, swing: 0 };
    }
    return { x: p.x, y: p.y, swing: prog };
  }

  draw(s: GameState, alpha: number, dt: number): void {
    this.time += dt;
    const ctx = this.ctx;
    const T = this.T;
    const vis = this.visualPos(s, alpha);

    // Kamera folgt weich (bildratenunabhängig)
    const target = vis.y - this.rows * 0.36;
    if (!this.camInit) {
      this.camY = target;
      this.camInit = true;
    } else {
      this.camY += (target - this.camY) * (1 - Math.exp(-dt * 9));
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake * T * 0.25 : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake * T * 0.25 : 0;

    const offY = -Math.round(this.camY * T) + Math.round(sy);
    const offX = this.offX + Math.round(sx);
    const toX = (x: number): number => offX + Math.round(x * T);
    const toY = (y: number): number => offY + Math.round(y * T);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0908';
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.imageSmoothingEnabled = false;

    const y0 = Math.floor(this.camY) - 1;
    const y1 = y0 + this.rows + 2;
    const gutter = Math.ceil(this.offX / T) + 1;

    // Himmel oberhalb der Oberfläche
    const groundY = toY(1);
    if (groundY > 0) {
      const g = ctx.createLinearGradient(0, 0, 0, groundY);
      g.addColorStop(0, '#4a97d8');
      g.addColorStop(1, '#b9e0f7');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.W, Math.min(this.H, groundY));
    }

    // Zellen
    for (let y = Math.max(1, y0); y <= y1; y++) {
      const zone = zoneAt(y);
      const variants = this.tex.base[zone.id];
      for (let x = -gutter; x < WIDTH + gutter; x++) {
        const px = toX(x);
        const py = toY(y);
        const inShaft = x >= 0 && x < WIDTH;
        const cell = inShaft ? getCell(s.world, x, y) : Block.Bedrock;
        const h = (x * 73856093) ^ (y * 19349663);
        if (!inShaft) {
          const t = variants[Math.abs(h) % variants.length];
          if (t) ctx.drawImage(t, px, py, T, T);
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          ctx.fillRect(px, py, T, T);
        } else if (cell === Block.Air) {
          ctx.drawImage(this.tex.back[zone.id], px, py, T, T);
        } else if (cell === Block.Bedrock) {
          const t = this.tex.bedrock[Math.abs(h) % this.tex.bedrock.length];
          if (t) ctx.drawImage(t, px, py, T, T);
        } else if (cell === Block.Lava) {
          const t = this.tex.lava[Math.floor(this.time * 4 + x + y) % this.tex.lava.length];
          if (t) ctx.drawImage(t, px, py, T, T);
        } else {
          const t = variants[Math.abs(h) % variants.length];
          if (t) ctx.drawImage(t, px, py, T, T);
          const ov = this.tex.overlay.get(cell);
          if (ov) {
            if (cell === Block.Heart) {
              const pulse = 1 + Math.sin(this.time * 5) * 0.06;
              const sz = Math.round(T * pulse);
              ctx.drawImage(ov, px - Math.round((sz - T) / 2), py - Math.round((sz - T) / 2), sz, sz);
            } else {
              ctx.drawImage(ov, px, py, T, T);
            }
          }
        }
        if (y === 1 && (cell === Block.Dirt || !inShaft)) ctx.drawImage(this.tex.grass, px, py, T, T);
      }
    }

    // Tiefenmarken (Zonen, Herz) und Rekordlinie
    this.drawMarks(s, toX, toY);

    // Abbau-Risse
    const pl = s.player;
    if (pl.action && pl.action.kind === 'dig') {
      const prog = 1 - Math.max(0, pl.action.left) / pl.action.dur;
      const stage = Math.min(3, Math.floor(prog * 4));
      const c = this.tex.crack[stage];
      if (c) ctx.drawImage(c, toX(pl.action.tx), toY(pl.action.ty), T, T);
    }

    // Wackelndes Geröll
    for (const [key, t] of s.wobble) {
      const wx = key % s.world.width;
      const wy = Math.floor(key / s.world.width);
      if (wy < y0 || wy > y1) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(toX(wx) + Math.round(Math.sin(t * 60) * T * 0.04), toY(wy), T, T);
    }

    // Fallendes Geröll
    const rock = this.tex.overlay.get(Block.Boulder);
    for (const r of s.rocks) {
      if (rock) ctx.drawImage(rock, toX(r.x), toY(r.y + r.t / 0.07), T, T);
    }

    // Lavatropfen
    ctx.fillStyle = '#ffb030';
    for (const d of s.drops) {
      ctx.fillRect(toX(d.x + 0.4), toY(d.y + d.t / 0.06 + 0.2), Math.round(T * 0.2), Math.round(T * 0.3));
    }

    // Dynamit
    for (const t of s.tnts) {
      const blink = Math.floor(t.fuse * 8) % 2 === 0;
      const tex = t.kind === 'crate' ? this.tex.crate : this.tex.tnt;
      const wob = t.kind === 'crate' ? (blink ? 1.0 : 1.06) : 1;
      const sz = Math.round(T * wob);
      ctx.drawImage(tex, toX(t.x) - Math.round((sz - T) / 2), toY(t.y) - Math.round((sz - T) / 2), sz, sz);
      if (blink) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(toX(t.x), toY(t.y), T, T);
      }
    }

    // Fledermäuse
    for (const b of s.bats) {
      const frame = this.tex.bat[b.awake ? Math.floor(this.time * 10) % 2 : 1];
      if (frame) ctx.drawImage(frame, toX(b.x), toY(b.y + (b.awake ? Math.sin(this.time * 9 + b.id) * 0.06 : 0)), T, T);
    }

    // Spieler
    const visible = !(pl.invuln > 0 && Math.floor(this.time * 14) % 2 === 0) && s.status !== 'dead';
    const ppx = toX(vis.x);
    const ppy = toY(vis.y);
    this.playerScreen = { x: ppx + T / 2, y: ppy + T / 2, t: T };
    if (visible) {
      const sprite = pl.facing === 'left' ? this.tex.player.left : this.tex.player.right;
      const bob = pl.action?.kind === 'move' ? Math.abs(Math.sin(this.time * 30)) * T * 0.04 : 0;
      ctx.drawImage(sprite, ppx, ppy - Math.round(bob), T, T);
      if (pl.action?.kind === 'dig') this.drawPick(ppx, ppy, pl.action.dir, vis.swing);
    }

    // Partikel
    this.updateParticles(dt);
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
      ctx.fillStyle = p.color;
      const sz = Math.max(2, Math.round(p.size * T));
      ctx.fillRect(toX(p.x), toY(p.y), sz, sz);
    }
    ctx.globalAlpha = 1;

    this.drawDarkness(s, vis, toX, toY, y0, y1);

    // Schwebende Texte (über der Dunkelheit)
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.round(T * 0.3)}px ui-monospace, Menlo, Consolas, monospace`;
    for (const f of this.floaters) {
      ctx.globalAlpha = Math.min(1, f.life * 1.5);
      ctx.fillStyle = '#000';
      ctx.fillText(f.text, toX(f.x) + 2, toY(f.y - (1.1 - f.life) * 0.9) + 2);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, toX(f.x), toY(f.y - (1.1 - f.life) * 0.9));
    }
    ctx.globalAlpha = 1;

    if (this.hurtFlash > 0) {
      ctx.fillStyle = `rgba(220,30,30,${this.hurtFlash * 0.5})`;
      ctx.fillRect(0, 0, this.W, this.H);
    }
  }

  private drawPick(px: number, py: number, dir: 'left' | 'right' | 'down' | 'up', swing: number): void {
    const ctx = this.ctx;
    const T = this.T;
    const cx = px + T / 2;
    const cy = py + T / 2;
    const base = dir === 'left' ? Math.PI : dir === 'down' ? Math.PI / 2 : dir === 'up' ? -Math.PI / 2 : 0;
    const ang = base + Math.sin(swing * Math.PI * 4) * 0.7 * (dir === 'left' ? -1 : 1);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.fillStyle = '#8a5a2b';
    ctx.fillRect(T * 0.1, -T * 0.04, T * 0.4, T * 0.08);
    ctx.fillStyle = '#c9ced6';
    ctx.fillRect(T * 0.46, -T * 0.16, T * 0.07, T * 0.32);
    ctx.restore();
  }

  private drawMarks(s: GameState, toX: (x: number) => number, toY: (y: number) => number): void {
    const ctx = this.ctx;
    const T = this.T;
    const left = toX(0);
    const width = T * WIDTH;
    ctx.font = `bold ${Math.round(T * 0.22)}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = 'left';
    for (const z of ZONES.slice(1)) {
      const y = toY(z.from);
      if (y < -T || y > this.H + T) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(left, y - 1, width, 2);
      ctx.fillText(`${z.name.toUpperCase()} · ${z.from} m`, left + 6, y + Math.round(T * 0.26));
    }
    if (s.record > 0 && s.record < HEART_DEPTH) {
      const y = toY(s.record);
      if (y > -T && y < this.H + T) {
        ctx.fillStyle = '#ffd23a';
        for (let x = 0; x < width; x += T * 0.4) ctx.fillRect(left + x, y - 1, T * 0.22, 3);
        ctx.textAlign = 'right';
        ctx.fillText(`REKORD ${s.record} m`, left + width - 6, y - Math.round(T * 0.1));
        ctx.textAlign = 'left';
      }
    }
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const f of this.floaters) f.life -= dt;
    this.floaters = this.floaters.filter((f) => f.life > 0);
    for (const f of this.flashes) f.life -= dt;
    this.flashes = this.flashes.filter((f) => f.life > 0);
  }

  private drawDarkness(
    s: GameState,
    vis: { x: number; y: number },
    toX: (x: number) => number,
    toY: (y: number) => number,
    y0: number,
    y1: number,
  ): void {
    const T = this.T;
    const zone = zoneAt(Math.max(0, Math.floor(vis.y)));
    // Oberfläche hell, nach unten zunehmend dunkel
    const fade = Math.min(1, Math.max(0, (vis.y - 1) / 10));
    const ambient = zone.darkness * fade;
    if (ambient <= 0.01) return;

    const d = this.dctx;
    const k = 0.5;
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, this.dark.width, this.dark.height);
    d.fillStyle = `rgba(3,2,9,${ambient})`;
    d.fillRect(0, 0, this.dark.width, this.dark.height);
    d.globalCompositeOperation = 'destination-out';

    const light = (cx: number, cy: number, r: number, strength = 1): void => {
      const rr = r * T * k;
      if (rr <= 1) return;
      const g = d.createRadialGradient(cx * k, cy * k, 0, cx * k, cy * k, rr);
      g.addColorStop(0, `rgba(0,0,0,${strength})`);
      g.addColorStop(0.55, `rgba(0,0,0,${strength * 0.8})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      d.fillStyle = g;
      d.fillRect(cx * k - rr, cy * k - rr, rr * 2, rr * 2);
    };

    // Lampe des Spielers
    const p = s.player;
    const f = p.maxEnergy > 0 ? p.energy / p.maxEnergy : 0;
    let r = ENERGY.lightMin + (ENERGY.lightMax - ENERGY.lightMin) * Math.sqrt(f) + s.mods.lightBonus * Math.sqrt(f);
    if (f < 0.2) r *= 0.9 + Math.sin(this.time * 17) * 0.06 + Math.sin(this.time * 5.3) * 0.04;
    const face = p.facing === 'left' ? -0.18 : 0.18;
    light(toX(vis.x + 0.5 + face), toY(vis.y + 0.5), r);

    // Leuchtende Blöcke im Bild
    for (let y = Math.max(1, y0); y <= y1; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const lr = ORE_LIGHT[getCell(s.world, x, y)];
        if (lr) light(toX(x + 0.5), toY(y + 0.5), lr, 0.9);
      }
    }
    for (const t of s.tnts) light(toX(t.x + 0.5), toY(t.y + 0.5), 1.8 + Math.sin(this.time * 30) * 0.2);
    for (const dr of s.drops) light(toX(dr.x + 0.5), toY(dr.y + dr.t / 0.06 + 0.5), 1.0);
    for (const fl of this.flashes) light(toX(fl.x), toY(fl.y), fl.radius * 1.8, Math.min(1, fl.life * 4));
    d.globalCompositeOperation = 'source-over';

    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(this.dark, 0, 0, this.W, this.H);
    this.ctx.imageSmoothingEnabled = false;

    // Warmer Schein um die Lampe
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    const cx = toX(vis.x + 0.5);
    const cy = toY(vis.y + 0.5);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * T);
    g.addColorStop(0, 'rgba(255,200,110,0.16)');
    g.addColorStop(1, 'rgba(255,200,110,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r * T, cy - r * T, r * T * 2, r * T * 2);
    ctx.globalCompositeOperation = 'source-over';
  }
}
