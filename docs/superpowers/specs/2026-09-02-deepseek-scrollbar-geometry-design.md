# DeepSeek Scrollbar Geometry Design

## Goal

Preserve DeepSeek's native custom scrollbar geometry and interaction while retaining the extension's high-visibility width and color controls for the main chat scrollbar only.

## Problem

DeepSeek renders its visible thumb through `.ds-scroll-area__vertical-bar::after`. The extension currently forces `width: 100%` on the thumb container. That removes the spacing geometry DeepSeek uses to coordinate the thumb's normal, hover, and drag states, so the visible thumb can become wider than its parent while dragging.

## Design

The extension will stop setting width or border radius on `.ds-scroll-area__vertical-bar` and its `::after` pseudo-element.

It will continue to apply only these scoped overrides to the selected main chat container:

- The direct custom vertical gutter receives `width: var(--dsa-width, 14px)` and `background-color: var(--dsa-track-color)`.
- The direct custom vertical bar and its `::after` receive `background-color: var(--dsa-thumb-color)`.

All extension custom-scrollbar selectors remain limited to this direct-child structure:

```css
[data-dsa-scroll-container="true"]
  > .ds-scroll-area__gutters
  > .ds-scroll-area__vertical-gutter
```

This excludes nested scrollbars such as the message composer. DeepSeek retains ownership of thumb inset, width, radius, hover behavior, drag behavior, and transitions.

## Verification

1. Add a CSS regression test requiring the direct custom bar color override and rejecting an extension `width` declaration on that bar rule.
2. Run the complete Node test suite.
3. Reload the unpacked extension, set distinct track and thumb colors, and verify that the main chat scrollbar changes color while the composer scrollbar does not.
4. Drag the main chat thumb and confirm its radius and changing geometry remain aligned with the DeepSeek-provided interaction state.
