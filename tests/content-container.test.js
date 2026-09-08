const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const settingsApi = require('../settings.js');
const groupsApi = require('../groups.js');

function createElement(id, options) {
  const styleProperties = new Map();
  const listeners = new Map();
  const classes = new Set();
  return {
    id,
    clientHeight: options.clientHeight,
    scrollHeight: options.scrollHeight,
    scrollTop: options.scrollTop || 0,
    dataset: {},
    children: [],
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
    style: {
      setProperty(name, value) { styleProperties.set(name, value); },
      removeProperty(name) { styleProperties.delete(name); },
      getPropertyValue(name) { return styleProperties.get(name) || ''; }
    },
    getBoundingClientRect() { return options.rect; },
    computedStyle: options.computedStyle,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    dispatch(type) { listeners.get(type)?.(); },
    listenerCount(type) { return listeners.has(type) ? 1 : 0; },
    scrollTo(options) { this.lastScrollTo = options; }
  };
}

function loadContent({ elements = [], dark = false, stored = settingsApi.DEFAULTS, asyncStorage = false, initialContentRect } = {}) {
  const storageListeners = [];
  const mediaListeners = [];
  const windowListeners = new Map();
  const resizeObservers = [];
  const timers = new Map();
  const normalizedSettings = [];
  let nextTimerId = 1;
  let clearCalls = 0;
  let storageCallback;
  let observer;
  const nodes = new Map();
  function register(node) {
    if (node.id) nodes.set(node.id, node);
    for (const child of node.children || []) register(child);
  }
  function makeNode(tagName) {
    const node = createElement('', {
      clientHeight: 0, scrollHeight: 0, rect: { width: 0, height: 0 },
      computedStyle: { display: 'block', visibility: 'visible', overflowY: 'visible' }
    });
    node.tagName = tagName;
    node.setAttribute = () => {};
    node.remove = () => {
      for (const child of node.children) child.remove();
      nodes.delete(node.id);
    };
    Object.defineProperty(node, 'innerHTML', {
      set() {
        const top = makeNode('button');
        top.id = 'dsa-scroll-top';
        const latest = makeNode('button');
        latest.id = 'dsa-scroll-latest';
        node.children = [top, latest];
      }
    });
    return node;
  }
  const contentSettingsApi = {
    ...settingsApi,
    normalizeSettings(value) {
      const normalized = settingsApi.normalizeSettings(value);
      normalizedSettings.push(normalized);
      return normalized;
    }
  };
  const context = {
    DEEPSEEK_SCROLL_SETTINGS: contentSettingsApi,
    DEEPSEEK_GROUPS: groupsApi,
    document: {
      body: {
        append(node) { register(node); },
        appendChild(node) { register(node); }
      },
      createElement: makeNode,
      querySelector(selector) { return nodes.get(selector.slice(1)) || null; },
      querySelectorAll() { return elements; }
    },
    chrome: {
      storage: {
        sync: {
          get(defaults, callback) {
            if (asyncStorage) storageCallback = callback;
            else callback(stored);
          }
        },
        onChanged: { addListener(listener) { storageListeners.push(listener); } }
      }
    },
    getComputedStyle(element) { return element.computedStyle; },
    matchMedia() {
      return {
        matches: dark,
        addEventListener(type, listener) { if (type === 'change') mediaListeners.push(listener); }
      };
    },
    window: {
      addEventListener(type, listener) { windowListeners.set(type, listener); }
    },
    MutationObserver: class { constructor(callback) { observer = { callback, observeCalls: 0 }; } observe() { observer.observeCalls += 1; } },
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.observed = [];
        this.disconnectCalls = 0;
        resizeObservers.push(this);
      }
      observe(element) {
        this.observed.push(element);
        this.callback([{
          target: element,
          contentRect: initialContentRect ? { ...initialContentRect } : { ...element.getBoundingClientRect() }
        }]);
      }
      disconnect() { this.disconnectCalls += 1; }
    },
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { clearCalls += 1; timers.delete(id); }
  };
  vm.runInNewContext(fs.readFileSync('content.js', 'utf8'), context);
  return {
    elements,
    mediaListeners,
    observer,
    storageListeners,
    dispatchWindowEvent(type) { windowListeners.get(type)?.(); },
    resizeObservers,
    completeStorageGet() { storageCallback(stored); },
    runTimers() {
      for (const [id, timer] of [...timers]) {
        timers.delete(id);
        timer.callback();
      }
    },
    timerCount() { return timers.size; },
    timerDelays() { return [...timers.values()].map((timer) => timer.delay); },
    latestSettings() { return normalizedSettings.at(-1); },
    clearCalls() { return clearCalls; },
    resetClearCalls() { clearCalls = 0; },
    node(id) { return nodes.get(id) || null; }
  };
}

