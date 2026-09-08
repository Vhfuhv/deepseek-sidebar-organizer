# DeepSeek Scroll Assistant Design

## Goal

Create a Chromium Manifest V3 extension that improves scroll visibility and navigation only on `https://chat.deepseek.com/*`. It must make the active conversation scroll area easy to locate in both light and dark themes without reading, saving, or transmitting conversation content.

## Scope

The first release includes:

- A high-contrast, configurable scrollbar for the active conversation scroll container.
- Automatic light and dark theme presets.
- A toolbar popup with an enable toggle, scrollbar width control, thumb and track color controls, and reset-to-recommended-values action.
- Page controls that scroll to the conversation top or latest message.
- A percentage label near the scrollbar that appears while scrolling and fades out after 900 milliseconds.

The first release excludes keyboard shortcuts, support for non-Chromium browsers, non-DeepSeek sites, and any conversation-content processing.

## Architecture

The extension uses native HTML, CSS, and JavaScript without third-party dependencies or a build step.

### Manifest

`manifest.json` uses Manifest V3 and limits the content script to `https://chat.deepseek.com/*`. It declares `storage` permission for local configuration. The browser action opens the popup.

### Content Script

`content.js` owns page behavior:

- Locate the active chat scroll container dynamically instead of relying on DeepSeek class names.
- Consider visible, scrollable elements and select the largest plausible main-content candidate. Exclude extension-owned elements and avoid modifying all nested scroll regions.
- Recheck the candidate after DOM mutations so switching conversations, route changes, streamed messages, or page rerenders recover automatically.
- Mark only the selected container with a unique data attribute. `content.css` scopes scrollbar styling to that attribute.
- Inject one position-label element and one action-button group. The script guarantees it never creates duplicates.
- Calculate percentage as `scrollTop / (scrollHeight - clientHeight)`, treating a non-scrollable container as 0%.
- Smooth-scroll to `0` for the top action and to `scrollHeight` for the latest-message action.
- Hide the top action when already near the top and the latest-message action when already near the bottom.
- Load settings at startup and subscribe to `chrome.storage` changes so popup edits apply to the open chat tab immediately.
- Remove extension controls and custom attributes when disabled. It does not alter DeepSeek content or persistent page state.

### Page Styles

`content.css` defines all selectors under a dedicated `dsa-` prefix:

- WebKit scrollbar styles apply only to the marked conversation container.
- The scrollbar has a recommended default width of 14 pixels. Its thumb uses a strong blue contrast color and becomes brighter on hover or active drag.
- CSS custom properties provide track color, thumb color, and width from stored settings.
- Light and dark preset values are selected from the page's effective color scheme. Explicit user color choices take precedence over theme presets.
- The position label is right-aligned near the scroll area, ignores pointer input, fades after inactivity, and does not reserve chat layout space.
- The compact top/latest controls are fixed to the chat region's lower-right visual area and are individually hidden when their destination has already been reached.

### Popup

`popup.html`, `popup.css`, and `popup.js` provide a focused settings surface:

- Enabled toggle.
- Width range input with a displayed pixel value.
- Native color inputs for thumb and track colors.
- Reset button that restores recommended values and re-enables theme-driven preset behavior.

Settings use `chrome.storage.sync` so they persist across browser sessions and are available in the user's Chromium profile. The popup does not inspect page content.

## Data Model

The extension stores one settings object in `chrome.storage.sync`:

```js
{
  enabled: true,
  width: 14,
  thumbColor: null,
  trackColor: null
}
```

`null` colors mean use the appropriate built-in light or dark preset. Width is constrained by the popup to a practical range selected during implementation.

## Failure Handling

- If no qualifying scroll container is found, the script performs no page modification and retries after relevant DOM mutations.
- If the current candidate is removed or becomes non-scrollable, the script detaches its handlers and finds a replacement.
- Storage read failures fall back to the recommended enabled defaults for the current page only.
- The extension must not throw uncaught errors into the page or interfere with DeepSeek controls.

## Verification

Manual verification in Chrome or Edge covers:

1. Load a long DeepSeek conversation in light mode and confirm the conversation scrollbar is visible, wide, and high contrast.
2. Repeat in dark mode and confirm the contrast remains sufficient.
3. Scroll the conversation and confirm the percentage label is accurate, then fades after roughly 900 milliseconds.
4. Confirm the top and latest buttons navigate correctly and hide at their respective destinations.
5. Change each popup control and confirm the active tab updates immediately.
6. Reload the DeepSeek page and reopen the browser to confirm settings persist.
7. Switch conversations and receive a streamed response to confirm controls survive page changes without duplication.
8. Disable the extension in the popup and confirm the injected controls and custom scrollbar appearance are removed.
