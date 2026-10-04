// SPTON engine: Web Audio driver for the SP-1200 DSP core.
//
// One lookahead scheduler (25ms tick, 120ms horizon) walks every track's
// active clip. Clip launch/stop is quantized to the bar, Ableton-style.
// Voices are the SP-1200 path: 12-bit/26.04kHz buffers, varispeed tuning,
// sample loop points, hat choking — see sp1200's playPadOn.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SPTON_ENGINE = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const LOOKAHEAD = 0.12, TICK_MS = 25;

  class Engine {
    constructor(project, DSP) {
      this.project = project;
      this.DSP = DSP;
      this.ctx = null;
      this.playing = false;
      this.bpm = project.bpm || 128;
      this.swing = project.swing || 54;
      this.metronome = false;
      this.recArmed = false;
      this.recordTarget = null; // clip or null
      this.active = new Array(project.tracks.length).fill(null);   // clip | null
      this.pending = new Array(project.tracks.length).fill(null);  // {clip}|{stop:true}|null
      this.strips = [];      // per-track {input, vol, pan}
      this.bufCache = [];    // per-track per-pad {key, buf}
      this.voices = [];      // per-track per-pad [voice]
      this.master = null;
      this.timer = null;
      this.step = 0;
      this.barStart = 0;
      this.lastFired = { step: -1, time: 0 };
      this.onchange = null;
    }

    _emit() { if (this.onchange) { try { this.onchange(); } catch (e) {} } }

    ensureAudio() {
      if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      const n = this.project.tracks.length;
      for (let i = 0; i < n; i++) {
        const input = this.ctx.createGain();
        const vol = this.ctx.createGain();
        const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
        input.connect(vol);
        if (pan) { vol.connect(pan); pan.connect(this.master); }
        else vol.connect(this.master);
        this.strips.push({ input, vol, pan });
        this.bufCache.push(new Array(8).fill(null));
        this.voices.push(Array.from({ length: 8 }, () => []));
        this._applyStrip(i);
      }
    }

    setMasterVol(v) { if (this.master) this.master.gain.value = v; }

    _applyStrip(ti) {
      if (!this.ctx) return;
      const t = this.project.tracks[ti], s = this.strips[ti];
      const anySolo = this.project.tracks.some((x) => x.solo);
      const muted = t.mute || (anySolo && !t.solo);
      s.vol.gain.setTargetAtTime(muted ? 0 : t.vol, this.ctx.currentTime, 0.015);
      if (s.pan) s.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, t.pan)), this.ctx.currentTime, 0.015);
    }

    refreshStrips() { for (let i = 0; i < this.strips.length; i++) this._applyStrip(i); }

    // ---- sample baking: the SP-1200 converter path, cached per pad ----
    // Pads are either synth drums or slices of the track's imported sample;
    // both run through the same 12-bit/varispeed/loop voice path.
    _buf(ti, pi) {
      const t = this.project.tracks[ti], pad = t.pads[pi];
      let key, data, sr;
      const sl = pad.src === "sample" && t.sample && t.sample.data ? pad.sample : null;
      if (sl) {
        key = "smp|" + t.sample.id + "|" + sl.start.toFixed(4) + "|" + sl.end.toFixed(4) +
          "|" + (t.spMode ? "sp" : "raw");
        const hit = this.bufCache[ti][pi];
        if (hit && hit.key === key) return hit.buf;
        const trimmed = this.DSP.trimSample(t.sample.data, sl.start, sl.end);
        data = t.spMode ? this.DSP.sp1200ize(trimmed, t.sample.sr) : trimmed;
        sr = t.spMode ? this.DSP.SP_RATE : t.sample.sr;
      } else {
        key = pad.drum + "|" + (t.spMode ? "sp" : "raw");
        const hit = this.bufCache[ti][pi];
        if (hit && hit.key === key) return hit.buf;
        data = t.spMode ? this.DSP.SYNTHS[pad.drum]() : this.DSP.SYNTHS_RAW[pad.drum]();
        sr = t.spMode ? this.DSP.SP_RATE : this.DSP.SYNTH_RATE;
      }
      const buf = this.ctx.createBuffer(1, Math.max(1, data.length), sr);
      buf.getChannelData(0).set(data);
      this.bufCache[ti][pi] = { key, buf };
      return buf;
    }

    rebake(ti, pi) {
      // safe before ensureAudio(): the cache is empty until the ctx exists
      if (this.bufCache[ti]) this.bufCache[ti][pi] = null;
      if (this.ctx) this._buf(ti, pi);
    }

    // Audition a raw slice (waveform clicks) straight to master, no SP path.
    previewSlice(data, sr, start, end) {
      this.ensureAudio();
      const trimmed = this.DSP.trimSample(data, start, end);
      if (!trimmed.length) return;
      const buf = this.ctx.createBuffer(1, trimmed.length, sr);
      buf.getChannelData(0).set(trimmed);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = 0.9;
      src.connect(g); g.connect(this.master);
      src.start(this.ctx.currentTime);
    }

    _kill(ti, pi, when) {
      for (const v of this.voices[ti][pi]) {
        try { v.gain.gain.setTargetAtTime(0, when, 0.008); v.src.stop(when + 0.06); } catch (e) {}
      }
      this.voices[ti][pi] = [];
    }

    _voice(ti, pi, t) {
      const ctx = this.ctx, t_ = this.project.tracks[ti], pad = t_.pads[pi];
      // hat choke: closed cuts open and vice versa, like the hardware
      if (pad.drum === "chat" || pad.drum === "ohat") {
        for (let q = 0; q < 8; q++) {
          const d = t_.pads[q].drum;
          if ((d === "chat" || d === "ohat")) this._kill(ti, q, t);
        }
      }
      if (pad.loopOn) this._kill(ti, pi, t); // looping voices retrigger-cut
      const src = ctx.createBufferSource();
      src.buffer = this._buf(ti, pi);
      src.playbackRate.value = pad.tune; // varispeed, exactly like the hardware
      if (pad.loopOn && pad.loopEnd - pad.loopStart > 1e-4) {
        src.loop = true;
        src.loopStart = Math.max(0, Math.min(1, pad.loopStart)) * src.buffer.duration;
        src.loopEnd = Math.max(0, Math.min(1, pad.loopEnd)) * src.buffer.duration;
      }
      const g = ctx.createGain();
      g.gain.value = pad.level;
      src.connect(g); g.connect(this.strips[ti].input);
      const voice = { src, gain: g };
      this.voices[ti][pi].push(voice);
      src.onended = () => {
        const a = this.voices[ti][pi].indexOf(voice);
        if (a >= 0) this.voices[ti][pi].splice(a, 1);
      };
      src.start(t);
    }

    // Audition a pad now (browser click / keyboard). Records into the
    // record target when session-record is armed and transport runs.
    triggerPad(ti, pi) {
      this.ensureAudio();
      const t = this.ctx.currentTime;
      this._voice(ti, pi, t);
      if (this.recArmed && this.playing && this.recordTarget && this.lastFired.step >= 0) {
        const M = (typeof self !== "undefined" ? self : globalThis).SPTON_MODEL;
        M.setStep(this.recordTarget, pi, this.lastFired.step, true);
        this._emit();
      }
    }

    // ---- transport ----
    play() {
      this.ensureAudio();
      if (this.playing) return;
      this.playing = true;
      this.step = 0;
      this.barStart = this.ctx.currentTime + 0.06;
      // stopped transport: pending launches take effect immediately
      this._applyPending();
      this.timer = setInterval(() => this._tick(), TICK_MS);
      this._emit();
    }

    stop() {
      this.playing = false;
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      if (this.ctx) {
        for (let i = 0; i < this.voices.length; i++)
          for (let q = 0; q < 8; q++) this._kill(i, q, this.ctx.currentTime);
      }
      this.lastFired = { step: -1, time: 0 };
      this._emit();
    }

    toggle() { this.playing ? this.stop() : this.play(); }

    _barDur() { return (60 / this.bpm) * 4; }

    _applyPending() {
      let changed = false;
      for (let i = 0; i < this.pending.length; i++) {
        const p = this.pending[i];
        if (!p) continue;
        this.active[i] = p.stop ? null : p.clip;
        this.pending[i] = null;
        changed = true;
      }
      if (changed) this._emit();
    }

    _tick() {
      if (!this.playing || !this.ctx) return;
      const DSP = this.DSP, horizon = this.ctx.currentTime + LOOKAHEAD;
      for (;;) {
        const t = this.barStart + DSP.stepTime16(this.step, this.bpm, this.swing);
        if (t >= horizon) break;
        if (this.step === 0) this._applyPending(); // quantization boundary
        for (let ti = 0; ti < this.project.tracks.length; ti++) {
          const clip = this.active[ti];
          if (!clip) continue;
          for (let pi = 0; pi < 8; pi++) {
            if (clip.steps[pi][this.step]) this._voice(ti, pi, t);
          }
        }
        if (this.metronome && this.step % 4 === 0) this._click(t, this.step === 0);
        this.lastFired = { step: this.step, time: t };
        this.step++;
        if (this.step === 16) { this.step = 0; this.barStart += this._barDur(); }
      }
    }

    _click(t, accent) {
      const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "square"; o.frequency.value = accent ? 2000 : 1500;
      g.gain.setValueAtTime(0.12, t);
      g.gain.setTargetAtTime(0, t, 0.008);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 0.05);
    }

    // ---- launching (quantized to the bar while playing) ----
    launchClip(ti, si) {
      const clip = this.project.clips[ti][si];
      if (!clip) return;
      if (this.active[ti] === clip && !this.pending[ti]) { this.stopClip(ti); return; }
      if (!this.playing) { this.active[ti] = clip; this.pending[ti] = null; }
      else this.pending[ti] = { clip };
      this._emit();
    }

    stopClip(ti) {
      if (!this.playing) { this.active[ti] = null; this.pending[ti] = null; }
      else this.pending[ti] = { stop: true };
      this._emit();
    }

    launchScene(si) {
      for (let ti = 0; ti < this.project.tracks.length; ti++) {
        const clip = this.project.clips[ti][si];
        if (!this.playing) { this.active[ti] = clip || null; this.pending[ti] = null; }
        else if (clip) this.pending[ti] = { clip };
        else this.pending[ti] = { stop: true };
      }
      this._emit();
    }

    stopAllClips() {
      for (let ti = 0; ti < this.project.tracks.length; ti++) this.stopClip(ti);
    }

    slotState(ti, si) {
      const clip = this.project.clips[ti][si];
      if (!clip) return "empty";
      if (this.pending[ti]) {
        if (this.pending[ti].stop) return this.active[ti] === clip ? "stopping" : "empty";
        return this.pending[ti].clip === clip ? "launching" : (this.active[ti] === clip ? "playing" : "clip");
      }
      return this.active[ti] === clip ? "playing" : "clip";
    }
  }

  return { Engine };
});
