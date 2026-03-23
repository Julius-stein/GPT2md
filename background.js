const DOWNLOAD_MESSAGE_TYPE = "DOWNLOAD_MARKDOWN_FILE";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== DOWNLOAD_MESSAGE_TYPE) return false;

  handleDownloadRequest(message.payload)
    .then((result) => {
      sendResponse({ ok: true, ...result });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: error.message });
    });

  return true;
});

async function handleDownloadRequest(payload = {}) {
  const content = String(payload.content || "");
  const filename = sanitizeFilename(payload.filename || "chatgpt-export.md");
  const url = `data:text/markdown;charset=utf-8,${encodeURIComponent(content)}`;
  const downloadId = await downloadFile({
    url,
    filename,
    saveAs: false,
    conflictAction: "uniquify"
  });

  return { destination: "downloads", downloadId, filename };
}

function downloadFile(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(downloadId);
    });
  });
}

function sanitizeFilename(input) {
  const cleaned = String(input || "chatgpt-export.md")
    .replace(/[\\/]+/g, "-")
    .replace(/[<>:\"|?*\u0000-\u001f]/g, "")
    .trim();

  return cleaned || "chatgpt-export.md";
}
