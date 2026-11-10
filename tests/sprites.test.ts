import { describe, expect, it } from 'vitest';
import { ALL_SPRITES, SPRITE_SIZE } from '../src/render/sprites';

describe('Sprites', () => {
  for (const [name, sprite] of Object.entries(ALL_SPRITES)) {
    it(`${name} ist 16x16 und nutzt nur Paletten-Zeichen`, () => {
      expect(sprite.rows).toHaveLength(SPRITE_SIZE);
      for (const row of sprite.rows) {
        expect(row).toHaveLength(SPRITE_SIZE);
        for (const ch of row) {
          if (ch !== '.') expect(sprite.palette[ch], `${name}: Zeichen ${ch}`).toBeDefined();
        }
      }
    });
  }
});
