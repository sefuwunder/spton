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
    equalSlices, onsetSlices,
    barDuration, msToNextBar,
  };
});
