// Hold-and-wheel scrubbing through a fake host: a stub window collects the
// listeners, a fake React renders the HUD, and DOM nodes are plain objects with
// parent links. Run: node --test "test/*.test.mjs"
import { test, mock } from "node:test";
import assert from "node:assert/strict";

function node(parent = null) {
  return {
    parentElement: parent,
    contains(other) {
      for (let n = other; n; n = n.parentElement) if (n === this) return true;
      return false;
    },
  };
}

const listeners = new Map();
globalThis.window = {
  addEventListener: (type, fn) => listeners.set(type, fn),
  removeEventListener: (type) => listeners.delete(type),
};
const { activate, deactivate } = await import("../index.js");

function setup() {
  const state = {
    photoId: "p1",
    params: { shadows: 0 },
    paramBag: {},
    setParam: mock.fn((k, v) => { state.params = { ...state.params, [k]: v }; }),
    commitEdit: mock.fn(),
  };
  const useDevelopStore = () => state;
  useDevelopStore.getState = () => state;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useReducer: (_r, init) => [init, () => {}],
    useEffect: (fn) => { fn(); },
    useState: (v) => [v, () => {}],
  };
  let Hud = null;
  activate({
    react,
    stores: { useDevelopStore },
    ui: { Button() {}, Select() {}, NumberInput() {}, Toggle() {}, tokens: {} },
    params: { list: () => [], get: () => undefined },
    keybindings: { list: () => [] },
    develop: { adjustments: { list: () => [], get: () => 0, set() {} } },
    settings: { get: (_k, d) => d, set() {}, onChange: () => () => {} },
    registerSlot: (c) => { Hud = c.component; },
    unregisterSlot() {},
    registerSettings() {},
  });

  // The develop canvas area: the overlay layer the HUD mounts in, and the
  // canvas beside it. A side panel and a dialogue live elsewhere in the page.
  const page = node();
  const area = node(page);
  const layer = node(area);
  const canvas = node(area);
  const sidePanel = node(page);
  const dialog = node(page);
  const hudRoot = node(layer);
  const el = Hud();
  if (el && typeof el.props.ref === "function") el.props.ref(hudRoot);

  const fire = (type, e) => listeners.get(type)(e);
  const keydown = (key) => fire("keydown", { key, repeat: false, target: page });
  const keyup = (key) => fire("keyup", { key, target: page });
  const wheel = (target, deltaY = -120) => {
    const e = { target, deltaY, deltaMode: 0, preventDefault: mock.fn(), stopPropagation: mock.fn() };
    fire("wheel", e);
    return e;
  };
  return { state, canvas, sidePanel, dialog, keydown, keyup, wheel };
}

test("wheel over a side panel or a dialogue scrolls it, not the held slider", (t) => {
  t.after(deactivate);
  const { state, canvas, sidePanel, dialog, keydown, wheel } = setup();
  keydown("s");
  const overPanel = wheel(sidePanel);
  const overDialog = wheel(dialog);
  assert.equal(state.params.shadows, 0, "an off-canvas wheel moved the slider");
  assert.equal(overPanel.preventDefault.mock.callCount(), 0);
  assert.equal(overDialog.preventDefault.mock.callCount(), 0);
  const overImage = wheel(canvas);
  assert.equal(state.params.shadows, 1);
  assert.equal(overImage.preventDefault.mock.callCount(), 1);
});

test("one hold is one undo step, committed on release however long it lasts", (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => { mock.timers.reset(); deactivate(); });
  const { state, canvas, keydown, keyup, wheel } = setup();
  keydown("s");
  wheel(canvas);
  mock.timers.tick(1000);
  wheel(canvas);
  mock.timers.tick(1000);
  assert.equal(state.commitEdit.mock.callCount(), 0, "committed mid-hold");
  keyup("s");
  assert.equal(state.commitEdit.mock.callCount(), 1);
  assert.equal(state.params.shadows, 2);
});

test("losing the window mid-hold commits, since the key-up never arrives", (t) => {
  t.after(deactivate);
  const { state, canvas, keydown, wheel } = setup();
  keydown("s");
  wheel(canvas);
  listeners.get("blur")();
  assert.equal(state.commitEdit.mock.callCount(), 1);
});
