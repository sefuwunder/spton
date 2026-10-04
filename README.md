# SPTON

The SP-1200 sound engine under an Ableton-style Session View.

**Sound** — the SP-1200 DSP core (`public/dsp.js`), kept verbatim:
26.04 kHz / 12-bit converters on every voice, varispeed pad tuning,
per-pad sample loop points, hat choking, Roger Linn swing timing.

**Interface** — Session View:
- 8 tracks × 8 scenes of clip slots; click to launch/stop, quantized to the bar
- Scene launch buttons fire whole rows at once
- Detail view: **Clip** tab (16-step × 8-pad editor with playhead),
  **SP-1200 Rack** tab (per-pad drum, tune, level, loop points, 12-bit A/B),
  and **Slice** tab (see below)
- Browser: 8 synthesized drums → click to load onto the selected pad;
  5 factory grooves → click to drop into the selected slot

## Slicer

Import any audio file (WAV/MP3/AIFF/OGG, up to 30s) from the browser's
Import section — it lands on the selected track. The Slice tab shows the
waveform with slice markers: **Auto** mode finds onsets with the DSP core's
onset detector, **Equal** mode cuts 4/8/16 even regions. Click a slice to
audition it, then **Chop to pads** — slices become pad sources 1–8, played
through the same 12-bit/varispeed/loop voice path as the synth drums.
Sample audio persists with the project (base64 int16 in localStorage).
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
Save/Reset live in the browser panel, plus **Save to file** (downloads a
`.json` snapshot) and **Open file…** (loads one back, replacing the
current project).

## Tests

```sh
bun test   # model + launch-quantization state machine + DSP swing math
```

Real listening validation happens on your machine — the sandbox has no
audio output.
