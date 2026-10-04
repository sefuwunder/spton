# SPTON

The SP-1200 sound engine under an Ableton-style Session View.

**Sound** — the SP-1200 DSP core (`public/dsp.js`), kept verbatim:
26.04 kHz / 12-bit converters on every voice, varispeed pad tuning,
per-pad sample loop points, hat choking, Roger Linn swing timing.

**Interface** — Session View:
- 8 tracks × 8 scenes of clip slots; click to launch/stop, quantized to the bar
- Scene launch buttons fire whole rows at once
- Detail view: **Clip** tab (16-step × 8-pad editor with playhead) and
  **SP-1200 Rack** tab (per-pad drum, tune, level, loop points, 12-bit A/B)
- Browser: 8 synthesized drums → click to load onto the selected pad;
  5 factory grooves → click to drop into the selected slot
- Transport: play/stop, session-record (pad hits punch into the selected clip),
  tempo, swing, metronome, master volume
- Mixer: per-track volume, pan, mute, solo

Keyboard: `Space` play/stop, `Enter` launch selected slot,
`Delete` remove clip, arrows move the slot selection.

## Run

```sh
bun src/server.ts
# → http://localhost:3017
```

Zero dependencies. Project autosaves to the browser (localStorage);
Save/Reset live in the browser panel.

## Tests

```sh
bun test   # model + launch-quantization state machine + DSP swing math
```

Real listening validation happens on your machine — the sandbox has no
audio output.
