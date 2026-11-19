/**
 * Boxed In — LocalStorage Persistence for Settings & Local Career Statistics
 * 100% local, zero backend, zero accounts.
 */

import {
  COLORS,
  COLOR_MAP,
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  ensureDistinctColors,
  getDefaultSingleClickPlacement,
} from './config.js';

function getSafeStorage(storageOverride = null) {
  if (storageOverride) return storageOverride;
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Ignore storage access errors (e.g. private browsing restrictions)
  }
  return null;
}

function createEmptyByColor() {
  const byColor = {};
  for (const c of COLORS) {
    byColor[c.id] = { played: 0, won: 0 };
  }
  return byColor;
}

export function createEmptyStats() {
  return {
    version: 1,
    gamesPlayed: 0,
    gamesWon: 0,
    gamesLost: 0,
    gamesDrawn: 0,
    byColor: createEmptyByColor(),
    fastestVictory: null, // { ms, size, mode, winnerColor, recordedAt }
    largestMargin: null, // { margin, winnerScore, loserScore, size, mode, winnerColor, recordedAt }
  };
}

/**
 * Load user settings with defaults and distinct-color validation.
 */
export function loadSettings(storageOverride = null) {
  const store = getSafeStorage(storageOverride);
  let parsed = {};
  if (store) {
    try {
      const raw = store.getItem(STORAGE_KEYS.settings);
      if (raw) parsed = JSON.parse(raw) || {};
    } catch {
      parsed = {};
    }
  }

  const merged = {
    mode: parsed.mode === 'pvp' ? 'pvp' : DEFAULT_SETTINGS.mode,
    boardSize: [2, 3, 4].includes(Number(parsed.boardSize))
      ? Number(parsed.boardSize)
      : DEFAULT_SETTINGS.boardSize,
    aiDifficulty: ['easy', 'medium', 'hard'].includes(parsed.aiDifficulty)
      ? parsed.aiDifficulty
      : DEFAULT_SETTINGS.aiDifficulty,
    p1Color: COLOR_MAP[parsed.p1Color] ? parsed.p1Color : DEFAULT_SETTINGS.p1Color,
    p2Color: COLOR_MAP[parsed.p2Color] ? parsed.p2Color : DEFAULT_SETTINGS.p2Color,
    singleClickPlacement:
      typeof parsed.singleClickPlacement === 'boolean'
        ? parsed.singleClickPlacement
        : getDefaultSingleClickPlacement(),
    soundEnabled:
      typeof parsed.soundEnabled === 'boolean'
        ? parsed.soundEnabled
        : DEFAULT_SETTINGS.soundEnabled,
  };

  const distinct = ensureDistinctColors(merged.p1Color, merged.p2Color);
  merged.p1Color = distinct.p1Color;
  merged.p2Color = distinct.p2Color;
  return merged;
}

/**
 * Merge and save updated settings to LocalStorage.
 */
export function saveSettings(partial, storageOverride = null) {
  const current = loadSettings(storageOverride);
  const next = { ...current, ...partial };
  if (next.boardSize !== undefined) {
    next.boardSize = [2, 3, 4].includes(Number(next.boardSize))
      ? Number(next.boardSize)
      : current.boardSize;
  }
  const distinct = ensureDistinctColors(next.p1Color, next.p2Color);
  next.p1Color = distinct.p1Color;
  next.p2Color = distinct.p2Color;

  const store = getSafeStorage(storageOverride);
  if (store) {
    try {
      store.setItem(STORAGE_KEYS.settings, JSON.stringify(next));
    } catch {
      // Ignore quota errors
    }
  }
  return next;
}

/**
 * Load local career statistics.
 */
export function loadStats(storageOverride = null) {
  const base = createEmptyStats();
  const store = getSafeStorage(storageOverride);
  if (!store) return base;

  try {
    const raw = store.getItem(STORAGE_KEYS.stats);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return base;

    base.gamesPlayed = Math.max(0, Number(parsed.gamesPlayed) || 0);
    base.gamesWon = Math.max(0, Number(parsed.gamesWon) || 0);
    base.gamesLost = Math.max(0, Number(parsed.gamesLost) || 0);
    base.gamesDrawn = Math.max(0, Number(parsed.gamesDrawn) || 0);

    if (parsed.byColor && typeof parsed.byColor === 'object') {
      for (const c of COLORS) {
        const row = parsed.byColor[c.id];
        if (row && typeof row === 'object') {
          base.byColor[c.id] = {
            played: Math.max(0, Number(row.played) || 0),
            won: Math.max(0, Number(row.won) || 0),
          };
        }
      }
    }

    if (parsed.fastestVictory && typeof parsed.fastestVictory === 'object') {
      base.fastestVictory = parsed.fastestVictory;
    }
    if (parsed.largestMargin && typeof parsed.largestMargin === 'object') {
      base.largestMargin = parsed.largestMargin;
    }
  } catch {
    return createEmptyStats();
  }

  return base;
}

