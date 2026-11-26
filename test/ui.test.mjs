// Preferences and HUD chrome through a fake host: every control is the app's
// ui kit (never a hand-built <button>, <select> or <input>), and every colour is
// a ui token rather than a raw CSS variable. Run: node --test "test/*.test.mjs"
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const listeners = new Map();
globalThis.window = {
  addEventListener: (type, fn) => listeners.set(type, fn),
  removeEventListener: (type) => listeners.delete(type),
};
const { activate, deactivate } = await import("../index.js");

const Button = () => null;
const Select = () => null;
const NumberInput = () => null;
const Toggle = () => null;
const tokens = {
  border: "T-border", surface2: "T-surface2", textPrimary: "T-primary", textSecondary: "T-secondary",
  textMuted: "T-muted", labelRed: "T-red", fontMono: "T-mono", accent: "T-accent",
};

function host(bindings) {
  const state = { photoId: "p1", params: {}, paramBag: {}, setParam() {}, commitEdit() {} };
  const useDevelopStore = () => state;
  useDevelopStore.getState = () => state;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
    useReducer: (_r, init) => [init, () => {}],
    useEffect: (fn) => { fn(); },
    useState: (v) => [v, () => {}],
  };
  const registered = {};
  activate({
    react,
    stores: { useDevelopStore },
    ui: { Button, Select, NumberInput, Toggle, tokens },
    params: { list: () => [], get: () => undefined },
    keybindings: { list: () => [] },
    develop: { adjustments: { list: () => [], get: () => 0, set() {} } },
    settings: { get: (k, d) => (k === "bindings" && bindings ? bindings : d), set() {}, onChange: () => () => {} },
    registerSlot: (c) => { registered.hud = c.component; },
    unregisterSlot() {},
    registerSettings: (c) => { registered.settings = c.component; },
  });
  return registered;
}

/** Every element of a rendered tree, expanding the extension's own components. */
function expand(node) {
  if (Array.isArray(node)) return node.flatMap(expand);
  if (!node || typeof node !== "object") return [];
  const own = typeof node.type === "function" && ![Button, Select, NumberInput, Toggle].includes(node.type);
  const rendered = own ? expand(node.type(node.props)) : node.children.flatMap(expand);
  return [node, ...rendered];
}

const styles = (tree) => tree.map((e) => JSON.stringify(e.props.style ?? {}));

test("preferences are built from the ui kit alone", (t) => {
  t.after(deactivate);
  const tree = expand(host().settings());
  assert.deepEqual(tree.filter((e) => ["button", "select", "input", "label"].includes(e.type)), []);
  for (const kit of [Button, Select, NumberInput, Toggle]) assert.ok(tree.some((e) => e.type === kit));
});

test("preferences take their colours from the ui tokens", (t) => {
  t.after(deactivate);
  const tree = expand(host([{ key: "a", param: "exposure" }, { key: "a", param: "contrast" }]).settings());
  assert.equal(styles(tree).filter((s) => s.includes("var(--")).length, 0);
  assert.ok(styles(tree).some((s) => s.includes("T-red")), "the duplicate-key warning is not label red");
  assert.ok(styles(tree).some((s) => s.includes("T-muted")));
});

test("the readout takes its colours from the ui tokens", (t) => {
  t.after(deactivate);
  const { hud } = host();
  const page = { parentElement: null, contains: () => true };
  const el = hud();
  el.props.ref({ parentElement: page });
  listeners.get("keydown")({ key: "s", repeat: false, target: page });
  const shown = expand(hud());
  assert.ok(shown.some((e) => e.props.style?.border?.includes("T-border")));
  assert.equal(styles(shown).filter((s) => s.includes("var(--")).length, 0);
});
