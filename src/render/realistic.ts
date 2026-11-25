/**
 * Realistischere Texturen: weich verlaufendes Rauschen mit Licht-Relief (Bump-Mapping),
 * Gesteinsmaserung, Risse, Körnung sowie Erze als Kristalle/Klumpen mit Verlauf und Glanzlicht.
 * Alles wird einmal in höherer Auflösung (R × R) erzeugt und beim Zeichnen heruntergerechnet.
 */
import { createRng, type Rng } from '../game/rng';

export const R = 64;

export type Rgb = [number, number, number];

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** '#rrggbb' oder 'hsl(h s% l%)' in RGB umrechnen. */
export function toRgb(color: string): Rgb {
  if (color.startsWith('#')) return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
  const m = /hsl\((\d+)\s+(\d+)%\s+(\d+)%\)/.exec(color);
  if (m) return hslToRgb(Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100);
  return [128, 128, 128];
}

const smooth = (t: number): number => t * t * (3 - 2 * t);
const rgbStr = (c: Rgb): string => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;

/** Kachelbares Wertrauschen (am Rand umlaufend) mit `cells` × `cells` Stützstellen. */
function lattice(rng: Rng, cells: number): Float32Array {
  const a = new Float32Array(cells * cells);
  for (let i = 0; i < a.length; i++) a[i] = rng.next();
  return a;
}

function sampleLattice(a: Float32Array, cells: number, u: number, v: number): number {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const at = (i: number, j: number): number => a[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)] as number;
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bot = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bot * fy;
}

/** Fraktales Rauschen 0..1 (mehrere Oktaven), kachelbar. */
function fbm(rng: Rng, size: number, octaves: [number, number][]): Float32Array {
  const out = new Float32Array(size * size);
  let total = 0;
  for (const [cells, weight] of octaves) {
    const lat = lattice(rng, cells);
    total += weight;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) out[y * size + x] = (out[y * size + x] as number) + sampleLattice(lat, cells, x / size, y / size) * weight;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) / total;
  return out;
}

export type StoneStyle = 'dirt' | 'slate' | 'basalt' | 'crystal' | 'bedrock';

export interface StoneOptions {
  seed: string;
  base: Rgb;
  dark: Rgb;
  light: Rgb;
  style: StoneStyle;
  /** 0..1 – Stärke von Relief und Kontrast (Höhlenwand: klein). */
  relief?: number;
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function blank(): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = c.height = R;
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas 2D nicht verfügbar');
  return { c, g };
}

