# DeepSeek Scrollbar Geometry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the main DeepSeek chat scrollbar's configured width and colors while restoring DeepSeek's native thumb geometry and drag interaction.

**Architecture:** The extension continues to style only the selected chat container's direct custom gutter, bar, and visible `::after` thumb layer. It removes its width override from the custom bar so DeepSeek again owns thumb size, inset, border radius, hover effects, drag effects, and transitions.

**Tech Stack:** Native CSS, Node built-in `node:test`, Chromium Manifest V3 extension.

## Global Constraints

- Match only `https://chat.deepseek.com/*`.
- Do not read, persist, transmit, or modify DeepSeek conversation content.
- Keep custom scrollbar styling scoped to `[data-dsa-scroll-container="true"] > .ds-scroll-area__gutters > .ds-scroll-area__vertical-gutter`.
- The main custom gutter keeps `width: var(--dsa-width, 14px)` and `background-color: var(--dsa-track-color)`.
- The direct custom bar and its `::after` keep `background-color: var(--dsa-thumb-color)`.
- Do not set `width`, `border-radius`, hover, drag, or transition properties on `.ds-scroll-area__vertical-bar` or its `::after`.
- Do not style nested scrollbars such as the message composer.

---

## File Structure

- `content.css`: Removes the custom bar width override while retaining the direct-child gutter and color overrides.
- `tests/content-styles.test.js`: Asserts the selected custom scrollbar structure remains scoped and that its custom bar rule contains no geometry override.

### Task 1: Restore DeepSeek Thumb Geometry

**Files:**
- Modify: `content.css:20-32`
- Modify: `tests/content-styles.test.js:14-29`

**Interfaces:**
- Consumes: `--dsa-width`, `--dsa-track-color`, and `--dsa-thumb-color` placed on the selected conversation container by `content.js`.
- Produces: scoped colors and gutter width without changing DeepSeek's custom thumb geometry.

- [ ] **Step 1: Write the failing regression test**

In `tests/content-styles.test.js`, read the direct custom-bar rule and assert that it has the thumb background override but no width declaration:

```js
const customBarRule = css.match(
  /\[data-dsa-scroll-container="true"\] > \.ds-scroll-area__gutters > \.ds-scroll-area__vertical-gutter > \.ds-scroll-area__vertical-bar\s*\{([^}]*)\}/
);

assert.ok(customBarRule);
assert.match(customBarRule[1], /background-color:\s*var\(--dsa-thumb-color\) !important;/);
assert.doesNotMatch(customBarRule[1], /\bwidth\s*:/);
assert.doesNotMatch(customBarRule[1], /\bborder-radius\s*:/);
```

- [ ] **Step 2: Run the style test to verify it fails**

Run: `node --test tests/content-styles.test.js`

Expected: FAIL because the direct custom-bar rule still contains `width: 100% !important`.

- [ ] **Step 3: Remove only the custom bar width override**

In `content.css`, change the direct custom-bar rule to:

```css
[data-dsa-scroll-container="true"] > .ds-scroll-area__gutters > .ds-scroll-area__vertical-gutter > .ds-scroll-area__vertical-bar {
  background-color: var(--dsa-thumb-color) !important;
}
```

Leave the gutter width and track color rule unchanged. Leave the direct custom bar `::after` color rule unchanged. Do not add radius, sizing, hover, drag, or transition declarations.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test tests/content-styles.test.js`

Expected: PASS.

- [ ] **Step 5: Run the complete automated suite and whitespace check**

Run: `npm test`

Expected: PASS with all tests passing.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 6: Perform browser verification**

Reload the unpacked extension from `chrome://extensions/`, then hard-refresh `chat.deepseek.com`. Set distinct track and thumb colors in the popup.

Expected:

- The main chat track and visible thumb use the configured colors.
- The composer scrollbar retains its DeepSeek styling.
- Hovering and dragging the main chat thumb preserve DeepSeek's original aligned roundness and size changes, with no mismatch between the bar and visible `::after` layer.

- [ ] **Step 7: Commit the geometry restoration**

```bash
git add content.css tests/content-styles.test.js
git commit -m "fix: preserve DeepSeek scrollbar thumb geometry"
```
