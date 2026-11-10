import { describe, expect, it } from 'vitest';
import { STEP } from '../src/config';
import { step } from '../src/game/game';
import { FixedStepper } from '../src/loop';
import { blankGame } from './helpers';

function simulate(hz: number, seconds: number): { ticks: number; y: number; energy: number } {
  const s = blankGame();
  s.input.held = 'down';
  const stepper = new FixedStepper();
  const frames = Math.round(seconds * hz);
  let ticks = 0;
  for (let i = 0; i < frames; i++) {
    stepper.advance(1 / hz, (dt) => {
      step(s, dt);
      ticks++;
    });
  }
  return { ticks, y: s.player.y, energy: s.player.energy };
}

describe('Fester Zeitschritt', () => {
  it('führt bei 60 Hz und 120 Hz gleich viele Logikschritte aus', () => {
    const a = simulate(60, 5);
    const b = simulate(120, 5);
    const c = simulate(144, 5);
    expect(Math.abs(a.ticks - b.ticks)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.ticks - c.ticks)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.y - c.y)).toBeLessThanOrEqual(1);
  });

  it('begrenzt extrem lange Frames', () => {
    const st = new FixedStepper();
    let n = 0;
    st.advance(10, () => n++);
    expect(n).toBeLessThanOrEqual(Math.ceil(0.25 / STEP));
  });
});
