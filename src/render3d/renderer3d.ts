import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PointLight,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { ENERGY, HEART_DEPTH, SKINS, zoneAt, type SkinDef } from '../config';
import type { GameState } from '../game/state';
import { Block, type BlockId, type Dir3, type GameEvent } from '../game/types';
import { D3, W3, getCell3 } from '../game3d/world3';
import { BLOCK_COLORS, createTextures, type Textures } from '../render/textures';
import { realStone, toRgb } from '../render/realistic';

/** Wie viele Ebenen unterhalb der Spielerebene gezeichnet werden. */
const VISIBLE_LAYERS = 9;
/** Blöcke, die von selbst leuchten (Erze). */
const GLOW: Partial<Record<number, number>> = {
  [Block.Gold]: 0x3a2a00,
  [Block.Ruby]: 0x4a0510,
  [Block.Amethyst]: 0x30104a,
  [Block.Diamond]: 0x0a3a4a,
  [Block.Heart]: 0x601020,
};

const FACING_ANGLE: Record<Dir3, number> = { zp: 0, xp: Math.PI / 2, zm: Math.PI, xm: -Math.PI / 2, dn: 0, up: 0 };

interface Debris {
  mesh: Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

/** Zeichnet die 3D-Welt mit Three.js: Würfel, Licht von der Grubenlampe, Nebel, Spielfigur, Dynamit und Partikel. */
export class Renderer3D {
  private readonly gl: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(52, 1, 0.1, 80);
  private readonly cube = new BoxGeometry(1, 1, 1);
  private readonly tex: Textures = createTextures();
  private readonly materials = new Map<string, MeshLambertMaterial>();
  private readonly meshes = new Map<string, InstancedMesh>();
  private readonly ambient = new AmbientLight(0xffffff, 1);
  private readonly sun = new DirectionalLight(0xfff0d0, 1.2);
  private readonly lamp = new PointLight(0xffc880, 40, 12, 1.4);
  private readonly fog = new FogExp2(0x000000, 0.05);
  private readonly player = new Group();
  private readonly pickPivot = new Group();
  private readonly tntMeshes: Mesh[] = [];
  private readonly debris: Debris[] = [];
  private readonly debrisGeo = new BoxGeometry(0.14, 0.14, 0.14);
  private readonly flash = new PointLight(0xff8a30, 0, 10, 1.6);
  private skinKey = '';
  private bodyMat = new MeshLambertMaterial({ color: 0x3b6ea5 });
  private helmMat = new MeshLambertMaterial({ color: 0xf5c542 });
  private builtKey = '';
  private time = 0;
  private shake = 0;
  private flashT = 0;
  /** Kamera-Drehung in Vierteln (ganzzahlig = Zielwert) und der angezeigte, weich nachlaufende Winkel. */
  yawTarget = 0;
  private yawShown = 0;
  private camPos = new Vector3();
  private lookAt = new Vector3();
  private camInit = false;
  /** Bildschirmposition der Spielfigur (CSS-Pixel) für die Tipp-Steuerung. */
  playerScreen = { x: 0, y: 0, t: 48 };
  private W = 1;
  private H = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.gl = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene.add(this.ambient, this.sun, this.lamp, this.flash, this.player);
    this.sun.position.set(-4, 8, 5);
    this.scene.fog = this.fog;
    this.buildPlayer();
    this.resize();
  }

