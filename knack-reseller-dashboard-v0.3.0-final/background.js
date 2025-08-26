chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "openOptions") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
  }
});
