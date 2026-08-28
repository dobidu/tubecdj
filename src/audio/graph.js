// Web Audio graph — used by Local Audio Mode and the sampler.
// source -> trim -> hi/mid/low -> filter -> [fxSend] -> fader -> xfader
//        -> master -> limiter -> destination

const RAMP = 0.01; // setTargetAtTime time constant; never assign gains directly

let ctx = null;
export function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  return ctx;
}
export async function resumeAudio() {
  const c = audioCtx();
  if (c.state === 'suspended') { try { await c.resume(); } catch { /* gesture needed */ } }
  return c;
}
const ramp = (param, v, t = RAMP) => param.setTargetAtTime(v, audioCtx().currentTime, t);

export class MasterBus {
  constructor() {
    const c = audioCtx();
    this.bus = c.createGain();
    this.gain = c.createGain();
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -1;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.1;
    this.bypass = c.createGain();
    this.bus.connect(this.gain);
    this.gain.connect(this.limiter).connect(c.destination);
    this.gain.connect(this.bypass);
    this.limiterOn = true;
    this.bypass.gain.value = 0;
  }
  setMaster(v) { ramp(this.gain.gain, v); }
  setLimiter(on) {
    if (on === this.limiterOn) return;
    this.limiterOn = on;
    // crossfade limiter vs. direct path so toggling never clicks
    ramp(this.limiter.threshold, on ? -1 : 0, 0.02);
    ramp(this.bypass.gain, on ? 0 : 1, 0.02);
    ramp(this.limiter.ratio, on ? 20 : 1, 0.02);
  }
}

export class ChannelStrip {
  constructor(master) {
    const c = audioCtx();
    this.master = master;
    this.trim = c.createGain();
    this.hi = c.createBiquadFilter(); this.hi.type = 'highshelf'; this.hi.frequency.value = 3200;
    this.mid = c.createBiquadFilter(); this.mid.type = 'peaking'; this.mid.frequency.value = 1000; this.mid.Q.value = 1;
    this.low = c.createBiquadFilter(); this.low.type = 'lowshelf'; this.low.frequency.value = 250;
    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000; this.lp.Q.value = 0.9;
    this.hp = c.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 20; this.hp.Q.value = 0.9;
    this.fader = c.createGain();
    this.xf = c.createGain();
    this.fxSend = c.createGain(); this.fxSend.gain.value = 0;
    this.analyser = c.createAnalyser(); this.analyser.fftSize = 1024; this.analyser.smoothingTimeConstant = 0.4;
    this._buf = new Float32Array(this.analyser.fftSize);

    this.trim.connect(this.hi).connect(this.mid).connect(this.low).connect(this.lp).connect(this.hp);
    this.hp.connect(this.fader).connect(this.xf).connect(master.bus);
    this.hp.connect(this.fxSend);
    this.xf.connect(this.analyser);
  }
  get input() { return this.trim; }
  setTrim(v) { ramp(this.trim.gain, v * 1.4); }
  /** knob 0..1 -> ±26 dB */
  setEq(hi, mid, low) {
    ramp(this.hi.gain, (hi - 0.5) * 52, 0.02);
    ramp(this.mid.gain, (mid - 0.5) * 52, 0.02);
    ramp(this.low.gain, (low - 0.5) * 52, 0.02);
  }
  /** bipolar filter: <.5 lowpass 20k->200Hz, >.5 highpass 20->2000Hz, bypass at .5 */
  setFilter(v) {
    const lp = v < 0.5 ? 200 * Math.pow(20000 / 200, v / 0.5) : 20000;
    const hp = v > 0.5 ? 20 * Math.pow(2000 / 20, (v - 0.5) / 0.5) : 20;
    ramp(this.lp.frequency, lp, 0.02);
    ramp(this.hp.frequency, hp, 0.02);
  }
  setFader(v) { ramp(this.fader.gain, v); }
  setXf(v, tc) { ramp(this.xf.gain, v, tc ?? RAMP); }
  setFxSend(v) { ramp(this.fxSend.gain, v); }
  /** RMS 0..1 for the VU meter. */
  level() {
    this.analyser.getFloatTimeDomainData(this._buf);
    let sum = 0;
    for (let i = 0; i < this._buf.length; i++) sum += this._buf[i] * this._buf[i];
    return Math.min(1, Math.sqrt(sum / this._buf.length) * 3.2);
  }
}

/** AudioBuffer transport with CDJ semantics (seek, rate, beat loop). */
export class LocalTrack {
  constructor(buffer, destination) {
    this.buffer = buffer;
    this.dest = destination;
    this.src = null;
    this.rate = 1;
    this.playing = false;
    this._offset = 0;             // buffer time at the last anchor
    this._anchorAt = 0;           // ctx time of the last anchor
    this.loop = null;             // { start, end }
  }
  get duration() { return this.buffer.duration; }
  get pos() {
    if (!this.playing) return this._offset;
    let p = this._offset + (audioCtx().currentTime - this._anchorAt) * this.rate;
    if (this.loop) {
      const len = this.loop.end - this.loop.start;
      if (len > 0 && p > this.loop.end) p = this.loop.start + ((p - this.loop.start) % len);
    }
    return Math.min(p, this.duration);
  }
  _start(from) {
    this._stopSource();
    const c = audioCtx();
    const s = c.createBufferSource();
    s.buffer = this.buffer;
    s.playbackRate.value = this.rate;
    if (this.loop) { s.loop = true; s.loopStart = this.loop.start; s.loopEnd = this.loop.end; }
    s.connect(this.dest);
    s.start(0, Math.max(0, Math.min(from, this.duration - 0.01)));
    this.src = s;
    this._offset = from;
    this._anchorAt = c.currentTime;
  }
  _stopSource() {
    if (!this.src) return;
    try { this.src.stop(); } catch { /* already stopped */ }
    this.src.disconnect();
    this.src = null;
  }
  play() { if (!this.playing) { this.playing = true; this._start(this._offset); } }
  pause() { if (this.playing) { this._offset = this.pos; this.playing = false; this._stopSource(); } }
  seek(t) {
    this._offset = Math.max(0, Math.min(t, this.duration));
    if (this.playing) this._start(this._offset);
  }
  setRate(r) {
    if (Math.abs(r - this.rate) < 0.0005) return;
    if (this.playing) { this._offset = this.pos; this._anchorAt = audioCtx().currentTime; }
    this.rate = r;
    if (this.src) this.src.playbackRate.setTargetAtTime(r, audioCtx().currentTime, 0.02);
  }
  setLoop(start, end) {
    this.loop = end > start ? { start, end } : null;
    if (this.src) {
      if (this.loop) { this.src.loop = true; this.src.loopStart = start; this.src.loopEnd = end; }
      else this.src.loop = false;
    }
  }
  dispose() { this._stopSource(); }
}
