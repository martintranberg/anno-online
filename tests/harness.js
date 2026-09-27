'use strict';
// Loads the real game scripts (in the order index.html lists them) into an isolated Node VM context
// with a minimal fake DOM, canvas and localStorage. No npm packages needed.
//
//   const game = createGame({ seed: 1 });
//   game.newGame({ size: 'small' });        // same path as choosing "Nyt spil" in the dialog
//   const G = game.api;                      // every top-level game binding: G.GAME, G.tick(), G.DEFS ...
//
// Randomness inside the game is seeded, so maps and simulations are reproducible.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function scriptFiles() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => path.join(ROOT, m[1]));
}

// Canvas 2D context that accepts every call and remembers nothing (drawing code still runs in full)
function fakeContext2D() {
  const noop = () => {};
  const special = {
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    createPattern: () => ({ setTransform: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    measureText: (s) => ({ width: String(s).length * 6 })
  };
  const state = {};
  return new Proxy(state, {
    get: (t, k) => (k in special ? special[k] : k in t ? t[k] : noop),
    set: (t, k, v) => { t[k] = v; return true; }
  });
}

class FakeElement {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.hidden = false;
    this._html = '';
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.width = 300;
    this.height = 150;
    this.scrollTop = 0;
    this.className = '';
    this.listeners = {};
    const classes = new Set();
    this.classList = {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
      toggle: (c, on) => { const v = on ?? !classes.has(c); if (v) classes.add(c); else classes.delete(c); return v; }
    };
    this._ctx = null;
  }
  // Setting innerHTML replaces the child elements, like in a browser
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this._parsedEls = null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener() {}
  dispatch(type, extra = {}) {
    const ev = { type, target: this, stopPropagation() {}, preventDefault() {}, ...extra };
    for (const fn of [...(this.listeners[type] || [])]) fn(ev);
  }
  click() { this.dispatch('click'); }
  // Panels look up their buttons right after setting innerHTML. Simple selectors (`[data-x]`, `[data-x="v"]`,
  // `tag[data-x]`) are matched against the tags in innerHTML, so tests can click them; the same element objects
  // are returned until innerHTML changes. Anything not found yields a detached element (querySelector) or none.
  _parse() {
    if (this._parsedEls) return this._parsedEls;
    const els = [];
    for (const m of String(this.innerHTML).matchAll(/<([a-zA-Z][\w-]*)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*\/?>/g)) {
      const el = new FakeElement(m[1]);
      el.attrs = {};
      for (const a of m[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
        const val = (a[2] ?? '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        el.attrs[a[1]] = val;
        if (a[1].startsWith('data-')) el.dataset[a[1].slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = val;
      }
      el.value = el.attrs.value ?? '';
      el.checked = 'checked' in el.attrs;
      el.disabled = 'disabled' in el.attrs;
      el.className = el.attrs.class ?? '';
      els.push(el);
    }
    this._parsedEls = els;
    return els;
  }
  _matches(el, sel) {
    const m = /^([a-zA-Z]*)\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel.trim());
    if (!m) return false;
    return (!m[1] || el.tagName === m[1].toUpperCase()) && m[2] in el.attrs && (m[3] === undefined || el.attrs[m[2]] === m[3]);
  }
  querySelector(sel) { return this._parse().find(el => this._matches(el, sel)) || new FakeElement('div', sel); }
  querySelectorAll(sel) { return this._parse().filter(el => this._matches(el, sel)); }
  appendChild(c) { this.children.push(c); return c; }
  contains() { return false; }
  getContext() { return (this._ctx ||= fakeContext2D()); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
  focus() {}
  blur() {}
}

function createGame({ seed = 1, storage = null, width = 1280, height = 800 } = {}) {
  const elements = new Map();
  const winListeners = {};
  const docListeners = {};
  const store = new Map(storage ? Object.entries(storage) : []);
  const logs = [];
  let reloaded = false;

  const document = {
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, new FakeElement(id === 'canvas' || id === 'minimap' ? 'canvas' : 'div', id));
      return elements.get(id);
    },
    createElement: (tag) => new FakeElement(tag),
    querySelector: (sel) => new FakeElement('div', sel),
    querySelectorAll: () => [],
    addEventListener: (t, f) => { (docListeners[t] ||= []).push(f); },
    activeElement: null,
    hidden: false,
    visibilityState: 'visible',
    body: new FakeElement('body')
  };

  const context = {
    console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: console.error, info() {} },
    document,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
      key: (i) => [...store.keys()][i] ?? null,
      get length() { return store.size; }
    },
    location: { reload: () => { reloaded = true; }, href: 'http://test/' },
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: 1,
    addEventListener: (t, f) => { (winListeners[t] ||= []).push(f); },
    removeEventListener() {},
    requestAnimationFrame: () => 0,       // the main loop is driven by the tests, not by frames
    cancelAnimationFrame() {},
    setTimeout: () => 0,                  // toasts etc. don't need to expire in tests
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    confirm: () => true,
    alert() {},
    performance: { now: () => Date.now() },
    DOMMatrix: class { scale() { return this; } },
    Blob: class {},
    URL: { createObjectURL: () => 'blob:', revokeObjectURL() {} },
    navigator: { userAgent: 'node' }
    // No AudioContext: the game's sound stays silent
  };
  context.window = context;
  context.self = context;
  context.globalThis = context;
  vm.createContext(context);

  // Seeded Math.random (mulberry32) inside the game
  vm.runInContext(`Math.random = (function (a) { return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })(${seed >>> 0});`, context);

  for (const file of scriptFiles()) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  }
  // Direct eval inside this function sees the game's global `const`/`let` bindings too
  vm.runInContext(`globalThis.__api = new Proxy({}, { get: (_, k) => typeof k === 'string' ? eval(k) : undefined,
    set: (_, k, v) => { globalThis.__set = v; eval(k + ' = globalThis.__set'); return true; } });`, context);

  const fire = (listeners, type, ev = {}) => { for (const fn of listeners[type] || []) fn({ type, preventDefault() {}, ...ev }); };

  const game = {
    context,
    api: context.__api,
    store,
    logs,
    get reloaded() { return reloaded; },
    run: (code) => vm.runInContext(code, context),
    el: (id) => document.getElementById(id),
    fireWindow: (type, ev) => fire(winListeners, type, ev),
    // Starts the page like a browser would: loads the autosave if there is one, otherwise a pending new game
    boot() { fire(winListeners, 'DOMContentLoaded'); return game; },
    // Starts a new game with the given settings through the real start-up path
    newGame(settings = {}) {
      store.delete('anno-online-save');
      store.set('anno-online-newgame', JSON.stringify({ size: 'small', islands: 'normal', difficulty: 'normal', rival: true, events: true, ...settings }));
      return game.boot();
    }
  };
  return game;
}

module.exports = { createGame, ROOT, scriptFiles };
