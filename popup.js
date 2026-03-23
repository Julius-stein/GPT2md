const DEFAULT_SETTINGS = {
  keepEmojis: false,
  keepHr: false,
  keepTail: false
};

const TOGGLE_SETTING_KEYS = ["keepEmojis", "keepHr", "keepTail"];
const POPUP_COMMANDS = {
  GET_BATCH_STATE: "GET_BATCH_EXPORT_STATE",
  START_BATCH_SELECTION: "START_BATCH_SELECTION",
  STOP_BATCH_SELECTION: "STOP_BATCH_SELECTION"
};

const elements = {
  toggleBatch: document.getElementById("toggleBatch"),
  batchState: document.getElementById("batchState"),
  keepEmojis: document.getElementById("keepEmojis"),
  keepHr: document.getElementById("keepHr"),
  keepTail: document.getElementById("keepTail"),
  status: document.getElementById("status")
};

let statusTimer = null;
let currentBatchActive = false;

function showStatus(text) {
  elements.status.textContent = text;
  elements.status.classList.toggle("is-saved", Boolean(text));

  if (statusTimer) clearTimeout(statusTimer);

  if (text) {
    statusTimer = setTimeout(() => {
      elements.status.textContent = "";
      elements.status.classList.remove("is-saved");
    }, 1500);
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
  TOGGLE_SETTING_KEYS.forEach((key) => {
    elements[key].checked = Boolean(settings[key]);
  });
}

async function handleSettingsChange() {
  const nextSettings = {
    keepEmojis: elements.keepEmojis.checked,
    keepHr: elements.keepHr.checked,
    keepTail: elements.keepTail.checked
  };

  await writeSettings(nextSettings);
  showStatus("Saved");
}

function setBatchState(text) {
  elements.batchState.textContent = text;
}

async function sendCommandToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    throw new Error("Open a ChatGPT conversation page first.");
  }

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error("Open a ChatGPT conversation page, then try again."));
        return;
      }

      resolve(response);
    });
  });
}

function renderBatchState(state) {
  if (!state) {
    currentBatchActive = false;
    setBatchState("Open a ChatGPT conversation page to use batch export.");
    elements.toggleBatch.disabled = true;
    elements.toggleBatch.textContent = "Start Selecting";
    elements.toggleBatch.classList.remove("button--ghost");
    elements.toggleBatch.classList.add("button--primary");
    return;
  }

  const modeText = state.active ? "Selection mode is on." : "Selection mode is off.";
  const countLabel = state.count === 1 ? "reply" : "replies";
  const countText = `${state.count} ${countLabel} selected.`;
  currentBatchActive = Boolean(state.active);
  setBatchState(`${modeText} ${countText}`);
  elements.toggleBatch.disabled = false;
  elements.toggleBatch.textContent = state.active ? "Stop Selecting" : "Start Selecting";
  elements.toggleBatch.classList.toggle("button--ghost", state.active);
  elements.toggleBatch.classList.toggle("button--primary", !state.active);
}

async function refreshBatchState() {
  try {
    const response = await sendCommandToActiveTab({ type: POPUP_COMMANDS.GET_BATCH_STATE });
    renderBatchState(response?.state || null);
  } catch (_error) {
    renderBatchState(null);
  }
}

async function setBatchSelection(nextActive) {
  try {
    const response = await sendCommandToActiveTab({
      type: nextActive
        ? POPUP_COMMANDS.START_BATCH_SELECTION
        : POPUP_COMMANDS.STOP_BATCH_SELECTION
    });
    renderBatchState(response?.state || null);
    showStatus(nextActive ? "Selection mode started" : "Selection mode stopped");
  } catch (error) {
    showStatus(error.message);
  }
}

async function toggleBatchSelection() {
  await setBatchSelection(!currentBatchActive);
}

async function init() {
  const settings = await readSettings();
  applySettings(settings);
  await refreshBatchState();

  TOGGLE_SETTING_KEYS.forEach((key) => {
    elements[key].addEventListener("change", handleSettingsChange);
  });

  elements.toggleBatch.addEventListener("click", toggleBatchSelection);
}

init();
