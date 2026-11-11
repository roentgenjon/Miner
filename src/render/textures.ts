import { createRng } from '../game/rng';
import { Block } from '../game/types';
import { SPRITE_SIZE as S, type Sprite, ALL_SPRITES } from './sprites';

type Tex = HTMLCanvasElement;

function make(w = S, h = S): { c: Tex; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas 2D nicht verfügbar');
  g.imageSmoothingEnabled = false;
  return { c, g };
}

function fromSprite(sp: Sprite): Tex {
  const { c, g } = make();
  sp.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = sp.palette[row[x] as string];
      if (col) {
        g.fillStyle = col;
        g.fillRect(x, y, 1, 1);
      }
    }
  });
  return c;
}

function flipped(t: Tex): Tex {
  const { c, g } = make();
  g.translate(S, 0);
  g.scale(-1, 1);
  g.drawImage(t, 0, 0);
  return c;
}

/** Gesteinstextur: Grundfarbe + dunkle/helle Sprenkel. */
function stone(seed: string, base: string, dark: string, light: string, density = 0.22): Tex {
  const rng = createRng(seed);
  const { c, g } = make();
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const r = rng.next();
      if (r < density * 0.55) {
        g.fillStyle = dark;
        g.fillRect(x, y, 1, 1);
      } else if (r < density) {
        g.fillStyle = light;
        g.fillRect(x, y, 1, 1);
      }
    }
  }
  // Rand leicht abdunkeln für Kachel-Optik
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, S - 1, S, 1);
  g.fillRect(S - 1, 0, 1, S);
  g.fillStyle = 'rgba(255,255,255,0.07)';
  g.fillRect(0, 0, S, 1);
  g.fillRect(0, 0, 1, S);
  return c;
}

/** Erz-Overlay: kleine Klumpen mit Glanzpunkt. */
function oreBlobs(seed: string, main: string, shade: string, shine: string, count = 5): Tex {
  const rng = createRng(seed);
  const { c, g } = make();
  for (let i = 0; i < count; i++) {
    const x = rng.int(1, S - 5);
    const y = rng.int(1, S - 5);
    const w = rng.int(2, 3);
    const h = rng.int(2, 3);
    g.fillStyle = shade;
    g.fillRect(x, y + 1, w + 1, h);
    g.fillStyle = main;
    g.fillRect(x, y, w + 1, h);
    g.fillStyle = shine;
    g.fillRect(x, y, 1, 1);
  }
  return c;
}

function boulder(): Tex {
  const { c, g } = make();
  const rows = [
    '................',
    '................',
    '....bbbbbb......',
    '...bggggggb.....',
    '..bggwwggggb....',
    '..bgwggggggb.bb.',
    '.bggggggddggbgb.',
    '.bgggggddddggb..',
    '.bgggggddggggb..',
    '.bggggggggggdb..',
    '..bggddggggdb...',
    '..bbggddddbbb...',
    '...bbbbbbbb.....',
    '................',
    '................',
    '................',
  ];
  const pal: Record<string, string> = { b: '#2c2c33', g: '#7b7f8a', w: '#b9bdc8', d: '#555964' };
  rows.forEach((row, y) => {
    for (let x = 0; x < S; x++) {
      const col = pal[row[x] as string];
      if (col) {
        g.fillStyle = col;
        g.fillRect(x, y, 1, 1);
      }
    }
  });
  return c;
}

function grass(): Tex {
  const { c, g } = make();
  g.fillStyle = '#4caf3a';
  g.fillRect(0, 0, S, 3);
  g.fillStyle = '#6fd04f';
  g.fillRect(0, 0, S, 1);
  g.fillStyle = '#2f7f26';
  for (let x = 0; x < S; x += 3) g.fillRect(x, 3, 1, 1);
  return c;
}

export interface ZoneTextures {
  base: Tex[];
  back: Tex;
}

export interface Textures {
  /** Gesteinstexturen der Zone mit Nummer `index` (wird bei Bedarf erzeugt und gemerkt). */
  forZone(index: number): ZoneTextures;
  bedrock: Tex[];
  overlay: Map<number, Tex>;
  grass: Tex;
  sky: Tex;
  player: { right: Tex; left: Tex };
  bat: Tex[];
  tnt: Tex;
  crate: Tex;
  heart: Tex;
  crack: Tex[];
}

function crackTex(stage: number): Tex {
  const { c, g } = make();
  g.fillStyle = 'rgba(0,0,0,0.55)';
  const paths: [number, number][][] = [
    [[7, 3], [7, 5], [6, 7], [6, 9]],
    [[8, 6], [10, 7], [11, 9], [12, 11]],
    [[6, 8], [4, 9], [3, 11], [2, 13]],
    [[9, 9], [9, 11], [10, 13], [10, 15]],
  ];
  paths.slice(0, stage + 1).forEach((p) => p.forEach(([x, y]) => g.fillRect(x as number, y as number, 1, 1)));
  return c;
}