/** Gesteinstextur als Canvas (R × R). */
export function realStone(o: StoneOptions): HTMLCanvasElement {
  const rng = createRng(o.seed);
  const relief = o.relief ?? 1;
  const { c, g } = blank();

  const height = fbm(rng, R, [[3, 0.5], [6, 0.3], [12, 0.15], [24, 0.1]]);
  const tone = fbm(rng, R, [[2, 0.6], [5, 0.4]]);
  const grain = fbm(rng, R, [[32, 1]]);
  const img = g.createImageData(R, R);
  const d = img.data;

  // Schichtung (Schiefer)
  const bands = o.style === 'slate' ? 7 + rng.int(0, 4) : 0;
  const phase = rng.next() * 6.28;
  const h = (x: number, y: number): number => height[(((y % R) + R) % R) * R + (((x % R) + R) % R)] as number;

  for (let y = 0; y < R; y++) {
    for (let x = 0; x < R; x++) {
      const i = y * R + x;
      let t = (tone[i] as number) * 0.7 + (height[i] as number) * 0.3;
      if (bands > 0) t = t * 0.55 + (0.5 + 0.5 * Math.sin((y / R) * Math.PI * 2 * bands + phase + (height[i] as number) * 5)) * 0.45;
      const col = t < 0.5 ? mix(o.dark, o.base, t * 2) : mix(o.base, o.light, (t - 0.5) * 2);
      // Relief: Licht von links oben
      const nx = h(x + 1, y) - h(x - 1, y);
      const ny = h(x, y + 1) - h(x, y - 1);
      const shade = 1 + (-nx * 0.7 - ny * 0.9) * 6 * relief;
      const speck = ((grain[i] as number) - 0.5) * 0.22 * (o.style === 'dirt' ? 1.5 : 1);
      const k = Math.max(0.55, Math.min(1.5, shade + speck));
      d[i * 4] = Math.max(0, Math.min(255, col[0] * k));
      d[i * 4 + 1] = Math.max(0, Math.min(255, col[1] * k));
      d[i * 4 + 2] = Math.max(0, Math.min(255, col[2] * k));
      d[i * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  // Kieselsteine/Einschlüsse mit Schatten
  const pebbles = o.style === 'dirt' ? 7 : o.style === 'bedrock' ? 3 : 5;
  for (let i = 0; i < pebbles; i++) {
    const px = rng.next() * R;
    const py = rng.next() * R;
    const rx = 1.5 + rng.next() * 3.2;
    const ry = rx * (0.6 + rng.next() * 0.35);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.beginPath();
    g.ellipse(px + 1.2, py + 1.4, rx, ry, 0, 0, 6.3);
    g.fill();
    const pg = g.createRadialGradient(px - rx * 0.3, py - ry * 0.4, 0.3, px, py, rx * 1.1);
    pg.addColorStop(0, rgbStr(mix(o.light, [255, 255, 255], 0.12)));
    pg.addColorStop(1, rgbStr(mix(o.base, o.dark, 0.4)));
    g.fillStyle = pg;
    g.beginPath();
    g.ellipse(px, py, rx, ry, 0, 0, 6.3);
    g.fill();
  }

  // Risse (bei Basalt mit glühender Ader)
  const cracks = o.style === 'bedrock' ? 2 : 2 + rng.int(0, 2);
  for (let i = 0; i < cracks; i++) {
    let x = rng.next() * R;
    let y = rng.next() * R;
    let a = rng.next() * 6.28;
    const len = 8 + rng.int(0, 14);
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < len; s++) {
      a += (rng.next() - 0.5) * 1.1;
      x += Math.cos(a) * 2.2;
      y += Math.sin(a) * 2.2;
      g.lineTo(x, y);
    }
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 1.2;
    g.stroke();
    if (o.style === 'basalt') {
      g.strokeStyle = 'rgba(255,110,40,0.55)';
      g.lineWidth = 0.7;
      g.stroke();
    }
  }

  // Kristallgestein: helle Glitzerpunkte
  if (o.style === 'crystal') {
    for (let i = 0; i < 9; i++) {
      const sx = Math.floor(rng.next() * R);
      const sy = Math.floor(rng.next() * R);
      g.fillStyle = 'rgba(200,190,255,0.8)';
      g.fillRect(sx, sy, 1.4, 1.4);
      g.fillStyle = 'rgba(200,190,255,0.25)';
      g.fillRect(sx - 1, sy, 3.4, 1.4);
      g.fillRect(sx, sy - 1, 1.4, 3.4);
    }
  }
  return c;
}

/* ---------- Erze ---------- */

export interface OreLook {
  main: string;
  shade: string;
  shine: string;
}

function path(g: CanvasRenderingContext2D, pts: [number, number][]): void {
  g.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
  g.closePath();
}

/** Unregelmäßiger Klumpen (Metall, Kohle) mit Verlauf, Kante und Glanzpunkt. */
function nugget(g: CanvasRenderingContext2D, rng: Rng, cx: number, cy: number, r: number, look: OreLook, glossy: boolean): void {
  const n = 9;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.72 + rng.next() * 0.38);
    pts.push([cx + Math.cos(a) * rr * 1.15, cy + Math.sin(a) * rr * 0.9]);
  }
  const p = (i: number): [number, number] => pts[i % n] as [number, number];
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowBlur = 3;
  g.shadowOffsetX = 1;
  g.shadowOffsetY = 1.5;
  path(g, pts);
  const grad = g.createRadialGradient(cx - r * 0.4, cy - r * 0.5, r * 0.1, cx, cy, r * 1.3);
  grad.addColorStop(0, look.shine);
  grad.addColorStop(0.35, look.main);
  grad.addColorStop(1, look.shade);
  g.fillStyle = grad;
  g.fill();
  g.restore();
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 0.8;
  path(g, pts);
  g.stroke();
  // Facetten: dunkle Fläche unten rechts, helle oben links
  g.fillStyle = 'rgba(0,0,0,0.18)';
  path(g, [p(3), p(4), p(5), [cx, cy]]);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.18)';
  path(g, [p(7), p(8), p(0), [cx - r * 0.1, cy - r * 0.1]]);
  g.fill();
  // Glanzpunkt
  g.fillStyle = glossy ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.55)';
  g.beginPath();
  g.ellipse(cx - r * 0.38, cy - r * 0.42, Math.max(0.8, r * 0.18), Math.max(0.6, r * 0.11), -0.6, 0, 6.3);
  g.fill();
}

