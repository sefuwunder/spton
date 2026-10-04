// SPTON model: the Session View project. Pure logic, no DOM — runs in the
// browser and in node for tests.
//
//   project.tracks[i]  — one SP-1200 rack per track (8 pads)
//   project.scenes[j]  — rows of the session grid
//   project.clips[i][j] — a 16-step x 8-pad pattern, or null for an empty slot
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SPTON_MODEL = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const DRUMS = ["kick", "snare", "chat", "ohat", "clap", "rim", "tom", "shaker"];
  const DRUM_LABELS = {
    kick: "Kick", snare: "Snare", chat: "Closed Hat", ohat: "Open Hat",
    clap: "Clap", rim: "Rim", tom: "Tom", shaker: "Shaker",
  };
  const TRACK_COLORS = [
    "#f5c518", "#ff5c39", "#3ec1ff", "#7ee081",
    "#c792ea", "#ff8ac2", "#5ce1e6", "#ffa94d",
  ];
  const N_TRACKS = 8, N_SCENES = 8, N_PADS = 8, N_STEPS = 16;
  const MAX_SAMPLE_SEC = 30;

  let uidCounter = 1;
  function uid(prefix) { return prefix + "-" + (uidCounter++) + "-" + Date.now().toString(36); }

  function defaultPad(drum) {
    // src "synth" (a DSP drum) or "sample" (a slice of the track's sample)
    return { drum, tune: 1, level: 0.9, loopOn: false, loopStart: 0, loopEnd: 1, src: "synth", sample: null };
  }

  function makeTrack(i) {
    return {
      id: uid("trk"), name: "Track " + (i + 1), color: TRACK_COLORS[i % TRACK_COLORS.length],
      pads: DRUMS.map(defaultPad),
      vol: 0.8, pan: 0, mute: false, solo: false, spMode: true, // SP-1200 12-bit A/B
      sample: null, // { id, name, data: Float32Array, sr } — shared by the track's sliced pads
    };
  }

  function makeScene(i) {
    return { id: uid("scn"), name: "Scene " + (i + 1) };
  }

  function emptySteps() {
    const s = [];
    for (let p = 0; p < N_PADS; p++) s.push(new Array(N_STEPS).fill(false));
    return s;
  }

  function makeClip(name) {
    return { id: uid("clp"), name: name || "Clip", steps: emptySteps() };
  }

  function setStep(clip, pad, step, val) {
    if (!clip || pad < 0 || pad >= N_PADS || step < 0 || step >= N_STEPS) return false;
    clip.steps[pad][step] = val === undefined ? !clip.steps[pad][step] : !!val;
    return true;
  }

  function clearClip(clip) {
    if (!clip) return;
    for (let p = 0; p < N_PADS; p++) clip.steps[p].fill(false);
  }

  function cloneClip(clip) {
    const c = makeClip(clip.name + " copy");
    for (let p = 0; p < N_PADS; p++) c.steps[p] = clip.steps[p].slice();
    return c;
  }

  function clipHitCount(clip) {
    let n = 0;
    for (let p = 0; p < N_PADS; p++)
      for (let s = 0; s < N_STEPS; s++) if (clip.steps[p][s]) n++;
    return n;
  }

  // ---- factory grooves: 8 pads x 16 steps, rows = DRUMS order ----
  const GROOVES = {
    "Boom Bap": [
      "1000000010000000", // kick
      "0000100000001000", // snare
      "1010101010101010", // chat
      "0000000000000000", // ohat
      "0000000000000000", // clap
      "0000001000000000", // rim
      "0000000000000000", // tom
      "0010001000100010", // shaker
    ],
    "Trap": [
      "1000000000100000",
      "0000000010000000",
      "1111111111111111",
      "0000000000000010",
      "0000000010000000",
      "0000000000000000",
      "0000000000001000",
      "0000100000001000",
    ],
    "House": [
      "1000100010001000",
      "0000000000000000",
      "0010001000100010",
      "0000001000000010",
      "0000100000001000",
      "0000000000000000",
      "0000000000000000",
      "1010101010101010",
    ],
    "Dilla Swing": [
      "1000000100000000",
      "0000100000100000",
      "1011010110101011",
      "0000000000000000",
      "0000000000000000",
      "0001000000001000",
      "0000000010000000",
      "0000000000000000",
    ],
    "Half-Time": [
      "1000000000000000",
      "0000000000100000",
      "1010101010101010",
      "0000000000000000",
      "0000000000100000",
      "0000001000000000",
      "1000000000000000",
      "0000100010001000",
    ],
  };

  function grooveClip(name) {
    const rows = GROOVES[name];
    if (!rows) return null;
    const c = makeClip(name);
    for (let p = 0; p < N_PADS; p++)
      for (let s = 0; s < N_STEPS; s++) c.steps[p][s] = rows[p][s] === "1";
    return c;
  }

  function createProject() {
    const tracks = [], scenes = [], clips = [];
    for (let i = 0; i < N_TRACKS; i++) { tracks.push(makeTrack(i)); clips.push(new Array(N_SCENES).fill(null)); }
    for (let j = 0; j < N_SCENES; j++) scenes.push(makeScene(j));
    // seed scene 1 with a starter groove on track 1
    clips[0][0] = grooveClip("Boom Bap");
    clips[1][0] = grooveClip("House");
    return { version: 1, tracks, scenes, clips, bpm: 128, swing: 54 };
  }

  // ---- persistence ----
  // Sample audio travels as base64 int16 so projects stay small enough
  // for localStorage. Float32Arrays are the only ones in the model.
  function f32ToB64(f) {
    const i16 = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) i16[i] = Math.round(Math.max(-1, Math.min(1, f[i])) * 32767);
    const bytes = new Uint8Array(i16.buffer);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 8192)
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return btoa(bin);
  }
  function b64ToF32(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const i16 = new Int16Array(bytes.buffer);
    const out = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) out[i] = i16[i] / 32767;
    return out;
  }
  function serialize(p) {
    return JSON.stringify(p, (k, v) =>
      v instanceof Float32Array ? { $f32: f32ToB64(v) } : v);
  }
  function deserialize(json) {
    const p = JSON.parse(json, (k, v) =>
      v && typeof v === "object" && typeof v.$f32 === "string" ? b64ToF32(v.$f32) : v);
    if (!p || !Array.isArray(p.tracks) || !Array.isArray(p.scenes)) throw new Error("bad project");
    // normalize: tolerate older shapes
    for (const t of p.tracks) {
      t.vol = +t.vol || 0; t.pan = +t.pan || 0;
      t.mute = !!t.mute; t.solo = !!t.solo; t.spMode = t.spMode !== false;
      if (!Array.isArray(t.pads) || t.pads.length !== N_PADS) t.pads = DRUMS.map(defaultPad);
      if (t.sample && !(t.sample.data instanceof Float32Array)) t.sample = null; // corrupt sample
      t.pads.forEach((pad, i) => {
        if (!DRUM_LABELS[pad.drum]) pad.drum = DRUMS[i % DRUMS.length];
        pad.tune = +pad.tune || 1; pad.level = Math.min(1, Math.max(0, +pad.level || 0));
        pad.loopOn = !!pad.loopOn;
        const sliceOk = pad.src === "sample" && t.sample && pad.sample && (+pad.sample.end > +pad.sample.start);
        if (!sliceOk) { pad.src = "synth"; pad.sample = null; }
      });
      if (!t.color) t.color = TRACK_COLORS[0];
    }
    if (!Array.isArray(p.clips)) p.clips = p.tracks.map(() => p.scenes.map(() => null));
    return p;
  }

  // ---- SP-1200 project import ----
  // Reads an SP-1200 exported project (version 1: bpm/swing, 8 pads with
  // optional custom samples, 4 tapes with optional stereo audio) and builds
  // a SPTON session around it:
  //   - transport bpm/swing follow the SP-1200
  //   - track 1 becomes the SP-1200 kit: pads matched by drum id (the two
  //     apps order clap/rim vs hats differently), tune/level/loop carried
  //     over; custom samples are concatenated into the track's shared
  //     sample with one slice per pad, so they play through the same
  //     12-bit/varispeed/loop voice path as the slicer chops
  //   - tracks 2-5 take the non-empty tapes as mono track samples, pad 1
  //     of each playing the whole tape so it stays playable from a clip
  // Throws on anything that is not an SP-1200 project.
  const SP1200_PAD_ORDER = ["kick", "snare", "clap", "rim", "chat", "ohat", "tom", "shaker"];
  const SP1200_SR = 44100; // SP-1200 pad samples and tape audio are 44.1 kHz
  function importSp1200(json) {
    let sp;
    try { sp = typeof json === "string" ? JSON.parse(json) : json; }
    catch (e) { throw new Error("not an SP-1200 project"); }
    if (!sp || sp.version !== 1 || !Array.isArray(sp.pads) || sp.pads.length !== N_PADS)
      throw new Error("not an SP-1200 project");
    const p = createProject();
    if (+sp.bpm > 0) p.bpm = Math.min(300, Math.max(40, +sp.bpm));
    if (+sp.swing >= 50) p.swing = Math.min(75, Math.max(50, +sp.swing));
    // --- track 1: the kit ---
    const kit = p.tracks[0];
    kit.name = String(sp.name || "SP-1200").slice(0, 24) || "SP-1200";
    kit.spMode = sp.spMode !== false;
    const customs = [];
    sp.pads.forEach((ps, i) => {
      if (!ps) return;
      const j = DRUMS.indexOf(SP1200_PAD_ORDER[i]);
      if (j < 0) return;
      const pad = kit.pads[j];
      if (+ps.tune > 0) pad.tune = +ps.tune;
      if (ps.level != null) pad.level = Math.min(1, Math.max(0, +ps.level / 100));
      if (ps.loop) {
        pad.loopOn = !!ps.loop.on;
        pad.loopStart = Math.min(1, Math.max(0, +ps.loop.start || 0));
        pad.loopEnd = Math.min(1, Math.max(0, ps.loop.end == null ? 1 : +ps.loop.end));
      }
      if (ps.custom && typeof ps.custom.pcm === "string" && ps.custom.pcm.length) {
        try {
          const data = b64ToF32(ps.custom.pcm); // same LE-int16 wire format
          if (data.length > 0) customs.push({ pad: j, data });
        } catch (e) { /* corrupt sample: pad keeps its synth drum */ }
      }
    });
    if (customs.length) {
      let total = 0;
      customs.forEach((c) => { total += c.data.length; });
      const cat = new Float32Array(total);
      let off = 0;
      customs.forEach((c) => {
        c.start = off / total;
        cat.set(c.data, off);
        off += c.data.length;
        c.end = off / total;
      });
      kit.sample = { id: uid("smp"), name: kit.name + " samples", data: cat, sr: SP1200_SR };
      customs.forEach((c) => {
        const pad = kit.pads[c.pad];
        pad.src = "sample";
        pad.sample = { start: c.start, end: c.end };
      });
    }
    // --- tracks 2-5: the tapes ---
    const tapes = Array.isArray(sp.tapes) ? sp.tapes : [];
    let ti = 0;
    for (const t of tapes) {
      if (ti >= N_TRACKS - 1) break;
      if (!t || !t.audio || typeof t.audio.pcm !== "string") continue;
      const len = +t.audio.len;
      if (!(len > 0)) continue;
      let planar;
      try { planar = b64ToF32(t.audio.pcm); } catch (e) { continue; }
      if (planar.length < len * 2) continue;
      const mono = new Float32Array(len);
      for (let i = 0; i < len; i++) mono[i] = (planar[i] + planar[len + i]) / 2;
      const trk = p.tracks[1 + ti];
      trk.name = String(t.name || "TAPE " + (ti + 1)).slice(0, 24) || "TAPE";
      trk.sample = { id: uid("smp"), name: trk.name, data: mono, sr: +t.audio.sr > 0 ? +t.audio.sr : SP1200_SR };
      if (t.level != null) trk.vol = Math.min(1, Math.max(0, +t.level / 100));
      trk.mute = !!t.muted;
      trk.spMode = sp.spMode !== false;
      const pad = trk.pads[0];
      pad.src = "sample";
      pad.sample = { start: 0, end: 1 };
      for (let s = 0; s < N_SCENES; s++) p.clips[1 + ti][s] = null;
      ti++;
    }
    return p;
  }

  // ---- slicing ----
  // Equal slices: n even regions as {start,end} fractions.
  function equalSlices(n) {
    n = Math.max(1, Math.min(32, n | 0));
    const out = [];
    for (let i = 0; i < n; i++) out.push({ start: i / n, end: (i + 1) / n });
    return out;
  }
  // Onset slices: one region per detected onset, last runs to the end.
  function onsetSlices(onsets, totalLen) {
    const pts = onsets.filter((o) => o >= 0 && o < totalLen).sort((a, b) => a - b);
    if (!pts.length) return [];
    const out = [];
    for (let i = 0; i < pts.length; i++)
      out.push({ start: pts[i] / totalLen, end: (i + 1 < pts.length ? pts[i + 1] : totalLen) / totalLen });
    return out;
  }

  // ---- transport math (pure; the engine uses the same) ----
  function barDuration(bpm) { return (60 / bpm) * 4; }
  // ms until the next bar boundary, given seconds elapsed in the current bar
  function msToNextBar(elapsedInBar, bpm) {
    const bar = barDuration(bpm);
    return Math.max(0, (bar - (elapsedInBar % bar)) * 1000);
  }

  return {
    DRUMS, DRUM_LABELS, TRACK_COLORS, MAX_SAMPLE_SEC,
    N_TRACKS, N_SCENES, N_PADS, N_STEPS, GROOVES,
    uid, makeTrack, makeScene, makeClip, emptySteps,
    setStep, clearClip, cloneClip, clipHitCount, grooveClip,
    createProject, serialize, deserialize, f32ToB64, b64ToF32,
    importSp1200,
    equalSlices, onsetSlices,
    barDuration, msToNextBar,
  };
});