/* --- Farbhilfen: Hex <-> HSL, um den Farbton je Zonen-Durchlauf zu verschieben --- */
function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function shiftHue(hex: string, degrees: number): string {
  const [h, s, l] = hexToHsl(hex);
  return `hsl(${Math.round((h + degrees) % 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

const FAMILY_COLORS: [string, string, string][] = [
  ['#7a5232', '#5e3f25', '#94693f'], // Erde
  ['#4a5060', '#383d4a', '#5d6577'], // Tiefschiefer
  ['#4a3030', '#2e2020', '#6f4040'], // Magma
  ['#3f3a70', '#2c2755', '#5a52a0'], // Kristall
];
const FAMILY_BACK: [string, string, string][] = [
  ['#2e2016', '#26190f', '#34261a'],
  ['#1d2029', '#161921', '#242833'],
  ['#2a1515', '#211010', '#331b1b'],
  ['#1b1838', '#141230', '#241f48'],
];

export function createTextures(): Textures {
  const zoneCache = new Map<number, ZoneTextures>();
  const forZone = (index: number): ZoneTextures => {
    const hit = zoneCache.get(index);
    if (hit) return hit;
    const family = index % FAMILY_COLORS.length;
    const ring = Math.floor(index / FAMILY_COLORS.length);
    // Jeder Durchlauf verschiebt den Farbton um ~29°, damit 100 Zonen unterscheidbar bleiben.
    const shift = ring * 29;
    const [b, d, l] = (FAMILY_COLORS[family] as [string, string, string]).map((c) => shiftHue(c, shift)) as [string, string, string];
    const [bb, bd, bl] = (FAMILY_BACK[family] as [string, string, string]).map((c) => shiftHue(c, shift)) as [string, string, string];
    const zt: ZoneTextures = {
      base: [0, 1, 2, 3].map((i) => stone(`z${index}-${i}`, b, d, l)),
      back: stone(`z${index}-back`, bb, bd, bl, 0.16),
    };
    zoneCache.set(index, zt);
    return zt;
  };

  const overlay = new Map<number, Tex>();
  overlay.set(Block.Coal, oreBlobs('coal', '#1a1a20', '#0c0c10', '#4a4a58', 6));
  overlay.set(Block.Copper, oreBlobs('copper', '#d9803a', '#8f4f1f', '#ffc58a'));
  overlay.set(Block.Iron, oreBlobs('iron', '#cbb8a8', '#85766a', '#ffffff'));
  overlay.set(Block.Gold, oreBlobs('gold', '#f5c542', '#b8860b', '#fff3a8'));
  overlay.set(Block.Ruby, oreBlobs('ruby', '#e0334a', '#8f1a2c', '#ff9aa8'));
  overlay.set(Block.Amethyst, oreBlobs('amethyst', '#b266ff', '#6a2fb0', '#e6c8ff'));
  overlay.set(Block.Diamond, oreBlobs('diamond', '#6fe7ff', '#2c9bb5', '#ffffff'));
  overlay.set(Block.Chest, fromSprite(ALL_SPRITES.CHEST as Sprite));
  overlay.set(Block.Crate, fromSprite(ALL_SPRITES.CRATE as Sprite));
  overlay.set(Block.Boulder, boulder());
  overlay.set(Block.Heart, fromSprite(ALL_SPRITES.HEART as Sprite));

  const sky = make(S, S);
  const grad = sky.g.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, '#5aa9e6');
  grad.addColorStop(1, '#a8d8f5');
  sky.g.fillStyle = grad;
  sky.g.fillRect(0, 0, S, S);

  const player = fromSprite(ALL_SPRITES.PLAYER as Sprite);
  return {
    forZone,
    bedrock: [0, 1, 2].map((i) => stone(`bed-${i}`, '#1d1d22', '#121216', '#2e2e36', 0.3)),
    overlay,
    grass: grass(),
    sky: sky.c,
    player: { right: player, left: flipped(player) },
    bat: [fromSprite(ALL_SPRITES.BAT_A as Sprite), fromSprite(ALL_SPRITES.BAT_B as Sprite)],
    tnt: fromSprite(ALL_SPRITES.TNT as Sprite),
    crate: fromSprite(ALL_SPRITES.CRATE as Sprite),
    heart: fromSprite(ALL_SPRITES.HEART as Sprite),
    crack: [0, 1, 2, 3].map(crackTex),
  };
}

/** Ungefähre Hauptfarbe je Blocktyp für Partikel. */
export const BLOCK_COLORS: Record<number, string> = {
  [Block.Dirt]: '#7a5232',
  [Block.Slate]: '#5d6577',
  [Block.Basalt]: '#6f4040',
  [Block.CrystalRock]: '#5a52a0',
  [Block.Coal]: '#2a2a33',
  [Block.Copper]: '#d9803a',
  [Block.Iron]: '#cbb8a8',
  [Block.Gold]: '#f5c542',
  [Block.Ruby]: '#e0334a',
  [Block.Amethyst]: '#b266ff',
  [Block.Diamond]: '#6fe7ff',
  [Block.Chest]: '#9a6535',
  [Block.Crate]: '#a8723c',
  [Block.Boulder]: '#7b7f8a',
  [Block.Heart]: '#e0334a',
};