test('selects only the largest visible scrollable non-extension container', () => {
  const ignored = createElement('dsa-actions', {
    clientHeight: 200,
    scrollHeight: 400,
    rect: { width: 700, height: 600 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'auto' }
  });
  const selected = createElement('chat', {
    clientHeight: 300,
    scrollHeight: 500,
    rect: { width: 600, height: 500 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'scroll' }
  });
  const other = createElement('sidebar', {
    clientHeight: 300,
    scrollHeight: 500,
    rect: { width: 320, height: 500 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'auto' }
  });

  loadContent({ elements: [ignored, other, selected] });

  assert.equal(selected.dataset.dsaScrollContainer, 'true');
  assert.equal(other.dataset.dsaScrollContainer, undefined);
  assert.equal(ignored.dataset.dsaScrollContainer, undefined);
  assert.equal(selected.style.getPropertyValue('--dsa-width'), '14px');
});

test('cleans selected container immediately when storage disables the extension', () => {
  const selected = createElement('chat', {
    clientHeight: 300,
    scrollHeight: 500,
    rect: { width: 600, height: 500 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'auto' }
  });
  const { resizeObservers, storageListeners } = loadContent({ elements: [selected] });

  storageListeners[0]({ enabled: { newValue: false } }, 'sync');

  assert.equal(selected.dataset.dsaScrollContainer, undefined);
  assert.equal(selected.style.getPropertyValue('--dsa-width'), '');
  assert.equal(selected.style.getPropertyValue('--dsa-thumb-color'), '');
  assert.equal(selected.style.getPropertyValue('--dsa-track-color'), '');
  assert.equal(resizeObservers[0].disconnectCalls, 1);
});

test('uses dark preset and registers one observer', () => {
  const selected = createElement('chat', {
    clientHeight: 300,
    scrollHeight: 500,
    rect: { width: 600, height: 500 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'auto' }
  });
  const { observer } = loadContent({ elements: [selected], dark: true });

  assert.equal(selected.style.getPropertyValue('--dsa-thumb-color'), '#79a7ff');
  assert.equal(selected.style.getPropertyValue('--dsa-track-color'), '#1d2c49');
  assert.equal(observer.observeCalls, 1);
});

test('merges an initialization storage change with unmodified initial values', () => {
  const selected = createElement('chat', {
    clientHeight: 300,
    scrollHeight: 500,
    rect: { width: 600, height: 500 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'auto' }
  });
  const { completeStorageGet, latestSettings, storageListeners } = loadContent({
    elements: [selected],
    asyncStorage: true,
    stored: { enabled: false, width: 20, thumbColor: '#123456', trackColor: null }
  });

  storageListeners[0]({ width: { newValue: 22 } }, 'sync');
  completeStorageGet();

  assert.deepEqual(latestSettings(), {
    enabled: false,
    width: 22,
    thumbColor: '#123456',
    trackColor: null
  });
});

