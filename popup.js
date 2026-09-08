const settingsApi = globalThis.DEEPSEEK_SCROLL_SETTINGS;
const ids = ['enabled', 'width', 'thumb-color', 'track-color'];
const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
const widthValue = document.getElementById('width-value');
const reset = document.getElementById('reset');
let currentSettings = { ...settingsApi.DEFAULTS };

function readForm() {
  return settingsApi.normalizeSettings({
    enabled: elements.enabled.checked,
    width: Number(elements.width.value),
    thumbColor: currentSettings.thumbColor,
    trackColor: currentSettings.trackColor
  });
}

function render(settings) {
  currentSettings = { ...settings };
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

function setFormDisabled(disabled) {
  for (const element of [...Object.values(elements), reset]) element.disabled = disabled;
}

function bindEvents() {
  elements.enabled.addEventListener('change', save);
  elements.width.addEventListener('input', () => {
    widthValue.value = `${elements.width.value}px`;
  });
  elements.width.addEventListener('change', save);
  elements['thumb-color'].addEventListener('input', () => {
    currentSettings.thumbColor = elements['thumb-color'].value;
  });
  elements['thumb-color'].addEventListener('change', () => {
    currentSettings.thumbColor = elements['thumb-color'].value;
    save();
  });
  elements['track-color'].addEventListener('input', () => {
    currentSettings.trackColor = elements['track-color'].value;
  });
  elements['track-color'].addEventListener('change', () => {
    currentSettings.trackColor = elements['track-color'].value;
    save();
  });
  reset.addEventListener('click', () => {
    render(settingsApi.DEFAULTS);
    chrome.storage.sync.set(settingsApi.DEFAULTS);
  });
}

setFormDisabled(true);
chrome.storage.sync.get(settingsApi.DEFAULTS, (stored) => {
  render(settingsApi.normalizeSettings(stored));
  setFormDisabled(false);
  bindEvents();
});
