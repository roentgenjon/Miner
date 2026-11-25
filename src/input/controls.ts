import type { Dir, Dir3 } from '../game/types';
import type { Input } from '../game/state';

/** Bildschirmrichtung → Richtung in der 3D-Welt, abhängig von der Kamera-Drehung (0–3). */
export function screenToDir3(dir: Dir, yaw: number): Dir3 {
  // Blickrichtung (Bildschirm oben) je Drehung: z−, x−, z+, x+; rechts davon: x+, z−, x−, z+
  const fwd: Dir3[] = ['zm', 'xm', 'zp', 'xp'];
  const right: Dir3[] = ['xp', 'zm', 'xm', 'zp'];
  const back: Dir3[] = ['zp', 'xp', 'zm', 'xm'];
  const left: Dir3[] = ['xm', 'zp', 'xp', 'zm'];
  const i = ((yaw % 4) + 4) % 4;
  const table = dir === 'up' ? fwd : dir === 'down' ? back : dir === 'left' ? left : right;
  return table[i] as Dir3;
}

export interface ControlHooks {
  onPause: () => void;
  /** Liefert die Bildschirmposition des Spielers in Canvas-Gerätepixeln (für Tippen). */
  playerScreen: () => { x: number; y: number };
  /** Auto-Dynamit umschalten (Taste T oder Button). */
  onToggleAuto: () => void;
  /** Erste Nutzergeste (Audio freischalten). */
  onGesture: () => void;
}

const KEY_DIRS: Record<string, Dir> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowUp: 'up',
  KeyW: 'up',
};

/** 3D: nach unten graben (F, Bild runter, Shift) bzw. nach oben klettern (R, Bild hoch). */
const KEY_DIRS3: Record<string, Dir3> = {
  KeyF: 'dn',
  PageDown: 'dn',
  ShiftLeft: 'dn',
  ShiftRight: 'dn',
  KeyR: 'up',
  PageUp: 'up',
};

/**
 * Vereinheitlicht Tastatur, Bildschirm-Buttons sowie Tippen/Wischen auf dem Canvas.
 * Schreibt in das Input-Objekt der laufenden Runde.
 */
