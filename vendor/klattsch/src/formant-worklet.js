// Thin AudioWorklet wrapper around FormantSynth. The DSP lives in the engine
// module so it can be reused outside the browser

import { FormantSynth } from './engine/synth-core.js';

class FormantProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options?.processorOptions ?? {};
    this.synths = [];                                   // index = voice

    const ensure = (v) => (this.synths[v] ??= new FormantSynth({ sampleRate }));

    // Legacy single-voice construction options seed voice 0.
    if (opts.schedule || opts.initialTarget) {
      this.synths[0] = new FormantSynth({
        sampleRate,
        initialTarget: opts.initialTarget,
        schedule: opts.schedule,
      });
    }
    // Multi-voice construction.
    if (Array.isArray(opts.schedules)) {
      opts.schedules.forEach((s, i) => { if (s && s.length) ensure(i).queueSchedule(s); });
    }

    this.port.onmessage = (e) => {
      const msg = e.data;
      const v = msg?.voice ?? null;
      if (msg?.type === 'frame') {
        ensure(v ?? 0).setTarget(msg.target, msg.transitionMs);
      } else if (msg?.type === 'schedule') {
        const startCounter = msg.startTime != null
          ? Math.round((currentTime - msg.startTime) * sampleRate)
          : 0;
        ensure(v ?? 0).queueSchedule(msg.schedule, startCounter);
      } else if (msg?.type === 'reset') {
        if (v == null) {
          for (const s of this.synths) s?.reset(msg.initialTarget);
        } else {
          ensure(v).reset(msg.initialTarget);
        }
      }
    };
  }

  process(_inputs, outputs) {
    for (let v = 0; v < outputs.length; v++) {
      const chans = outputs[v];
      const synth = this.synths[v];
      if (!chans?.length || !synth) continue;           // no synth => zero-filled silence
      synth.process(chans[0]);
      for (let c = 1; c < chans.length; c++) chans[c].set(chans[0]);
    }
    return true;
  }
}

registerProcessor('formant-processor', FormantProcessor);
