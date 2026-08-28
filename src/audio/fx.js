// Beat FX send bus: echo, reverb, flanger, swept filter.
// Wet-only (it is fed from a channel's fxSend) with tempo-synced times.

import { audioCtx } from './graph.js';

function makeImpulse(seconds = 2.2, decay = 3.2) {
  const c = audioCtx();
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

export class FXUnit {
  constructor(destination) {
    const c = audioCtx();
    this.input = c.createGain();
    this.output = c.createGain();
    this.output.gain.value = 0;
    this.output.connect(destination);

    // ECHO
    this.echoIn = c.createGain();
    this.delay = c.createDelay(4);
    this.delay.delayTime.value = 0.5;
    this.fb = c.createGain(); this.fb.gain.value = 0.45;
    this.echoIn.connect(this.delay);
    this.delay.connect(this.fb).connect(this.delay);
    this.delay.connect(this.output);

    // REVERB
    this.revIn = c.createGain();
    this.conv = c.createConvolver();
    this.conv.buffer = makeImpulse();
    this.revIn.connect(this.conv).connect(this.output);

    // FLANGER
    this.flIn = c.createGain();
    this.flDelay = c.createDelay(0.05);
    this.flDelay.delayTime.value = 0.005;
    this.flFb = c.createGain(); this.flFb.gain.value = 0.3;
    this.lfo = c.createOscillator(); this.lfo.frequency.value = 0.25;
    this.lfoGain = c.createGain(); this.lfoGain.gain.value = 0.002;
    this.lfo.connect(this.lfoGain).connect(this.flDelay.delayTime);
    this.lfo.start();
    this.flIn.connect(this.flDelay);
    this.flDelay.connect(this.flFb).connect(this.flDelay);
    this.flDelay.connect(this.output);

    // FILTER (LFO-swept lowpass)
    this.fltIn = c.createGain();
    this.flt = c.createBiquadFilter();
    this.flt.type = 'lowpass'; this.flt.frequency.value = 1200; this.flt.Q.value = 6;
    this.fltLfo = c.createOscillator(); this.fltLfo.frequency.value = 0.5;
    this.fltLfoGain = c.createGain(); this.fltLfoGain.gain.value = 900;
    this.fltLfo.connect(this.fltLfoGain).connect(this.flt.frequency);
    this.fltLfo.start();
    this.fltIn.connect(this.flt).connect(this.output);

    this.chains = [this.echoIn, this.revIn, this.flIn, this.fltIn];
    this.type = -1;
    this.setType(0);
  }

  setType(i) {
    if (i === this.type) return;
    this.chains.forEach((node) => { try { this.input.disconnect(node); } catch { /* not connected */ } });
    this.input.connect(this.chains[i]);
    this.type = i;
  }

  /** @param {number} sec beat-derived time @param {number} depth 0..1 */
  setParams(sec, depth) {
    const c = audioCtx();
    const t = c.currentTime;
    this.delay.delayTime.setTargetAtTime(Math.max(0.02, Math.min(4, sec)), t, 0.05);
    this.fb.gain.setTargetAtTime(0.2 + depth * 0.55, t, 0.05);
    this.lfo.frequency.setTargetAtTime(Math.max(0.05, 1 / Math.max(0.05, sec * 4)), t, 0.05);
    this.lfoGain.gain.setTargetAtTime(0.0008 + depth * 0.004, t, 0.05);
    this.fltLfo.frequency.setTargetAtTime(Math.max(0.05, 1 / Math.max(0.05, sec)), t, 0.05);
    this.flt.frequency.setTargetAtTime(400 + (1 - depth) * 2600, t, 0.05);
  }

  setWet(v) { this.output.gain.setTargetAtTime(v, audioCtx().currentTime, 0.02); }
}
