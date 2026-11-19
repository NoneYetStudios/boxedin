/**
 * Boxed In — Main Application Coordinator
 * Wires GameEngine, BoardRenderer, AI, AudioEngine, Storage, and UIController.
 */

import { AI_DIFFICULTIES, getColor } from './config.js';
import { GameEngine } from './game.js';
import { chooseAIMove } from './ai.js';
import {
  loadSettings,
  saveSettings,
  loadStats,
  recordGameResult,
  resetStats,
} from './storage.js';
import { AudioEngine } from './audio.js';
import { BoardRenderer } from './renderer.js';
import { UIController } from './ui.js';

class BoxedInApp {
  constructor() {
    this.settings = loadSettings();
    this.stats = loadStats();
    this.audio = new AudioEngine(this.settings.soundEnabled);
    this.engine = new GameEngine(this.settings);
    this.ui = null;
    this.renderer = null;

    this.screen = 'setup'; // 'setup' | 'playing'
    this.selectedEdgeId = -1;
    this.hoveredEdgeId = -1;
    this.aiJobToken = 0;
    this.aiTimerId = 0;
    this.timerIntervalId = 0;
    this.hasRecordedCurrentFinish = false;

    this._init();
  }

  _init() {
    this.ui = new UIController({
      onUpdateSettings: (partial) => this.updateSettings(partial),
      onToggleSound: () => this.updateSettings({ soundEnabled: !this.settings.soundEnabled }),
      onStartGame: () => this.startNewMatch(),
      onPlayAgain: () => this.startNewMatch(),
      onReturnToSetup: () => this.showSetup(),
      onUndo: () => this.undoMove(),
      onResetView: () => this.resetView(),
      onConfirmSelected: () => this.confirmSelectedEdge(),
      onCancelSelected: () => this.clearSelection(true),
      onOpenStats: () => {
        this.stats = loadStats();
        this.ui.renderStats(this.stats);
        this.ui.openModal('modalStats');
      },
      onResetStats: () => {
        this.stats = resetStats();
        this.ui.renderStats(this.stats);
      },
    });

    const canvasHost = document.getElementById('canvasHost');
    this.renderer = new BoardRenderer(canvasHost, {
      onHoverEdgeChange: (edgeId) => this._handleHoverChange(edgeId),
      onEdgeTap: (edgeId) => this._handleEdgeTap(edgeId),
      onEmptyTap: () => this.clearSelection(false),
    });

    if (!this.renderer.webglSupported) {
      this.ui.showWebGLError(
        'WebGL is required to render the 3D lattice. Please enable hardware acceleration or try a modern browser.'
      );
    }

    this._bindEngineEvents();
    this._bindKeyboard();

    this.ui.syncSettings(this.settings);
    this.showSetup();

    // Expose clean handle for inspection & future integrations
    window.BoxedIn = {
      app: this,
      engine: this.engine,
      renderer: this.renderer,
      getSettings: () => ({ ...this.settings }),
      getStats: () => loadStats(),
    };
  }

