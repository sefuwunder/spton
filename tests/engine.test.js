// engine.test.js — launch/quantization state machine (no AudioContext needed)
// plus the DSP swing math the scheduler relies on.
import { describe, test, expect } from "bun:test";
const M = require("../public/model.js");
const DSP = require("../public/dsp.js");
const { Engine } = require("../public/engine.js");

function freshEngine() {
  const p = M.createProject();
  return { p, e: new Engine(p, DSP) };
}

describe("DSP swing", () => {
  test("stepTime16: 50% straight, 75% full lope, evens on grid", () => {
    const d = DSP.sixteenthDur(120); // 0.125
    expect(DSP.stepTime16(0, 120, 50)).toBeCloseTo(0, 9);
    expect(DSP.stepTime16(1, 120, 50)).toBeCloseTo(d, 9);
    expect(DSP.stepTime16(1, 120, 75)).toBeCloseTo(1.5 * d, 9);
    expect(DSP.stepTime16(2, 120, 75)).toBeCloseTo(2 * d, 9);
    expect(DSP.stepTime16(15, 120, 60)).toBeCloseTo(14 * d + 1.2 * d, 9);
    expect(DSP.stepTime16(1, 120, 10)).toBe(DSP.stepTime16(1, 120, 50)); // clamped
  });
  test("drum synths produce audio", () => {
    for (const name of M.DRUMS) {
      const s = DSP.SYNTHS[name]();
      expect(s.length).toBeGreaterThan(100);
      let peak = 0;
      for (let i = 0; i < s.length; i++) peak = Math.max(peak, Math.abs(s[i]));
      expect(peak).toBeGreaterThan(0.1);
    }
  });
});

describe("launch state machine", () => {
  test("stopped transport: launch takes effect immediately", () => {
    const { e } = freshEngine();
    expect(e.slotState(0, 0)).toBe("clip");
    e.launchClip(0, 0);
    expect(e.slotState(0, 0)).toBe("playing");
    // launching the same clip again stops it
    e.launchClip(0, 0);
    expect(e.slotState(0, 0)).toBe("clip");
  });
  test("launching empty slot is a no-op", () => {
    const { e } = freshEngine();
    e.launchClip(2, 0);
    expect(e.active[2]).toBeNull();
    expect(e.slotState(2, 0)).toBe("empty");
  });
  test("playing transport: launch is pending (quantized)", () => {
    const { p, e } = freshEngine();
    p.clips[0][1] = M.grooveClip("Trap");
    e.playing = true;
    e.launchClip(0, 0);
    expect(e.slotState(0, 0)).toBe("launching");
    expect(e.active[0]).toBeNull();
    e._applyPending(); // bar boundary
    expect(e.slotState(0, 0)).toBe("playing");
    // switch clips mid-play: old keeps playing until the boundary
    e.launchClip(0, 1);
    expect(e.slotState(0, 0)).toBe("playing");
    expect(e.slotState(0, 1)).toBe("launching");
    e._applyPending();
    expect(e.slotState(0, 0)).toBe("clip");
    expect(e.slotState(0, 1)).toBe("playing");
  });
  test("stopClip while playing is pending", () => {
    const { e } = freshEngine();
    e.playing = true;
    e.launchClip(0, 0);
    e._applyPending();
    e.stopClip(0);
    expect(e.slotState(0, 0)).toBe("stopping");
    e._applyPending();
    expect(e.slotState(0, 0)).toBe("clip");
  });
  test("launchScene arms every track", () => {
    const { e } = freshEngine();
    e.playing = true;
    e.launchScene(0);
    expect(e.slotState(0, 0)).toBe("launching");
    expect(e.slotState(1, 0)).toBe("launching");
    expect(e.slotState(2, 0)).toBe("empty"); // empty slot stays empty
    e._applyPending();
    expect(e.slotState(0, 0)).toBe("playing");
    expect(e.slotState(1, 0)).toBe("playing");
  });
  test("one clip per track: launching a second replaces the first", () => {
    const { p, e } = freshEngine();
    p.clips[0][1] = M.grooveClip("Trap");
    e.launchClip(0, 0);
    e.launchClip(0, 1);
    expect(e.active[0].name).toBe("Trap");
  });
});