test('removes old styling before selecting a replacement container', () => {
  const first = createElement('first', {
    clientHeight: 300,
    scrollHeight: 500,
    rect: { width: 600, height: 500 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'auto' }
  });
  const replacement = createElement('replacement', {
    clientHeight: 300,
    scrollHeight: 500,
    rect: { width: 500, height: 500 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'auto' }
  });
  const runtime = loadContent({ elements: [first, replacement] });

  first.computedStyle.overflowY = 'hidden';
  runtime.observer.callback();
  runtime.runTimers();

  assert.equal(first.dataset.dsaScrollContainer, undefined);
  assert.equal(first.style.getPropertyValue('--dsa-width'), '');
  assert.equal(first.style.getPropertyValue('--dsa-thumb-color'), '');
  assert.equal(first.style.getPropertyValue('--dsa-track-color'), '');
  assert.equal(replacement.dataset.dsaScrollContainer, 'true');
});

test('removes all DSA styling when mutations leave no candidate', () => {
  const selected = createElement('chat', {
    clientHeight: 300,
    scrollHeight: 500,
    rect: { width: 600, height: 500 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'auto' }
  });
  const runtime = loadContent({ elements: [selected] });

  selected.computedStyle.overflowY = 'hidden';
  runtime.observer.callback();
  runtime.runTimers();

  assert.equal(selected.dataset.dsaScrollContainer, undefined);
  assert.equal(selected.style.getPropertyValue('--dsa-width'), '');
  assert.equal(selected.style.getPropertyValue('--dsa-thumb-color'), '');
  assert.equal(selected.style.getPropertyValue('--dsa-track-color'), '');
});

test('debounces multiple mutations into one 150 ms refresh timer', () => {
  const selected = createElement('chat', {
    clientHeight: 300,
    scrollHeight: 500,
    rect: { width: 600, height: 500 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'auto' }
  });
  const runtime = loadContent({ elements: [selected] });

  runtime.observer.callback();
  runtime.observer.callback();
  runtime.observer.callback();

  assert.equal(runtime.timerCount(), 1);
  assert.deepEqual(runtime.timerDelays(), [150]);
  runtime.runTimers();
  runtime.resetClearCalls();
  runtime.observer.callback();
  assert.equal(runtime.clearCalls(), 0);
});

test('reselects the container after a window resize', () => {
  const first = createElement('first', {
    clientHeight: 300, scrollHeight: 500,
    rect: { width: 600, height: 500 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'auto' }
  });
  const replacement = createElement('replacement', {
    clientHeight: 300, scrollHeight: 500,
    rect: { width: 500, height: 500 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'auto' }
  });
  const runtime = loadContent({ elements: [first, replacement] });

  first.computedStyle.overflowY = 'hidden';
  runtime.dispatchWindowEvent('resize');

  assert.deepEqual(runtime.timerDelays(), [150]);
  runtime.runTimers();
  assert.equal(first.dataset.dsaScrollContainer, undefined);
  assert.equal(replacement.dataset.dsaScrollContainer, 'true');
});

test('ignores an initial content-box resize notification that differs from the border box', () => {
  const selected = createElement('chat', {
    clientHeight: 300, scrollHeight: 500,
    rect: { width: 600, height: 500 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'auto' }
  });
  const runtime = loadContent({
    elements: [selected],
    initialContentRect: { width: 560, height: 460 }
  });

  assert.equal(runtime.timerCount(), 0);
});

test('schedules one refresh after a content-box size change following the initial notification', () => {
  const selected = createElement('chat', {
    clientHeight: 300, scrollHeight: 500,
    rect: { width: 600, height: 500 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'auto' }
  });
  const runtime = loadContent({
    elements: [selected],
    initialContentRect: { width: 560, height: 460 }
  });

  runtime.resizeObservers[0].callback([
    { target: selected, contentRect: { width: 561, height: 460 } }
  ]);

  assert.equal(runtime.timerCount(), 1);
  assert.deepEqual(runtime.timerDelays(), [150]);
});

