# DeepSeek Scroll Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chromium Manifest V3 extension that makes the active DeepSeek chat scrollbar conspicuous and adds lightweight conversation navigation controls.

**Architecture:** A content script locates one visible, scrollable main-chat candidate, applies a data attribute used by scoped CSS, and owns the injected position label and navigation actions. A toolbar popup saves simple preferences in `chrome.storage.sync`; content scripts subscribe to those changes and update the current page without reloading.

**Tech Stack:** Chromium Extension Manifest V3, native HTML, CSS, JavaScript, `chrome.storage.sync`, WebKit scrollbar pseudo-elements.

## Global Constraints

- Match only `https://chat.deepseek.com/*`.
- Support Chromium browsers only.
- Use no third-party dependencies, build tools, or bundled libraries.
- Do not read, persist, transmit, or modify DeepSeek conversation content.
- Use the `dsa-` prefix for extension-owned classes and data attributes.
- Store settings in `chrome.storage.sync` as `enabled`, `width`, `thumbColor`, and `trackColor`.
- Default to enabled with a 14-pixel scrollbar and theme-derived preset colors.
- Use `null` color values to mean theme-derived preset colors.

---

## File Structure

- `manifest.json`: Declares the MV3 extension, scoped content script, popup, and storage permission.
- `content.css`: Defines only `dsa-` styles for the selected scroll container and page overlays.
- `content.js`: Finds and tracks the chat scroll container, injects controls, renders settings, and handles navigation.
- `popup.html`: Contains accessible controls for all persisted settings.
- `popup.css`: Styles the compact extension popup.
- `popup.js`: Reads, normalizes, writes, and resets popup settings.
- `tests/popup-settings.test.js`: Node built-in test coverage for settings normalization, which is extracted into a dependency-free module.
- `settings.js`: Pure settings constants and normalization shared by popup and tested independently.
- `README.md`: Documents local installation, usage, scope, and manual verification.

### Task 1: Extension Manifest and Settings Contract

**Files:**
- Create: `manifest.json`
- Create: `settings.js`
- Create: `tests/popup-settings.test.js`
- Create: `package.json`

**Interfaces:**
- Produces: global `DEEPSEEK_SCROLL_SETTINGS` from `settings.js` with `DEFAULTS`, `WIDTH_MIN`, `WIDTH_MAX`, and `normalizeSettings(value)`.
- Produces: `manifest.json` that loads `settings.js`, then `content.js`, on `https://chat.deepseek.com/*`, and loads `popup.html` from `action.default_popup`.
- Consumes: Node 20+ built-in `node:test` and `node:assert/strict` only.

- [ ] **Step 1: Write the failing settings-normalization tests**

Create `tests/popup-settings.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/popup-settings.test.js`

Expected: FAIL because `../settings.js` does not exist.

- [ ] **Step 3: Implement the settings contract and extension manifest**

Create `settings.js` using a UMD-style export so it works in both Node tests and extension pages:

