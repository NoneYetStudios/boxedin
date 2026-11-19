/**
 * Boxed In — Procedural Web Audio SFX Engine
 * Zero external audio assets; fast load and instant feedback.
 */

export class AudioEngine {
  constructor(enabled = true) {
    this.enabled = Boolean(enabled);
    this.ctx = null;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  _ensureContext() {
    if (!this.enabled) return null;
    if (typeof window === 'undefined') return null;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;

    if (!this.ctx) {
      try {
        this.ctx = new Ctx();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  _tone(freq, duration, { type = 'sine', gain = 0.08, delay = 0, slideTo = null } = {}) {
    const ctx = this._ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), now + duration);
    }

    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(gain, now + Math.min(0.015, duration * 0.25));
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(env);
    env.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  selectEdge() {
    this._tone(520, 0.07, { type: 'triangle', gain: 0.055, slideTo: 660 });
  }

  cancelSelect() {
    this._tone(340, 0.06, { type: 'sine', gain: 0.04, slideTo: 240 });
  }

  claimEdge(isAI = false) {
    this._tone(isAI ? 360 : 440, 0.085, { type: 'triangle', gain: 0.065, slideTo: isAI ? 420 : 560 });
  }

  captureCube(count = 1) {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    const total = Math.min(4, Math.max(1, count));
    for (let i = 0; i < total; i++) {
      this._tone(notes[i], 0.19, {
        type: 'triangle',
        gain: 0.09,
        delay: i * 0.055,
        slideTo: notes[i] * 1.03,
      });
    }
    // Subtle shimmer harmonic
    this._tone(1318.5, 0.22, { type: 'sine', gain: 0.04, delay: total * 0.045 });
  }

  undo() {
    this._tone(420, 0.08, { type: 'sine', gain: 0.05, slideTo: 290 });
  }

  resetView() {
    this._tone(390, 0.09, { type: 'sine', gain: 0.04, slideTo: 520 });
  }

  victory() {
    const chord = [523.25, 659.25, 783.99, 1046.5];
    chord.forEach((f, idx) => {
      this._tone(f, 0.28, { type: 'triangle', gain: 0.08, delay: idx * 0.075 });
    });
  }

  defeat() {
    const notes = [392.0, 349.23, 293.66];
    notes.forEach((f, idx) => {
      this._tone(f, 0.22, { type: 'sawtooth', gain: 0.04, delay: idx * 0.1 });
    });
  }

  draw() {
    this._tone(440, 0.18, { type: 'triangle', gain: 0.06 });
    this._tone(554.37, 0.22, { type: 'triangle', gain: 0.05, delay: 0.1 });
  }
}
