// FormantSynth: the klattsch synthesis engine, free of any audio-API dependency.
//
// Usage:
//
//   import { FormantSynth } from './synth-core.js';
//   const synth = new FormantSynth({ sampleRate: 48000, schedule });
//   const buf = new Float32Array(48000 * 2);  // 2 seconds
//   synth.process(buf);
//
// `schedule` is an array of { atMs, target, transitionMs } events; the synth
// applies them in time order. Or drive it live with setTarget()

import { BandpassBiquad, glottalPulse, xorshift, softClip } from './dsp.js';

export const PARAMS = [
  'F0', 'voicing',
  'F1', 'BW1', 'A1',
  'F2', 'BW2', 'A2',
  'F3', 'BW3', 'A3',
  'gain',
  'vibratoDepth',   // Hz peak deviation
  'vibratoRate',    // Hz LFO rate
  'tremoloDepth',   // 0..1 amplitude modulation depth
  'tremoloRate',    // Hz tremolo LFO rate
  'aspiration',     // 0..1 noise mixed into voiced source (breathiness)
  'tilt',           // -0.95..0.95 spectral tilt (positive = brighter)
  'effort',         // 0..1 glottal pulse shape (0=lax, 1=tense)
];

export const DEFAULT = {
  F0: 120, voicing: 0,
  F1: 500, BW1: 80,  A1: 0,
  F2: 1500, BW2: 120, A2: 0,
  F3: 2500, BW3: 160, A3: 0,
  gain: 3.5,
  vibratoDepth: 0,
  vibratoRate: 5,
  tremoloDepth: 0,
  tremoloRate: 5,
  aspiration: 0,
  tilt: 0,
  effort: 0.5,
};

// (sonicpi-toolchain patch) shaped, per-parameter transitions. A schedule event may carry
//   curve:  1 raised cosine (0.5 - 0.5 cos(pi u)), 2 ease-out (u (2 - u): fast at first, settling, like
//           the formant movement after a consonant release), 0 or absent linear
//   params: the parameters it moves (absent: all of them, as before); the others keep their own transitions
// A schedule whose events carry neither renders through the original linear code, sample for sample.
export const CURVES = {
  1: (u) => 0.5 - 0.5 * Math.cos(Math.PI * u),
  2: (u) => u * (2 - u),
};
const isShaped = (events) => events.some((e) => e.curve || e.params);
const toEvents = (events, sr) => events.map((e) => ({
  atSample: Math.floor((e.atMs ?? 0) * sr / 1000),
  target: e.target,
  transitionSamples: Math.max(1, Math.floor((e.transitionMs ?? 30) * sr / 1000)),
  ...(e.curve || e.params ? { curve: e.curve ?? 0, params: e.params ?? null } : {}),
}));

export class FormantSynth {
  constructor({ sampleRate, initialTarget, schedule } = {}) {
    if (!sampleRate || sampleRate <= 0) {
      throw new Error('FormantSynth requires a positive sampleRate');
    }
    this.sr = sampleRate;
    const init = initialTarget ?? {};
    this.current = { ...DEFAULT, ...init };
    this.target = { ...this.current };
    this.increment = {};
    for (const k of PARAMS) this.increment[k] = 0;
    this.transitionSamples = 0;
    this.glottalPhase = 0;
    this.lfsr = 0xACE1ACE1 | 0;
    this.vibratoPhase = 0;
    this.tremoloPhase = 0;
    this.tiltPrev = 0;
    this.bp1 = new BandpassBiquad();
    this.bp2 = new BandpassBiquad();
    this.bp3 = new BandpassBiquad();

    this.schedule = toEvents(schedule ?? [], this.sr);
    this.scheduleIdx = 0;
    this.sampleCounter = 0;
    this.shaped = isShaped(this.schedule);
    this.moves = [];        // shaped mode: running transitions { n, N, shape, keys, from, to }
    this.mover = {};        // shaped mode: param -> the transition moving it
  }

  // shaped mode: start moving `params` (default all) toward target over N samples along curve
  startMove(target, N, curve = 0, params = null) {
    const keys = [];
    const move = { n: 0, N, shape: CURVES[curve] ?? null, keys, from: {}, to: {} };
    for (const k of params ?? PARAMS) {
      if (k in target) this.target[k] = target[k];
      const old = this.mover[k];
      if (old) old.keys.splice(old.keys.indexOf(k), 1);
      this.mover[k] = move;
      keys.push(k);
      move.from[k] = this.current[k];
      move.to[k] = this.target[k];
    }
    this.moves.push(move);
  }

  // shaped mode: advance every running transition one sample
  stepMoves() {
    const cur = this.current;
    let done = 0;
    for (const m of this.moves) {
      m.n++;
      if (m.n >= m.N) {
        for (const k of m.keys) { cur[k] = m.to[k]; this.mover[k] = undefined; }
        m.keys.length = 0;
        done++;
        continue;
      }
      const u = m.n / m.N, w = m.shape ? m.shape(u) : u;
      for (const k of m.keys) cur[k] = m.from[k] + (m.to[k] - m.from[k]) * w;
      if (!m.keys.length) done++;
    }
    if (done) this.moves = this.moves.filter((m) => m.keys.length && m.n < m.N);
  }

  // Schedule a new target. transitionMs samples are linearly interpolated
  // from current state to the new target
  setTarget(target, transitionMs = 30) {
    const N = Math.max(1, Math.floor(transitionMs * this.sr / 1000));
    if (this.shaped) { this.startMove(target, N); return; }
    this.transitionSamples = N;
    for (const k of PARAMS) {
      if (k in target) this.target[k] = target[k];
      this.increment[k] = (this.target[k] - this.current[k]) / N;
    }
  }