```js
(function attachSettings(root) {
  const DEFAULTS = Object.freeze({ enabled: true, width: 14, thumbColor: null, trackColor: null });
  const WIDTH_MIN = 8;
  const WIDTH_MAX = 24;
  const COLOR = /^#[0-9a-f]{6}$/i;

  function normalizeColor(value) {
    return typeof value === 'string' && COLOR.test(value) ? value.toLowerCase() : null;
  }

  function normalizeSettings(value) {
    if (!value || (value.enabled !== undefined && typeof value.enabled !== 'boolean')) return { ...DEFAULTS };
    const width = Number.isFinite(value.width) ? Math.round(value.width) : DEFAULTS.width;
    return {
      enabled: value.enabled === undefined ? DEFAULTS.enabled : value.enabled,
      width: Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, width)),
      thumbColor: normalizeColor(value.thumbColor),
      trackColor: normalizeColor(value.trackColor)
    };
  }

  const api = { DEFAULTS, WIDTH_MIN, WIDTH_MAX, normalizeSettings };
  root.DEEPSEEK_SCROLL_SETTINGS = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

Create `manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "DeepSeek Scroll Assistant",
  "version": "1.0.0",
  "description": "Improves the DeepSeek chat scrollbar and adds chat navigation controls.",
  "permissions": ["storage"],
  "action": { "default_popup": "popup.html" },
  "content_scripts": [{
    "matches": ["https://chat.deepseek.com/*"],
    "js": ["settings.js", "content.js"],
    "css": ["content.css"],
    "run_at": "document_idle"
  }]
}
```

Create `package.json`:

```json
{
  "private": true,
  "scripts": { "test": "node --test" }
}
```

- [ ] **Step 4: Run tests to verify the settings contract passes**

Run: `npm test`

Expected: PASS with two passing tests.

- [ ] **Step 5: Validate the manifest parses as JSON**

Run: `node -e "JSON.parse(require('node:fs').readFileSync('manifest.json', 'utf8')); console.log('manifest valid')"`

Expected: `manifest valid`.

- [ ] **Step 6: Commit the manifest and settings contract**

```bash
git add manifest.json settings.js tests/popup-settings.test.js package.json
git commit -m "feat: add extension manifest and settings contract"
```

### Task 2: Popup Settings UI

**Files:**
- Create: `popup.html`
- Create: `popup.css`
- Create: `popup.js`
- Modify: `manifest.json`

**Interfaces:**
- Consumes: `DEEPSEEK_SCROLL_SETTINGS.DEFAULTS`, `WIDTH_MIN`, `WIDTH_MAX`, and `normalizeSettings` from `settings.js`.
- Produces: a popup that writes `{ enabled, width, thumbColor, trackColor }` to `chrome.storage.sync` after each change.
- Produces: a reset action that writes `DEFAULTS` and updates all form controls.

- [ ] **Step 1: Create the semantic popup markup**

Create `popup.html` that loads `settings.js` then `popup.js`, with this control contract:

```html
<main class="dsa-popup">
  <h1>DeepSeek Scroll</h1>
  <label class="dsa-switch-row" for="enabled"><span>启用增强</span><input id="enabled" type="checkbox"></label>
  <label for="width">滚动条宽度 <output id="width-value" for="width"></output></label>
  <input id="width" type="range" min="8" max="24" step="1">
  <label for="thumb-color">滑块颜色</label>
  <input id="thumb-color" type="color" value="#2674ff">
  <label for="track-color">轨道颜色</label>
  <input id="track-color" type="color" value="#dbe7ff">
  <p id="preset-note">颜色会随网页深浅主题自动适配。</p>
  <button id="reset" type="button">恢复推荐值</button>
</main>
```

- [ ] **Step 2: Implement popup state loading and persistence**

Create `popup.js` with `currentSettings` retaining `null` theme-derived colors until a user changes a color input. Width and enabled changes must not accidentally turn theme presets into custom colors:

```js
const settingsApi = globalThis.DEEPSEEK_SCROLL_SETTINGS;
const ids = ['enabled', 'width', 'thumb-color', 'track-color'];
const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
const widthValue = document.getElementById('width-value');
let currentSettings = settingsApi.DEFAULTS;

function readForm() {
  return settingsApi.normalizeSettings({
    enabled: elements.enabled.checked,
    width: Number(elements.width.value),
    thumbColor: currentSettings.thumbColor,
    trackColor: currentSettings.trackColor
  });
}

function render(settings) {
  currentSettings = settings;
  elements.enabled.checked = settings.enabled;
  elements.width.value = settings.width;
  widthValue.value = `${settings.width}px`;
  elements['thumb-color'].value = settings.thumbColor || '#2674ff';
  elements['track-color'].value = settings.trackColor || '#dbe7ff';
}

function save() {
  const settings = readForm();
  chrome.storage.sync.set(settings);
  render(settings);
}

chrome.storage.sync.get(settingsApi.DEFAULTS, (stored) => render(settingsApi.normalizeSettings(stored)));
elements.enabled.addEventListener('change', save);
elements.width.addEventListener('input', save);
elements['thumb-color'].addEventListener('input', () => {
  currentSettings.thumbColor = elements['thumb-color'].value;
  save();
});
elements['track-color'].addEventListener('input', () => {
  currentSettings.trackColor = elements['track-color'].value;
  save();
});
document.getElementById('reset').addEventListener('click', () => {
  chrome.storage.sync.set(settingsApi.DEFAULTS, () => render(settingsApi.DEFAULTS));
});
```

Update `manifest.json` to load the popup stylesheet from `popup.html`; no additional permission is needed.

- [ ] **Step 3: Style the popup for a compact, legible toolbar surface**

Create `popup.css` with a 280-pixel minimum popup width, system font stack, visible focus outlines, a grid layout for labels and inputs, and a full-width reset button. Keep all classes prefixed `dsa-`.

- [ ] **Step 4: Manually verify popup behavior from an unpacked extension**

Run: `start chrome://extensions/`

Expected: The extensions page opens. Enable Developer mode, choose “Load unpacked”, select the repository directory, then open the extension toolbar popup. Verify the toggle, range output, colors, and reset action all change and retain their displayed values after closing and reopening the popup.

- [ ] **Step 5: Run regression tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit the popup settings UI**

```bash
git add popup.html popup.css popup.js manifest.json
git commit -m "feat: add scrollbar settings popup"
```

### Task 3: Scoped Scrollbar Styling and Overlay Controls