  /** Muss aufgerufen werden, wenn sich die Fenstergröße ändert (oder die Ansicht eingeblendet wird). */
  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.W = w;
    this.H = h;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Hochformat: weiterer Blickwinkel, damit die ganze Fläche sichtbar bleibt
    this.camera.fov = w / h < 0.8 ? 62 : 50;
    this.camera.updateProjectionMatrix();
  }

  rotate(d: number): void {
    this.yawTarget += d;
  }

  /** Aktuelle Drehung 0–3 (für die Steuerung relativ zur Kamera). */
  get yaw(): number {
    return ((this.yawTarget % 4) + 4) % 4;
  }

  /* ---------- Texturen und Materialien ---------- */

  /** Block-Material je Zone und Blockart: Gesteinstextur plus Erz-Overlay in einer Textur. */
  private material(family: number, ring: number, block: BlockId, variant: number, grass: boolean): MeshLambertMaterial {
    const key = `${family}:${ring % 12}:${block}:${variant}:${grass ? 'g' : ''}`;
    const hit = this.materials.get(key);
    if (hit) return hit;
    const zt = this.tex.forZone(family, ring);
    const base = zt.base[variant % zt.base.length] as HTMLCanvasElement;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    if (!g) throw new Error('Canvas 2D nicht verfügbar');
    g.drawImage(base, 0, 0, 64, 64);
    const ov = this.tex.overlay.get(block);
    if (ov) {
      g.imageSmoothingEnabled = ov.width > 16;
      g.drawImage(ov, 0, 0, 64, 64);
    }
    if (grass) {
      g.imageSmoothingEnabled = false;
      g.drawImage(this.tex.grass, 0, 0, 64, 12);
    }
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    const m = new MeshLambertMaterial({ map: t });
    const glow = GLOW[block];
    if (glow) m.emissive = new Color(glow);
    this.materials.set(key, m);
    return m;
  }

  /* ---------- Welt ---------- */

  private rebuild(s: GameState, top: number): void {
    const d = s.d3;
    if (!d) return;
    const bottom = Math.min(HEART_DEPTH, top + VISIBLE_LAYERS);
    const groups = new Map<string, { mat: MeshLambertMaterial | MeshLambertMaterial[]; items: Matrix4[] }>();
    const m = new Matrix4();
    const solid = (x: number, y: number, z: number): boolean => {
      if (x < 0 || x >= W3 || z < 0 || z >= D3) return false; // Seitenflächen der Säule bleiben sichtbar
      if (y < top) return false; // oberhalb des Sichtfensters: nichts (die Ebene wird von oben gesehen)
      return getCell3(d.world, x, y, z) !== Block.Air;
    };
    for (let y = Math.max(1, top); y <= bottom; y++) {
      const zone = zoneAt(y);
      for (let z = 0; z < D3; z++) {
        for (let x = 0; x < W3; x++) {
          const b = getCell3(d.world, x, y, z);
          if (b === Block.Air) continue;
          // verdeckte Würfel überspringen
          if (solid(x - 1, y, z) && solid(x + 1, y, z) && solid(x, y - 1, z) && solid(x, y + 1, z) && solid(x, y, z - 1) && solid(x, y, z + 1)) continue;
          const variant = Math.abs((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) % 4;
          const grass = y === 1 && b === Block.Dirt;
          const side = b === Block.Bedrock ? this.bedrockMaterial(variant) : this.material(zone.family, zone.ring, b, variant, grass);
          // Erdoberfläche: Gras nur oben
          const mat = grass ? [side, side, this.grassTop(variant), side, side, side] : side;
          const key = Array.isArray(mat) ? `g${mat[2]?.id}:${side.id}` : `${mat.id}`;
          let g = groups.get(key);
          if (!g) {
            g = { mat, items: [] };
            groups.set(key, g);
          }
          m.makeTranslation(x - (W3 - 1) / 2, -y, z - (D3 - 1) / 2);
          g.items.push(m.clone());
        }
      }
    }
    // Instanzen aktualisieren (Netze wiederverwenden)
    const used = new Set<string>();
    for (const [key, g] of groups) {
      used.add(key);
      let mesh = this.meshes.get(key);
      if (!mesh || mesh.instanceMatrix.count < g.items.length) {
        if (mesh) {
          this.scene.remove(mesh);
          mesh.dispose();
        }
        mesh = new InstancedMesh(this.cube, g.mat, Math.max(64, g.items.length * 2));
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        this.meshes.set(key, mesh);
      }
      g.items.forEach((mm, i) => mesh.setMatrixAt(i, mm));
      mesh.count = g.items.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const [key, mesh] of this.meshes) if (!used.has(key)) mesh.count = 0;
  }

  private grassCache: MeshLambertMaterial[] = [];
  private grassTop(variant: number): MeshLambertMaterial {
    let m = this.grassCache[variant];
    if (!m) {
      const c = realStone({ seed: `gras-${variant}`, base: [74, 148, 52], dark: [46, 104, 36], light: [112, 184, 72], style: 'dirt' });
      const t = new CanvasTexture(c);
      t.colorSpace = SRGBColorSpace;
      m = new MeshLambertMaterial({ map: t });
      this.grassCache[variant] = m;
    }
    return m;
  }

  private bedrockCache: MeshLambertMaterial[] = [];
  private bedrockMaterial(variant: number): MeshLambertMaterial {
    let m = this.bedrockCache[variant];
    if (!m) {
      const t = new CanvasTexture(this.tex.bedrock[variant % this.tex.bedrock.length] as HTMLCanvasElement);
      t.colorSpace = SRGBColorSpace;
      m = new MeshLambertMaterial({ map: t });
      this.bedrockCache[variant] = m;
    }
    return m;
  }

  /* ---------- Spielfigur ---------- */

  private buildPlayer(): void {
    const box = (w: number, h: number, d: number, mat: MeshLambertMaterial | MeshBasicMaterial, x: number, y: number, z: number): Mesh => {
      const mesh = new Mesh(new BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      return mesh;
    };
    const skin = new MeshLambertMaterial({ color: 0xe8b890 });
    const legs = new MeshLambertMaterial({ color: 0x3a3a4a });
    const boots = new MeshLambertMaterial({ color: 0x4a2f1a });
    this.player.add(
      box(0.16, 0.34, 0.2, legs, -0.12, 0.17, 0),
      box(0.16, 0.34, 0.2, legs, 0.12, 0.17, 0),
      box(0.18, 0.1, 0.26, boots, -0.12, 0.05, 0.03),
      box(0.18, 0.1, 0.26, boots, 0.12, 0.05, 0.03),
      box(0.46, 0.42, 0.28, this.bodyMat, 0, 0.55, 0),
      box(0.3, 0.3, 0.3, skin, 0, 0.92, 0),
      box(0.36, 0.14, 0.36, this.helmMat, 0, 1.1, 0),
      box(0.1, 0.08, 0.1, new MeshBasicMaterial({ color: 0xfff2b0 }), 0, 1.12, 0.2),
    );
    // Spitzhacke
    const handle = box(0.06, 0.06, 0.5, new MeshLambertMaterial({ color: 0x6b4a2a }), 0, 0, 0.25);
    const head = box(0.34, 0.07, 0.07, new MeshLambertMaterial({ color: 0xb8bcc8 }), 0, 0, 0.5);
    this.pickPivot.add(handle, head);
    this.pickPivot.position.set(0.3, 0.62, 0.05);
    this.player.add(this.pickPivot);
  }

  private applySkin(id: string): void {
    if (this.skinKey === id) return;
    this.skinKey = id;
    const skin = SKINS.find((k) => k.id === id) ?? (SKINS[0] as SkinDef);
    const body = skin.palette.b ?? '#3b6ea5';
    const helm = skin.palette.y ?? '#f5c542';
    const [r, g, b] = toRgb(body.startsWith('#') ? body : '#3b6ea5');
    const [hr, hg, hb] = toRgb(helm.startsWith('#') ? helm : '#f5c542');
    this.bodyMat.color.setRGB(r / 255, g / 255, b / 255);
    this.helmMat.color.setRGB(hr / 255, hg / 255, hb / 255);
  }

  /* ---------- Ereignisse (Partikel, Wackeln) ---------- */

  private spawnDebris(x: number, y: number, z: number, color: string, n: number, speed: number): void {
    const [r, g, b] = toRgb(color.startsWith('#') ? color : '#7a5232');
    for (let i = 0; i < n; i++) {
      if (this.debris.length > 260) break;
      const mesh = new Mesh(this.debrisGeo, new MeshBasicMaterial({ color: new Color(r / 255, g / 255, b / 255).multiplyScalar(0.7 + Math.random() * 0.5) }));
      mesh.position.set(x - (W3 - 1) / 2, -y, z - (D3 - 1) / 2);
      this.scene.add(mesh);
      const a = Math.random() * Math.PI * 2;
      const v = (0.4 + Math.random()) * speed;
      this.debris.push({ mesh, vx: Math.cos(a) * v, vy: 1 + Math.random() * speed, vz: Math.sin(a) * v, life: 0.5 + Math.random() * 0.5 });
    }
  }

  handleEvents(events: readonly GameEvent[]): void {
    let digs = 0;
    let booms = 0;
    for (const e of events) {
      if (e.type === 'dig' && digs++ < 10) this.spawnDebris(e.x, e.y, e.z ?? 0, BLOCK_COLORS[e.block] ?? '#7a5232', 6, 2.2);
      else if (e.type === 'explosion' && booms++ < 3) {
        this.spawnDebris(e.x, e.y, e.z ?? 0, '#ff9a30', 14, 5);
        this.spawnDebris(e.x, e.y, e.z ?? 0, '#555555', 8, 3);
        this.shake = Math.max(this.shake, 0.5 + e.radius * 0.12);
        this.flashT = 0.35;
        this.flash.position.set(e.x - (W3 - 1) / 2, -e.y + 0.5, (e.z ?? 0) - (D3 - 1) / 2);
      } else if (e.type === 'hurt') this.shake = Math.max(this.shake, 0.35);
      else if (e.type === 'land') this.shake = Math.max(this.shake, 0.12);
    }
  }

  /* ---------- Bild ---------- */

  draw(s: GameState, alpha: number, dt: number): void {
    const d = s.d3;
    if (!d) return;
    this.time += dt;
    const p = s.player;

    // Spielerposition mit Weiche Bewegung
    let t = 1;
    const a = d.action;
    if (a && a.kind !== 'dig' && a.dur > 0) t = 1 - Math.max(0, a.left - alpha * (1 / 60)) / a.dur;
    t = Math.max(0, Math.min(1, t));
    const vx = p.px + (p.x - p.px) * t;
    const vy = p.py + (p.y - p.py) * t;
    const vz = d.pz + (d.z - d.pz) * t;
    const px = vx - (W3 - 1) / 2;
    const py = -vy;
    const pz = vz - (D3 - 1) / 2;

    // Blöcke bei Änderungen neu aufbauen (nur bei Änderung der Welt oder der Ebene)
    const top = Math.max(1, Math.floor(vy));
    const key = `${d.world.version}:${top}:${s.seed}`;
    if (key !== this.builtKey) {
      this.builtKey = key;
      this.rebuild(s, top);
    }

    // Figur
    this.applySkin(s.skin);
    this.player.position.set(px, py - 0.5, pz);
    this.player.rotation.y += (FACING_ANGLE[d.facing] - this.player.rotation.y) * Math.min(1, dt * 14);
    const digging = a?.kind === 'dig';
    this.pickPivot.rotation.x = digging ? -0.9 + Math.sin(this.time * 18) * 0.9 : -0.3;
    this.player.position.y += a?.kind === 'move' ? Math.abs(Math.sin(this.time * 24)) * 0.05 : 0;

    // Kamera: schräg von oben, drehbar in 90°-Schritten
    this.yawShown += (this.yawTarget - this.yawShown) * Math.min(1, dt * 7);
    const ang = this.yawShown * (Math.PI / 2);
    const dist = this.W / this.H < 0.8 ? 11 : 9;
    const pitch = 0.95;
    const target = new Vector3(px, py - 0.3, pz);
    const want = new Vector3(target.x + Math.sin(ang) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(ang) * Math.cos(pitch) * dist);
    if (!this.camInit) {
      this.camPos.copy(want);
      this.lookAt.copy(target);
      this.camInit = true;
    }
    const k = Math.min(1, dt * 9);
    this.camPos.lerp(want, k);
    this.lookAt.lerp(target, k);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * 0.12;
    this.camera.position.set(this.camPos.x + (Math.random() - 0.5) * sh, this.camPos.y + (Math.random() - 0.5) * sh, this.camPos.z + (Math.random() - 0.5) * sh);
    this.camera.lookAt(this.lookAt);

    // Licht und Nebel nach Tiefe/Zone
    const zone = zoneAt(Math.max(0, Math.floor(vy)));
    const fade = Math.min(1, Math.max(0, (vy - 1) / 8));
    const dark = zone.darkness * fade;
    const f = p.maxEnergy > 0 ? p.energy / p.maxEnergy : 0;
    let r = ENERGY.lightMin + (ENERGY.lightMax - ENERGY.lightMin) * Math.sqrt(f) + s.mods.lightBonus * Math.sqrt(f);
    if (f < 0.2) r *= 0.9 + Math.sin(this.time * 17) * 0.06;
    r *= 1 + Math.sin(this.time * 11) * 0.02;
    this.ambient.intensity = 0.14 + 0.85 * (1 - dark) * (1 - fade * 0.8) + 0.06;
    this.sun.intensity = 1.2 * (1 - fade);
    this.lamp.position.set(px, py + 0.9, pz);
    this.lamp.distance = Math.max(4, r * 1.6);
    this.lamp.intensity = 6 + r * 2.4;
    const sky = new Color(0x6fb4ea).lerp(new Color(0x05040a), fade);
    this.scene.background = sky;
    this.fog.color.copy(sky);
    this.fog.density = 0.02 + 0.05 * fade;

    // Dynamit
    while (this.tntMeshes.length < s.tnts.length) {
      const m = new Mesh(this.cube, new MeshLambertMaterial({ color: 0xc83a2a, emissive: new Color(0x300800) }));
      m.scale.setScalar(0.5);
      this.scene.add(m);
      this.tntMeshes.push(m);
    }
    this.tntMeshes.forEach((m, i) => {
      const tn = s.tnts[i];
      m.visible = tn !== undefined;
      if (!tn) return;
      m.position.set(tn.x - (W3 - 1) / 2, -tn.y - 0.25, (tn.z ?? 0) - (D3 - 1) / 2);
      const blink = Math.floor(tn.fuse * 8) % 2 === 0;
      const mat = m.material as MeshLambertMaterial;
      mat.color.setHex(tn.kind === 'crate' ? 0xa8723c : 0xc83a2a);
      mat.emissive.setHex(blink ? 0x808080 : 0x200400);
      m.scale.setScalar(blink ? 0.56 : 0.5);
    });

    // Partikel
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const q = this.debris[i] as Debris;
      q.life -= dt;
      q.vy -= 9 * dt;
      q.mesh.position.x += q.vx * dt;
      q.mesh.position.y += q.vy * dt;
      q.mesh.position.z += q.vz * dt;
      q.mesh.scale.setScalar(Math.max(0.1, q.life * 1.6));
      if (q.life <= 0) {
        this.scene.remove(q.mesh);
        (q.mesh.material as MeshBasicMaterial).dispose();
        this.debris.splice(i, 1);
      }
    }
    this.flashT = Math.max(0, this.flashT - dt);
    this.flash.intensity = this.flashT * 260;

    // Bildschirmposition der Figur für die Tipp-Steuerung
    const sp = new Vector3(px, py - 0.2, pz).project(this.camera);
    this.playerScreen = { x: (sp.x * 0.5 + 0.5) * this.W, y: (-sp.y * 0.5 + 0.5) * this.H, t: 48 };

    this.gl.render(this.scene, this.camera);
  }

  /** Rundenende: alle Partikel entfernen. */
  clear(): void {
    for (const q of this.debris) this.scene.remove(q.mesh);
    this.debris.length = 0;
    this.builtKey = '';
    this.camInit = false;
    this.yawTarget = 0;
    this.yawShown = 0;
    this.shake = 0;
    this.flashT = 0;
  }
}
