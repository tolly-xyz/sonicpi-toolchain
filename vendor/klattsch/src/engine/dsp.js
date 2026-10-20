// Low-level DSP primitives used by the formant synth core.

// Constant-skirt-gain bandpass biquad (RBJ Audio EQ Cookbook)
// Coefficients are recomputed only when frequency or bandwidth changes
export class BandpassBiquad {
  constructor() {
    this.x1 = 0; this.x2 = 0;
    this.y1 = 0; this.y2 = 0;
    this.b0 = 0; this.b1 = 0; this.b2 = 0;
    this.a1 = 0; this.a2 = 0;
    this.lastF = -1; this.lastBW = -1;
  }
  setFreq(f, bw, sr) {
    if (f === this.lastF && bw === this.lastBW) return;
    this.lastF = f; this.lastBW = bw;
    f = Math.max(40, Math.min(sr * 0.45, f));
    bw = Math.max(20, bw);
    const w0 = 2 * Math.PI * f / sr;
    const cosw0 = Math.cos(w0);
    const sinw0 = Math.sin(w0);
    const Q = f / bw;
    const alpha = sinw0 / (2 * Q);
    const a0 = 1 + alpha;
    this.b0 =  alpha / a0;
    this.b1 =  0;
    this.b2 = -alpha / a0;
    this.a1 = -2 * cosw0 / a0;
    this.a2 = (1 - alpha) / a0;
  }
  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2
            - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
  reset() {
    this.x1 = 0; this.x2 = 0;
    this.y1 = 0; this.y2 = 0;
  }
}

// Derivative of the Rosenberg glottal pulse. Phase normalized to [0, 1).
// Peak |value| is pi / (2·Tn) ~= 9.82, so we divide by 10 to keep amplitude
// near unity.
//
// `effort` (0..1) controls the pulse shape: 0 is lax/breathy (longer Tp,
// gentler closure), 1 is tense (shorter Tp, sharper closure)
export function glottalPulse(phase, effort = 0.5) {
  const e = effort < 0 ? 0 : effort > 1 ? 1 : effort;
  const Tp = 0.5 - e * 0.2;     // 0.5 (lax) -> 0.3 (tense)
  const Tn = 0.25 - e * 0.17;   // 0.25 (lax) -> 0.08 (tense)
  const NORM = 0.1;
  if (phase < Tp) {
    return NORM * 0.5 * (Math.PI / Tp) * Math.sin(Math.PI * phase / Tp);
  }
  if (phase < Tp + Tn) {
    return -NORM * (Math.PI / (2 * Tn)) * Math.sin(Math.PI * (phase - Tp) / (2 * Tn));
  }
  return 0;
}