function writeStats(stats, storageOverride = null) {
  const store = getSafeStorage(storageOverride);
  if (store) {
    try {
      store.setItem(STORAGE_KEYS.stats, JSON.stringify(stats));
    } catch {
      // Ignore quota errors
    }
  }
  return stats;
}

/**
 * Record the result of a completed match into LocalStorage statistics.
 * Note on win metrics:
 * - Overall Games Played / Games Won / Win Percentage tracks Player 1 wins across games
 *   so Win Percentage === (Games Won / Games Played) * 100 always holds cleanly.
 * - Color stats track Player 1's color in PvC, and both human players' colors in PvP.
 * - Fastest Victory & Largest Margin track decisive victories (Player 1 vs AI in PvC,
 *   or winning player in PvP).
 */
export function recordGameResult(summary, config, storageOverride = null) {
  const stats = loadStats(storageOverride);
  if (!summary || !config) return stats;

  const p1 = config.players[0];
  const p2 = config.players[1];
  const isPvC = summary.mode === 'pvc';

  stats.gamesPlayed += 1;

  if (summary.isDraw) {
    stats.gamesDrawn += 1;
  } else if (summary.winnerIndex === 0) {
    stats.gamesWon += 1;
  } else {
    stats.gamesLost += 1;
  }

  // Update per-color win rate tracking
  if (p1 && stats.byColor[p1.colorId]) {
    stats.byColor[p1.colorId].played += 1;
    if (!summary.isDraw && summary.winnerIndex === 0) {
      stats.byColor[p1.colorId].won += 1;
    }
  }
  if (!isPvC && p2 && stats.byColor[p2.colorId]) {
    stats.byColor[p2.colorId].played += 1;
    if (!summary.isDraw && summary.winnerIndex === 1) {
      stats.byColor[p2.colorId].won += 1;
    }
  }

  // Track Fastest Victory & Largest Margin of Victory for human/player wins
  const humanWon = !summary.isDraw && (isPvC ? summary.winnerIndex === 0 : summary.winnerIndex >= 0);
  if (humanWon && summary.winner) {
    const durationMs = Math.max(100, Number(summary.durationMs) || 0);
    if (!stats.fastestVictory || durationMs < stats.fastestVictory.ms) {
      stats.fastestVictory = {
        ms: durationMs,
        size: summary.boardSize,
        mode: summary.mode,
        winnerColor: summary.winner.colorId,
        recordedAt: Date.now(),
      };
    }

    if (
      summary.margin > 0 &&
      (!stats.largestMargin || summary.margin > stats.largestMargin.margin)
    ) {
      stats.largestMargin = {
        margin: summary.margin,
        winnerScore: summary.winnerScore,
        loserScore: summary.loserScore,
        size: summary.boardSize,
        mode: summary.mode,
        winnerColor: summary.winner.colorId,
        recordedAt: Date.now(),
      };
    }
  }

  return writeStats(stats, storageOverride);
}

export function resetStats(storageOverride = null) {
  const empty = createEmptyStats();
  return writeStats(empty, storageOverride);
}

/**
 * Derive presentation-ready stats metrics.
 */
export function getComputedStats(stats) {
  const winPercentage =
    stats.gamesPlayed > 0 ? (stats.gamesWon / stats.gamesPlayed) * 100 : 0;

  let bestColor = null;
  const colorRows = COLORS.map((c) => {
    const entry = stats.byColor[c.id] || { played: 0, won: 0 };
    const winPct = entry.played > 0 ? (entry.won / entry.played) * 100 : 0;
    const row = {
      color: c,
      played: entry.played,
      won: entry.won,
      winPct,
    };

    if (
      entry.played > 0 &&
      (!bestColor ||
        winPct > bestColor.winPct + 1e-6 ||
        (Math.abs(winPct - bestColor.winPct) <= 1e-6 && entry.won > bestColor.won))
    ) {
      bestColor = row;
    }
    return row;
  });

  return {
    gamesPlayed: stats.gamesPlayed,
    gamesWon: stats.gamesWon,
    gamesLost: stats.gamesLost,
    gamesDrawn: stats.gamesDrawn,
    winPercentage,
    bestColor,
    colorRows,
    fastestVictory: stats.fastestVictory,
    largestMargin: stats.largestMargin,
  };
}
