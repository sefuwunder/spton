// model.test.js — SPTON project model: pure logic, no DOM.
import { describe, test, expect } from "bun:test";
const M = require("../public/model.js");

describe("createProject", () => {
  test("8x8 grid with seeded grooves", () => {
    const p = M.createProject();
    expect(p.tracks.length).toBe(8);
    expect(p.scenes.length).toBe(8);
    expect(p.clips.length).toBe(8);
    expect(p.clips[0].length).toBe(8);
    expect(p.clips[0][0]).not.toBeNull();
    expect(p.clips[1][0]).not.toBeNull();
    expect(p.clips[2][0]).toBeNull();
    for (const t of p.tracks) {
      expect(t.pads.length).toBe(8);
      expect(t.spMode).toBe(true);
    }
  });
});

describe("steps", () => {
  test("setStep toggles and bounds-checks", () => {
    const c = M.makeClip("x");
    expect(M.setStep(c, 0, 0)).toBe(true);
    expect(c.steps[0][0]).toBe(true);
    expect(M.setStep(c, 0, 0)).toBe(true);
    expect(c.steps[0][0]).toBe(false);
    expect(M.setStep(c, 8, 0)).toBe(false);
    expect(M.setStep(c, 0, 16)).toBe(false);
    expect(M.setStep(null, 0, 0)).toBe(false);
  });
  test("clearClip and clipHitCount", () => {
    const c = M.grooveClip("Boom Bap");
    expect(M.clipHitCount(c)).toBeGreaterThan(10);
    M.clearClip(c);
    expect(M.clipHitCount(c)).toBe(0);
  });
  test("cloneClip copies steps", () => {
    const c = M.grooveClip("Trap");
    const d = M.cloneClip(c);
    expect(d.id).not.toBe(c.id);
    expect(M.clipHitCount(d)).toBe(M.clipHitCount(c));
    M.setStep(d, 0, 0);
    expect(c.steps[0][0]).toBe(true); // unchanged
  });
});

describe("grooves", () => {
  test("all factory grooves parse to 8x16", () => {
    for (const name of Object.keys(M.GROOVES)) {
      const c = M.grooveClip(name);
      expect(c.steps.length).toBe(8);
      expect(c.steps[0].length).toBe(16);
      expect(M.clipHitCount(c)).toBeGreaterThan(0);
    }
    expect(M.grooveClip("nope")).toBeNull();
  });
});

describe("persistence", () => {
  test("serialize/deserialize round-trips and normalizes", () => {
    const p = M.createProject();
    p.tracks[0].pads[0].tune = 0.5;
    const q = M.deserialize(M.serialize(p));
    expect(q.tracks[0].pads[0].tune).toBe(0.5);
    expect(q.tracks[0].name).toBe(p.tracks[0].name);
    expect(q.clips[0][0].name).toBe("Boom Bap");
    // hostile shapes get normalized, not thrown
    const r = M.deserialize(JSON.stringify({ tracks: [{ pads: [] }], scenes: [{}], clips: [] }));
    expect(r.tracks[0].pads.length).toBe(8);
    expect(() => M.deserialize("{}")).toThrow();
  });
});

describe("transport math", () => {
  test("barDuration and msToNextBar", () => {
    expect(M.barDuration(120)).toBeCloseTo(2, 6);
    expect(M.barDuration(128)).toBeCloseTo(1.875, 6);
    expect(M.msToNextBar(0, 120)).toBeCloseTo(2000, 3);
    expect(M.msToNextBar(1.5, 120)).toBeCloseTo(500, 3);
    expect(M.msToNextBar(2, 120)).toBeCloseTo(2000, 3); // wraps
  });
});