  // startCounter presets the schedule clock: negative delays the first event,
  // positive drains already-past events on the first process() call.
  queueSchedule(events, startCounter = 0) {
    this.schedule = toEvents(events, this.sr);
    this.scheduleIdx = 0;
    this.sampleCounter = startCounter;
    if (isShaped(this.schedule) && !this.shaped) {
      // switching to shaped mode mid-flight: carry the linear transition that is running
      this.shaped = true;
      if (this.transitionSamples > 0) this.startMove({}, this.transitionSamples);
      this.transitionSamples = 0;
    }
  }

  reset(initialTarget) {
    this.glottalPhase = 0;
    this.vibratoPhase = 0;
    this.tremoloPhase = 0;
    this.lfsr = 0xACE1ACE1 | 0;
    this.tiltPrev = 0;
    this.bp1.reset();
    this.bp2.reset();
    this.bp3.reset();
    const init = initialTarget ?? {};
    this.current = { ...DEFAULT, ...init };
    this.target = { ...this.current };
    for (const k of PARAMS) this.increment[k] = 0;
    this.transitionSamples = 0;
    this.schedule = [];
    this.scheduleIdx = 0;
    this.sampleCounter = 0;
    this.shaped = false;
    this.moves = [];
    this.mover = {};
  }

  // Render `out.length` samples into the given Float32Array
  process(out) {
    const cur = this.current;
    for (let i = 0; i < out.length; i++) {
      if (this.shaped) {
        // (sonicpi-toolchain patch) shaped, per-parameter transitions
        while (this.scheduleIdx < this.schedule.length
            && this.schedule[this.scheduleIdx].atSample <= this.sampleCounter) {
          const evt = this.schedule[this.scheduleIdx++];
          this.startMove(evt.target, evt.transitionSamples, evt.curve, evt.params);
        }
        this.sampleCounter++;
        if (this.moves.length) this.stepMoves();
      } else {
      // Drain any baked-in schedule events whose time has arrived
      while (this.scheduleIdx < this.schedule.length
          && this.schedule[this.scheduleIdx].atSample <= this.sampleCounter) {
        const evt = this.schedule[this.scheduleIdx++];
        const N = evt.transitionSamples;
        this.transitionSamples = N;
        for (const k of PARAMS) {
          if (k in evt.target) this.target[k] = evt.target[k];
          this.increment[k] = (this.target[k] - this.current[k]) / N;
        }
      }
      this.sampleCounter++;

      if (this.transitionSamples > 0) {
        for (const k of PARAMS) cur[k] += this.increment[k];
        this.transitionSamples--;
        if (this.transitionSamples === 0) {
          for (const k of PARAMS) cur[k] = this.target[k];
        }
      }
      }

      // Vibrato LFO modulates F0 around its target value
      this.vibratoPhase += 2 * Math.PI * cur.vibratoRate / this.sr;
      this.vibratoPhase -= 2 * Math.PI * Math.floor(this.vibratoPhase / (2 * Math.PI));
      const effF0 = cur.F0 + cur.vibratoDepth * Math.sin(this.vibratoPhase);

      // Tremolo LFO modulates output amplitude
      this.tremoloPhase += 2 * Math.PI * cur.tremoloRate / this.sr;
      this.tremoloPhase -= 2 * Math.PI * Math.floor(this.tremoloPhase / (2 * Math.PI));
      const tremoloMod = 1 - cur.tremoloDepth * (0.5 + 0.5 * Math.sin(this.tremoloPhase));

      const v = cur.voicing < 0 ? 0 : cur.voicing > 1 ? 1 : cur.voicing;
      this.lfsr = xorshift(this.lfsr);
      const noiseSample = this.lfsr / 2147483648;
      const pulseVal = glottalPulse(this.glottalPhase, cur.effort);
      const voicedGain = 1 - cur.aspiration * 0.85;
      const exc = v * pulseVal * voicedGain
                + (1 - v) * noiseSample * 0.35
                + cur.aspiration * noiseSample * 0.5;
      this.glottalPhase += effF0 / this.sr;
      this.glottalPhase -= Math.floor(this.glottalPhase);

      this.bp1.setFreq(cur.F1, cur.BW1, this.sr);
      this.bp2.setFreq(cur.F2, cur.BW2, this.sr);
      this.bp3.setFreq(cur.F3, cur.BW3, this.sr);

      const y = (this.bp1.process(exc) * cur.A1
              +  this.bp2.process(exc) * cur.A2
              +  this.bp3.process(exc) * cur.A3) * cur.gain * tremoloMod;

      const tilted = y - cur.tilt * this.tiltPrev;
      this.tiltPrev = y;

      out[i] = softClip(tilted);
    }
  }
}

// Convenience: render a complete utterance offline
export function renderToBuffer({ sampleRate = 48000, schedule, totalMs, initialTarget } = {}) {
  if (totalMs == null) {
    if (!schedule || !schedule.length) throw new Error('renderToBuffer needs totalMs or a non-empty schedule');
    totalMs = schedule[schedule.length - 1].atMs + 200;
  }
  const samples = Math.ceil(totalMs * sampleRate / 1000);
  const buf = new Float32Array(samples);
  const synth = new FormantSynth({ sampleRate, initialTarget, schedule });
  synth.process(buf);
  return buf;
}
