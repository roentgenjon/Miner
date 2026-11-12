import type { Dir } from '../game/types';
import type { Input } from '../game/state';

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

  setTarget(input: Input | null): void {
    this.target = input;
    this.releaseAll();
  }

  private releaseAll(): void {
    this.keys = [];
    this.padDir = null;
    this.pointerDir = null;
    this.pointerId = null;
    this.sync();
  }

  private press(dir: Dir): void {
    if (!this.enabled || !this.target) return;
    this.target.queued = dir;
    this.target.queuedAge = 0;
    this.sync();
  }

  private sync(): void {
    if (!this.target) return;
    this.target.held = this.enabled ? (this.padDir ?? this.pointerDir ?? this.keys[this.keys.length - 1] ?? null) : null;
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
