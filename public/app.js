// SPTON app: Ableton-style Session View over the SP-1200 engine.
(function () {
  "use strict";
  const M = window.SPTON_MODEL, DSP = window.DSP;
  const $ = (s, r) => (r || document).querySelector(s);
  const LS_KEY = "spton-project-v1";

  let project;
  try {
    const saved = localStorage.getItem(LS_KEY);
    project = saved ? M.deserialize(saved) : M.createProject();
  } catch (e) { project = M.createProject(); }

  const engine = new window.SPTON_ENGINE.Engine(project, DSP);
  engine.bpm = project.bpm; engine.swing = project.swing;

  const sel = { t: 0, s: 0 };   // selected slot
  let selPad = 0;               // selected pad in the rack
  let detailTab = "clip";
  let stepCells = [];           // stepCells[step] = [td x8] for playhead
  let saveTimer = null, saveWarned = false;

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, M.serialize(project)); }
      catch (e) {
        if (!saveWarned) { saveWarned = true; toast("Project too large to autosave — sample audio stays in memory"); }
      }
    }, 400);
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  // ---------------- transport ----------------
  function renderTransport() {
    $("#btn-play").classList.toggle("playing", engine.playing);
    $("#btn-play").innerHTML = engine.playing ? "&#10074;&#10074;" : "&#9654;";
    $("#btn-rec").classList.toggle("on", engine.recArmed);
    $("#btn-metro").classList.toggle("on", engine.metronome);
    $("#tempo-val").textContent = engine.bpm.toFixed(1);
    $("#swing-val").textContent = Math.round(engine.swing) + "%";
  }

  function bindTransport() {
    $("#btn-play").onclick = () => { engine.ensureAudio(); engine.toggle(); renderTransport(); };
    $("#btn-stop").onclick = () => { engine.stop(); renderTransport(); };
    $("#btn-rec").onclick = () => {
      engine.recArmed = !engine.recArmed;
      engine.recordTarget = engine.recArmed ? selectedClip() : null;
      toast(engine.recArmed ? "Record armed — pad hits punch into the selected clip" : "Record off");
      renderTransport();
    };
    $("#btn-metro").onclick = () => { engine.metronome = !engine.metronome; renderTransport(); };
    $("#tempo").oninput = (e) => {
      engine.bpm = +e.target.value; project.bpm = engine.bpm; renderTransport(); persist();
    };
    $("#swing").oninput = (e) => {
      engine.swing = +e.target.value; project.swing = engine.swing; renderTransport(); persist();
    };
    $("#master-vol").oninput = (e) => engine.setMasterVol(+e.target.value);
  }

  // ---------------- browser ----------------
  function renderBrowser() {
    const drums = $("#br-drums"); drums.innerHTML = "";
    M.DRUMS.forEach((d, i) => {
      const el = document.createElement("div");
      el.className = "br-item" + (project.tracks[sel.t].pads[selPad].drum === d ? " sel" : "");
      el.textContent = M.DRUM_LABELS[d];
      el.onclick = () => {
        const pad = project.tracks[sel.t].pads[selPad];
        pad.drum = d; engine.rebake(sel.t, selPad);
        engine.ensureAudio(); engine.triggerPad(sel.t, selPad);
        persist(); renderBrowser(); renderDetail();
      };
      drums.appendChild(el);
    });
    const gr = $("#br-grooves"); gr.innerHTML = "";
    Object.keys(M.GROOVES).forEach((name) => {
      const el = document.createElement("div");
      el.className = "br-item"; el.textContent = name;
      el.onclick = () => {
        project.clips[sel.t][sel.s] = M.grooveClip(name);
        engine.recordTarget = engine.recArmed ? project.clips[sel.t][sel.s] : engine.recordTarget;
        persist(); renderSession(); renderDetail();
        toast(name + " dropped into " + project.tracks[sel.t].name);
      };
      gr.appendChild(el);
    });
    $("#btn-save").onclick = () => {
      try { localStorage.setItem(LS_KEY, M.serialize(project)); toast("Project saved"); }
      catch (e) { toast("Save failed"); }
    };
    $("#btn-export").onclick = () => {
      try {
        const blob = new Blob([M.serialize(project)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        const d = new Date(), p = (n) => String(n).padStart(2, "0");
        a.download = `spton-project-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
        toast("Project downloaded");
      } catch (e) { toast("Export failed"); }
    };
    $("#btn-open").onclick = () => $("#file-open").click();
    $("#file-open").onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = "";
      if (!f) return;
      try {
        const text = await f.text();
        M.deserialize(text); // validates before we touch stored state
        localStorage.setItem(LS_KEY, text);
        location.reload();
      } catch (err) { toast("Could not open that file"); }
    };
    $("#btn-reset").onclick = () => {
      if (!confirm("Reset to the factory project?")) return;
      project = M.createProject();
      location.reload();
    };
  }

  // ---------------- session grid ----------------
  function selectedClip() { return project.clips[sel.t][sel.s]; }

  function renderSession() {
    const heads = $("#col-heads"), grid = $("#grid"), foots = $("#col-foots");
    heads.innerHTML = ""; grid.innerHTML = ""; foots.innerHTML = "";

    project.tracks.forEach((t, ti) => {
      const h = document.createElement("div");
      h.className = "col-head";
      h.innerHTML = `<div class="ch-top"><span class="dot" style="background:${t.color}"></span>
        <span class="nm" title="Double-click to rename">${escapeHtml(t.name)}</span></div>
        <div class="ch-btns"></div>`;
      h.querySelector(".nm").ondblclick = () => {
        const n = prompt("Track name", t.name);
        if (n) { t.name = n.slice(0, 24); persist(); renderSession(); renderDetail(); }
      };
      const mkBtn = (cls, txt, title, fn) => {
        const b = document.createElement("button");
        b.className = cls; b.textContent = txt; b.title = title; b.onclick = (e) => { e.stopPropagation(); fn(); };
        return b;
      };
      const mb = mkBtn("ms-btn m" + (t.mute ? " on" : ""), "M", "Mute", () => {
        t.mute = !t.mute; engine.refreshStrips(); persist(); renderSession();
      });
      const sb = mkBtn("ms-btn s" + (t.solo ? " on" : ""), "S", "Solo", () => {
        t.solo = !t.solo; engine.refreshStrips(); persist(); renderSession();
      });
      const stop = mkBtn("stop-btn", "■", "Stop clip", () => engine.stopClip(ti));
      const btnRow = h.querySelector(".ch-btns");
      btnRow.append(mb, sb, stop);
      heads.appendChild(h);

      const f = document.createElement("div");
      f.className = "col-foot";
      f.innerHTML = `<label>Vol<input type="range" min="0" max="1" step="0.01" value="${t.vol}"></label>
                     <label>Pan<input type="range" min="-1" max="1" step="0.01" value="${t.pan}"></label>`;
      const [vol, pan] = f.querySelectorAll("input");
      vol.oninput = () => { t.vol = +vol.value; engine._applyStrip(ti); persist(); };
      pan.oninput = () => { t.pan = +pan.value; engine._applyStrip(ti); persist(); };
      foots.appendChild(f);
    });

    project.scenes.forEach((scn, si) => {
      project.tracks.forEach((t, ti) => {
        const clip = project.clips[ti][si];
        const d = document.createElement("div");
        const st = engine.slotState(ti, si);
        d.className = "slot" + (clip ? " has-clip" : "") +
          (st === "playing" ? " playing" : "") +
          (st === "launching" || st === "stopping" ? " launching" : "") +
          (sel.t === ti && sel.s === si ? " sel" : "");
        d.style.setProperty("--trackc", t.color);
        d.innerHTML = (clip ? `<span class="clipbar" style="background:${t.color}"></span>
          <span class="clabel">${escapeHtml(clip.name)}</span>` : "") +
          `<span class="st">${st === "playing" ? "▶" : st === "launching" ? "…" : st === "stopping" ? "■" : ""}</span>
           ${st === "playing" ? `<span class="prog" data-prog="${ti}"></span>` : ""}`;
        d.onclick = () => {
          sel.t = ti; sel.s = si;
          engine.ensureAudio();
          if (!clip) {
            project.clips[ti][si] = M.makeClip(t.name + " · " + scn.name);
            if (engine.recArmed) engine.recordTarget = project.clips[ti][si];
            persist(); renderSession(); renderDetail();
            return;
          }
          engine.launchClip(ti, si);
          if (engine.recArmed) engine.recordTarget = clip;
          renderSession(); renderDetail();
        };
        grid.appendChild(d);
      });
    });

    const sl = $("#scene-launch"); sl.innerHTML = "";
    project.scenes.forEach((scn, si) => {
      const b = document.createElement("button");
      b.className = "scene-btn";
      b.innerHTML = `<span>▶</span><span class="nm">${escapeHtml(scn.name)}</span>`;
      b.title = "Launch scene";
      b.ondblclick = () => {
        const n = prompt("Scene name", scn.name);
        if (n) { scn.name = n.slice(0, 24); persist(); renderSession(); }
      };
      b.onclick = () => { engine.ensureAudio(); engine.launchScene(si); };
      sl.appendChild(b);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  // ---------------- detail ----------------
  function renderDetail() {
    document.querySelectorAll("#detail-tabs button").forEach((b) =>
      b.classList.toggle("active", b.dataset.tab === detailTab));
    const body = $("#detail-body");
    if (detailTab === "clip") renderClipTab(body);
    else if (detailTab === "slice") renderSliceTab(body);
    else renderRackTab(body);
  }

  function renderClipTab(body) {
    const clip = selectedClip(), track = project.tracks[sel.t];
    $("#detail-title").textContent = clip ? `${track.name} · ${clip.name}` : `${track.name} · empty slot`;
    body.innerHTML = "";
    if (!clip) {
      body.innerHTML = `<p style="color:var(--dim)">No clip here yet — click the slot above to create one, or pick a groove from the browser.</p>`;
      return;
    }
    const tools = document.createElement("div");
    tools.className = "clip-tools";
    tools.innerHTML = `<button data-a="clear">Clear</button>
      <button data-a="dup">Duplicate ↓</button>
      <button data-a="del" style="color:#e04747">Delete</button>
      <span style="color:var(--dim);font-size:11px">${M.clipHitCount(clip)} hits</span>`;
    tools.onclick = (e) => {
      const a = e.target.dataset && e.target.dataset.a;
      if (!a) return;
      if (a === "clear") { M.clearClip(clip); }
      else if (a === "del") { project.clips[sel.t][sel.s] = null; }
      else if (a === "dup") {
        let dst = -1;
        for (let j = sel.s + 1; j < M.N_SCENES; j++) if (!project.clips[sel.t][j]) { dst = j; break; }
        if (dst < 0) { toast("No empty scene below"); return; }
        project.clips[sel.t][dst] = M.cloneClip(clip);
        sel.s = dst;
        toast("Duplicated to " + project.scenes[dst].name);
      }
      persist(); renderSession(); renderDetail();
    };
    body.appendChild(tools);

    const g = document.createElement("div");
    g.id = "stepgrid";
    g.style.setProperty("--trackc", track.color);
    stepCells = [];
    for (let s = 0; s < M.N_STEPS; s++) stepCells.push([]);
    track.pads.forEach((pad, pi) => {
      const lab = document.createElement("div");
      lab.className = "padlab"; lab.textContent = M.DRUM_LABELS[pad.drum];
      lab.title = "Edit in Rack tab";
      lab.onclick = () => { selPad = pi; detailTab = "rack"; renderDetail(); };
      g.appendChild(lab);
      for (let s = 0; s < M.N_STEPS; s++) {
        const c = document.createElement("button");
        c.className = "cell" + (clip.steps[pi][s] ? " on" : "") + (s % 4 === 0 ? " beat" : "");
        c.title = `${M.DRUM_LABELS[pad.drum]} · step ${s + 1}`;
        c.onclick = () => {
          M.setStep(clip, pi, s);
          c.classList.toggle("on", clip.steps[pi][s]);
          engine.ensureAudio(); engine.triggerPad(sel.t, pi);
          persist();
        };
        g.appendChild(c);
        stepCells[s].push(c);
      }
    });
    body.appendChild(g);
  }

  function renderRackTab(body) {
    const track = project.tracks[sel.t], ti = sel.t;
    $("#detail-title").textContent = track.name + " · SP-1200 Rack";
    body.innerHTML = "";
    const head = document.createElement("div");
    head.id = "rack-head";
    head.innerHTML = `<button class="sp-toggle ${track.spMode ? "on" : ""}">
      ${track.spMode ? "SP-1200 · 12-bit" : "Clean · 16-bit"}</button>
      <span style="color:var(--dim);font-size:11px">26.04 kHz converters ${track.spMode ? "engaged" : "bypassed"} — varispeed tuning, per-pad loop points</span>`;
    head.querySelector(".sp-toggle").onclick = (e) => {
      track.spMode = !track.spMode;
      for (let q = 0; q < 8; q++) engine.rebake(ti, q);
      e.target.classList.toggle("on", track.spMode);
      e.target.textContent = track.spMode ? "SP-1200 · 12-bit" : "Clean · 16-bit";
      persist();
    };
    body.appendChild(head);

    const wrap = document.createElement("div");
    wrap.id = "rack-pads";
    track.pads.forEach((pad, pi) => {
      const card = document.createElement("div");
      card.className = "pad-card" + (pi === selPad ? " sel" : "");
      const drumOpts = M.DRUMS.map((d) =>
        `<option value="${d}"${d === pad.drum ? " selected" : ""}>${M.DRUM_LABELS[d]}</option>`).join("");
      card.innerHTML = `
        <div class="ph"><button class="phit">Pad ${pi + 1}</button></div>
        ${pad.src === "sample" && pad.sample
          ? `<div class="slice-tag">✂ ${Math.round(pad.sample.start * 100)}–${Math.round(pad.sample.end * 100)}% <button data-unsl title="Back to synth drum">synth</button></div>`
          : ``}
        <select>${drumOpts}</select>
        <label>Tune <input type="range" min="0.25" max="2" step="0.01" value="${pad.tune}"><output>${pad.tune.toFixed(2)}×</output></label>
        <label>Level <input type="range" min="0" max="1" step="0.01" value="${pad.level}"><output>${Math.round(pad.level * 100)}</output></label>
        <div class="loop-row">
          <button class="loop-btn ${pad.loopOn ? "on" : ""}">LOOP</button>
          <label style="flex:1">A<input type="range" min="0" max="1" step="0.01" value="${pad.loopStart}"></label>
          <label style="flex:1">B<input type="range" min="0" max="1" step="0.01" value="${pad.loopEnd}"></label>
        </div>`;
      const [tune, level, la, lb] = card.querySelectorAll('input[type=range]');
      card.querySelector(".phit").onclick = () => {
        selPad = pi; engine.ensureAudio(); engine.triggerPad(ti, pi); renderDetail(); renderBrowser();
      };
      card.querySelector("select").onchange = (e) => {
        pad.drum = e.target.value; pad.src = "synth"; pad.sample = null;
        engine.rebake(ti, pi); persist(); renderDetail();
      };
      const unsl = card.querySelector("[data-unsl]");
      if (unsl) unsl.onclick = (e) => {
        e.stopPropagation();
        pad.src = "synth"; pad.sample = null;
        engine.rebake(ti, pi); persist(); renderDetail();
      };
      tune.oninput = () => { pad.tune = +tune.value; tune.nextElementSibling.textContent = pad.tune.toFixed(2) + "×"; persist(); };
      level.oninput = () => { pad.level = +level.value; level.nextElementSibling.textContent = Math.round(pad.level * 100); persist(); };
      la.oninput = () => { pad.loopStart = +la.value; persist(); };
      lb.oninput = () => { pad.loopEnd = +lb.value; persist(); };
      card.querySelector(".loop-btn").onclick = (e) => {
        pad.loopOn = !pad.loopOn;
        if (pad.loopOn && pad.loopEnd - pad.loopStart < 1e-4) { pad.loopStart = 0; pad.loopEnd = 1; }
        e.target.classList.toggle("on", pad.loopOn); persist();
      };
      card.onclick = (e) => { if (e.target === card) { selPad = pi; renderDetail(); renderBrowser(); } };
      wrap.appendChild(card);
    });
    body.appendChild(wrap);
  }

  // ---------------- slice ----------------
  const sliceCfg = { mode: "auto", count: 8 };

  function sliceBounds() {
    const t = project.tracks[sel.t];
    if (!t.sample || !t.sample.data) return [];
    if (sliceCfg.mode === "auto") {
      const onsets = DSP.detectOnsets(t.sample.data, t.sample.sr, { sensitivity: 1.2 });
      const b = M.onsetSlices(onsets, t.sample.data.length);
      if (b.length >= 2) return b.slice(0, 32);
    }
    return M.equalSlices(sliceCfg.count);
  }

  async function importFile(file) {
    if (!file) return;
    try {
      engine.ensureAudio();
      const decoded = await engine.ctx.decodeAudioData(await file.arrayBuffer());
      if (decoded.duration > M.MAX_SAMPLE_SEC) { toast("Sample too long — 30s max"); return; }
      loadSampleData(file.name.replace(/\.[^.]+$/, ""), Float32Array.from(decoded.getChannelData(0)), decoded.sampleRate);
    } catch (e) { toast("Could not decode that audio file"); }
  }

  function loadSampleData(name, data, sr) {
    const t = project.tracks[sel.t];
    t.sample = { id: M.uid("smp"), name: String(name).slice(0, 40), data, sr };
    persist();
    detailTab = "slice";
    renderDetail();
    toast("Sample loaded — slice it, then chop to pads");
  }

  function chopToPads() {
    const ti = sel.t, track = project.tracks[ti];
    if (!track.sample) return;
    const bounds = sliceBounds();
    const n = Math.min(8, bounds.length);
    for (let i = 0; i < n; i++) {
      const pad = track.pads[i];
      pad.src = "sample";
      pad.sample = { start: bounds[i].start, end: bounds[i].end };
      engine.rebake(ti, i);
    }
    persist();
    detailTab = "rack";
    renderDetail(); renderBrowser();
    toast(bounds.length > 8 ? `Chopped 8 of ${bounds.length} slices` : `Chopped ${n} slices onto pads`);
  }

  function drawWave(cv, smp, bounds) {
    const w = cv.clientWidth || 600, h = 120;
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    const d = smp.data, mid = h / 2;
    ctx.fillStyle = "#161616"; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#f5c518";
    for (let x = 0; x < w; x++) {
      const a = Math.floor((x / w) * d.length), b = Math.max(a + 1, Math.floor(((x + 1) / w) * d.length));
      let mn = 1, mx = -1;
      for (let i = a; i < b; i += 4) { const v = d[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
      const y1 = mid - mx * (mid - 4), y2 = mid - mn * (mid - 4);
      ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    bounds.forEach((s) => ctx.fillRect(Math.floor(s.start * w), 0, 1, h));
  }

  function renderSliceTab(body) {
    const track = project.tracks[sel.t], ti = sel.t;
    $("#detail-title").textContent = track.name + " · Slice";
    body.innerHTML = "";
    if (!track.sample) {
      body.innerHTML = `<div class="slice-empty">
        <p>No sample on this track yet.</p>
        <button id="slice-import" class="br-btn">Import audio…</button>
        <p class="br-hint">WAV, MP3, AIFF, OGG — up to 30 seconds. It lands on ${escapeHtml(track.name)}.</p>
      </div>`;
      body.querySelector("#slice-import").onclick = () => $("#file-import").click();
      return;
    }
    const smp = track.sample, bounds = sliceBounds();
    const ctl = document.createElement("div");
    ctl.className = "slice-ctl";
    ctl.innerHTML = `
      <span class="slice-name">${escapeHtml(smp.name)} · ${(smp.data.length / smp.sr).toFixed(1)}s</span>
      <label>Mode <select id="slice-mode">
        <option value="auto"${sliceCfg.mode === "auto" ? " selected" : ""}>Auto (onsets)</option>
        <option value="equal"${sliceCfg.mode === "equal" ? " selected" : ""}>Equal</option>
      </select></label>
      <label id="slice-count-lab" style="${sliceCfg.mode === "equal" ? "" : "display:none"}">Slices
        <select id="slice-count">${[4, 8, 16].map((n) => `<option${n === sliceCfg.count ? " selected" : ""}>${n}</option>`).join("")}</select>
      </label>
      <button id="slice-chop" class="br-btn accent">Chop to pads (${Math.min(8, bounds.length)})</button>
      <button id="slice-replace" class="br-btn">Replace…</button>
      <button id="slice-clear" class="br-btn danger">Remove</button>`;
    body.appendChild(ctl);
    const cv = document.createElement("canvas");
    cv.id = "wave";
    cv.title = "Click a slice to audition it";
    body.appendChild(cv);
    ctl.querySelector("#slice-mode").onchange = (e) => { sliceCfg.mode = e.target.value; renderDetail(); };
    const cnt = ctl.querySelector("#slice-count");
    if (cnt) cnt.onchange = (e) => { sliceCfg.count = +e.target.value; renderDetail(); };
    ctl.querySelector("#slice-chop").onclick = chopToPads;
    ctl.querySelector("#slice-replace").onclick = () => $("#file-import").click();
    ctl.querySelector("#slice-clear").onclick = () => {
      track.sample = null;
      track.pads.forEach((p, pi) => {
        if (p.src === "sample") { p.src = "synth"; p.sample = null; engine.rebake(ti, pi); }
      });
      persist(); renderDetail();
    };
    requestAnimationFrame(() => drawWave(cv, smp, sliceBounds()));
    cv.onclick = (e) => {
      const r = cv.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const bb = sliceBounds();
      const b = bb.find((s) => frac >= s.start && frac < s.end) || bb[bb.length - 1];
      if (b) engine.previewSlice(smp.data, smp.sr, b.start, b.end);
    };
  }

  function renderAll() {
    renderTransport(); renderBrowser(); renderSession(); renderDetail();
  }

  // ---------------- playhead ----------------
  function playheadLoop() {
    requestAnimationFrame(playheadLoop);
    const lf = engine.lastFired;
    // step cells
    for (let s = 0; s < M.N_STEPS; s++) {
      const on = engine.playing && lf.step === s;
      for (const c of stepCells[s]) c.classList.toggle("now", on);
    }
    // slot progress + position readout
    if (engine.playing && engine.ctx) {
      const barDur = (60 / engine.bpm) * 4;
      const el = Math.max(0, Math.min(1, (engine.ctx.currentTime - engine.barStart) / barDur));
      document.querySelectorAll("[data-prog]").forEach((p) => { p.style.width = (el * 100).toFixed(1) + "%"; });
      const totalSteps = Math.floor((engine.ctx.currentTime - engine.barStart) / (barDur / 16));
      const bar = Math.floor(totalSteps / 16) + 1, st16 = (totalSteps % 16) + 1;
      $("#pos").textContent = bar + ".1." + st16;
    } else {
      document.querySelectorAll("[data-prog]").forEach((p) => { p.style.width = "0%"; });
      if (!engine.playing) $("#pos").textContent = "1.1.1";
    }
  }

  // ---------------- keyboard ----------------
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
    if (e.code === "Space") { e.preventDefault(); engine.ensureAudio(); engine.toggle(); renderTransport(); }
    else if (e.key === "Enter") {
      const clip = selectedClip();
      if (clip) engine.launchClip(sel.t, sel.s);
      renderSession();
    }
    else if (e.key === "Delete" || e.key === "Backspace") {
      if (selectedClip()) { project.clips[sel.t][sel.s] = null; persist(); renderSession(); renderDetail(); }
    }
    else if (e.key === "ArrowRight") { sel.t = Math.min(M.N_TRACKS - 1, sel.t + 1); renderSession(); renderDetail(); }
    else if (e.key === "ArrowLeft") { sel.t = Math.max(0, sel.t - 1); renderSession(); renderDetail(); }
    else if (e.key === "ArrowDown") { sel.s = Math.min(M.N_SCENES - 1, sel.s + 1); renderSession(); renderDetail(); }
    else if (e.key === "ArrowUp") { sel.s = Math.max(0, sel.s - 1); renderSession(); renderDetail(); }
  });

  // ---------------- boot ----------------
  document.querySelectorAll("#detail-tabs button").forEach((b) => {
    b.onclick = () => { detailTab = b.dataset.tab; renderDetail(); };
  });
  document.addEventListener("pointerdown", () => engine.ensureAudio(), { once: true });
  $("#btn-import").onclick = () => $("#file-import").click();
  $("#file-import").onchange = (e) => { importFile(e.target.files[0]); e.target.value = ""; };
  engine.onchange = () => { renderSession(); if (detailTab === "clip") renderDetail(); };
  bindTransport();
  renderAll();
  playheadLoop();
  // test / automation hook (no UI effect)
  window.__spton = { engine, project: () => project, importSample: loadSampleData, chop: chopToPads, slices: sliceBounds };
})();
