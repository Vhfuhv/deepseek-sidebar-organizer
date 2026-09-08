const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSettings, DEFAULTS, WIDTH_MIN, WIDTH_MAX } = require('../settings.js');

test('uses defaults for missing or invalid settings', () => {
  assert.deepEqual(normalizeSettings(), DEFAULTS);
  assert.deepEqual(normalizeSettings({ enabled: 'yes', width: 2 }), DEFAULTS);
});

test('clamps width and preserves valid optional colors', () => {
  assert.deepEqual(normalizeSettings({
    enabled: false,
    width: WIDTH_MAX + 10,
    thumbColor: '#123abc',
    trackColor: '#ffffff'
  }), {
    enabled: false,
    width: WIDTH_MAX,
    thumbColor: '#123abc',
    trackColor: '#ffffff'
  });
  assert.equal(normalizeSettings({ width: WIDTH_MIN - 1 }).width, WIDTH_MIN);
});
