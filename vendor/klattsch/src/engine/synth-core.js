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

import { BandpassBiquad, KlattResonator, KlattAntiresonator, glottalPulse, xorshift, softClip, lfShape, lfPulse, tiltCoef } from './dsp.js';

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

// (sonicpi-toolchain patch) Nasal parameters (Klatt 1980 names): a nasal pole-zero pair FNP/BNP, FNZ/BNZ in
// cascade with the excitation (resonator then antiresonator, each unity gain at 0 Hz; they cancel when FNP = FNZ
// and BNP = BNZ), a second pair FNP2/BNP2, FNZ2/BNZ2 (the murmur's place-dependent oral side-branch zero), and
// AN, a parallel nasal formant at FNP (fed by the excitation, like A1-A3), and GN, a gain on all of it (the level
// of a murmur or a nasalized vowel, which spectral distances do not see). The nasal path runs only once a target
// (schedule event, setTarget, initialTarget) has carried one of these keys; until then every sample is computed
// exactly as before. Nasal parameters glide linearly on their own clock (in both the linear and the shaped mode),
// so an event may move only them ({ nasalOnly: true }) without retiming the other parameters' transitions.
export const NASAL_PARAMS = ['FNP', 'BNP', 'FNZ', 'BNZ', 'AN', 'FNP2', 'BNP2', 'FNZ2', 'BNZ2', 'GN'];
export const NASAL_DEFAULT = Object.freeze({
  FNP: 250, BNP: 100, FNZ: 250, BNZ: 100, AN: 0,
  FNP2: 1500, BNP2: 100, FNZ2: 1500, BNZ2: 100, GN: 1,
});
const hasNasal = (t) => { for (const k of NASAL_PARAMS) if (k in t) return true; return false; };

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
// An event carries the [GS] voice-source state (absent fields = their defaults, so a missing GS turns the
// LF source off) unless it only moves formants: [CO]'s formant events hold F1-F3 alone, and taking them
// as "GS absent" switched the LF source off under coarticulation.
const FORMANT_KEYS = new Set(['F1', 'F2', 'F3']);
const sourceEvent = (t, on) => (t.GS !== undefined || on) && !Object.keys(t).every((k) => FORMANT_KEYS.has(k));
const toEvents = (events, sr) => events.map((e) => ({
  atSample: Math.floor((e.atMs ?? 0) * sr / 1000),
  target: e.target,
  transitionSamples: Math.max(1, Math.floor((e.transitionMs ?? 30) * sr / 1000)),
  ...(e.curve || e.params ? { curve: e.curve ?? 0, params: e.params ?? null } : {}),
  ...(e.nasalOnly ? { nasalOnly: true } : {}),
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
    this.resetSource();
    this.initNasal(init);

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

  // (sonicpi-toolchain patch) nasal path state; this.nasal turns on with the first target that has a nasal key
  initNasal(init) {
    this.nasal = hasNasal(init);
    for (const k of NASAL_PARAMS) if (!(k in this.current)) { this.current[k] = NASAL_DEFAULT[k]; this.target[k] = NASAL_DEFAULT[k]; }
    this.nasalSamples = 0;
    this.nasalIncrement = {};
    for (const k of NASAL_PARAMS) this.nasalIncrement[k] = 0;
    this.rnp = new KlattResonator();
    this.rnz = new KlattAntiresonator();
    this.rnp2 = new KlattResonator();
    this.rnz2 = new KlattAntiresonator();
    this.bpn = new BandpassBiquad();
  }

  // move the nasal parameters a target names to it over N samples (their own clock)
  retargetNasal(target, N) {
    if (!hasNasal(target)) return;
    this.nasal = true;
    this.nasalSamples = N;
    for (const k of NASAL_PARAMS) {
      if (k in target) this.target[k] = target[k];
      this.nasalIncrement[k] = (this.target[k] - this.current[k]) / N;
    }
  }

  // advance the nasal parameters one sample
  stepNasal() {
    const cur = this.current;
    for (const k of NASAL_PARAMS) cur[k] += this.nasalIncrement[k];
    if (--this.nasalSamples === 0) for (const k of NASAL_PARAMS) cur[k] = this.target[k];
  }

  // Schedule a new target. transitionMs samples are linearly interpolated
  // from current state to the new target
  setTarget(target, transitionMs = 30) {
    if ('GS' in target) this.setSource(target);
    const N = Math.max(1, Math.floor(transitionMs * this.sr / 1000));
    this.retargetNasal(target, N);
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
    this.resetSource();
    const init = initialTarget ?? {};
    this.current = { ...DEFAULT, ...init };
    this.target = { ...this.current };
    this.initNasal(init);
    for (const k of PARAMS) this.increment[k] = 0;
    this.transitionSamples = 0;
    this.schedule = [];
    this.scheduleIdx = 0;
    this.sampleCounter = 0;
    this.shaped = false;
    this.moves = [];
    this.mover = {};
  }

  // (sonicpi-toolchain patch) the [GS=1] voice source: an LF glottal flow derivative (dsp.js lfShape) with
  // KLSYN88-style spectral tilt, jitter, shimmer, flutter, pitch-synchronous noise and low-passed noise. Its settings
  // ride in the schedule targets as extended directives (absent = default); without GS the synth is untouched.
  //   GS    1 = LF source (0 or absent: the Rosenberg pulse, glottalPulse)
  //   RD    LF shape Rd at effort 0.5 (Fant 1995; 0.3 tense .. 1 modal .. 2.7 lax), default 1
  //   RDE   octaves Rd falls per unit of effort above 0.5 (effort g and accents move the tilt), default 6
  //   TL    extra tilt of the voiced source, dB down at 3 kHz (KLSYN88 TL; one-pole low-pass), default 0
  //   JIT   jitter: local (cycle-to-cycle) perturbation of the closure-to-closure period in %, default 0
  //   SHIM  shimmer: local cycle-to-cycle amplitude perturbation in %, default 0
  //   AM    noise modulated by the glottal flow while voiced, 0..1 (0 steady; depth AM * voicing), default 0
  //   FL    flutter, Klatt & Klatt 1990: slow F0 wander (FL/50)(F0/100)(sum of 12.7, 7.1, 4.7 Hz sines) Hz, default 0
  //   NT    frication noise ((1 - voicing) noise: fricatives, bursts, HH) low-passed, dB down at 3 kHz, default 0
  //         (Klatt's noise generator: "a soft low-pass filter", y = x + 0.75 y1 at 10 kHz, ~15 dB at 3 kHz)
  //   AT    aspiration (h) noise low-passed, dB down at 3 kHz, default 0
  resetSource() {
    this.src = { GS: 0, RD: 1, RDE: 6, TL: 0, JIT: 0, SHIM: 0, AM: 0, FL: 0, AT: 0, NT: 0 };
    this.lfCache = this.lfCache ?? new Map();
    this.lf = null;          // the current cycle's shape
    this.cycleAmp = 1;       // shimmer factor of the current cycle
    this.cycleRate = 1;      // jitter factor of the current closure-to-closure period (phase speed)
    this.flow = 0;           // running glottal flow in the cycle (for pitch-synchronous noise)
    this.tlA = 0;            // TL one-pole coefficient
    this.tlPrev = 0;
    this.atA = 0; this.atPrev = 0;   // AT: aspiration-noise one-pole low-pass (coefficient, state)
    this.ntA = 0; this.ntPrev = 0;   // NT: frication-noise one-pole low-pass
    this.jrng = 0x2545F491 | 0;
  }

  setSource(t) {
    const s = this.src;
    s.GS = t.GS ? 1 : 0;
    s.RD = t.RD ?? 1;
    s.RDE = t.RDE ?? 6;
    s.TL = t.TL ?? 0;
    s.JIT = t.JIT ?? 0;
    s.SHIM = t.SHIM ?? 0;
    s.AM = t.AM === undefined ? 0 : t.AM < 0 ? 0 : t.AM > 1 ? 1 : t.AM;
    s.FL = t.FL ?? 0;
    this.tlA = tiltCoef(s.TL, 3000, this.sr);
    s.AT = t.AT ?? 0; s.NT = t.NT ?? 0;
    this.atA = tiltCoef(s.AT, 3000, this.sr);
    this.ntA = tiltCoef(s.NT, 3000, this.sr);
  }

  lfShapeFor(effort) {
    const s = this.src;
    const rd = s.RD * Math.pow(2, -s.RDE * (effort - 0.5));
    const key = Math.round(rd * 1000);
    let shape = this.lfCache.get(key);
    if (!shape) { shape = lfShape(key / 1000); this.lfCache.set(key, shape); }
    return shape;
  }

  // approximately normal, unit variance (sum of 4 uniforms), from the source's own generator
  gauss() {
    let x = 0;
    for (let i = 0; i < 4; i++) { this.jrng = xorshift(this.jrng); x += this.jrng / 2147483648; }
    return x * 0.8660254037844386;   // sqrt(3/4): var of a sum of 4 U(-1,1) is 4/3
  }

  // A new glottal cycle (phase 0, where the flow derivative is 0): its shape from the current effort and its
  // shimmer. A local shimmer of S% needs a per-period sd of S / 1.128 % (mean |d1 - d2| of two iid normals is
  // 1.128 sd); likewise jitter.
  newCycle(cur) {
    const s = this.src;
    this.lf = this.lfShapeFor(cur.effort);
    const ss = s.SHIM / 112.8;
    const g = ss ? Math.max(-3, Math.min(3, this.gauss())) : 0;
    this.cycleAmp = Math.max(0, 1 + ss * g);
    this.flow = 0;
  }

  // Jitter: a new phase speed at each glottal closure (te, the main excitation), so the closure-to-closure
  // intervals, the periods an analysis (Praat's) measures, are the perturbed ones. Drawn at the cycle start
  // instead, each closure interval would mix two periods ((1 - te) T_i + te T_i+1) and measure ~half the jitter.
  newRate() {
    const sj = this.src.JIT / 112.8;
    const g = sj ? Math.max(-3, Math.min(3, this.gauss())) : 0;
    this.cycleRate = 1 / (1 + sj * g);
  }

  lfSample(cur, effF0, v, voicedGain, noiseSample) {
    const s = this.src;
    if (!this.lf) this.newCycle(cur);
    let f0 = effF0;
    if (s.FL) {
      const t = this.sampleCounter / this.sr, w = 2 * Math.PI * t;
      f0 += (s.FL / 50) * (effF0 / 100) * (Math.sin(12.7 * w) + Math.sin(7.1 * w) + Math.sin(4.7 * w));
    }
    const raw = lfPulse(this.glottalPhase, this.lf);
    let voiced = raw * this.cycleAmp;
    if (this.tlA) { voiced = (1 - this.tlA) * voiced + this.tlA * this.tlPrev; this.tlPrev = voiced; }
    let nA = noiseSample, nF = noiseSample;
    if (this.atA) { this.atPrev = (1 - this.atA) * noiseSample + this.atA * this.atPrev; nA = this.atPrev; }
    if (this.ntA) { this.ntPrev = (1 - this.ntA) * noiseSample + this.ntA * this.ntPrev; nF = this.ntPrev; }
    let asp = cur.aspiration * nA * 0.5;
    let fric = (1 - v) * nF * 0.35;
    // pitch-synchronous noise: while the folds vibrate (v > 0) turbulence follows the glottal flow, so both noise
    // sources are scaled by (1 - a) + a u (u = flow / peak flow, 0 in the closed phase) at depth a = AM v, normalised
    // to the same mean power (Klatt 1980 and KLSYN88 halve the noise in the second half of each voiced period;
    // Klatt & Klatt 1990). Voiceless noise (v = 0: HH, S, bursts) stays steady.
    if (s.AM && v > 0) {
      const L = this.lf, a = s.AM * v;
      const u = this.flow > 0 ? this.flow / 0.1 : 0;
      const norm = Math.sqrt((1 - a) * (1 - a) + 2 * (1 - a) * a * L.uMean + a * a * L.uSq);
      const m = ((1 - a) + a * u) / norm;
      asp *= m; fric *= m;
    }
    const dphase = f0 * this.cycleRate / this.sr;
    this.flow += raw * dphase;
    const before = this.glottalPhase;
    this.glottalPhase += dphase;
    if (before < this.lf.te && this.glottalPhase >= this.lf.te) this.newRate();
    if (this.glottalPhase >= 1) {
      this.glottalPhase -= Math.floor(this.glottalPhase);
      this.newCycle(cur);
    }
    return v * voiced * voicedGain + fric + asp;
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
          this.retargetNasal(evt.target, evt.transitionSamples);
          if (evt.nasalOnly) continue;      // (sonicpi-toolchain patch) moves the nasal parameters alone
          if (sourceEvent(evt.target, this.src.GS)) this.setSource(evt.target);   // the voice source in shaped mode too
          this.startMove(evt.target, evt.transitionSamples, evt.curve, evt.params);
        }
        this.sampleCounter++;
        if (this.moves.length) this.stepMoves();
      } else {
      // Drain any baked-in schedule events whose time has arrived
      while (this.scheduleIdx < this.schedule.length
          && this.schedule[this.scheduleIdx].atSample <= this.sampleCounter) {
        const evt = this.schedule[this.scheduleIdx++];
        this.retargetNasal(evt.target, evt.transitionSamples);
        if (evt.nasalOnly) continue;        // (sonicpi-toolchain patch) moves the nasal parameters alone
        if (sourceEvent(evt.target, this.src.GS)) this.setSource(evt.target);
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
      if (this.nasalSamples > 0) this.stepNasal();

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
      const voicedGain = 1 - cur.aspiration * 0.85;
      let exc;
      if (!this.src.GS) {
        const pulseVal = glottalPulse(this.glottalPhase, cur.effort);
        exc = v * pulseVal * voicedGain
            + (1 - v) * noiseSample * 0.35
            + cur.aspiration * noiseSample * 0.5;
        this.glottalPhase += effF0 / this.sr;
        this.glottalPhase -= Math.floor(this.glottalPhase);
      } else {
        exc = this.lfSample(cur, effF0, v, voicedGain, noiseSample);
      }

      this.bp1.setFreq(cur.F1, cur.BW1, this.sr);
      this.bp2.setFreq(cur.F2, cur.BW2, this.sr);
      this.bp3.setFreq(cur.F3, cur.BW3, this.sr);

      let y;
      if (!this.nasal) {
        y = (this.bp1.process(exc) * cur.A1
          +  this.bp2.process(exc) * cur.A2
          +  this.bp3.process(exc) * cur.A3) * cur.gain * tremoloMod;
      } else {
        // (sonicpi-toolchain patch) nasal pole-zero pairs in cascade before the parallel formants, AN in parallel
        this.rnp.setFreq(cur.FNP, cur.BNP, this.sr);
        this.rnz.setFreq(cur.FNZ, cur.BNZ, this.sr);
        this.rnp2.setFreq(cur.FNP2, cur.BNP2, this.sr);
        this.rnz2.setFreq(cur.FNZ2, cur.BNZ2, this.sr);
        this.bpn.setFreq(cur.FNP, cur.BNP, this.sr);
        const en = this.rnz2.process(this.rnp2.process(this.rnz.process(this.rnp.process(exc))));
        y = (this.bp1.process(en) * cur.A1
          +  this.bp2.process(en) * cur.A2
          +  this.bp3.process(en) * cur.A3
          +  this.bpn.process(exc) * cur.AN) * cur.GN * cur.gain * tremoloMod;
      }

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
