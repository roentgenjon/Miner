import { Block, type GameEvent } from '../game/types';

type Wave = OscillatorType;

/** Synthetisierte Soundeffekte per WebAudio (keine Audiodateien nötig). */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private last = new Map<string, number>();
  public enabled = true;

  /** Muss aus einer Nutzergeste heraus aufgerufen werden (Autoplay-Regeln). */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private ready(): boolean {
    return this.enabled && this.ctx !== null && this.master !== null && this.ctx.state === 'running';
  }

  private tone(freq: number, dur: number, type: Wave = 'square', vol = 0.2, slideTo?: number, delay = 0): void {
    if (!this.ready() || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol = 0.2, from = 3000, to = 300, delay = 0): void {
    if (!this.ready() || !this.ctx || !this.master || !this.noiseBuf) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private throttle(key: string, ms: number): boolean {
    const now = performance.now();
    if (now - (this.last.get(key) ?? -1e9) < ms) return false;
    this.last.set(key, now);
    return true;
  }

  play(e: GameEvent): void {
    if (!this.ready()) return;
    switch (e.type) {
      case 'dig':
        if (!this.throttle('dig', 40)) return;
        if (e.block === Block.Dirt) this.noise(0.08, 0.18, 1800, 300);
        else this.noise(0.09, 0.2, 3500, 600), this.tone(180, 0.05, 'square', 0.05);
        break;
      case 'ore': {
        const base = 520 * Math.pow(1.06, Math.min(12, Math.round((e.mult - 1) * 4)));
        this.tone(base, 0.09, 'square', 0.12);
        this.tone(base * 1.5, 0.16, 'square', 0.12, undefined, 0.07);
        break;
      }
      case 'coal':
        this.tone(330, 0.08, 'triangle', 0.18);
        this.tone(440, 0.12, 'triangle', 0.18, undefined, 0.06);
        break;
      case 'chest':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.14, 'square', 0.12, undefined, i * 0.07));
        break;
      case 'tntPlace':
        this.tone(900, 0.04, 'square', 0.1);
        this.tone(600, 0.06, 'square', 0.1, undefined, 0.05);
        break;
      case 'explosion':
        if (!this.throttle('boom', 60)) return;
        this.noise(0.7, 0.55, 2400, 80);
        this.tone(110, 0.5, 'sawtooth', 0.3, 30);
        break;
      case 'hurt':
        this.tone(300, 0.25, 'sawtooth', 0.22, 80);
        break;
      case 'heal':
        this.tone(660, 0.12, 'triangle', 0.2);
        this.tone(990, 0.2, 'triangle', 0.2, undefined, 0.1);
        break;
      case 'revive':
        [392, 523, 659, 880].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.2, undefined, i * 0.09));
        break;
      case 'land':
        if (e.fall > 1) this.noise(0.1, 0.25, 700, 120);
        break;
      case 'rockFall':
        if (this.throttle('rockFall', 120)) this.noise(0.25, 0.2, 500, 120);
        break;
      case 'rockLand':
        this.noise(0.14, 0.3, 600, 80);
        break;
      case 'lavaDrip':
        if (this.throttle('lava', 200)) this.noise(0.12, 0.08, 6000, 2500);
        break;
      case 'lava':
        this.noise(0.3, 0.3, 5000, 800);
        break;
      case 'batHit':
        this.tone(1400, 0.1, 'square', 0.1, 800);
        break;
      case 'batDie':
        this.tone(900, 0.12, 'square', 0.12, 200);
        break;
      case 'zone':
        [262, 330, 392].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.18, undefined, i * 0.1));
        break;
      case 'mission':
        [523, 659, 784].forEach((f, i) => this.tone(f, 0.2, 'square', 0.12, undefined, i * 0.09));
        break;
      case 'win':
        [392, 523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 'square', 0.14, undefined, i * 0.13));
        break;
      case 'death':
        [330, 262, 196, 130].forEach((f, i) => this.tone(f, 0.3, 'sawtooth', 0.2, undefined, i * 0.18));
        break;
      case 'blocked':
        if (this.throttle('blocked', 200)) this.tone(120, 0.06, 'square', 0.08);
        break;
    }
  }

  ui(kind: 'click' | 'buy' | 'deny' | 'achievement'): void {
    if (!this.ready()) return;
    if (kind === 'click') this.tone(700, 0.05, 'square', 0.08);
    else if (kind === 'buy') [659, 880].forEach((f, i) => this.tone(f, 0.12, 'square', 0.12, undefined, i * 0.08));
    else if (kind === 'deny') this.tone(160, 0.15, 'square', 0.12);
    else [523, 784, 1047].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.18, undefined, i * 0.1));
  }
}
