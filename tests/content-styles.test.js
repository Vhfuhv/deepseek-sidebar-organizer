const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('forces a visible scrollbar width over DeepSeek hidden scrollbar rules', () => {
  const css = fs.readFileSync('content.css', 'utf8');

  assert.match(
    css,
    /\[data-dsa-scroll-container="true"\]\[data-dsa-scroll-container="true"\]::-webkit-scrollbar\s*\{\s*width:\s*var\(--dsa-width, 14px\) !important;/
  );
});

test('styles DeepSeek custom scrollbar gutter and keeps the thumb width stable while dragging', () => {
  const css = fs.readFileSync('content.css', 'utf8');

  assert.match(
    css,
    /\[data-dsa-scroll-container="true"\] > \.ds-scroll-area__gutters > \.ds-scroll-area__vertical-gutter\s*\{\s*width:\s*var\(--dsa-width, 14px\) !important;\s*background-color:\s*var\(--dsa-track-color\) !important;/
  );
  const customBarRule = css.match(
    /\[data-dsa-scroll-container="true"\] > \.ds-scroll-area__gutters > \.ds-scroll-area__vertical-gutter > \.ds-scroll-area__vertical-bar\s*\{([^}]*)\}/
  );

  assert.ok(customBarRule);
  assert.match(customBarRule[1], /background-color:\s*var\(--dsa-thumb-color\) !important;/);
  assert.doesNotMatch(customBarRule[1], /\bwidth\s*:/i);
  assert.doesNotMatch(customBarRule[1], /\bborder-radius\s*:/i);
  const customBarAfterRule = css.match(
    /\[data-dsa-scroll-container="true"\] > \.ds-scroll-area__gutters > \.ds-scroll-area__vertical-gutter > \.ds-scroll-area__vertical-bar::after\s*\{([^}]*)\}/
  );

  assert.ok(customBarAfterRule);
  assert.match(customBarAfterRule[1], /background-color:\s*var\(--dsa-thumb-color\) !important;/);
  assert.match(customBarAfterRule[1], /left:\s*2px !important;/);
  assert.match(customBarAfterRule[1], /right:\s*2px !important;/);
  assert.match(customBarAfterRule[1], /width:\s*auto !important;/);
  assert.match(customBarAfterRule[1], /border-radius:\s*0 !important;/);
  assert.match(customBarAfterRule[1], /transform:\s*none !important;/);

  const customBarAfterRules = [
    ...css.matchAll(
      /\[data-dsa-scroll-container="true"\][^{>]*>\s*\.ds-scroll-area__gutters[^{>]*>\s*\.ds-scroll-area__vertical-gutter[^{>]*>\s*\.ds-scroll-area__vertical-bar[^{]*::after[^{]*\{([^}]*)\}/g
    )
  ];

  assert.ok(customBarAfterRules.length > 0);
  assert.ok(customBarAfterRules.length > 0);
});

test('keeps the custom thumb inset while its bar is active', () => {
  const css = fs.readFileSync('content.css', 'utf8');

  assert.match(
    css,
    /\.ds-scroll-area__vertical-gutter:hover > \.ds-scroll-area__vertical-bar::after,[\s\S]*\.ds-scroll-area__vertical-bar:active::after\s*\{[\s\S]*?width:\s*auto !important;[\s\S]*?left:\s*2px !important;[\s\S]*?right:\s*2px !important;/
  );
});