export class Controls {
  private target: Input | null = null;
  private keys: Dir[] = [];
  private padDir: Dir | null = null;
  private pointerDir: Dir | null = null;
  private pointerId: number | null = null;
  /** 3D-Modus: Kamera-Drehung abfragen/ändern. */
  private three: { yaw: () => number; rotate: (d: number) => void } | null = null;
  private padDir3: Dir3 | null = null;
  private keys3: Dir3[] = [];
  private startX = 0;
  private startY = 0;
  public enabled = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    pad: HTMLElement,
    private readonly hooks: ControlHooks,
  ) {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => this.releaseAll());

    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    const up = (e: PointerEvent): void => this.onPointerUp(e);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    // Bildschirm-Buttons
    pad.querySelectorAll<HTMLElement>('[data-dir]').forEach((btn) => {
      const dir = btn.dataset.dir as Dir;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        this.hooks.onGesture();
        this.padDir = dir;
        this.press(dir);
        btn.classList.add('active');
      });
      const release = (): void => {
        if (this.padDir === dir) this.padDir = null;
        this.sync();
        btn.classList.remove('active');
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
    });
    // 3D-Knöpfe: nach unten graben / nach oben klettern, Kamera drehen
    pad.querySelectorAll<HTMLElement>('[data-dir3]').forEach((btn) => {
      const dir = btn.dataset.dir3 as Dir3;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        this.hooks.onGesture();
        this.padDir3 = dir;
        this.press3(dir);
        btn.classList.add('active');
      });
      const release = (): void => {
        if (this.padDir3 === dir) this.padDir3 = null;
        this.sync();
        btn.classList.remove('active');
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
    });
    pad.querySelectorAll<HTMLElement>('[data-rot]').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.hooks.onGesture();
        this.rotate(Number(btn.dataset.rot));
      });
    });
    const tntBtn = pad.querySelector<HTMLElement>('[data-action="tnt"]');
    tntBtn?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.hooks.onGesture();
      if (this.enabled && this.target) this.target.tnt = true;
    });
    pad.querySelector<HTMLElement>('[data-action="auto"]')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.hooks.onGesture();
      if (this.enabled) this.hooks.onToggleAuto();
    });
    for (const ev of ['contextmenu', 'gesturestart', 'dblclick']) {
      document.addEventListener(ev, (e) => e.preventDefault());
    }
  }

  /** 3D-Welt ein-/ausschalten: dann gelten Bildschirmrichtungen relativ zur Kamera. */
  setThreeD(h: { yaw: () => number; rotate: (d: number) => void } | null): void {
    this.three = h;
    this.releaseAll();
  }

  private rotate(d: number): void {
    if (!this.enabled || !this.three) return;
    this.three.rotate(d);
    this.sync();
  }

  setTarget(input: Input | null): void {
    this.target = input;
    this.releaseAll();
  }

  private releaseAll(): void {
    this.keys = [];
    this.keys3 = [];
    this.padDir3 = null;
    this.padDir = null;
    this.pointerDir = null;
    this.pointerId = null;
    this.sync();
  }

  private press(dir: Dir): void {
    if (!this.enabled || !this.target) return;
    if (this.three) return this.press3(screenToDir3(dir, this.three.yaw()));
    this.target.queued = dir;
    this.target.queuedAge = 0;
    this.sync();
  }

  private press3(dir: Dir3): void {
    if (!this.enabled || !this.target) return;
    this.target.queued3 = dir;
    this.target.queuedAge = 0;
    this.sync();
  }

  private sync(): void {
    if (!this.target) return;
    const flat = this.padDir ?? this.pointerDir ?? this.keys[this.keys.length - 1] ?? null;
    if (this.three) {
      this.target.held = null;
      this.target.held3 = this.enabled ? (this.padDir3 ?? this.keys3[this.keys3.length - 1] ?? (flat ? screenToDir3(flat, this.three.yaw()) : null)) : null;
      return;
    }
    this.target.held = this.enabled ? flat : null;
    this.target.held3 = null;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // In Eingabefeldern (z. B. Kontoname) darf getippt werden: keine Spieltasten abfangen.
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    this.hooks.onGesture();
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (!e.repeat) this.hooks.onPause();
      e.preventDefault();
      return;
    }
    if (!this.enabled) return;
    if (e.code === 'Space') {
      if (!e.repeat && this.target) this.target.tnt = true;
      e.preventDefault();
      return;
    }
    if (e.code === 'KeyT') {
      if (!e.repeat) this.hooks.onToggleAuto();
      e.preventDefault();
      return;
    }
    if (this.three) {
      if (e.code === 'KeyQ' || e.code === 'KeyE') {
        e.preventDefault();
        if (!e.repeat) this.rotate(e.code === 'KeyQ' ? -1 : 1);
        return;
      }
      const d3 = KEY_DIRS3[e.code];
      if (d3) {
        e.preventDefault();
        if (e.repeat) return;
        this.keys3 = this.keys3.filter((k) => k !== d3);
        this.keys3.push(d3);
        this.press3(d3);
        return;
      }
    }
    const dir = KEY_DIRS[e.code];
    if (dir) {
      e.preventDefault();
      if (e.repeat) return;
      this.keys = this.keys.filter((k) => k !== dir);
      this.keys.push(dir);
      this.press(dir);
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    const d3 = KEY_DIRS3[e.code];
    if (d3) {
      this.keys3 = this.keys3.filter((k) => k !== d3);
      this.sync();
    }
    const dir = KEY_DIRS[e.code];
    if (dir) {
      this.keys = this.keys.filter((k) => k !== dir);
      this.sync();
    }
  }

  /** Richtung aus einem Vektor: dominante Achse, Aufwärts wird ignoriert. */
  private static dirFromVector(dx: number, dy: number): Dir | null {
    if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? 'down' : 'up';
    if (dx === 0) return null;
    return dx < 0 ? 'left' : 'right';
  }

  private onPointerDown(e: PointerEvent): void {
    this.hooks.onGesture();
    if (!this.enabled || this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
    this.startX = e.clientX;
    this.startY = e.clientY;
    // Tippen: Richtung relativ zum Spieler
    const rect = this.canvas.getBoundingClientRect();
    const scale = this.canvas.width / rect.width;
    const ps = this.hooks.playerScreen();
    const dx = (e.clientX - rect.left) * scale - ps.x;
    const dy = (e.clientY - rect.top) * scale - ps.y;
    const dir = Controls.dirFromVector(dx, dy) ?? (dx < 0 ? 'left' : 'right');
    this.pointerDir = dir;
    this.press(dir);
  }

  private onPointerMove(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    if (Math.hypot(dx, dy) < 24) return;
    const dir = Controls.dirFromVector(dx, dy);
    if (dir && dir !== this.pointerDir) {
      this.pointerDir = dir;
      this.press(dir);
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.pointerDir = null;
    this.sync();
  }
}
