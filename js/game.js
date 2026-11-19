/**
 * Boxed In — Core Game State Machine & Rules Engine
 * Decoupled from DOM and Three.js for clean testing and future multiplayer/tournament support.
 */

import { BOARD_SIZES, DEFAULT_SETTINGS, ensureDistinctColors, getColor } from './config.js';
import { createLattice } from './lattice.js';

export class GameEngine {
  /**
   * @param {object} [matchConfig]
   */
  constructor(matchConfig = {}) {
    this._listeners = new Map();
    this.lattice = null;
    this.edgeOwner = new Int8Array(0);
    this.cubeOwner = new Int8Array(0);
    this.cubeEdgeCount = new Uint8Array(0);
    this.scores = [0, 0];
    this.currentPlayer = 0;
    this.history = [];
    this.status = 'idle'; // 'idle' | 'playing' | 'finished'
    this.startedAt = 0;
    this.finishedAt = 0;
    this.lastMove = null;
    this.maxMultiCapture = 0;
    this.config = this._normalizeConfig(matchConfig);
    this.init(this.config, { startImmediately: false });
  }

  _normalizeConfig(cfg = {}) {
    const size = BOARD_SIZES[cfg.boardSize] ? Number(cfg.boardSize) : DEFAULT_SETTINGS.boardSize;
    const mode = cfg.mode === 'pvp' ? 'pvp' : 'pvc';
    const aiDifficulty = ['easy', 'medium', 'hard'].includes(cfg.aiDifficulty)
      ? cfg.aiDifficulty
      : DEFAULT_SETTINGS.aiDifficulty;

    const rawP1 = cfg.players?.[0]?.colorId || cfg.p1Color || DEFAULT_SETTINGS.p1Color;
    const rawP2 = cfg.players?.[1]?.colorId || cfg.p2Color || DEFAULT_SETTINGS.p2Color;
    const { p1Color, p2Color } = ensureDistinctColors(rawP1, rawP2);

    const p1 = {
      index: 0,
      name: cfg.players?.[0]?.name || `Player ${getColor(p1Color).name}`,
      colorId: p1Color,
      isAI: false,
    };
    const p2 = {
      index: 1,
      name: cfg.players?.[1]?.name || (mode === 'pvc' ? 'Computer' : `Player ${getColor(p2Color).name}`),
      colorId: p2Color,
      isAI: mode === 'pvc',
    };

    return {
      mode,
      boardSize: size,
      aiDifficulty,
      players: [p1, p2],
      seed: cfg.seed ?? null,
      tournamentId: cfg.tournamentId ?? null,
    };
  }