/** Kristallsäule (sechskantig, mit hellen und dunklen Flächen und Spitze). */
function crystal(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, hgt: number, tilt: number, look: OreLook, diamond: boolean): void {
  const hw = w / 2;
  const tip = -hgt;
  const shoulder = -hgt * 0.72;
  const outline: [number, number][] = [[-hw, 0], [-hw, shoulder], [0, tip], [hw, shoulder], [hw, 0]];
  g.save();
  g.translate(cx, cy);
  g.rotate(tilt);
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.5)';
  g.shadowBlur = 3;
  g.shadowOffsetY = 1.5;
  path(g, outline);
  const grad = g.createLinearGradient(-hw, 0, hw, 0);
  grad.addColorStop(0, look.shine);
  grad.addColorStop(0.45, look.main);
  grad.addColorStop(1, look.shade);
  g.fillStyle = grad;
  g.fill();
  g.restore();
  // Flächen: linke Spitzenfläche hell, rechte dunkel
  g.fillStyle = 'rgba(255,255,255,0.32)';
  path(g, [[-hw, shoulder], [0, tip], [-hw * 0.1, shoulder]]);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.28)';
  path(g, [[hw, shoulder], [0, tip], [hw * 0.1, shoulder]]);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.4)';
  g.lineWidth = 0.7;
  path(g, outline);
  g.stroke();
  // Mittelkante und Glanz
  g.strokeStyle = 'rgba(255,255,255,0.45)';
  g.beginPath();
  g.moveTo(-hw * 0.1, shoulder);
  g.lineTo(-hw * 0.1, -1);
  g.stroke();
  g.fillStyle = diamond ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)';
  g.beginPath();
  g.ellipse(-hw * 0.5, shoulder * 0.8, 0.9, Math.max(1.2, hgt * 0.16), 0, 0, 6.3);
  g.fill();
  g.restore();
}

export type OreKind = 'coal' | 'copper' | 'iron' | 'gold' | 'ruby' | 'amethyst' | 'diamond';

/** Erz als Overlay (durchsichtiger Hintergrund): Metalle als Klumpen, Edelsteine als Kristallgruppen. */
export function realOre(kind: OreKind, look: OreLook, seed: string): HTMLCanvasElement {
  const rng = createRng(`ore:${seed}`);
  const { c, g } = blank();
  if (kind === 'ruby' || kind === 'amethyst' || kind === 'diamond') {
    const spots: [number, number, number, number, number][] = [
      [20, 52, 11, 26, -0.25],
      [34, 56, 13, 32, 0.08],
      [47, 50, 10, 22, 0.32],
      [28, 42, 8, 17, -0.5],
      [41, 40, 7, 15, 0.55],
    ];
    const count = kind === 'diamond' ? 4 : 5;
    spots.slice(0, count).forEach(([x, y, w, hgt, tilt]) => crystal(g, x + (rng.next() - 0.5) * 3, y + (rng.next() - 0.5) * 3, w, hgt * (0.9 + rng.next() * 0.2), tilt, look, kind === 'diamond'));
    // funkelnde Sterne
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 3; i++) {
      const sx = 14 + rng.next() * 36;
      const sy = 12 + rng.next() * 34;
      g.fillRect(sx - 0.5, sy - 2, 1, 4);
      g.fillRect(sx - 2, sy - 0.5, 4, 1);
    }
  } else {
    const count = kind === 'coal' ? 6 : 5;
    for (let i = 0; i < count; i++) {
      const r = 4 + rng.next() * (kind === 'gold' ? 5 : 4.5);
      const cx = 10 + rng.next() * 44;
      const cy = 10 + rng.next() * 44;
      nugget(g, rng, cx, cy, r, look, kind === 'gold' || kind === 'iron');
    }
    if (kind === 'copper') {
      g.fillStyle = 'rgba(70,170,130,0.6)'; // grünliche Patina
      for (let i = 0; i < 9; i++) g.fillRect(8 + rng.next() * 48, 8 + rng.next() * 48, 1.6, 1.6);
    }
    if (kind === 'iron') {
      g.fillStyle = 'rgba(160,70,40,0.45)'; // Rost
      for (let i = 0; i < 8; i++) g.fillRect(8 + rng.next() * 48, 8 + rng.next() * 48, 2, 1.2);
    }
  }
  return c;
}

/* ---------- Kanten (Schattierung an Hohlräumen) ---------- */

export interface EdgeTextures {
  /** Schatten an einem Hohlraum-Feld, wenn die Nachbarzelle in dieser Richtung fest ist. */
  shadow: Record<'up' | 'down' | 'left' | 'right', HTMLCanvasElement>;
}

export function makeEdges(): EdgeTextures {
  const mk = (x0: number, y0: number, x1: number, y1: number, strength: number): HTMLCanvasElement => {
    const { c, g } = blank();
    const grad = g.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, `rgba(0,0,0,${strength})`);
    grad.addColorStop(0.35, `rgba(0,0,0,${strength * 0.35})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, R, R);
    return c;
  };
  return {
    shadow: {
      up: mk(0, 0, 0, R * 0.5, 0.62),
      down: mk(0, R, 0, R * 0.5, 0.42),
      left: mk(0, 0, R * 0.5, 0, 0.5),
      right: mk(R, 0, R * 0.5, 0, 0.5),
    },
  };
}

/** Weiche Scheibe (Staub, Rauch) in einer Farbe. */
export function softDisc(color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas 2D nicht verfügbar');
  const [r, gg, b] = toRgb(color);
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, `rgba(${r},${gg},${b},0.75)`);
  grad.addColorStop(0.5, `rgba(${r},${gg},${b},0.35)`);
  grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return c;
}
