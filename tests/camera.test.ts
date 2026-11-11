import { describe, expect, it } from 'vitest';
import { followCamera } from '../src/render/camera';

describe('Kamera', () => {
  it('bleibt bei extremem Tempo höchstens maxLag Zeilen hinter der Figur', () => {
    let cam = 0;
    let target = 0;
    for (let i = 0; i < 300; i++) {
      target += 1136; // Felder pro Logikschritt bei maximaler Spitzhacke
      cam = followCamera(cam, target, 1 / 60, 2.5);
      expect(Math.abs(target - cam)).toBeLessThanOrEqual(2.5 + 1e-9);
    }
  });

  it('folgt bei normalem Tempo weich und ohne Sprung', () => {
    let cam = 0;
    const target = 10;
    cam = followCamera(cam, target, 1 / 60, 2.5);
    expect(cam).toBeGreaterThan(0);
    expect(cam).toBeLessThan(target);
    for (let i = 0; i < 240; i++) cam = followCamera(cam, target, 1 / 60, 2.5);
    expect(cam).toBeCloseTo(target, 3);
  });

  it('ist bildratenunabhängig (60 Hz und 144 Hz erreichen etwa denselben Stand)', () => {
    const run = (hz: number): number => {
      let cam = 0;
      for (let i = 0; i < hz * 0.2; i++) cam = followCamera(cam, 1.5, 1 / hz, 2.5);
      return cam;
    };
    expect(Math.abs(run(60) - run(144))).toBeLessThan(0.02);
  });

  it('funktioniert auch aufwärts (ohne den Abstand zu überschreiten)', () => {
    let cam = 100;
    const target = 100 - 5000;
    for (let i = 0; i < 60; i++) {
      cam = followCamera(cam, target, 1 / 60, 2.5);
      expect(Math.abs(target - cam)).toBeLessThanOrEqual(2.5 + 1e-9);
    }
    expect(cam).toBeLessThan(100);
  });
});
