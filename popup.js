const DEFAULT_SETTINGS = {
  keepEmojis: false,
  keepHr: false,
  keepTail: false
};

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

const elements = {
  keepEmojis: document.getElementById("keepEmojis"),
  keepHr: document.getElementById("keepHr"),
  keepTail: document.getElementById("keepTail"),
  status: document.getElementById("status")
};

let statusTimer = null;

function showStatus(text) {
  elements.status.textContent = text;
  elements.status.classList.toggle("is-saved", Boolean(text));

  if (statusTimer) clearTimeout(statusTimer);

  if (text) {
    statusTimer = setTimeout(() => {
      elements.status.textContent = "";
      elements.status.classList.remove("is-saved");
    }, 1200);
  }
}

function readSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (result) => {
      resolve(result);
    });
  });
}

function writeSettings(nextSettings) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(nextSettings, resolve);
  });
}

function applySettings(settings) {
  SETTING_KEYS.forEach((key) => {
    elements[key].checked = Boolean(settings[key]);
  });
}

async function handleChange() {
  const nextSettings = {
    keepEmojis: elements.keepEmojis.checked,
    keepHr: elements.keepHr.checked,
    keepTail: elements.keepTail.checked
  };

  await writeSettings(nextSettings);
  showStatus("Saved");
}

async function init() {
  const settings = await readSettings();
  applySettings(settings);

  SETTING_KEYS.forEach((key) => {
    elements[key].addEventListener("change", handleChange);
  });
}

init();
