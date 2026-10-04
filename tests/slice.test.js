// slice.test.js — sample slicing: equal/onset bounds, sample persistence.
import { describe, test, expect } from "bun:test";
const M = require("../public/model.js");

describe("equalSlices", () => {
  test("n even regions covering [0,1)", () => {
    const s = M.equalSlices(4);
    expect(s.length).toBe(4);
    expect(s[0]).toEqual({ start: 0, end: 0.25 });
    expect(s[3]).toEqual({ start: 0.75, end: 1 });
    for (let i = 1; i < s.length; i++) expect(s[i].start).toBe(s[i - 1].end);
  });
  test("clamps to 1..32", () => {
    expect(M.equalSlices(0).length).toBe(1);
    expect(M.equalSlices(99).length).toBe(32);
  });
});

describe("onsetSlices", () => {
  test("one region per onset, last runs to the end", () => {
    const s = M.onsetSlices([100, 300, 700], 1000);
    expect(s.length).toBe(3);
    expect(s[0]).toEqual({ start: 0.1, end: 0.3 });
    expect(s[2]).toEqual({ start: 0.7, end: 1 });
  });
  test("sorts, filters out-of-range, empty on none", () => {
    expect(M.onsetSlices([], 1000)).toEqual([]);
    const s = M.onsetSlices([500, 100, 9999, -5], 1000);
    expect(s.map((x) => x.start)).toEqual([0.1, 0.5]);
  });
});

describe("sample persistence", () => {
  test("f32 base64 round-trips within 12-bit-ish tolerance", () => {
    const f = new Float32Array([0, 0.5, -0.5, 1, -1, 0.123456]);
    const g = M.b64ToF32(M.f32ToB64(f));
    expect(g.length).toBe(f.length);
    for (let i = 0; i < f.length; i++) expect(Math.abs(g[i] - f[i])).toBeLessThan(1 / 32767 + 1e-9);
  });
  test("project with a sliced pad serializes and revives", () => {
    const p = M.createProject();
    const data = new Float32Array(4410);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * 0.1) * 0.5;
    p.tracks[2].sample = { id: "smp-x", name: "loop", data, sr: 44100 };
    p.tracks[2].pads[0].src = "sample";
    p.tracks[2].pads[0].sample = { start: 0, end: 0.125 };
    const q = M.deserialize(M.serialize(p));
    expect(q.tracks[2].sample.data instanceof Float32Array).toBe(true);
    expect(q.tracks[2].sample.data.length).toBe(4410);
    expect(q.tracks[2].sample.sr).toBe(44100);
    expect(q.tracks[2].pads[0].src).toBe("sample");
    expect(q.tracks[2].pads[0].sample.end).toBe(0.125);
    // corrupt sample normalizes to null, pads fall back to synth
    const r = M.deserialize(M.serialize(p).replace("$f32", "$f33"));
    expect(r.tracks[2].sample).toBeNull();
    expect(r.tracks[2].pads[0].src).toBe("synth");
  });
  test("pads default to synth", () => {
    const p = M.createProject();
    for (const t of p.tracks) for (const pad of t.pads) {
      expect(pad.src).toBe("synth");
      expect(pad.sample).toBeNull();
    }
  });
});