**Files:**
- Create: `content.css`

**Interfaces:**
- Consumes: a selected scroll container with `data-dsa-scroll-container="true"`.
- Consumes: CSS properties `--dsa-width`, `--dsa-thumb-color`, and `--dsa-track-color` set by `content.js`.
- Produces: styles for `#dsa-position-label`, `#dsa-actions`, `#dsa-scroll-top`, and `#dsa-scroll-latest`.

- [ ] **Step 1: Add only scoped WebKit scrollbar rules**

Create `content.css` using the selected-container attribute exclusively:

```css
[data-dsa-scroll-container="true"]::-webkit-scrollbar { width: var(--dsa-width, 14px); }
[data-dsa-scroll-container="true"]::-webkit-scrollbar-track { background: var(--dsa-track-color); }
[data-dsa-scroll-container="true"]::-webkit-scrollbar-thumb {
  background: var(--dsa-thumb-color);
  border: 2px solid var(--dsa-track-color);
  border-radius: 999px;
}
[data-dsa-scroll-container="true"]::-webkit-scrollbar-thumb:hover,
[data-dsa-scroll-container="true"]::-webkit-scrollbar-thumb:active { filter: brightness(1.2); }
```

- [ ] **Step 2: Add non-layout-shifting overlay styles**

Add styles that keep `#dsa-position-label` and `#dsa-actions` fixed, set `pointer-events: none` on the label, restore `pointer-events: auto` on buttons, include visible `:focus-visible` outlines, and use an `.dsa-hidden` class for opacity/visibility transitions. Position actions at `right: 28px; bottom: 28px` and the label at `right: 28px; top: 50%`.

- [ ] **Step 3: Verify stylesheet scope statically**

Run: `rg "::-webkit-scrollbar" content.css`

Expected: Every result begins with `[data-dsa-scroll-container="true"]`.

- [ ] **Step 4: Commit the page styles**

```bash
git add content.css
git commit -m "feat: add scoped scrollbar and overlay styles"
```

### Task 4: Conversation Container Detection and Settings Application

**Files:**
- Create: `content.js`

**Interfaces:**
- Consumes: `DEEPSEEK_SCROLL_SETTINGS` from `settings.js`.
- Consumes: CSS attribute and properties from Task 3.
- Produces: `findScrollContainer()`, `applySettings(settings)`, and `refreshContainer()` within the content-script module.
- Produces: exactly one selected element marked `data-dsa-scroll-container="true"` while enabled and a suitable candidate exists.

- [ ] **Step 1: Implement safe candidate selection**

Create `content.js` and implement these helpers:

```js
function isVisible(element) {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 240 && rect.height > 180 && style.display !== 'none' && style.visibility !== 'hidden';
}

function isScrollable(element) {
  const style = getComputedStyle(element);
  return element.scrollHeight - element.clientHeight > 24 && /(auto|scroll)/.test(style.overflowY);
}

function findScrollContainer() {
  return [...document.querySelectorAll('body *')]
    .filter((element) => !element.id.startsWith('dsa-') && isVisible(element) && isScrollable(element))
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0]?.element || null;
}
```

- [ ] **Step 2: Implement theme-aware settings application**

Add the fixed presets and style-property updates:

```js
const LIGHT = { thumb: '#2674ff', track: '#dbe7ff' };
const DARK = { thumb: '#79a7ff', track: '#1d2c49' };

function activePreset() {
  return matchMedia('(prefers-color-scheme: dark)').matches ? DARK : LIGHT;
}

function applySettings(settings) {
  const preset = activePreset();
  if (!state.container || !settings.enabled) return;
  state.container.dataset.dsaScrollContainer = 'true';
  state.container.style.setProperty('--dsa-width', `${settings.width}px`);
  state.container.style.setProperty('--dsa-thumb-color', settings.thumbColor || preset.thumb);
  state.container.style.setProperty('--dsa-track-color', settings.trackColor || preset.track);
}
```

Use `chrome.storage.sync.get(settingsApi.DEFAULTS, ...)` on startup and `chrome.storage.onChanged.addListener(...)` to normalize and reapply stored settings immediately.

- [ ] **Step 3: Revalidate on page changes without duplicate observers**

Implement `refreshContainer()` to remove the data attribute and the three `--dsa-*` properties from an old candidate, select a replacement, and apply current settings. Start one `MutationObserver` on `document.body` with `{ childList: true, subtree: true }`; debounce `refreshContainer()` by 150 milliseconds. Listen for `matchMedia('(prefers-color-scheme: dark)')` changes and reapply settings.

- [ ] **Step 4: Manually verify selection on DeepSeek**

Reload the unpacked extension from `chrome://extensions/`, open a DeepSeek conversation with enough messages to scroll, and inspect the page.

