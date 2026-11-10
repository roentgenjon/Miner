import { MAX_FRAME, STEP } from './config';

/**
 * Fester Zeitschritt: unabhängig von der Bildwiederholrate (60/120/144 Hz)
 * läuft die Spiellogik in identischen STEP-Schritten.
 */
export class FixedStepper {
  private acc = 0;

  constructor(
    private readonly step: number = STEP,
    private readonly maxFrame: number = MAX_FRAME,
  ) {}

  /** Verarbeitet eine Frame-Zeit (Sekunden) und liefert den Interpolationsfaktor 0..1. */
  advance(frameDt: number, update: (dt: number) => void): number {
    this.acc += Math.min(Math.max(frameDt, 0), this.maxFrame);
    // kleine Toleranz gegen Gleitkommafehler (z. B. 7 x 1/120 s ≈ 1/60 s * 3.5)
    while (this.acc >= this.step - 1e-9) {
      update(this.step);
      this.acc -= this.step;
    }
    if (this.acc < 0) this.acc = 0;
    return this.acc / this.step;
  }

  reset(): void {
    this.acc = 0;
  }
}