  /**
   * Subscribe to engine events ('stateChange', 'move', 'undo', 'gameOver', 'reset').
   */
  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    const set = this._listeners.get(event);
    if (set) set.delete(handler);
  }

  _emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      fn(payload, this);
    }
  }

  /**
   * Initialize or restart a match with the provided config.
   */
  init(matchConfig = {}, { startImmediately = true } = {}) {
    this.config = this._normalizeConfig({ ...this.config, ...matchConfig });
    this.lattice = createLattice(this.config.boardSize);
    this.edgeOwner = new Int8Array(this.lattice.edgeCount).fill(-1);
    this.cubeOwner = new Int8Array(this.lattice.cubeCount).fill(-1);
    this.cubeEdgeCount = new Uint8Array(this.lattice.cubeCount);
    this.scores = [0, 0];
    this.currentPlayer = 0;
    this.history = [];
    this.lastMove = null;
    this.maxMultiCapture = 0;
    this.startedAt = startImmediately ? Date.now() : 0;
    this.finishedAt = 0;
    this.status = startImmediately ? 'playing' : 'idle';

    this._emit('reset', { config: this.config, status: this.status });
    this._emit('stateChange', this.getSnapshot());
    return this;
  }

  start() {
    return this.init(this.config, { startImmediately: true });
  }

  isAITurn() {
    return (
      this.status === 'playing' &&
      Boolean(this.config.players[this.currentPlayer]?.isAI)
    );
  }

  getRemainingCubes() {
    return this.lattice.cubeCount - (this.scores[0] + this.scores[1]);
  }

  getElapsedMs(now = Date.now()) {
    if (!this.startedAt) return 0;
    const end = this.status === 'finished' && this.finishedAt ? this.finishedAt : now;
    return Math.max(0, end - this.startedAt);
  }

  getUnclaimedEdges() {
    const list = [];
    for (let i = 0; i < this.edgeOwner.length; i++) {
      if (this.edgeOwner[i] === -1) list.push(i);
    }
    return list;
  }

  /**
   * Inspect tactical impact of claiming an edge without mutating state.
   */
  analyzeEdge(edgeId) {
    if (
      edgeId === null ||
      edgeId === undefined ||
      edgeId < 0 ||
      edgeId >= this.lattice.edgeCount
    ) {
      return {
        valid: false,
        affectedCubes: [],
        completesCubes: [],
        vulnerableCubes: [],
        affectedCount: 0,
        completesCount: 0,
        vulnerableCount: 0,
      };
    }

    const valid = this.edgeOwner[edgeId] === -1;
    const edge = this.lattice.edges[edgeId];
    const affectedCubes = [];
    const completesCubes = [];
    const vulnerableCubes = [];

    for (let i = 0; i < edge.cubes.length; i++) {
      const cid = edge.cubes[i];
      if (this.cubeOwner[cid] !== -1) continue;
      affectedCubes.push(cid);
      const count = this.cubeEdgeCount[cid];
      if (count === 11) {
        completesCubes.push(cid);
      } else if (count === 10) {
        vulnerableCubes.push(cid);
      }
    }

    return {
      valid,
      affectedCubes,
      completesCubes,
      vulnerableCubes,
      affectedCount: affectedCubes.length,
      completesCount: completesCubes.length,
      vulnerableCount: vulnerableCubes.length,
    };
  }

  /**
   * Claim an edge for the current player.
   * Returns move result object (or { ok: false, reason }).
   */
  claimEdge(edgeId) {
    if (this.status !== 'playing') {
      return { ok: false, reason: 'Match is not active.' };
    }
    if (edgeId < 0 || edgeId >= this.lattice.edgeCount) {
      return { ok: false, reason: 'Edge index out of bounds.' };
    }
    if (this.edgeOwner[edgeId] !== -1) {
      return { ok: false, reason: 'Edge is already claimed.' };
    }

    const player = this.currentPlayer;
    const prevPlayer = player;
    this.edgeOwner[edgeId] = player;

    const edge = this.lattice.edges[edgeId];
    const capturedCubes = [];

    for (let i = 0; i < edge.cubes.length; i++) {
      const cid = edge.cubes[i];
      this.cubeEdgeCount[cid] += 1;
      if (this.cubeEdgeCount[cid] === 12 && this.cubeOwner[cid] === -1) {
        this.cubeOwner[cid] = player;
        this.scores[player] += 1;
        capturedCubes.push(cid);
      }
    }

    if (capturedCubes.length > this.maxMultiCapture) {
      this.maxMultiCapture = capturedCubes.length;
    }

    const remainingCubes = this.getRemainingCubes();
    const gameOver = remainingCubes === 0;
    const extraTurn = !gameOver && capturedCubes.length > 0;

    if (!gameOver && !extraTurn) {
      this.currentPlayer = player === 0 ? 1 : 0;
    }

    const moveRecord = {
      ply: this.history.length + 1,
      edgeId,
      edgeKey: edge.key,
      player,
      prevPlayer,
      nextPlayer: this.currentPlayer,
      capturedCubes,
      extraTurn,
      timestamp: Date.now(),
    };
    this.history.push(moveRecord);
    this.lastMove = moveRecord;

    if (gameOver) {
      this.status = 'finished';
      this.finishedAt = moveRecord.timestamp;
    }

    this._emit('move', moveRecord);
    this._emit('stateChange', this.getSnapshot());

    if (gameOver) {
      const summary = this.getSummary();
      this._emit('gameOver', summary);
    }

    return {
      ok: true,
      ...moveRecord,
      gameOver,
      remainingCubes,
    };
  }

  _revertSingleMove() {
    if (this.history.length === 0) return null;
    const move = this.history.pop();
    this.edgeOwner[move.edgeId] = -1;

    const edge = this.lattice.edges[move.edgeId];
    for (let i = 0; i < edge.cubes.length; i++) {
      const cid = edge.cubes[i];
      if (this.cubeEdgeCount[cid] > 0) {
        this.cubeEdgeCount[cid] -= 1;
      }
    }

    for (let i = 0; i < move.capturedCubes.length; i++) {
      const cid = move.capturedCubes[i];
      if (this.cubeOwner[cid] === move.player) {
        this.cubeOwner[cid] = -1;
        this.scores[move.player] = Math.max(0, this.scores[move.player] - 1);
      }
    }

    this.currentPlayer = move.prevPlayer;
    if (this.status === 'finished') {
      this.status = 'playing';
      this.finishedAt = 0;
    }
    this.lastMove = this.history.length > 0 ? this.history[this.history.length - 1] : null;
    return move;
  }

  /**
   * Check whether Undo is currently available.
   */
  canUndo() {
    if (this.status !== 'playing' || this.history.length === 0) return false;
    if (this.config.mode === 'pvc') {
      // Must have at least one human move in history to rewind back to human control
      return this.history.some((m) => m.player === 0);
    }
    return true;
  }

  /**
   * Undo the most recent move (in PvP) or rewind back to before the most recent
   * human move (in PvC, undoing any intervening AI chain moves cleanly).
   */
  undo() {
    if (!this.canUndo()) {
      return { ok: false, reverted: [] };
    }

    const reverted = [];
    if (this.config.mode === 'pvp') {
      const m = this._revertSingleMove();
      if (m) reverted.push(m);
    } else {
      // Rewind until we revert a human move (player === 0)
      while (this.history.length > 0) {
        const m = this._revertSingleMove();
        if (!m) break;
        reverted.push(m);
        if (m.player === 0) break;
      }
    }

    // Recompute maxMultiCapture cleanly
    this.maxMultiCapture = this.history.reduce(
      (mx, m) => Math.max(mx, m.capturedCubes.length),
      0
    );

    this._emit('undo', { reverted });
    this._emit('stateChange', this.getSnapshot());
    return { ok: reverted.length > 0, reverted };
  }

  /**
   * Compute final/current match summary metrics.
   */
  getSummary() {
    const totalCubes = this.lattice.cubeCount;
    const [s0, s1] = this.scores;
    const isDraw = s0 === s1;
    const winnerIndex = isDraw ? -1 : s0 > s1 ? 0 : 1;
    const winnerScore = Math.max(s0, s1);
    const loserScore = Math.min(s0, s1);
    const margin = Math.abs(s0 - s1);
    const boardControlPct = totalCubes > 0 ? (winnerScore / totalCubes) * 100 : 0;

    return {
      mode: this.config.mode,
      boardSize: this.config.boardSize,
      aiDifficulty: this.config.aiDifficulty,
      totalCubes,
      scores: [s0, s1],
      isDraw,
      winnerIndex,
      winner: winnerIndex >= 0 ? this.config.players[winnerIndex] : null,
      loser: winnerIndex >= 0 ? this.config.players[winnerIndex === 0 ? 1 : 0] : null,
      winnerScore,
      loserScore,
      margin,
      boardControlPct,
      durationMs: this.getElapsedMs(),
      movesCount: this.history.length,
      maxMultiCapture: this.maxMultiCapture,
    };
  }

  /**
   * Compact JSON-serializable state snapshot (future-proofing for saves/online/replays).
   */
  serialize() {
    return {
      version: 1,
      config: {
        mode: this.config.mode,
        boardSize: this.config.boardSize,
        aiDifficulty: this.config.aiDifficulty,
        p1Color: this.config.players[0].colorId,
        p2Color: this.config.players[1].colorId,
        seed: this.config.seed,
        tournamentId: this.config.tournamentId,
      },
      status: this.status,
      currentPlayer: this.currentPlayer,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      moves: this.history.map((m) => m.edgeId),
    };
  }

  getSnapshot() {
    return {
      status: this.status,
      mode: this.config.mode,
      boardSize: this.config.boardSize,
      aiDifficulty: this.config.aiDifficulty,
      players: this.config.players,
      currentPlayer: this.currentPlayer,
      scores: [...this.scores],
      totalCubes: this.lattice.cubeCount,
      remainingCubes: this.getRemainingCubes(),
      moveCount: this.history.length,
      lastMove: this.lastMove,
      canUndo: this.canUndo(),
    };
  }

  /**
   * Reconstruct an engine instance from a serialized snapshot.
   */
  static fromSnapshot(snapshot) {
    const engine = new GameEngine(snapshot.config);
    engine.init(snapshot.config, { startImmediately: snapshot.status !== 'idle' });
    if (snapshot.startedAt) engine.startedAt = snapshot.startedAt;
    if (Array.isArray(snapshot.moves)) {
      for (const edgeId of snapshot.moves) {
        engine.claimEdge(edgeId);
      }
    }
    if (snapshot.finishedAt) engine.finishedAt = snapshot.finishedAt;
    return engine;
  }
}
