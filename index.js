// Speed Edit for Safelight
// Copyright (c) 2026 Anthony Reimche. MIT License.
//
// Keyboard + mouse-wheel scrubbing for the Develop adjustments — no clicking,
// no dragging. Hold a bound key and roll the wheel over the image to push that
// slider: A = Exposure, Z = Contrast, S = Shadows, H = Highlights, and so on.
// Release the key to drop the change into one undo step. Every binding (key,
// target slider and step-per-notch) is remappable in Preferences ▸ Speed Edit.
//
// Why a wheel and not click-drag: it's the fast path for high-volume editing.
// You keep one hand on the keyboard, one on the wheel, and never reach for a
// slider handle. Capture One ships this natively; this brings it to Safelight.
//
// How it stays honest: each notch just calls the SAME develop-store setParam the
// built-in sliders call (live preview), then releasing the key commitEdits the
// scrub session to history. It never touches the render path, thumbnails or
// export — it only moves the values you could have moved by hand.

// ── Adjustable parameters ─────────────────────────────────────────────────────
// Every scalar develop slider Speed Edit can drive. step = default change per
// wheel notch; decimals/signed/unit control the on-screen readout. These mirror
// the ranges the built-in panels enforce.
const PARAMS = {
  exposure:    { label: "Exposure",    min: -5,    max: 5,     step: 0.05, decimals: 2, signed: true,  unit: "EV" },
  contrast:    { label: "Contrast",    min: -100,  max: 100,   step: 1,    decimals: 0, signed: true,  unit: "" },
  highlights:  { label: "Highlights",  min: -100,  max: 100,   step: 1,    decimals: 0, signed: true,  unit: "" },
  shadows:     { label: "Shadows",     min: -100,  max: 100,   step: 1,    decimals: 0, signed: true,  unit: "" },
  whites:      { label: "Whites",      min: -100,  max: 100,   step: 1,    decimals: 0, signed: true,  unit: "" },
  blacks:      { label: "Blacks",      min: -100,  max: 100,   step: 1,    decimals: 0, signed: true,  unit: "" },
  texture:     { label: "Texture",     min: -100,  max: 100,   step: 1,    decimals: 0, signed: true,  unit: "" },
  clarity:     { label: "Clarity",     min: -100,  max: 100,   step: 1,    decimals: 0, signed: true,  unit: "" },
  dehaze:      { label: "Dehaze",      min: -100,  max: 100,   step: 1,    decimals: 0, signed: true,  unit: "" },
  vibrance:    { label: "Vibrance",    min: -100,  max: 100,   step: 1,    decimals: 0, signed: true,  unit: "" },
  saturation:  { label: "Saturation",  min: -100,  max: 100,   step: 1,    decimals: 0, signed: true,  unit: "" },
  temperature: { label: "Temperature", min: 2000,  max: 50000, step: 50,   decimals: 0, signed: false, unit: "K" },
  tint:        { label: "Tint",        min: -150,  max: 150,   step: 1,    decimals: 0, signed: true,  unit: "" },
  sharpening:  { label: "Sharpening",  min: 0,     max: 100,   step: 1,    decimals: 0, signed: false, unit: "" },
};

// Sensible mnemonic defaults that DON'T collide with Develop's built-in
// single-key shortcuts (G D F Tab J O [ ]). A = Exposure and Z = Contrast match
// the request; the rest follow the Basic + White Balance panel order.
const DEFAULT_BINDINGS = [
  { key: "A", param: "exposure" },
  { key: "Z", param: "contrast" },
  { key: "H", param: "highlights" },
  { key: "S", param: "shadows" },
  { key: "W", param: "whites" },
  { key: "B", param: "blacks" },
  { key: "T", param: "temperature" },
  { key: "Y", param: "tint" },
  { key: "V", param: "vibrance" },
  { key: "C", param: "saturation" },
  { key: "Q", param: "clarity" },
  { key: "E", param: "dehaze" },
  { key: "R", param: "texture" },
];

