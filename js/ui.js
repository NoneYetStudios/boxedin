/**
 * Boxed In — UI Controller & DOM View Bindings
 * Manages Setup screen, Scoreboard HUD, Gameplay Help, Confirmation Pill,
 * and How To Play / Local Stats / Options / End Game modals.
 */

import {
  AI_DIFFICULTIES,
  BOARD_SIZES,
  COLORS,
  getColor,
} from './config.js';
import { getComputedStats } from './storage.js';

export function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor((ms || 0) / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export class UIController {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.resetStatsArmed = false;
    this.resetStatsTimer = 0;
    this.extraTurnTimer = 0;
    this.aiThinking = false;

    this.els = {
      app: document.getElementById('app'),
      setupScreen: document.getElementById('setupScreen'),
      gameOverlays: document.getElementById('gameOverlays'),
      scoreboard: document.getElementById('scoreboard'),
      webglFallback: document.getElementById('webglFallback'),
      webglFallbackMsg: document.getElementById('webglFallbackMsg'),

      // Setup controls
      aiDifficultySection: document.getElementById('aiDifficultySection'),
      p2ColorTitle: document.getElementById('p2ColorTitle'),
      p1ColorSwatches: document.getElementById('p1ColorSwatches'),
      p2ColorSwatches: document.getElementById('p2ColorSwatches'),
      chkSingleClickSetup: document.getElementById('chkSingleClickSetup'),
      btnStartGame: document.getElementById('btnStartGame'),
      btnHowSetup: document.getElementById('btnHowSetup'),
      btnStatsSetup: document.getElementById('btnStatsSetup'),

      // Top HUD
      btnStatsHud: document.getElementById('btnStatsHud'),
      btnHowHud: document.getElementById('btnHowHud'),
      btnSound: document.getElementById('btnSound'),
      p1ScorePill: document.getElementById('p1ScorePill'),
      p2ScorePill: document.getElementById('p2ScorePill'),
      p1SwatchDot: document.getElementById('p1SwatchDot'),
      p2SwatchDot: document.getElementById('p2SwatchDot'),
      p1Label: document.getElementById('p1Label'),
      p2Label: document.getElementById('p2Label'),
      p1Score: document.getElementById('p1Score'),
      p2Score: document.getElementById('p2Score'),
      turnBadge: document.getElementById('turnBadge'),
      turnDot: document.getElementById('turnDot'),
      turnText: document.getElementById('turnText'),
      remainingCubesText: document.getElementById('remainingCubesText'),
      boardDimsBadge: document.getElementById('boardDimsBadge'),
      matchTimer: document.getElementById('matchTimer'),

      // In-game overlays
      edgeHelpPill: document.getElementById('edgeHelpPill'),
      statusToast: document.getElementById('statusToast'),
      statusToastText: document.getElementById('statusToastText'),
      confirmPill: document.getElementById('confirmPill'),
      confirmMsg: document.getElementById('confirmMsg'),
      btnConfirmPlace: document.getElementById('btnConfirmPlace'),
      btnCancelPlace: document.getElementById('btnCancelPlace'),
      btnShowResults: document.getElementById('btnShowResults'),

      // Bottom Dock
      btnUndo: document.getElementById('btnUndo'),
      btnResetView: document.getElementById('btnResetView'),
      btnOptions: document.getElementById('btnOptions'),
      btnHowGame: document.getElementById('btnHowGame'),
      btnNewGame: document.getElementById('btnNewGame'),

      // Modals
      modalHow: document.getElementById('modalHow'),
      modalStats: document.getElementById('modalStats'),
      modalOptions: document.getElementById('modalOptions'),
      modalEnd: document.getElementById('modalEnd'),

      // Options modal inputs
      chkSingleClickModal: document.getElementById('chkSingleClickModal'),
      chkSoundModal: document.getElementById('chkSoundModal'),

      // Stats fields
      statGamesPlayed: document.getElementById('statGamesPlayed'),
      statGamesWon: document.getElementById('statGamesWon'),
      statWinPct: document.getElementById('statWinPct'),
      statBestColor: document.getElementById('statBestColor'),
      statFastest: document.getElementById('statFastest'),
      statMargin: document.getElementById('statMargin'),
      colorStatsGrid: document.getElementById('colorStatsGrid'),
      btnResetStats: document.getElementById('btnResetStats'),

      // End game modal fields
      endEyebrow: document.getElementById('endEyebrow'),
      endTitle: document.getElementById('endTitle'),
      endScoreLine: document.getElementById('endScoreLine'),
      endControlLine: document.getElementById('endControlLine'),
      endBarP1: document.getElementById('endBarP1'),
      endBarP2: document.getElementById('endBarP2'),
      endLegendP1: document.getElementById('endLegendP1'),
      endLegendP2: document.getElementById('endLegendP2'),
      endMetaSize: document.getElementById('endMetaSize'),
      endMetaTime: document.getElementById('endMetaTime'),
      btnPlayAgain: document.getElementById('btnPlayAgain'),
      btnEndSetup: document.getElementById('btnEndSetup'),
      btnEndStats: document.getElementById('btnEndStats'),
      btnEndInspect: document.getElementById('btnEndInspect'),
      btnInspectBoard: document.getElementById('btnInspectBoard'),
    };

    this._bindEvents();
  }

  _bindEvents() {
    // Mode buttons
    document.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.handlers.onUpdateSettings?.({ mode: btn.dataset.mode });
      });
    });

    // AI Difficulty buttons
    document.querySelectorAll('[data-difficulty]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.handlers.onUpdateSettings?.({ aiDifficulty: btn.dataset.difficulty });
      });
    });

    // Board Size buttons
    document.querySelectorAll('[data-size]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.handlers.onUpdateSettings?.({ boardSize: Number(btn.dataset.size) });
      });
    });

    // Single-click placement checkboxes (setup + options modal)
    const onSingleClickToggle = (e) => {
      this.handlers.onUpdateSettings?.({
        singleClickPlacement: Boolean(e.target.checked),
      });
    };
    this.els.chkSingleClickSetup.addEventListener('change', onSingleClickToggle);
    this.els.chkSingleClickModal.addEventListener('change', onSingleClickToggle);

    // Sound toggles
    this.els.btnSound.addEventListener('click', () => {
      this.handlers.onToggleSound?.();
    });
    this.els.chkSoundModal.addEventListener('change', (e) => {
      this.handlers.onUpdateSettings?.({ soundEnabled: Boolean(e.target.checked) });
    });

    // Setup CTAs
    this.els.btnStartGame.addEventListener('click', () => {
      this.handlers.onStartGame?.();
    });
    this.els.btnHowSetup.addEventListener('click', () => this.openModal('modalHow'));
    this.els.btnHowHud.addEventListener('click', () => this.openModal('modalHow'));
    this.els.btnHowGame.addEventListener('click', () => this.openModal('modalHow'));

    this.els.btnStatsSetup.addEventListener('click', () => {
      this.handlers.onOpenStats?.();
    });
    this.els.btnStatsHud.addEventListener('click', () => {
      this.handlers.onOpenStats?.();
    });

    // In-game Dock & Confirmation
    this.els.btnUndo.addEventListener('click', () => this.handlers.onUndo?.());
    this.els.btnResetView.addEventListener('click', () => this.handlers.onResetView?.());
    this.els.btnOptions.addEventListener('click', () => this.openModal('modalOptions'));
    this.els.btnNewGame.addEventListener('click', () => this.handlers.onReturnToSetup?.());
    this.els.btnConfirmPlace.addEventListener('click', () => this.handlers.onConfirmSelected?.());
    this.els.btnCancelPlace.addEventListener('click', () => this.handlers.onCancelSelected?.());

    // Stats reset (2-step confirm)
    this.els.btnResetStats.addEventListener('click', () => {
      if (!this.resetStatsArmed) {
        this.resetStatsArmed = true;
        this.els.btnResetStats.textContent = 'Confirm Reset?';
        clearTimeout(this.resetStatsTimer);
        this.resetStatsTimer = setTimeout(() => {
          this.resetStatsArmed = false;
          this.els.btnResetStats.textContent = 'Reset Stats';
        }, 3200);
        return;
      }
      clearTimeout(this.resetStatsTimer);
      this.resetStatsArmed = false;
      this.els.btnResetStats.textContent = 'Reset Stats';
      this.handlers.onResetStats?.();
    });

    // End game actions
    this.els.btnPlayAgain.addEventListener('click', () => {
      this.closeAllModals();
      this.els.btnShowResults.classList.add('hidden');
      this.handlers.onPlayAgain?.();
    });
    this.els.btnEndSetup.addEventListener('click', () => {
      this.closeAllModals();
      this.els.btnShowResults.classList.add('hidden');
      this.handlers.onReturnToSetup?.();
    });
    this.els.btnEndStats.addEventListener('click', () => {
      this.closeModal('modalEnd');
      this.els.btnShowResults.classList.remove('hidden');
      this.handlers.onOpenStats?.();
    });

    const inspectBoard = () => {
      this.closeModal('modalEnd');
      this.els.btnShowResults.classList.remove('hidden');
    };
    this.els.btnEndInspect.addEventListener('click', inspectBoard);
    this.els.btnInspectBoard.addEventListener('click', inspectBoard);
    this.els.btnShowResults.addEventListener('click', () => {
      this.els.btnShowResults.classList.add('hidden');
      this.openModal('modalEnd');
    });

    // Generic modal close buttons & backdrop click
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.closeModal(btn.dataset.closeModal);
      });
    });

    document.querySelectorAll('dialog.modal').forEach((dlg) => {
      dlg.addEventListener('click', (e) => {
        if (e.target === dlg) {
          if (dlg.id === 'modalEnd') {
            inspectBoard();
          } else {
            this.closeModal(dlg.id);
          }
        }
      });
    });
  }

  showWebGLError(message) {
    this.els.webglFallbackMsg.textContent = message;
    this.els.webglFallback.classList.remove('hidden');
  }

  setScreen(screen) {
    const isSetup = screen === 'setup';
    this.els.app.dataset.screen = screen;
    this.els.setupScreen.classList.toggle('hidden', !isSetup);
    this.els.gameOverlays.classList.toggle('hidden', isSetup);
    this.els.scoreboard.classList.toggle('hidden', isSetup);
    if (isSetup) {
      this.els.btnShowResults.classList.add('hidden');
      this.showThinking(false);
      this.setConfirmationEdge(false);
    }
  }

  syncSettings(settings) {
    document.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === settings.mode);
    });
    document.querySelectorAll('[data-difficulty]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.difficulty === settings.aiDifficulty);
    });
    document.querySelectorAll('[data-size]').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.size) === Number(settings.boardSize));
    });

    const isPvC = settings.mode === 'pvc';
    this.els.aiDifficultySection.classList.toggle('hidden', !isPvC);
    this.els.p2ColorTitle.textContent = isPvC ? 'COMPUTER COLOR' : 'PLAYER 2 COLOR';

    this.els.chkSingleClickSetup.checked = Boolean(settings.singleClickPlacement);
    this.els.chkSingleClickModal.checked = Boolean(settings.singleClickPlacement);

    this.els.chkSoundModal.checked = Boolean(settings.soundEnabled);
    this.els.btnSound.textContent = settings.soundEnabled ? 'SND: ON' : 'SND: OFF';

    this._renderColorPickers(settings.p1Color, settings.p2Color, isPvC);
  }

  _renderColorPickers(p1ColorId, p2ColorId, isPvC) {
    const buildSwatches = (container, selectedId, otherId, key) => {
      container.innerHTML = '';
      for (const c of COLORS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'color-swatch';
        if (c.id === selectedId) btn.classList.add('selected');
        btn.style.backgroundColor = c.hex;
        btn.dataset.colorId = c.id;
        const blocked = c.id === otherId;
        btn.disabled = blocked;
        btn.setAttribute('aria-pressed', c.id === selectedId ? 'true' : 'false');
        btn.title = blocked
          ? `${c.name} (used by ${key === 'p1Color' ? (isPvC ? 'Computer' : 'Player 2') : 'Player 1'})`
          : c.name;
        btn.setAttribute('aria-label', btn.title);
        btn.addEventListener('click', () => {
          if (!blocked) {
            this.handlers.onUpdateSettings?.({ [key]: c.id });
          }
        });
        container.appendChild(btn);
      }
    };

    buildSwatches(this.els.p1ColorSwatches, p1ColorId, p2ColorId, 'p1Color');
    buildSwatches(this.els.p2ColorSwatches, p2ColorId, p1ColorId, 'p2Color');
  }

  syncMatchState(engine) {
    if (!engine) return;
    const snap = engine.getSnapshot();
    const p1 = snap.players[0];
    const p2 = snap.players[1];
    const c1 = getColor(p1.colorId);
    const c2 = getColor(p2.colorId);

    this.els.p1SwatchDot.style.backgroundColor = c1.hex;
    this.els.p1SwatchDot.style.color = c1.hex;
    this.els.p2SwatchDot.style.backgroundColor = c2.hex;
    this.els.p2SwatchDot.style.color = c2.hex;

    this.els.p1Label.textContent = snap.mode === 'pvc' ? `You (${c1.name})` : `P1 (${c1.name})`;
    this.els.p2Label.textContent = snap.mode === 'pvc' ? `CPU (${c2.name})` : `P2 (${c2.name})`;

    this.els.p1Score.textContent = String(snap.scores[0]);
    this.els.p2Score.textContent = String(snap.scores[1]);

    this.els.p1ScorePill.classList.toggle(
      'is-active',
      snap.status === 'playing' && snap.currentPlayer === 0
    );
    this.els.p2ScorePill.classList.toggle(
      'is-active',
      snap.status === 'playing' && snap.currentPlayer === 1
    );

    const activePlayer = snap.players[snap.currentPlayer];
    const activeColor = getColor(activePlayer.colorId);
    this.els.turnDot.style.backgroundColor = activeColor.hex;

    if (snap.status === 'finished') {
      this.els.turnText.textContent = 'Match Complete';
    } else if (activePlayer.isAI) {
      this.els.turnText.textContent = 'Computer Turn';
    } else if (snap.mode === 'pvc') {
      this.els.turnText.textContent = 'Your Turn';
    } else {
      this.els.turnText.textContent = `${activePlayer.name}'s Turn`;
    }

    this.els.remainingCubesText.textContent = `${snap.remainingCubes} left`;
    const sizeInfo = BOARD_SIZES[snap.boardSize];
    this.els.boardDimsBadge.textContent = sizeInfo ? sizeInfo.dims : `${snap.boardSize}³`;

    this.els.btnUndo.disabled = !snap.canUndo;
    this.updateTimer(engine.getElapsedMs());
  }

  updateTimer(ms) {
    this.els.matchTimer.textContent = formatDuration(ms);
  }

  updateEdgeHelp(edgeId, engine, { selected = false, singleClick = false } = {}) {
    const el = this.els.edgeHelpPill;
    if (!engine || engine.status !== 'playing') {
      el.innerHTML = '<span class="help-idle">Rotate &amp; inspect the 3D lattice</span>';
      return;
    }

    if (edgeId === null || edgeId === undefined || edgeId < 0) {
      const actionHint = singleClick
        ? 'Hover or tap an edge to claim'
        : 'Hover or tap an edge to inspect · Click twice to place';
      el.innerHTML = `<span class="help-idle">${actionHint} · Drag to rotate</span>`;
      return;
    }

    const info = engine.analyzeEdge(edgeId);
    if (!info.valid) {
      el.innerHTML = '<span class="help-idle">Edge already claimed</span>';
      return;
    }

    const parts = [];
    const affLabel = info.affectedCount === 1 ? '1 cube' : `${info.affectedCount} cubes`;
    parts.push(`<span class="help-chip">Affects ${affLabel}</span>`);

    if (info.completesCount > 0) {
      const compLabel = info.completesCount === 1 ? '1 cube' : `${info.completesCount} cubes`;
      parts.push(`<span class="help-chip complete">Completes ${compLabel} (+Extra Turn)</span>`);
    }

    if (info.vulnerableCount > 0) {
      const vulnLabel =
        info.vulnerableCount === 1 ? '1 vulnerable cube' : `${info.vulnerableCount} vulnerable cubes`;
      parts.push(`<span class="help-chip vuln">Creates ${vulnLabel}</span>`);
    } else if (info.completesCount === 0) {
      parts.push('<span class="help-chip safe">Safe edge · 0 vulnerable</span>');
    }

    if (selected) {
      parts.push('<span class="help-idle">· Previewing</span>');
    }

    el.innerHTML = parts.join('<span class="sep">·</span>');
  }

  setConfirmationEdge(active, edgeInfo = null) {
    if (!active) {
      this.els.confirmPill.classList.add('hidden');
      return;
    }
    this.els.confirmPill.classList.remove('hidden');
    if (edgeInfo && edgeInfo.completesCount > 0) {
      const n = edgeInfo.completesCount;
      this.els.confirmMsg.textContent = `Click edge again to capture ${n} cube${n > 1 ? 's' : ''}`;
    } else {
      this.els.confirmMsg.textContent = 'Click edge again to place';
    }
  }

  showThinking(show) {
    this.aiThinking = Boolean(show);
    if (show) {
      clearTimeout(this.extraTurnTimer);
      this.els.statusToast.classList.remove('hidden', 'extra-turn');
      this.els.statusToastText.textContent = 'Thinking...';
    } else if (!this.els.statusToast.classList.contains('extra-turn')) {
      this.els.statusToast.classList.add('hidden');
    }
  }

  showExtraTurn(playerLabel, capturedCount) {
    if (this.aiThinking) return;
    clearTimeout(this.extraTurnTimer);
    this.els.statusToast.classList.remove('hidden');
    this.els.statusToast.classList.add('extra-turn');
    this.els.statusToastText.textContent = `${playerLabel}: +${capturedCount} cube${capturedCount > 1 ? 's' : ''} · Extra Turn!`;
    this.extraTurnTimer = setTimeout(() => {
      this.els.statusToast.classList.remove('extra-turn');
      if (!this.aiThinking) {
        this.els.statusToast.classList.add('hidden');
      }
    }, 1350);
  }

  renderStats(stats) {
    const computed = getComputedStats(stats);

    this.els.statGamesPlayed.textContent = String(computed.gamesPlayed);
    this.els.statGamesWon.textContent = String(computed.gamesWon);
    this.els.statWinPct.textContent = `${computed.winPercentage.toFixed(1)}%`;

    if (computed.bestColor) {
      this.els.statBestColor.textContent = `${computed.bestColor.color.name} (${computed.bestColor.winPct.toFixed(0)}%)`;
      this.els.statBestColor.style.color = computed.bestColor.color.glow;
    } else {
      this.els.statBestColor.textContent = '—';
      this.els.statBestColor.style.color = '';
    }

    if (computed.fastestVictory) {
      const sz = BOARD_SIZES[computed.fastestVictory.size]?.dims || `${computed.fastestVictory.size}³`;
      this.els.statFastest.textContent = `${formatDuration(computed.fastestVictory.ms)} (${sz})`;
    } else {
      this.els.statFastest.textContent = '—';
    }

    if (computed.largestMargin) {
      const m = computed.largestMargin;
      this.els.statMargin.textContent = `+${m.margin} (${m.winnerScore}–${m.loserScore})`;
    } else {
      this.els.statMargin.textContent = '—';
    }

    this.els.colorStatsGrid.innerHTML = '';
    for (const row of computed.colorRows) {
      const card = document.createElement('div');
      card.className = 'color-stat-row';

      const left = document.createElement('div');
      left.className = 'color-stat-left';
      const dot = document.createElement('span');
      dot.className = 'swatch-dot';
      dot.style.backgroundColor = row.color.hex;
      dot.style.color = row.color.hex;
      const nameSpan = document.createElement('span');
      nameSpan.textContent = row.color.name;
      left.append(dot, nameSpan);

      const right = document.createElement('div');
      right.className = 'color-stat-right';
      right.textContent =
        row.played > 0 ? `${row.won}/${row.played} (${row.winPct.toFixed(0)}%)` : '0 played';

      card.append(left, right);
      this.els.colorStatsGrid.appendChild(card);
    }
  }

  showEndGame(summary, config) {
    this.showThinking(false);
    this.setConfirmationEdge(false);
    this.els.btnShowResults.classList.add('hidden');

    const p1 = config.players[0];
    const p2 = config.players[1];
    const c1 = getColor(p1.colorId);
    const c2 = getColor(p2.colorId);

    if (summary.isDraw) {
      this.els.endEyebrow.textContent = 'MATCH TIED';
      this.els.endTitle.textContent = 'Draw Game!';
      this.els.endTitle.style.color = '#f8fafc';
      this.els.endScoreLine.textContent = `${summary.scores[0]} cubes to ${summary.scores[1]}`;
      this.els.endControlLine.textContent = '50.0% board control each';
    } else {
      const wColor = getColor(summary.winner.colorId);
      const isCPU = summary.winner.isAI;
      this.els.endEyebrow.textContent = isCPU ? 'DEFEAT' : 'VICTORY';
      this.els.endTitle.textContent = isCPU
        ? `Computer (${wColor.name}) wins`
        : `${summary.winner.name} wins`;
      this.els.endTitle.style.color = wColor.glow;
      this.els.endScoreLine.textContent = `${summary.winnerScore} cubes to ${summary.loserScore}`;
      this.els.endControlLine.textContent = `${summary.boardControlPct.toFixed(1)}% board control`;
    }

    const p1Pct = summary.totalCubes > 0 ? (summary.scores[0] / summary.totalCubes) * 100 : 50;
    const p2Pct = 100 - p1Pct;
    this.els.endBarP1.style.width = `${p1Pct}%`;
    this.els.endBarP1.style.backgroundColor = c1.hex;
    this.els.endBarP2.style.width = `${p2Pct}%`;
    this.els.endBarP2.style.backgroundColor = c2.hex;

    this.els.endLegendP1.textContent = `${p1.name}: ${summary.scores[0]}`;
    this.els.endLegendP2.textContent = `${p2.name}: ${summary.scores[1]}`;

    const sz = BOARD_SIZES[summary.boardSize];
    const diffLabel =
      summary.mode === 'pvc' ? ` · ${AI_DIFFICULTIES[summary.aiDifficulty]?.label || 'Medium'} AI` : '';
    this.els.endMetaSize.textContent = `${sz ? `${sz.label} (${sz.dims})` : `${summary.boardSize}³`}${diffLabel}`;
    this.els.endMetaTime.textContent = formatDuration(summary.durationMs);

    this.openModal('modalEnd');
  }

  openModal(id) {
    const dlg = this.els[id] || document.getElementById(id);
    if (!dlg) return;
    if (!dlg.open) dlg.showModal();
  }

  closeModal(id) {
    const dlg = this.els[id] || document.getElementById(id);
    if (dlg && dlg.open) dlg.close();
  }

  closeAllModals() {
    document.querySelectorAll('dialog.modal[open]').forEach((dlg) => dlg.close());
  }

  hasOpenModal() {
    return Boolean(document.querySelector('dialog.modal[open]'));
  }
}