test('reselects after a changed candidate resize and disconnects replaced and cleared observers', () => {
  const first = createElement('first', {
    clientHeight: 300, scrollHeight: 500,
    rect: { width: 600, height: 500 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'auto' }
  });
  const replacement = createElement('replacement', {
    clientHeight: 300, scrollHeight: 500,
    rect: { width: 500, height: 500 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'auto' }
  });
  const runtime = loadContent({
    elements: [first, replacement],
    initialContentRect: { width: 560, height: 460 }
  });
  const firstObserver = runtime.resizeObservers[0];

  assert.deepEqual(firstObserver.observed, [first]);
  first.computedStyle.overflowY = 'hidden';
  firstObserver.callback([{ target: first, contentRect: { width: 599, height: 500 } }]);
  runtime.runTimers();

  const replacementObserver = runtime.resizeObservers[1];
  assert.equal(firstObserver.disconnectCalls, 1);
  assert.deepEqual(replacementObserver.observed, [replacement]);
  assert.equal(runtime.timerCount(), 0);
  replacement.computedStyle.overflowY = 'hidden';
  replacementObserver.callback([{ target: replacement, contentRect: { width: 499, height: 500 } }]);
  runtime.runTimers();

  assert.equal(replacement.dataset.dsaScrollContainer, undefined);
  assert.equal(replacementObserver.disconnectCalls, 1);
});

test('renders unique controls, scroll state, smooth actions, and label fade', () => {
  const selected = createElement('chat', {
    clientHeight: 300, scrollHeight: 1300, scrollTop: 500,
    rect: { width: 600, height: 500 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'auto' }
  });
  const runtime = loadContent({ elements: [selected] });
  const label = runtime.node('dsa-position-label');
  const top = runtime.node('dsa-scroll-top');
  const latest = runtime.node('dsa-scroll-latest');

  assert.ok(label);
  assert.ok(top);
  assert.ok(latest);
  selected.dispatch('scroll');
  assert.equal(label.value, '50%');
  assert.equal(label.classList.contains('dsa-hidden'), false);
  assert.deepEqual(runtime.timerDelays(), [900]);
  top.dispatch('click');
  assert.equal(selected.lastScrollTo.top, 0);
  assert.equal(selected.lastScrollTo.behavior, 'smooth');
  latest.dispatch('click');
  assert.equal(selected.lastScrollTo.top, 1300);
  assert.equal(selected.lastScrollTo.behavior, 'smooth');
  runtime.runTimers();
  assert.equal(label.classList.contains('dsa-hidden'), true);
});

test('hides endpoint action buttons within 24 pixels and cleans controls on replacement', () => {
  const first = createElement('first', {
    clientHeight: 300, scrollHeight: 1300, scrollTop: 24,
    rect: { width: 600, height: 500 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'auto' }
  });
  const replacement = createElement('replacement', {
    clientHeight: 300, scrollHeight: 1300, scrollTop: 976,
    rect: { width: 500, height: 500 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'auto' }
  });
  const runtime = loadContent({ elements: [first, replacement] });

  first.dispatch('scroll');
  assert.equal(runtime.node('dsa-scroll-top').classList.contains('dsa-hidden'), true);
  first.computedStyle.overflowY = 'hidden';
  runtime.observer.callback();
  runtime.runTimers();
  assert.equal(first.listenerCount('scroll'), 0);
  replacement.dispatch('scroll');
  assert.equal(runtime.node('dsa-scroll-latest').classList.contains('dsa-hidden'), true);
});

test('removes controls and fade timer when disabled or no candidate remains', () => {
  const selected = createElement('chat', {
    clientHeight: 300, scrollHeight: 1300,
    rect: { width: 600, height: 500 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'auto' }
  });
  const runtime = loadContent({ elements: [selected] });
  selected.dispatch('scroll');
  runtime.storageListeners[0]({ enabled: { newValue: false } }, 'sync');

  assert.equal(runtime.node('dsa-position-label'), null);
  assert.equal(runtime.node('dsa-actions'), null);
  assert.equal(runtime.timerDelays().includes(900), false);

  const enabled = loadContent({ elements: [selected] });
  selected.computedStyle.overflowY = 'hidden';
  enabled.observer.callback();
  enabled.runTimers();
  assert.equal(enabled.node('dsa-position-label'), null);
  assert.equal(enabled.node('dsa-actions'), null);
});