Expected: Exactly one element has `data-dsa-scroll-container="true"`; its scrollbar has the configured width and colors. The sidebar scrollbar retains the site’s original appearance.

- [ ] **Step 5: Commit container detection**

```bash
git add content.js
git commit -m "feat: detect and style the chat scroll container"
```

### Task 5: Position Indicator and Navigation Actions

**Files:**
- Modify: `content.js`
- Modify: `content.css`

**Interfaces:**
- Consumes: `state.container`, `state.settings`, and `refreshContainer()` from Task 4.
- Produces: one label with ID `dsa-position-label` and action group with IDs `dsa-scroll-top` and `dsa-scroll-latest` while the extension is enabled with an active container.
- Produces: fade behavior after 900 milliseconds and top/latest visibility changes within 24 pixels of either endpoint.

- [ ] **Step 1: Inject controls once and wire accessible actions**

Extend `content.js` with an `ensureControls()` helper that appends these elements to `document.body` only when absent:

```js
const label = document.createElement('output');
label.id = 'dsa-position-label';
label.className = 'dsa-hidden';
label.setAttribute('aria-live', 'off');

const actions = document.createElement('div');
actions.id = 'dsa-actions';
actions.innerHTML = '<button id="dsa-scroll-top" type="button" aria-label="回到对话顶部">顶部</button><button id="dsa-scroll-latest" type="button" aria-label="跳到最新消息">最新</button>';
```

Attach clicks that call `state.container.scrollTo({ top: 0, behavior: 'smooth' })` and `state.container.scrollTo({ top: state.container.scrollHeight, behavior: 'smooth' })`. Do not access message DOM nodes.

- [ ] **Step 2: Implement scroll-state rendering and fade timing**

Add `renderScrollState()` with this contract:

```js
const maximum = Math.max(0, state.container.scrollHeight - state.container.clientHeight);
const percent = maximum === 0 ? 0 : Math.round((state.container.scrollTop / maximum) * 100);
label.value = `${percent}%`;
topButton.classList.toggle('dsa-hidden', state.container.scrollTop <= 24);
latestButton.classList.toggle('dsa-hidden', maximum - state.container.scrollTop <= 24);
```

On each container `scroll` event, remove `dsa-hidden` from the label, call `renderScrollState()`, clear the existing timer, and set a 900-millisecond timer that adds `dsa-hidden` to the label. Detach the old listener before assigning a replacement container.

- [ ] **Step 3: Remove overlays completely when disabled or no container exists**

Add `removeControls()` that removes `#dsa-position-label` and `#dsa-actions`, clears the fade timer, and is invoked whenever settings are disabled or `refreshContainer()` cannot select a valid candidate.

- [ ] **Step 4: Manually verify controls across a long conversation**

In a long conversation, scroll to an intermediate position.

Expected: A correct percentage appears briefly near the right edge; “顶部” and “最新” buttons both appear. Click each and verify smooth navigation plus correct button hiding at the destination. Disable the popup toggle and verify all overlays and custom scrollbar styling disappear.

- [ ] **Step 5: Run regression tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit controls and behavior**

```bash
git add content.js content.css
git commit -m "feat: add chat scroll position and navigation controls"
```

### Task 6: User Documentation and Release Verification

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: final extension files from Tasks 1 through 5.
- Produces: complete instructions for installing the unpacked extension and confirming expected behavior.

- [ ] **Step 1: Write the README**

Create `README.md` covering:

- The extension’s purpose and strict `chat.deepseek.com` scope.
- Features: high-contrast scrollbar, theme presets, popup configuration, percentage label, top/latest actions.
- Privacy statement: the extension does not read, store, or transmit chat content.
- Chromium installation steps: open `chrome://extensions/`, enable Developer mode, select “Load unpacked”, and choose this repository directory.
- Usage instructions for the toolbar popup.
- The eight manual verification cases from the approved design specification.

- [ ] **Step 2: Run automated checks**

Run: `npm test`

Expected: PASS.

Run: `node -e "JSON.parse(require('node:fs').readFileSync('manifest.json', 'utf8')); console.log('manifest valid')"`

Expected: `manifest valid`.

- [ ] **Step 3: Perform the final browser verification**

Reload the unpacked extension and validate the README’s eight manual verification cases in a long DeepSeek conversation across both page themes.

Expected: Every case succeeds; only the active conversation’s scrollbar changes, settings survive reload, and no duplicate overlays occur after changing conversations.

- [ ] **Step 4: Inspect the final diff and status**

Run: `git status --short`

Expected: Only the intended uncommitted `README.md` appears before the final commit.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md
git commit -m "docs: add extension installation and usage guide"
```
