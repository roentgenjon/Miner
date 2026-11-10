/** Pixel-Sprites als ASCII-Art (16x16). '.' = transparent. Reine Daten, ohne DOM. */

export interface Sprite {
  rows: readonly string[];
  palette: Record<string, string>;
}

export const SPRITE_SIZE = 16;

export const PLAYER: Sprite = {
  palette: { y: '#f2c230', Y: '#b8860b', w: '#fffbd0', s: '#e8b48a', k: '#222034', b: '#3b6ea5', B: '#2a4f7a', p: '#5a3d28', o: '#2b1d14', g: '#9aa0a6' },
  rows: [
    '................',
    '.....yyyyyy.....',
    '....yyyyyyyyw...',
    '....YYYYYYYYww..',
    '.....ssssss.....',
    '.....skssks.....',
    '.....ssssss.....',
    '....bbbbbbbb....',
    '...bbbBbbBbbb...',
    '...sbbbbbbbbs...',
    '...sbbggggbbs...',
    '....bbbbbbbb....',
    '.....pppppp.....',
    '.....pp..pp.....',
    '.....pp..pp.....',
    '....oooo.oooo...',
  ],
};

export const BAT_A: Sprite = {
  palette: { p: '#6a4a8c', P: '#3f2a5c', r: '#ff4a4a', w: '#ffffff' },
  rows: [
    '................',
    '..p..........p..',
    '..pp........pp..',
    '..pPp......pPp..',
    '..pPPp.pp.pPPp..',
    '..pPPppppppPPp..',
    '...pPPppppPPp...',
    '....pPprrpPp....',
    '.....pppppp.....',
    '......pwwp......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
};

export const BAT_B: Sprite = {
  palette: BAT_A.palette,
  rows: [
    '................',
    '................',
    '................',
    '......p..p......',
    '......pppp......',
    '..ppp.prrp.ppp..',
    '.pPPPppppppPPPp.',
    '.pPPPPppppPPPPp.',
    '..pPPppwwppPPp..',
    '...pp..pp..pp...',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
};

export const TNT: Sprite = {
  palette: { r: '#c8372d', R: '#8f241d', w: '#e8e0c8', k: '#2a2a2a', f: '#ffb030', g: '#8a6a3a' },
  rows: [
    '.........f......',
    '........fg......',
    '.......g........',
    '..rrrrrrrrrrrr..',
    '.rRrrrrrrrrrrRr.',
    '.rrrrrrrrrrrrrr.',
    '.wwwwwwwwwwwwww.',
    '.wkwkwkwkwkwkwk.',
    '.wwwwwwwwwwwwww.',
    '.rrrrrrrrrrrrrr.',
    '.rRrrrrrrrrrrRr.',
    '.rrrrrrrrrrrrrr.',
    '..RRRRRRRRRRRR..',
    '................',
    '................',
    '................',
  ],
};

export const CHEST: Sprite = {
  palette: { d: '#5a3518', w: '#9a6535', g: '#f5c542', k: '#2a2a2a' },
  rows: [
    '................',
    '................',
    '..dddddddddddd..',
    '.dwwwwwwwwwwwwd.',
    '.dwwwwwwwwwwwwd.',
    '.dwwwwwwwwwwwwd.',
    '.gggggggggggggg.',
    '.dwwwwgggwwwwwd.',
    '.dwwwwgkgwwwwwd.',
    '.dwwwwwwwwwwwwd.',
    '.dwwwwwwwwwwwwd.',
    '.dddddddddddddd.',
    '................',
    '................',
    '................',
    '................',
  ],
};

export const CRATE: Sprite = {
  palette: { d: '#5a3518', w: '#a8723c', r: '#d6342a', y: '#ffd23a', k: '#2a2a2a' },
  rows: [
    'dddddddddddddddd',
    'dwwwwwwwwwwwwwwd',
    'dwrwwwwwwwwwwrwd',
    'dwwrwwwwwwwwrwwd',
    'dwwwrwwyywwrwwwd',
    'dwwwwrwykywrwwwd',
    'dwwwwwrykyrwwwwd',
    'dwwwwwwrkrwwwwwd',
    'dwwwwwwrkrwwwwwd',
    'dwwwwwrwwwrwwwwd',
    'dwwwwrwwywwrwwwd',
    'dwwwrwwwwwwwrwwd',
    'dwwrwwwwwwwwwrwd',
    'dwrwwwwwwwwwwwrd',
    'dwwwwwwwwwwwwwwd',
    'dddddddddddddddd',
  ],
};

export const HEART: Sprite = {
  palette: { r: '#e0334a', R: '#9c1d33', w: '#ffb0bd' },
  rows: [
    '................',
    '................',
    '..rrrr....rrrr..',
    '.rwwrrr..rrrrrR.',
    '.rwrrrrrrrrrrrR.',
    '.rrrrrrrrrrrrrR.',
    '.rrrrrrrrrrrrrR.',
    '..rrrrrrrrrrrR..',
    '...rrrrrrrrrR...',
    '....rrrrrrrR....',
    '.....rrrrrR.....',
    '......rrrR......',
    '.......rR.......',
    '................',
    '................',
    '................',
  ],
};

export const HEART_ICON: Sprite = {
  palette: { r: '#e0334a', R: '#9c1d33', w: '#ffb0bd' },
  rows: HEART.rows,
};

export const ALL_SPRITES: Record<string, Sprite> = { PLAYER, BAT_A, BAT_B, TNT, CHEST, CRATE, HEART };
