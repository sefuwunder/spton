// sp1200-import.test.js — SP-1200 project import into the SPTON model.
import { describe, test, expect } from "bun:test";
const M = require("../public/model.js");

// SP-1200 pad order: kick, snare, clap, rim, chat, ohat, tom, shaker
// SPTON DRUMS order: kick, snare, chat, ohat, clap, rim, tom, shaker
function spPad(over) {
  return Object.assign({
    tune: 1, level: 90, muted: false,
    filterType: "lowpass", filterFreq: 800, filterQ: 1,
    voiceMode: "poly", choke: 0,
    delay: { on: false, time: 0.3, feedback: 0.4, mix: 0.3 },
    loop: { on: false, start: 0, end: 1 },
    custom: null, label: null,
  }, over || {});
}
function spProject(over) {
  return Object.assign({
    version: 1, name: "slot-4", savedAt: Date.now(),
    bpm: 92, swing: 62, master: 80, spMode: true,
    pads: [spPad(), spPad(), spPad(), spPad(), spPad(), spPad(), spPad(), spPad()],
    tapes: [],
    tapeBars: 2,
  }, over || {});
}
function spTape(name, seconds, level) {
  const len = Math.floor(seconds * 44100);
  const planar = new Float32Array(len * 2);
  for (let i = 0; i < len; i++) { planar[i] = 0.5; planar[len + i] = -0.25; }
  return {
    name, bars: 0, bpm: 92, level: level == null ? 80 : level, muted: false,
    audio: { sr: 44100, len, pcm: M.f32ToB64(planar) },
  };
}

describe("importSp1200 validation", () => {
  test("rejects garbage", () => {
    expect(() => M.importSp1200("nope")).toThrow();
    expect(() => M.importSp1200("{}")).toThrow();
    expect(() => M.importSp1200(null)).toThrow();
    expect(() => M.importSp1200(JSON.stringify({ version: 2, pads: [] }))).toThrow();
    expect(() => M.importSp1200(JSON.stringify({ version: 1 }))).toThrow();
    expect(() => M.importSp1200(JSON.stringify({ version: 1, pads: [1, 2, 3] }))).toThrow();
  });
  test("accepts a parsed object as well as JSON text", () => {
    const a = M.importSp1200(JSON.stringify(spProject()));
    const b = M.importSp1200(spProject());
    expect(a.tracks.length).toBe(8);
    expect(b.tracks.length).toBe(8);
  });
});

describe("importSp1200 kit", () => {
  test("maps pads by drum id, not position", () => {
    const pads = [spPad(), spPad(), spPad(), spPad(), spPad(), spPad(), spPad(), spPad()];
    // SP-1200 pad idx 2 = clap, idx 4 = chat
    pads[2] = spPad({ tune: 0.5, level: 80, loop: { on: true, start: 0.1, end: 0.9 } });
    pads[4] = spPad({ tune: 1.5, level: 50 });
    const p = M.importSp1200(JSON.stringify(spProject({ pads })));
    const kit = p.tracks[0];
    expect(kit.name).toBe("slot-4");
    // clap is DRUMS[4] in SPTON, chat is DRUMS[2]
    const clap = kit.pads[M.DRUMS.indexOf("clap")];
    expect(clap.tune).toBeCloseTo(0.5, 6);
    expect(clap.level).toBeCloseTo(0.8, 6);
    expect(clap.loopOn).toBe(true);
    expect(clap.loopStart).toBeCloseTo(0.1, 6);
    expect(clap.loopEnd).toBeCloseTo(0.9, 6);
    expect(clap.src).toBe("synth");
    const chat = kit.pads[M.DRUMS.indexOf("chat")];
    expect(chat.tune).toBeCloseTo(1.5, 6);
    expect(chat.level).toBeCloseTo(0.5, 6);
  });
  test("carries transport and the 12-bit toggle", () => {
    const p = M.importSp1200(JSON.stringify(spProject({ bpm: 100, swing: 70, spMode: false })));
    expect(p.bpm).toBe(100);
    expect(p.swing).toBe(70);
    expect(p.tracks[0].spMode).toBe(false);
  });
  test("clamps wild transport values", () => {
    const p = M.importSp1200(JSON.stringify(spProject({ bpm: 9999, swing: 10 })));
    expect(p.bpm).toBeLessThanOrEqual(300);
    expect(p.swing).toBeGreaterThanOrEqual(50);
  });
});

