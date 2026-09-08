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