test('ignores mutations that only add or remove DSA controls', () => {
  const selected = createElement('chat', {
    clientHeight: 300, scrollHeight: 500,
    rect: { width: 600, height: 500 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'auto' }
  });
  const runtime = loadContent({ elements: [selected] });
  const actions = runtime.node('dsa-actions');
  const label = runtime.node('dsa-position-label');

  runtime.observer.callback([{ addedNodes: [actions], removedNodes: [label] }]);

  assert.equal(runtime.timerDelays().includes(150), false);
});

test('schedules refresh when a mutation batch also contains a page node', () => {
  const selected = createElement('chat', {
    clientHeight: 300, scrollHeight: 500,
    rect: { width: 600, height: 500 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'auto' }
  });
  const pageNode = createElement('streaming-content', {
    clientHeight: 0, scrollHeight: 0,
    rect: { width: 0, height: 0 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'visible' }
  });
  const runtime = loadContent({ elements: [selected] });

  runtime.observer.callback([{ addedNodes: [runtime.node('dsa-actions'), pageNode], removedNodes: [] }]);

  assert.equal(runtime.timerDelays().includes(150), true);
});

test('keeps existing controls when the selected container survives a page mutation', () => {
  const selected = createElement('chat', {
    clientHeight: 300, scrollHeight: 1300, scrollTop: 0,
    rect: { width: 600, height: 500 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'auto' }
  });
  const pageNode = createElement('streaming-content', {
    clientHeight: 0, scrollHeight: 0,
    rect: { width: 0, height: 0 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'visible' }
  });
  const runtime = loadContent({ elements: [selected] });
  const label = runtime.node('dsa-position-label');
  const actions = runtime.node('dsa-actions');
  const top = runtime.node('dsa-scroll-top');

  runtime.observer.callback([{ addedNodes: [pageNode], removedNodes: [] }]);
  runtime.runTimers();

  assert.equal(runtime.node('dsa-position-label'), label);
  assert.equal(runtime.node('dsa-actions'), actions);
  assert.equal(runtime.node('dsa-scroll-top'), top);
  assert.equal(top.classList.contains('dsa-hidden'), true);
});

test('waits for async storage initialization before injecting and honors disabled changes', () => {
  const selected = createElement('chat', {
    clientHeight: 300, scrollHeight: 500,
    rect: { width: 600, height: 500 },
    computedStyle: { display: 'block', visibility: 'visible', overflowY: 'auto' }
  });
  const runtime = loadContent({
    elements: [selected],
    asyncStorage: true,
    stored: { enabled: false, width: 14, thumbColor: null, trackColor: null }
  });

  assert.equal(selected.dataset.dsaScrollContainer, undefined);
  assert.equal(runtime.node('dsa-position-label'), null);
  assert.equal(runtime.node('dsa-actions'), null);
  runtime.observer.callback([{ addedNodes: [selected], removedNodes: [] }]);
  runtime.dispatchWindowEvent('resize');
  assert.equal(runtime.timerCount(), 0);
  runtime.runTimers();
  assert.equal(selected.dataset.dsaScrollContainer, undefined);
  assert.equal(runtime.node('dsa-position-label'), null);
  assert.equal(runtime.node('dsa-actions'), null);
  runtime.storageListeners[0]({ enabled: { newValue: false } }, 'sync');
  assert.equal(selected.dataset.dsaScrollContainer, undefined);
  assert.equal(runtime.node('dsa-position-label'), null);
  assert.equal(runtime.node('dsa-actions'), null);
  runtime.completeStorageGet();
  assert.equal(selected.dataset.dsaScrollContainer, undefined);
  assert.equal(runtime.node('dsa-position-label'), null);
  assert.equal(runtime.node('dsa-actions'), null);
});