describe("importSp1200 custom samples", () => {
  test("concatenates customs into the track sample with one slice per pad", () => {
    const a = new Float32Array(100).fill(0.5);
    const b = new Float32Array(200).fill(-0.25);
    const pads = [spPad(), spPad(), spPad(), spPad(), spPad(), spPad(), spPad(), spPad()];
    pads[0] = spPad({ custom: { name: "KICK", pcm: M.f32ToB64(a) } }); // kick -> DRUMS[0]
    pads[6] = spPad({ custom: { name: "TOM", pcm: M.f32ToB64(b) } });  // tom  -> DRUMS[6]
    const p = M.importSp1200(JSON.stringify(spProject({ pads })));
    const kit = p.tracks[0];
    expect(kit.sample).not.toBeNull();
    expect(kit.sample.sr).toBe(44100);
    expect(kit.sample.data.length).toBe(300);
    const kick = kit.pads[0], tom = kit.pads[6];
    expect(kick.src).toBe("sample");
    expect(tom.src).toBe("sample");
    expect(kick.sample.start).toBeCloseTo(0, 6);
    expect(kick.sample.end).toBeCloseTo(100 / 300, 6);
    expect(tom.sample.start).toBeCloseTo(100 / 300, 6);
    expect(tom.sample.end).toBeCloseTo(1, 6);
    // slice audio survives the int16 round-trip
    expect(kit.sample.data[0]).toBeCloseTo(0.5, 3);
    expect(kit.sample.data[150]).toBeCloseTo(-0.25, 3);
    // untouched pads stay synth drums
    expect(kit.pads[1].src).toBe("synth");
    expect(kit.pads[1].drum).toBe("snare");
  });
  test("corrupt custom pcm falls back to the synth drum", () => {
    const pads = [spPad(), spPad(), spPad(), spPad(), spPad(), spPad(), spPad(), spPad()];
    pads[0] = spPad({ custom: { name: "BAD", pcm: "!!!" } });
    const p = M.importSp1200(JSON.stringify(spProject({ pads })));
    expect(p.tracks[0].pads[0].src).toBe("synth");
    expect(p.tracks[0].sample).toBeNull();
  });
});

describe("importSp1200 tapes", () => {
  test("non-empty tapes become track samples on tracks 2+", () => {
    const p = M.importSp1200(JSON.stringify(spProject({
      tapes: [spTape("TAKE 1", 1, 80), { name: "empty", audio: null }, spTape("BOUNCE 3", 0.5, 60)],
    })));
    const t1 = p.tracks[1], t2 = p.tracks[2];
    expect(t1.name).toBe("TAKE 1");
    expect(t1.sample.data.length).toBe(44100);
    expect(t1.sample.sr).toBe(44100);
    // mono mix of L=0.5 / R=-0.25
    expect(t1.sample.data[0]).toBeCloseTo(0.125, 3);
    expect(t1.vol).toBeCloseTo(0.8, 6);
    expect(t1.pads[0].src).toBe("sample");
    expect(t1.pads[0].sample.start).toBe(0);
    expect(t1.pads[0].sample.end).toBe(1);
    // the empty tape is skipped: BOUNCE 3 lands on track 3
    expect(t2.name).toBe("BOUNCE 3");
    expect(t2.sample.data.length).toBe(22050);
    // tape tracks lose their seeded 1-bar clips; the kit keeps its groove
    for (let s = 0; s < 8; s++) expect(p.clips[1][s]).toBeNull();
    expect(p.clips[0][0]).not.toBeNull();
  });
  test("tape mute is carried over", () => {
    const tp = spTape("T", 0.1); tp.muted = true;
    const p = M.importSp1200(JSON.stringify(spProject({ tapes: [tp] })));
    expect(p.tracks[1].mute).toBe(true);
  });
});

describe("importSp1200 round-trip", () => {
  test("survives serialize -> deserialize with sample slices intact", () => {
    const a = new Float32Array(64).fill(0.25);
    const pads = [spPad(), spPad(), spPad(), spPad(), spPad(), spPad(), spPad(), spPad()];
    pads[3] = spPad({ custom: { name: "RIM", pcm: M.f32ToB64(a) } });
    const imported = M.importSp1200(JSON.stringify(spProject({
      pads, tapes: [spTape("TAKE 1", 0.25)],
    })));
    const back = M.deserialize(M.serialize(imported));
    const rim = back.tracks[0].pads[M.DRUMS.indexOf("rim")];
    expect(rim.src).toBe("sample"); // deserialize keeps valid slices
    expect(back.tracks[0].sample.data.length).toBe(64);
    expect(back.tracks[1].pads[0].src).toBe("sample");
    expect(back.tracks[1].sample.data.length).toBe(11025);
    expect(back.bpm).toBe(92);
  });
});