  _bindEngineEvents() {
    this.engine.on('move', (move) => {
      this.renderer.syncFromEngine(this.engine, move);
      this.ui.syncMatchState(this.engine);
      this._refreshHelpText();

      if (move.capturedCubes.length > 0) {
        this.audio.captureCube(move.capturedCubes.length);
        if (move.extraTurn && !this.engine.config.players[move.player].isAI) {
          this.ui.showExtraTurn(
            this.engine.config.players[move.player].name,
            move.capturedCubes.length
          );
        }
      } else {
        this.audio.claimEdge(this.engine.config.players[move.player].isAI);
      }
    });

    this.engine.on('undo', () => {
      this.clearSelection(false);
      this.renderer.syncFromEngine(this.engine);
      this.ui.syncMatchState(this.engine);
      this._refreshHelpText();
      this.audio.undo();
    });

    this.engine.on('gameOver', (summary) => {
      this._cancelAI();
      this._stopClock();
      this.clearSelection(false);
      this.ui.syncMatchState(this.engine);

      if (!this.hasRecordedCurrentFinish) {
        this.hasRecordedCurrentFinish = true;
        this.stats = recordGameResult(summary, this.engine.config);
      }

      if (summary.isDraw) {
        this.audio.draw();
      } else if (summary.mode === 'pvc' && summary.winnerIndex === 1) {
        this.audio.defeat();
      } else {
        this.audio.victory();
      }

      setTimeout(() => {
        if (this.screen === 'playing' && this.engine.status === 'finished') {
          this.ui.showEndGame(summary, this.engine.config);
        }
      }, 420);
    });
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      if (this.ui.hasOpenModal()) {
        if (key === 'm') {
          this.updateSettings({ soundEnabled: !this.settings.soundEnabled });
        }
        return;
      }

      if (key === 'm') {
        this.updateSettings({ soundEnabled: !this.settings.soundEnabled });
      } else if (this.screen === 'playing') {
        if (key === 'r') {
          this.resetView();
        } else if (key === 'z' || ((e.ctrlKey || e.metaKey) && key === 'z')) {
          e.preventDefault();
          this.undoMove();
        } else if (key === 'escape') {
          this.clearSelection(true);
        }
      }
    });
  }

  updateSettings(partial) {
    this.settings = saveSettings(partial);
    this.audio.setEnabled(this.settings.soundEnabled);
    this.ui.syncSettings(this.settings);

    if (this.screen === 'setup') {
      this.renderer.setPreviewMode(true, this.settings);
    } else {
      // Mid-game single-click setting update clears pending confirmation cleanly if turned on
      if (this.settings.singleClickPlacement && this.selectedEdgeId >= 0) {
        this.clearSelection(false);
      }
      this._refreshHelpText();
    }
  }

  showSetup() {
    this._cancelAI();
    this._stopClock();
    this.screen = 'setup';
    this.selectedEdgeId = -1;
    this.hoveredEdgeId = -1;
    this.ui.closeAllModals();
    this.ui.setScreen('setup');
    this.renderer.setPreviewMode(true, this.settings);
  }

  startNewMatch() {
    this._cancelAI();
    this.hasRecordedCurrentFinish = false;
    this.screen = 'playing';
    this.selectedEdgeId = -1;
    this.hoveredEdgeId = -1;

    this.ui.closeAllModals();
    this.ui.setScreen('playing');

    this.renderer.setPreviewMode(false, this.settings);
    this.engine.init(
      {
        mode: this.settings.mode,
        boardSize: this.settings.boardSize,
        aiDifficulty: this.settings.aiDifficulty,
        p1Color: this.settings.p1Color,
        p2Color: this.settings.p2Color,
      },
      { startImmediately: true }
    );

    this.renderer.buildBoard(this.engine.lattice);
    this.renderer.syncFromEngine(this.engine);
    this.ui.syncMatchState(this.engine);
    this._refreshHelpText();
    this._startClock();
    this._maybeScheduleAI();
  }

  _startClock() {
    this._stopClock();
    this.timerIntervalId = setInterval(() => {
      if (this.engine.status === 'playing') {
        this.ui.updateTimer(this.engine.getElapsedMs());
      }
    }, 500);
  }

  _stopClock() {
    if (this.timerIntervalId) {
      clearInterval(this.timerIntervalId);
      this.timerIntervalId = 0;
    }
  }

  _handleHoverChange(edgeId) {
    if (this.screen !== 'playing' || this.engine.status !== 'playing' || this.engine.isAITurn()) {
      this.hoveredEdgeId = -1;
      return;
    }
    this.hoveredEdgeId = edgeId;
    this.renderer.refreshOverlays(this.engine);
    this._refreshHelpText();
  }

  _handleEdgeTap(edgeId) {
    if (this.screen !== 'playing' || this.engine.status !== 'playing' || this.engine.isAITurn()) {
      return;
    }
    if (this.engine.edgeOwner[edgeId] !== -1) return;

    // Immediate placement when confirmation is disabled
    if (this.settings.singleClickPlacement) {
      this._executeMove(edgeId);
      return;
    }

    // Two-click confirmation mode (default)
    if (this.selectedEdgeId === edgeId) {
      this._executeMove(edgeId);
    } else {
      this.selectedEdgeId = edgeId;
      this.renderer.setSelectedEdge(edgeId, this.engine);
      this.audio.selectEdge();
      const info = this.engine.analyzeEdge(edgeId);
      this.ui.setConfirmationEdge(true, info);
      this._refreshHelpText();
    }
  }

  confirmSelectedEdge() {
    if (this.selectedEdgeId >= 0) {
      this._executeMove(this.selectedEdgeId);
    }
  }

  clearSelection(playSound = false) {
    if (this.selectedEdgeId >= 0 && playSound) {
      this.audio.cancelSelect();
    }
    this.selectedEdgeId = -1;
    this.renderer.setSelectedEdge(-1, this.engine);
    this.ui.setConfirmationEdge(false);
    this._refreshHelpText();
  }

  _executeMove(edgeId) {
    this.selectedEdgeId = -1;
    this.hoveredEdgeId = -1;
    this.renderer.setSelectedEdge(-1, this.engine);
    this.ui.setConfirmationEdge(false);

    const res = this.engine.claimEdge(edgeId);
    if (res.ok && !res.gameOver) {
      this._maybeScheduleAI();
    }
  }

  _refreshHelpText() {
    const inspectId = this.selectedEdgeId >= 0 ? this.selectedEdgeId : this.hoveredEdgeId;
    this.ui.updateEdgeHelp(inspectId, this.engine, {
      selected: this.selectedEdgeId >= 0,
      singleClick: this.settings.singleClickPlacement,
    });
  }

  undoMove() {
    if (!this.engine.canUndo()) return;
    this._cancelAI();
    this.engine.undo();
    this._maybeScheduleAI();
  }

  resetView() {
    this.renderer.resetView(false);
    this.audio.resetView();
  }

  _cancelAI() {
    this.aiJobToken += 1;
    if (this.aiTimerId) {
      clearTimeout(this.aiTimerId);
      this.aiTimerId = 0;
    }
    if (this.ui) {
      this.ui.showThinking(false);
    }
  }

  _maybeScheduleAI(isChainTurn = false) {
    if (this.screen !== 'playing' || !this.engine.isAITurn()) {
      this.ui.showThinking(false);
      return;
    }

    const token = ++this.aiJobToken;
    this.ui.showThinking(true);
    const diffCfg = AI_DIFFICULTIES[this.settings.aiDifficulty] || AI_DIFFICULTIES.medium;
    const delay = isChainTurn ? Math.max(190, diffCfg.thinkMs * 0.6) : diffCfg.thinkMs;

    this.aiTimerId = setTimeout(() => {
      if (
        token !== this.aiJobToken ||
        this.screen !== 'playing' ||
        !this.engine.isAITurn()
      ) {
        return;
      }

      const moveEdgeId = chooseAIMove(this.engine, this.settings.aiDifficulty);
      if (moveEdgeId < 0) {
        this.ui.showThinking(false);
        return;
      }

      const res = this.engine.claimEdge(moveEdgeId);
      if (res.ok && !res.gameOver && this.engine.isAITurn()) {
        this._maybeScheduleAI(true);
      } else {
        this.ui.showThinking(false);
      }
    }, delay);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new BoxedInApp();
});
