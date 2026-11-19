/**
 * Boxed In — Static Configuration, Palettes, Board Presets & Constants
 * Shared by both browser runtime and headless verification tests.
 */

export const COLORS = [
  {
    id: 'blue',
    name: 'Blue',
    hex: '#3b82f6',
    glow: '#93c5fd',
    dark: '#1d4ed8',
    threeHex: 0x3b82f6,
    threeGlow: 0x93c5fd,
  },
  {
    id: 'red',
    name: 'Red',
    hex: '#ef4444',
    glow: '#fca5a5',
    dark: '#b91c1c',
    threeHex: 0xef4444,
    threeGlow: 0xfca5a5,
  },
  {
    id: 'green',
    name: 'Green',
    hex: '#22c55e',
    glow: '#86efac',
    dark: '#15803d',
    threeHex: 0x22c55e,
    threeGlow: 0x86efac,
  },
  {
    id: 'purple',
    name: 'Purple',
    hex: '#a855f7',
    glow: '#d8b4fe',
    dark: '#7e22ce',
    threeHex: 0xa855f7,
    threeGlow: 0xd8b4fe,
  },
  {
    id: 'orange',
    name: 'Orange',
    hex: '#f97316',
    glow: '#fdba74',
    dark: '#c2410c',
    threeHex: 0xf97316,
    threeGlow: 0xfdba74,
  },
  {
    id: 'cyan',
    name: 'Cyan',
    hex: '#06b6d4',
    glow: '#67e8f9',
    dark: '#0e7490',
    threeHex: 0x06b6d4,
    threeGlow: 0x67e8f9,
  },
];

export const COLOR_MAP = Object.fromEntries(COLORS.map((c) => [c.id, c]));

export const BOARD_SIZES = {
  2: {
    size: 2,
    id: 'quick',
    label: 'Quick',
    dims: '2×2×2',
    cubes: 8,
    edges: 54,
    estimate: '5 minutes',
    default: false,
  },
  3: {
    size: 3,
    id: 'standard',
    label: 'Standard',
    dims: '3×3×3',
    cubes: 27,
    edges: 144,
    estimate: '10 minutes',
    default: true,
  },
  4: {
    size: 4,
    id: 'large',
    label: 'Large',
    dims: '4×4×4',
    cubes: 64,
    edges: 300,
    estimate: '20+ minutes',
    default: false,
  },
};

export const AI_DIFFICULTIES = {
  easy: {
    id: 'easy',
    label: 'Easy',
    summary: 'Relaxed & mostly random moves.',
    thinkMs: 280,
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    summary: 'Claims available cubes & avoids obvious traps.',
    thinkMs: 360,
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    summary: 'Reads cube chains & defends board control.',
    thinkMs: 420,
  },
};

export const GAME_MODES = {
  pvc: {
    id: 'pvc',
    label: 'Player vs Computer',
    shortLabel: 'vs AI',
  },
  pvp: {
    id: 'pvp',
    label: 'Player vs Player',
    shortLabel: '2P Hotseat',
  },
};

export const STORAGE_KEYS = {
  settings: 'boxedin_stf_settings_v1',
  stats: 'boxedin_stf_stats_v1',
};

export const DEFAULT_SETTINGS = {
  mode: 'pvc',
  boardSize: 3,
  aiDifficulty: 'medium',
  p1Color: 'blue',
  p2Color: 'red',
  singleClickPlacement: false,
  soundEnabled: true,
};

/**
 * Default placement mode by input capability:
 * - Desktop (fine pointer with hover): single-click placement ON (hover already previews)
 * - Mobile / touch (coarse pointer, no hover): two-step preview & confirm ON
 * @param {object} [env]
 */
export function getDefaultSingleClickPlacement(env = globalThis) {
  try {
    const mm = env?.window?.matchMedia;
    if (typeof mm === 'function') {
      return !mm('(pointer: coarse)').matches;
    }
  } catch {
    // Ignore matchMedia errors
  }
  return DEFAULT_SETTINGS.singleClickPlacement;
}

/**
 * Resolve a valid color object by id with fallback.
 * @param {string} colorId
 * @param {string} fallbackId
 */
export function getColor(colorId, fallbackId = 'blue') {
  return COLOR_MAP[colorId] || COLOR_MAP[fallbackId] || COLORS[0];
}

/**
 * Guarantee Player 1 and Player 2 always hold valid, distinct color ids.
 * @param {string} p1Color
 * @param {string} p2Color
 * @returns {{ p1Color: string, p2Color: string }}
 */
export function ensureDistinctColors(p1Color, p2Color) {
  const c1 = COLOR_MAP[p1Color] ? p1Color : DEFAULT_SETTINGS.p1Color;
  let c2 = COLOR_MAP[p2Color] ? p2Color : DEFAULT_SETTINGS.p2Color;
  if (c1 === c2) {
    const alt = COLORS.find((c) => c.id !== c1);
    c2 = alt ? alt.id : 'red';
  }
  return { p1Color: c1, p2Color: c2 };
}