// (sonicpi-toolchain patch) Liljencrants-Fant glottal flow derivative, used only with [GS=1].
//
// Fant, Liljencrants & Lin (1985), "A four-parameter model of glottal flow", STL-QPSR 26(4): over one period
// (time t in periods, T0 = 1)
//   open phase    0 <= t < te:  E(t) = E0 exp(alpha t) sin(pi t / tp)
//   return phase te <= t < 1:   E(t) = -(Ee / (eps ta)) (exp(-eps (t - te)) - exp(-eps (1 - te)))
// with eps ta = 1 - exp(-eps (1 - te)) and alpha such that the flow returns to zero (no net flow per period).
// The return phase is a first-order low-pass on the source spectrum above Fa = F0 / (2 pi ta): the LF pulse's
// spectral tilt. The timing comes from one shape parameter, Rd (Fant 1995, "The LF-model revisited", STL-QPSR
// 36(2-3), eqs. for Ra, Rk, Rg; valid 0.3..2.7): Rd ~0.3-0.7 tense/pressed, ~1 modal, 2-2.7 lax/breathy.
//   Ra = (-1 + 4.8 Rd) / 100, Rk = (22.4 + 11.8 Rd) / 100, Rg = Rk / (4 (0.11 Rd / (0.5 + 1.2 Rk) - Ra))
//   tp = 1 / (2 Rg), te = tp (1 + Rk), ta = Ra
// The pulse is scaled to a peak flow of 0.1 per period, the peak flow of glottalPulse() above, so low frequencies
// keep about the Rosenberg pulse's level and Rd moves the highs. Also returned: mean and mean square of the
// normalized flow u = U / U0 over a period (for pitch-synchronous noise), and the shape's timing.
export const LF_RD_MIN = 0.3, LF_RD_MAX = 2.7;
export function lfShape(rd) {
  const Rd = rd < LF_RD_MIN ? LF_RD_MIN : rd > LF_RD_MAX ? LF_RD_MAX : rd;
  const Ra = (-1 + 4.8 * Rd) / 100;
  const Rk = (22.4 + 11.8 * Rd) / 100;
  const Rg = Rk / (4 * (0.11 * Rd / (0.5 + 1.2 * Rk) - Ra));
  const tp = 1 / (2 * Rg), te = tp * (1 + Rk), ta = Ra, tr = 1 - te;
  const wg = Math.PI / tp;
  // eps: eps ta = 1 - exp(-eps tr) (Newton from 1/ta; converges in a few steps)
  let eps = 1 / ta;
  for (let i = 0; i < 50; i++) {
    const ex = Math.exp(-eps * tr);
    const f = eps * ta - 1 + ex, d = ta - tr * ex;
    const step = f / d;
    eps -= step;
    if (Math.abs(step) < 1e-12 * eps) break;
  }
  // with Ee = 1: flow removed by the return phase, and the flow at te left by the open phase (a function of alpha)
  const exr = Math.exp(-eps * tr);
  const retFlow = (1 / (eps * ta)) * ((1 - exr) / eps - tr * exr);
  const sinTe = Math.sin(wg * te), cosTe = Math.cos(wg * te);
  const openFlow = (a) => {
    const e0 = -1 / (Math.exp(a * te) * sinTe);
    return e0 * (Math.exp(a * te) * (a * sinTe - wg * cosTe) + wg) / (a * a + wg * wg);
  };
  // openFlow falls as alpha grows: bisection on a bracket around the root
  let lo = -20, hi = 20;
  while (openFlow(lo) < retFlow && lo > -1e4) lo *= 2;
  while (openFlow(hi) > retFlow && hi < 1e4) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (openFlow(mid) > retFlow) lo = mid; else hi = mid;
    if (hi - lo < 1e-12) break;
  }
  const alpha = 0.5 * (lo + hi);
  const E0 = -1 / (Math.exp(alpha * te) * sinTe);
  const U0 = E0 * wg * (Math.exp(alpha * tp) + 1) / (alpha * alpha + wg * wg);   // the flow at tp, its peak
  const k = 0.1 / U0;
  const s = { Rd, tp, te, ta, eps, alpha, wg, E0: E0 * k, Ee: k, retTail: exr, uMean: 0, uSq: 0 };
  // flow statistics by the analytic flow (open phase) and its return-phase decay, 2000 points
  const N = 2000;
  let m = 0, q = 0;
  const Ute = openFlow(alpha) * k;
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    let U;
    if (t < te) U = s.E0 * (Math.exp(alpha * t) * (alpha * Math.sin(wg * t) - wg * Math.cos(wg * t)) + wg) / (alpha * alpha + wg * wg);
    else {
      const x = t - te;
      U = Ute - (k / (eps * ta)) * ((1 - Math.exp(-eps * x)) / eps - x * exr);
    }
    const u = U < 0 ? 0 : U / 0.1;
    m += u; q += u * u;
  }
  s.uMean = m / N; s.uSq = q / N;
  return s;
}

// The LF flow derivative at phase t (0..1) of a shape from lfShape()
export function lfPulse(t, s) {
  if (t < s.te) return s.E0 * Math.exp(s.alpha * t) * Math.sin(s.wg * t);
  return -(s.Ee / (s.eps * s.ta)) * (Math.exp(-s.eps * (t - s.te)) - s.retTail);
}

// One-pole low-pass coefficient a (y = (1 - a) x + a y1, unity gain at DC) that attenuates by `db` at `hz`:
// KLSYN88's spectral tilt TL, "dB down at 3 kHz" (Klatt & Klatt 1990). 0 for db <= 0.
export function tiltCoef(db, hz, sr) {
  if (!(db > 0)) return 0;
  const G = Math.pow(10, -db / 10), c = Math.cos(2 * Math.PI * Math.min(hz, sr * 0.49) / sr);
  // (1 - a)^2 = G (1 - 2 a c + a^2)  ->  (1 - G) a^2 - 2 (1 - G c) a + (1 - G) = 0, smaller root
  const A = 1 - G, B = 1 - G * c;
  return (B - Math.sqrt(Math.max(0, B * B - A * A))) / A;
}

// 32-bit xorshift LFSR
export function xorshift(state) {
  let x = state | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x | 0;
}

// Soft-clip with a linear region up to ±0.85 and a smooth knee
export function softClip(x) {
  const T = 0.85;
  const a = x < 0 ? -x : x;
  if (a <= T) return x;
  const sign = x < 0 ? -1 : 1;
  const excess = a - T;
  return sign * (T + (1 - T) * excess / (excess + 1));
}
