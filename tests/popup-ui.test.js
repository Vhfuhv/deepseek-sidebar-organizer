const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

class Element {
  constructor() {
    this.checked = false;
    this.disabled = false;
    this.value = '';
    this.listeners = {};
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  dispatch(type) {
    this.listeners[type]();
  }
}

function loadPopup() {
  const elements = Object.fromEntries([
    'enabled', 'width', 'thumb-color', 'track-color', 'width-value', 'reset'
  ].map((id) => [id, new Element()]));
  const saved = [];
  let resolveStorage;
  const context = {
    document: { getElementById: (id) => elements[id] },
    chrome: {
      storage: {
        sync: {
          get: (_defaults, callback) => { resolveStorage = callback; },
          set: (settings, callback) => {
            saved.push({ ...settings });
            if (callback) callback();
          }
        }
      }
    }
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'settings.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.join(root, 'popup.js'), 'utf8'), context);
  return { elements, resolveStorage, saved };
}

test('popup blocks writes until stored settings have rendered', () => {
  const { elements, resolveStorage, saved } = loadPopup();

  for (const id of ['enabled', 'width', 'thumb-color', 'track-color', 'reset']) {
    assert.equal(elements[id].disabled, true);
    assert.equal(Object.keys(elements[id].listeners).length, 0);
  }
  assert.deepEqual(saved, []);

  resolveStorage({ enabled: true, width: 14, thumbColor: '#123abc', trackColor: '#abcdef' });

  assert.equal(elements.enabled.disabled, false);
  assert.equal(elements.width.disabled, false);
  assert.equal(elements['thumb-color'].value, '#123abc');
  assert.equal(elements['track-color'].value, '#abcdef');
});

test('popup previews width input and saves null presets only after committing the change', () => {
  const { elements, resolveStorage, saved } = loadPopup();
  resolveStorage({ enabled: true, width: 14, thumbColor: null, trackColor: null });

  elements.enabled.checked = false;
  elements.enabled.dispatch('change');
  elements.width.value = '20';
  elements.width.dispatch('input');
  assert.equal(elements['width-value'].value, '20px');
  assert.deepEqual(saved, [
    { enabled: false, width: 14, thumbColor: null, trackColor: null }
  ]);
  elements.width.dispatch('change');

  assert.deepEqual(saved, [
    { enabled: false, width: 14, thumbColor: null, trackColor: null },
    { enabled: false, width: 20, thumbColor: null, trackColor: null }
  ]);
});

test('popup stores explicit colors and reset restores defaults and UI', () => {
  const { elements, resolveStorage, saved } = loadPopup();
  resolveStorage({ enabled: false, width: 20, thumbColor: null, trackColor: null });

  elements['thumb-color'].value = '#123abc';
  elements['thumb-color'].dispatch('input');
  assert.deepEqual(saved, []);
  elements['thumb-color'].dispatch('change');
  elements['track-color'].value = '#abcdef';
  elements['track-color'].dispatch('change');
  elements.reset.dispatch('click');

  assert.deepEqual(saved, [
    { enabled: false, width: 20, thumbColor: '#123abc', trackColor: null },
    { enabled: false, width: 20, thumbColor: '#123abc', trackColor: '#abcdef' },
    { enabled: true, width: 14, thumbColor: null, trackColor: null }
  ]);
  assert.equal(elements.enabled.checked, true);
  assert.equal(elements.width.value, 14);
  assert.equal(elements['thumb-color'].value, '#2674ff');
  assert.equal(elements['track-color'].value, '#dbe7ff');
});
