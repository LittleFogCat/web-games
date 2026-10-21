/* Small procedural synth. No audio files are used. */
(function () {
  'use strict';

  class NeoAudio {
    constructor(enabled) {
      this.enabled = enabled !== false;
      this.ctx = null;
      this.master = null;
      this.compressor = null;
      this.noiseBuffer = null;
      this.lastPlayed = Object.create(null);
      this.throttles = {
        arrow: 0.055,
        gatling: 0.04,
        cannon: 0.09,
        laser: 0.13,
        shock: 0.09,
        frost: 0.08,
        tesla: 0.09,
        hit: 0.045,
        kill: 0.05,
        split: 0.06,
        ui: 0.03,
      };
    }

    setEnabled(value) {
      this.enabled = !!value;
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(this.enabled ? 0.38 : 0, this.ctx.currentTime, 0.01);
      }
    }

    ensure() {
      if (!this.enabled) return null;
      if (!this.ctx) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return null;
        try {
          this.ctx = new AudioCtor();
          this.master = this.ctx.createGain();
          this.master.gain.value = 0.38;
          this.compressor = this.ctx.createDynamicsCompressor();
          this.compressor.threshold.value = -18;
          this.compressor.knee.value = 14;
          this.compressor.ratio.value = 4;
          this.compressor.attack.value = 0.002;
          this.compressor.release.value = 0.18;
          this.master.connect(this.compressor);
          this.compressor.connect(this.ctx.destination);
          this.noiseBuffer = this._makeNoise();
        } catch (error) {
          this.ctx = null;
          return null;
        }
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(function () {});
      }
      return this.ctx;
    }

    _makeNoise() {
      const ctx = this.ctx;
      const length = Math.floor(ctx.sampleRate * 0.5);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        last = last * 0.6 + white * 0.4;
        data[i] = last;
      }
      return buffer;
    }

    _allowed(name) {
      const now = performance.now() / 1000;
      const throttle = this.throttles[name] || 0.02;
      const last = this.lastPlayed[name] || -100;
      if (now - last < throttle) return false;
      this.lastPlayed[name] = now;
      return true;
    }

    _tone(type, f0, f1, duration, gain, delay, destination) {
      const ctx = this.ctx;
      if (!ctx) return;
      const t0 = ctx.currentTime + (delay || 0);
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(20, f0), t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + duration);
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(env);
      env.connect(destination || this.master);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    }

    _noise(duration, gain, filterType, frequency, delay, destination) {
      const ctx = this.ctx;
      if (!ctx || !this.noiseBuffer) return;
      const t0 = ctx.currentTime + (delay || 0);
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = filterType || 'bandpass';
      filter.frequency.setValueAtTime(frequency || 900, t0);
      filter.Q.value = 0.7;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      source.connect(filter);
      filter.connect(env);
      env.connect(destination || this.master);
      source.start(t0);
      source.stop(t0 + duration + 0.02);
    }

    play(name) {
      if (!this.enabled) return;
      if (!this.ensure()) return;
      if (!this._allowed(name)) return;
      switch (name) {
        case 'ui':
        case 'select':
          this._tone('sine', 520, 680, 0.045, 0.035);
          break;
        case 'back':
          this._tone('sine', 380, 280, 0.06, 0.03);
          break;
        case 'build':
          this._tone('triangle', 220, 440, 0.12, 0.075);
          this._tone('sine', 660, 990, 0.16, 0.035, 0.04);
          this._noise(0.09, 0.028, 'highpass', 1600);
          break;
        case 'upgrade':
          this._tone('triangle', 330, 660, 0.16, 0.07);
          this._tone('sine', 880, 1320, 0.22, 0.045, 0.07);
          break;
        case 'sell':
          this._tone('triangle', 420, 180, 0.13, 0.045);
          break;
        case 'error':
          this._tone('square', 150, 110, 0.12, 0.028);
          break;
        case 'arrow':
          this._tone('triangle', 920, 520, 0.045, 0.025);
          break;
        case 'gatling':
          this._tone('square', 240, 150, 0.025, 0.018);
          this._noise(0.035, 0.016, 'highpass', 2200);
          break;
        case 'cannon':
          this._tone('sine', 95, 38, 0.3, 0.12);
          this._noise(0.19, 0.07, 'lowpass', 500);
          break;
        case 'laser':
          this._tone('sawtooth', 740, 980, 0.1, 0.018);
          this._tone('sine', 1480, 1980, 0.07, 0.01);
          break;
        case 'shock':
          this._tone('sine', 140, 52, 0.3, 0.09);
          this._noise(0.22, 0.045, 'lowpass', 700);
          break;
        case 'frost':
          this._tone('sine', 1480, 2350, 0.16, 0.025);
          this._tone('triangle', 980, 1550, 0.22, 0.018, 0.02);
          break;
        case 'tesla':
          this._noise(0.13, 0.055, 'highpass', 1800);
          this._tone('sawtooth', 1800, 420, 0.11, 0.02);
          break;
        case 'hit':
          this._noise(0.04, 0.018, 'bandpass', 1400);
          break;
        case 'kill':
          this._tone('triangle', 620, 180, 0.13, 0.035);
          this._noise(0.07, 0.02, 'highpass', 1000);
          break;
        case 'split':
          this._tone('square', 380, 620, 0.1, 0.03);
          this._tone('square', 380, 620, 0.1, 0.025, 0.08);
          break;
        case 'leak':
          this._tone('sawtooth', 220, 55, 0.48, 0.09);
          this._noise(0.35, 0.05, 'lowpass', 380);
          break;
        case 'warning':
          this._tone('triangle', 720, 560, 0.15, 0.045);
          this._tone('triangle', 720, 560, 0.15, 0.04, 0.19);
          this._noise(0.08, 0.016, 'bandpass', 1200, 0.19);
          break;
        case 'wave':
          this._tone('triangle', 220, 330, 0.22, 0.05);
          this._tone('triangle', 330, 440, 0.26, 0.04, 0.13);
          this._tone('sine', 660, 880, 0.35, 0.028, 0.26);
          break;
        case 'boss':
          this._tone('sawtooth', 55, 110, 0.9, 0.08);
          this._tone('sine', 165, 82, 1.2, 0.055, 0.1);
          break;
        case 'victory':
          [0, 0.12, 0.24, 0.4].forEach(function (delay, i) {
            const notes = [440, 554, 659, 880];
            this._tone('triangle', notes[i], notes[i], 0.4, 0.055, delay);
            this._tone('sine', notes[i] * 2, notes[i] * 2, 0.25, 0.02, delay);
          }, this);
          break;
        case 'defeat':
          [0, 0.18, 0.38].forEach(function (delay, i) {
            const notes = [220, 174, 110];
            this._tone('sawtooth', notes[i], notes[i] * 0.8, 0.55, 0.04, delay);
          }, this);
          break;
        default:
          this._tone('sine', 440, 440, 0.05, 0.02);
      }
    }
  }

  window.NeoAudio = NeoAudio;
})();
