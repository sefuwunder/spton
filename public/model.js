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

  let uidCounter = 1;
  function uid(prefix) { return prefix + "-" + (uidCounter++) + "-" + Date.now().toString(36); }

  function defaultPad(drum) {
    return { drum, tune: 1, level: 0.9, loopOn: false, loopStart: 0, loopEnd: 1 };
  }

  function makeTrack(i) {
    return {
      id: uid("trk"), name: "Track " + (i + 1), color: TRACK_COLORS[i % TRACK_COLORS.length],
      pads: DRUMS.map(defaultPad),
      vol: 0.8, pan: 0, mute: false, solo: false, spMode: true, // SP-1200 12-bit A/B
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
  function serialize(p) { return JSON.stringify(p); }
  function deserialize(json) {
    const p = JSON.parse(json);
    if (!p || !Array.isArray(p.tracks) || !Array.isArray(p.scenes)) throw new Error("bad project");
    // normalize: tolerate older shapes
    for (const t of p.tracks) {
      t.vol = +t.vol || 0; t.pan = +t.pan || 0;
      t.mute = !!t.mute; t.solo = !!t.solo; t.spMode = t.spMode !== false;
      if (!Array.isArray(t.pads) || t.pads.length !== N_PADS) t.pads = DRUMS.map(defaultPad);
      t.pads.forEach((pad, i) => {
        if (!DRUM_LABELS[pad.drum]) pad.drum = DRUMS[i % DRUMS.length];
        pad.tune = +pad.tune || 1; pad.level = Math.min(1, Math.max(0, +pad.level || 0));
        pad.loopOn = !!pad.loopOn;
      });
      if (!t.color) t.color = TRACK_COLORS[0];
    }
    if (!Array.isArray(p.clips)) p.clips = p.tracks.map(() => p.scenes.map(() => null));
    return p;
  }

  // ---- transport math (pure; the engine uses the same) ----
  function barDuration(bpm) { return (60 / bpm) * 4; }
  // ms until the next bar boundary, given seconds elapsed in the current bar
  function msToNextBar(elapsedInBar, bpm) {
    const bar = barDuration(bpm);
    return Math.max(0, (bar - (elapsedInBar % bar)) * 1000);
  }

  return {
    DRUMS, DRUM_LABELS, TRACK_COLORS,
    N_TRACKS, N_SCENES, N_PADS, N_STEPS, GROOVES,
    uid, makeTrack, makeScene, makeClip, emptySteps,
    setStep, clearClip, cloneClip, clipHitCount, grooveClip,
    createProject, serialize, deserialize,
    barDuration, msToNextBar,
  };
});