const CFG_DEFAULTS = { enabled: true, invert: false, showHud: true, fineFactor: 0.2 };
const SLOT_ID = "speed-edit.hud";

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function normKey(k) { return typeof k === "string" && k.length === 1 ? k.toUpperCase() : k; }
function eventKey(e) { return normKey(e.key); }
function isEditable(t) {
  if (!t || !t.tagName) return false;
  const tag = t.tagName;
  return !!t.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
function fmtVal(meta, v) {
  let s = meta.decimals > 0 ? v.toFixed(meta.decimals) : String(Math.round(v));
  if (meta.signed && v > 0) s = "+" + s;
  return meta.unit ? s + " " + meta.unit : s;
}

// Tiny external store so the HUD (a React component) re-renders when the wheel
// handlers (plain DOM callbacks) push a new value. Avoids any host-version
// dependency on a particular zustand entry point.
function makeStore(React, initial) {
  let state = initial;
  const subs = new Set();
  return {
    set(patch) { state = { ...state, ...patch }; subs.forEach((f) => f()); },
    use() {
      const [, force] = React.useReducer((x) => x + 1, 0);
      React.useEffect(() => { subs.add(force); return () => { subs.delete(force); }; }, []);
      return state;
    },
  };
}

let cleanup = null;

export function activate(api) {
  const React = api.react;
  const h = React.createElement;
  const { Button, Select, NumberInput, Toggle, tokens } = api.ui;
  const useDevelopStore = api.stores.useDevelopStore;

  // Core's structured "nested" sliders (vignette/grain/…) routed through setParam
  // by the host — they live inside a param object so a plain setParam can't reach
  // them.
  const da = api.develop.adjustments;

  // ── runtime state ───────────────────────────────────────────────────────────
  let cfg = { ...CFG_DEFAULTS };
  let bindings = new Map();      // normalized KEY -> { key, param, step? }
  const held = new Set();        // bound keys currently pressed (insertion order)
  let activeKey = null;          // most-recently-pressed held key drives the wheel
  let accum = 0;                 // sub-step accumulator (smooth trackpads / fine mode)
  let accumParam = null;
  let hudRoot = null;            // the HUD's element, mounted while the Develop canvas is on screen
  let capturing = false;         // a Preferences key-capture is listening — stand down
  let commitDirty = false, commitLabel = "Speed Edit";
  let hideTimer = null;

  const hud = makeStore(React, { on: false, label: "", value: "", sub: "" });

  function loadConfig() {
    cfg.enabled = !!api.settings.get("enabled", CFG_DEFAULTS.enabled);
    cfg.invert = !!api.settings.get("invert", CFG_DEFAULTS.invert);
    cfg.showHud = !!api.settings.get("showHud", CFG_DEFAULTS.showHud);
    cfg.fineFactor = clamp(Number(api.settings.get("fineFactor", CFG_DEFAULTS.fineFactor)) || CFG_DEFAULTS.fineFactor, 0.02, 1);
    const raw = api.settings.get("bindings", null);
    const list = Array.isArray(raw) ? raw : DEFAULT_BINDINGS;
    bindings = new Map();
    for (const b of list) {
      // Keep any keyed entry; the target (core param OR an extension uniform) is
      // resolved lazily so a binding survives the extension that owns it loading
      // after us — or being momentarily absent.
      if (!b || !b.key || !b.param) continue;
      const k = normKey(b.key);
      bindings.set(k, { key: k, param: b.param, step: typeof b.step === "number" ? b.step : undefined });
    }
  }
  loadConfig();
  const offSettings = api.settings.onChange(() => loadConfig());

  // ── target resolution (built-in params + other extensions' sliders) ───────────
  // Built-in scalars live on the develop store's `params`; extension sliders are
  // uniforms in `paramBag`, keyed "<stageId>.<uniform>". When the host exposes
  // api.params (read-only stage-uniform descriptors) we can target those too.
  function descriptorFor(param) {
    try { return api.params.get(param) || null; } catch (_) { return null; }
  }
  function decimalsForStep(step) {
    if (!(step > 0) || step >= 1) return 0;
    return Math.min(4, Math.ceil(-Math.log10(step)));
  }
  // Core nested adjustments (vignette/grain/…) from the host, keyed by their
  // dotted id ("vignette.amount"), normalized to the same meta shape. Built once.
  let _adjMap = null;
  function adjMap() {
    if (_adjMap) return _adjMap;
    _adjMap = new Map();
    try {
      for (const a of da.list() || []) {
        _adjMap.set(a.key, {
          // HUD label is qualified ("Vignette · Amount"); the dropdown item
          // stays short ("Amount") under its group heading.
          label: a.group ? a.group + " · " + a.label : a.label,
          group: a.group, min: a.min, max: a.max, step: a.step,
          decimals: a.step < 1 ? decimalsForStep(a.step) : 0,
          signed: a.min < 0, unit: "", adj: true, def: a.default,
        });
      }
    } catch (_) {}
    return _adjMap;
  }
  function metaFor(param) {
    const core = PARAMS[param];
    if (core) return core;
    const adj = adjMap().get(param);
    if (adj) return adj;
    const d = descriptorFor(param);
    if (!d || (d.glslType !== "float" && d.glslType !== "int")) return null;
    // Core's own stages (vignette/grain/denoise) drive their uniforms from
    // structured params, NOT paramBag, so setDynParam can't move them — only
    // genuine extension stages are scrubbable this way.
    if (isBuiltinExt(d.extensionId)) return null;
    const isInt = d.glslType === "int";
    const r = d.range || null;
    const span = r ? r.max - r.min : 0;
    const step = r && r.step != null ? r.step : isInt ? 1 : span > 0 ? span / 100 : 0.1;
    const uniformLabel = d.label || d.localKey || param;
    const stageLabel = d.stageName || prettyId(d.stageId);
    return {
      // HUD label qualified by the owning stage ("Halation · Amount").
      label: stageLabel ? stageLabel + " · " + uniformLabel : uniformLabel,
      min: r ? r.min : null,
      max: r ? r.max : null,
      step,
      decimals: isInt ? 0 : decimalsForStep(step),
      signed: r ? r.min < 0 : true,
      unit: "",
      dynamic: true,
      def: typeof d.default === "number" ? d.default : 0,
    };
  }
  function readVal(param, meta) {
    if (meta.adj) return da.get(param);
    const ds = useDevelopStore.getState();
    if (!meta.dynamic) return Number(ds.params[param]) || 0;
    const v = (ds.paramBag || {})[param];
    return typeof v === "number" ? v : meta.def || 0;
  }
  function writeVal(param, value, meta) {
    if (meta.adj) { da.set(param, value); return; }
    const ds = useDevelopStore.getState();
    if (meta.dynamic) ds.setDynParam(param, value);
    else ds.setParam(param, value);
  }
  // Prettify an id segment (last "/" or "." part) into a display word.
  function prettyId(s) {
    const seg = String(s || "").split("/").pop().split(".").pop().replace(/[-_]/g, " ").trim();
    return seg ? seg.replace(/\b\w/g, (c) => c.toUpperCase()) : "";
  }
  function isBuiltinExt(id) { return id === "core" || (typeof id === "string" && id.startsWith("core.")); }
  // Heading for a stage's group: the owning extension's name (third-party) and/or
  // the stage name, so the list says WHERE each slider comes from. Falls back to
  // prettified ids on hosts that don't yet provide stageName/extensionName.
  function groupTitle(d) {
    const stage = d.stageName || prettyId(d.stageId);
    if (isBuiltinExt(d.extensionId)) return stage || "Built-in";
    const ext = d.extensionName || prettyId(d.extensionId);
    if (ext && stage && ext.toLowerCase() !== stage.toLowerCase()) return ext + " · " + stage;
    return ext || stage || "Extension";
  }

  // Bare keys the LIVE shortcuts already use while editing (General + Develop;
  // Library shortcuts don't fire in Develop), read from core so this never goes
  // stale when bindings change or the user remaps. KEY -> action label.
  function reservedKeyMap() {
    const out = new Map();
    try {
      for (const b of api.keybindings.list() || []) {
        if (b.category !== "General" && b.category !== "Develop") continue;
        if (!b.combo || b.combo.includes("+")) continue; // bare single keys only
        out.set(normKey(b.combo), b.label || b.id);
      }
    } catch (_) {}
    return out;
  }

  // ── history commit (one undo step per scrub session) ─────────────────────────
  // A session ends on key release, on a switch to another key, or on window
  // blur, which stands in for a key-up the window never receives.
  function flushCommit() {
    if (commitDirty) {
      commitDirty = false;
      try { useDevelopStore.getState().commitEdit(commitLabel); } catch (_) {}
    }
  }
  function markDirty(label) {
    commitDirty = true;
    commitLabel = label;
  }

  function canvasMounted() { return hudRoot !== null; }
  // The overlay layer the HUD mounts in covers the canvas, and its parent holds
  // the canvas itself, so a wheel whose target sits in there is over the image
  // (or a core overlay on it), never a side panel or a dialogue on top.
  function overCanvas(target) {
    const area = hudRoot && hudRoot.parentElement && hudRoot.parentElement.parentElement;
    return !!area && !!target && area.contains(target);
  }

  // ── HUD ──────────────────────────────────────────────────────────────────────
  function cancelHide() { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } }
  function hideHudSoon() { cancelHide(); hideTimer = setTimeout(() => { hud.set({ on: false }); hideTimer = null; }, 750); }
  function showHud(meta, value, withHint) {
    if (!cfg.showHud) return;
    cancelHide();
    hud.set({
      on: true,
      label: meta.label,
      value: fmtVal(meta, value),
      sub: withHint ? "scroll to adjust · Shift = fine" : "",
    });
  }

  // ── input handlers ────────────────────────────────────────────────────────────
  function onKeyDown(e) {
    if (!cfg.enabled || capturing) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // bare key (Shift allowed for fine)
    if (isEditable(e.target)) return;
    const k = eventKey(e);
    const b = bindings.get(k);
    if (!b) return;

    if (e.repeat && held.has(k)) { activeKey = k; cancelHide(); return; }

    held.add(k);
    if (activeKey !== k) {
      flushCommit();          // a new key starts a new scrub session
      accum = 0;
      accumParam = b.param;
    }
    activeKey = k;
    const meta = metaFor(b.param);
    if (canvasMounted() && meta) showHud(meta, readVal(b.param, meta), true);
  }

  function onKeyUp(e) {
    const k = eventKey(e);
    if (!held.has(k)) return;
    held.delete(k);
    if (activeKey === k) {
      flushCommit();
      const rest = [...held];
      activeKey = rest.length ? rest[rest.length - 1] : null;
      if (activeKey) {
        const b = bindings.get(activeKey);
        accum = 0;
        accumParam = b ? b.param : null;
        const meta = b ? metaFor(b.param) : null;
        if (meta && canvasMounted()) showHud(meta, readVal(b.param, meta), true);
      } else {
        hideHudSoon();
      }
    }
  }

  function onWheel(e) {
    if (!cfg.enabled || capturing || !activeKey || !overCanvas(e.target)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave system/zoom gestures alone
    const b = bindings.get(activeKey);
    if (!b) return;
    const meta = metaFor(b.param);
    if (!meta) return;
    const ds = useDevelopStore.getState();
    if (!ds.photoId) return;

    e.preventDefault();
    e.stopPropagation();

    let unit = e.deltaY;
    if (e.deltaMode === 1) unit *= 16;        // lines → ~px
    else if (e.deltaMode === 2) unit *= 120;  // pages → ~notches
    const notches = -unit / 120;              // wheel up (deltaY < 0) increases

    const step = b.step != null ? b.step : meta.step;
    const fine = e.shiftKey ? cfg.fineFactor : 1;
    const dir = cfg.invert ? -1 : 1;
    const delta = notches * step * fine * dir;

    if (accumParam !== b.param) { flushCommit(); accumParam = b.param; accum = 0; }
    accum += delta;

    // Emit whole display-units; carry the remainder so fine mode and smooth
    // trackpads still move integer sliders predictably.
    const scale = Math.pow(10, meta.decimals);
    let applied = meta.decimals > 0
      ? Math.round(accum * scale) / scale
      : (accum >= 0 ? Math.floor(accum) : Math.ceil(accum));
    if (applied === 0) return;
    accum -= applied;

    const cur = readVal(b.param, meta);
    let next = cur + applied;
    if (meta.min != null) next = Math.max(meta.min, next);
    if (meta.max != null) next = Math.min(meta.max, next);
    next = meta.decimals > 0 ? Math.round(next * scale) / scale : Math.round(next);
    if (next !== cur) {
      writeVal(b.param, next, meta);
      markDirty(meta.label);
    }
    showHud(meta, next, false);
  }

  function onBlur() {
    held.clear();
    activeKey = null;
    flushCommit();
    hud.set({ on: false });
  }

  const wheelOpts = { capture: true, passive: false };
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("wheel", onWheel, wheelOpts);
  window.addEventListener("blur", onBlur);

  // ── HUD overlay (rendered over the Develop canvas) ────────────────────────────
  const setHudRoot = (el) => { hudRoot = el; };
  const hudAnchor = { position: "absolute", inset: 0, pointerEvents: "none" };
  const hudWrap = {
    position: "absolute", top: "12px", left: "50%", transform: "translateX(-50%)",
    display: "flex", flexDirection: "column", alignItems: "center", gap: "2px",
    pointerEvents: "none", zIndex: 30,
  };
  const hudInner = {
    display: "flex", alignItems: "baseline", gap: "7px", padding: "4px 9px",
    borderRadius: "7px", border: `1px solid ${tokens.border}`,
    background: `color-mix(in srgb, ${tokens.surface2} 88%, transparent)`,
    boxShadow: "0 3px 12px rgba(0,0,0,0.3)", backdropFilter: "blur(6px)",
  };
  const hudLabel = { fontSize: "9px", letterSpacing: "0.05em", textTransform: "uppercase", color: tokens.textSecondary };
  const hudValue = { fontSize: "13px", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: tokens.textPrimary };
  const hudSub = { fontSize: "9px", color: tokens.textMuted };

  function Hud() {
    const st = hud.use();
    // Always mounted, empty while hidden, so its element marks the canvas area.
    if (!cfg.showHud || !st.on) return h("div", { ref: setHudRoot, style: hudAnchor });
    return h("div", { ref: setHudRoot, style: hudAnchor },
      h("div", { style: hudWrap },
        h("div", { style: hudInner },
          h("span", { style: hudLabel }, st.label),
          h("span", { style: hudValue }, st.value),
        ),
        st.sub ? h("div", { style: hudSub }, st.sub) : null,
      ),
    );
  }
  api.registerSlot({ id: SLOT_ID, slot: "develop-canvas-overlay", component: Hud, order: 1000 });

  // ── Preferences ▸ Speed Edit ──────────────────────────────────────────────────
  function KeyCapture({ value, onCapture }) {
    const [armed, setArmed] = React.useState(false);
    React.useEffect(() => {
      if (!armed) return;
      capturing = true;
      const handler = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const k = ev.key;
        if (k === "Control" || k === "Shift" || k === "Alt" || k === "Meta") return;
        if (k !== "Escape") onCapture(normKey(k));
        setArmed(false);
      };
      window.addEventListener("keydown", handler, true);
      return () => { window.removeEventListener("keydown", handler, true); capturing = false; };
    }, [armed]);
    return h(
      Button,
      { variant: armed ? "primary" : "secondary", size: "sm", active: armed, onClick: () => setArmed((a) => !a), style: { minWidth: "62px", flex: "0 0 auto", fontFamily: tokens.fontMono } },
      armed ? "press…" : (value || "—"),
    );
  }

  function Settings() {
    const [, bump] = React.useReducer((x) => x + 1, 0);
    React.useEffect(() => api.settings.onChange(() => bump()), []);

    const enabled = !!api.settings.get("enabled", CFG_DEFAULTS.enabled);
    const invert = !!api.settings.get("invert", CFG_DEFAULTS.invert);
    const showHud = !!api.settings.get("showHud", CFG_DEFAULTS.showHud);
    const fineFactor = Number(api.settings.get("fineFactor", CFG_DEFAULTS.fineFactor)) || CFG_DEFAULTS.fineFactor;
    const rawBindings = api.settings.get("bindings", null);
    const list = (Array.isArray(rawBindings) ? rawBindings : DEFAULT_BINDINGS).map((b) => ({ ...b }));

    const saveList = (next) => api.settings.set("bindings", next);
    const setRow = (i, patch) => { const next = list.map((b, j) => (j === i ? { ...b, ...patch } : b)); saveList(next); };
    const removeRow = (i) => saveList(list.filter((_, j) => j !== i));
    const addRow = () => saveList([...list, { key: "", param: "exposure" }]);

    // Flag a key bound on more than one row (last one wins at runtime).
    const counts = {};
    for (const b of list) if (b.key) counts[normKey(b.key)] = (counts[normKey(b.key)] || 0) + 1;

    // Target list: built-in sliders, then one group per extension stage exposing
    // scrubbable float/int sliders.
    // First (untitled) group = the built-in sliders; no heading so the dropdown
    // trigger shows them plainly ("Exposure"), while extension groups keep a
    // heading so a selection reads "Spektrafilm · Halation · Amount".
    const groups = [{ items: Object.keys(PARAMS).map((k) => ({ value: k, label: PARAMS[k].label })) }];
    const allValues = new Set(groups[0].items.map((o) => o.value));
    // Core nested sliders (Vignette, Grain, …) — one titled group each.
    try {
      const byGroup = new Map();
      for (const a of da.list() || []) {
        let g = byGroup.get(a.group);
        if (!g) { g = { title: a.group, items: [] }; byGroup.set(a.group, g); }
        g.items.push({ value: a.key, label: a.label });
        allValues.add(a.key);
      }
      for (const g of byGroup.values()) groups.push(g);
    } catch (_) {}
    try {
      const byStage = new Map();
      for (const d of api.params.list() || []) {
        if (!d || (d.glslType !== "float" && d.glslType !== "int") || !d.range) continue;
        // Skip core's own stages — structured-param driven, not paramBag (see metaFor).
        if (isBuiltinExt(d.extensionId)) continue;
        let g = byStage.get(d.stageId);
        if (!g) { g = { title: groupTitle(d), items: [] }; byStage.set(d.stageId, g); }
        g.items.push({ value: d.qualifiedKey, label: d.label || d.localKey || d.qualifiedKey });
        allValues.add(d.qualifiedKey);
      }
      const extGroups = [...byStage.values()].filter((g) => g.items.length);
      extGroups.sort((a, b) => a.title.localeCompare(b.title));
      for (const g of extGroups) { g.items.sort((a, b) => a.label.localeCompare(b.label)); groups.push(g); }
    } catch (_) {}

    const labelCss = { fontSize: "11px", color: tokens.textSecondary, textTransform: "uppercase", letterSpacing: "0.04em" };
    const noteCss = { fontSize: "10px", color: tokens.textMuted, lineHeight: 1.5 };

    // Live set of bare keys core already uses while editing (never hard-coded).
    const reservedKeys = reservedKeyMap();

    const rows = list.map((b, i) => {
      const key = b.key ? normKey(b.key) : "";
      const meta = metaFor(b.param) || { step: 1, decimals: 0 };
      const dup = key && counts[key] > 1;
      const reservedBy = reservedKeys.get(key);
      const warn = dup ? "duplicate key" : reservedBy ? "used by " + reservedBy : "";
      // Keep the row readable even if its target's extension is currently absent.
      const rowGroups = allValues.has(b.param)
        ? groups
        : [{ items: [{ value: b.param || "", label: (b.param || "—") + " — unavailable" }] }].concat(groups);
      const tickTop = { flex: "0 0 auto" };
      return h("div", { key: i, style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "nowrap" } },
        h(KeyCapture, { value: key, onCapture: (k) => setRow(i, { key: k }) }),
        h("span", { style: { color: tokens.textMuted, fontSize: "11px", ...tickTop } }, "→"),
        h("div", { style: { flex: "1 1 auto", minWidth: 0 } },
          h(Select, { value: b.param, groups: rowGroups, onChange: (v) => setRow(i, { param: v }) }),
        ),
        warn
          ? h("span", { style: { fontSize: "10px", color: tokens.labelRed, whiteSpace: "nowrap", ...tickTop } }, warn)
          : null,
        h("span", { style: { color: tokens.textMuted, fontSize: "10px", ...tickTop } }, "step"),
        h(NumberInput, {
          value: b.step != null ? b.step : meta.step, width: "60px",
          step: meta.decimals > 0 ? 0.01 : 1,
          onChange: (v) => setRow(i, { step: v }),
        }),
        h(Button, { variant: "ghost", size: "sm", onClick: () => removeRow(i), title: "Remove binding", style: { color: tokens.textMuted, flex: "0 0 auto" } }, "✕"),
      );
    });

    return h("div", { style: { display: "flex", flexDirection: "column", gap: "16px" } },
      h("p", { style: noteCss },
        "Hold a key and roll the mouse wheel over the image to move that slider — no clicking, no dragging. ",
        "Release the key to commit the change as one undo step. Hold Shift while scrolling for fine steps.",
      ),

      h("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } },
        h(Toggle, { checked: enabled, label: "Enable Speed Edit", onChange: (v) => api.settings.set("enabled", v) }),
        h(Toggle, { checked: showHud, label: "Show value readout on the image", onChange: (v) => api.settings.set("showHud", v) }),
        h(Toggle, { checked: invert, label: "Invert wheel direction", onChange: (v) => api.settings.set("invert", v) }),
        h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
          h("span", { style: { fontSize: "11px", color: tokens.textPrimary } }, "Fine-step multiplier (Shift)"),
          h(NumberInput, { value: fineFactor, width: "62px", step: 0.05, onChange: (v) => api.settings.set("fineFactor", clamp(v, 0.02, 1)) }),
        ),
      ),

      h("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } },
        h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } },
          h("span", { style: labelCss }, "Key bindings"),
          h("div", { style: { display: "flex", gap: "6px" } },
            h(Button, { variant: "secondary", size: "sm", onClick: addRow }, "+ Add"),
            h(Button, { variant: "ghost", size: "sm", onClick: () => saveList(DEFAULT_BINDINGS.map((b) => ({ ...b }))) }, "Reset defaults"),
          ),
        ),
        ...rows,
        reservedKeys.size
          ? h("p", { style: noteCss }, "Tip: keys already bound while editing are flagged — currently " + [...reservedKeys.keys()].sort().join(", ") + ".")
          : null,
      ),
    );
  }

  api.registerSettings({
    title: "Speed Edit",
    order: 50,
    fields: [],
    component: Settings,
    keywords: ["keyboard", "wheel", "scroll", "shortcut", "scrub", "speed", "exposure", "contrast", "tactile"],
  });

  cleanup = () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("wheel", onWheel, wheelOpts);
    window.removeEventListener("blur", onBlur);
    offSettings();
    flushCommit();
    api.unregisterSlot(SLOT_ID);
  };
}

export function deactivate() {
  if (cleanup) { cleanup(); cleanup = null; }
}
