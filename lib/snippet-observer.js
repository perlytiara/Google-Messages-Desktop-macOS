const SNIPPET_OBSERVER_SCRIPT = String.raw`(function () {
  if (window.__messagesSnippetWatcher) {
    return;
  }
  window.__messagesSnippetWatcher = true;

  function requestScan() {
    window.__messagesNativeBridge?.requestSnippetScan?.();
  }

  let timer = null;
  function scheduleScan() {
    clearTimeout(timer);
    timer = setTimeout(requestScan, 40);
  }

  const observer = new MutationObserver(scheduleScan);

  function attach() {
    const roots = [
      document.querySelector('mws-conversation-list'),
      document.querySelector('[data-e2e-conversation-list]'),
      document.querySelector('mws-conversation-view'),
      document.querySelector('main'),
    ].filter(Boolean);

    for (const root of roots) {
      observer.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    if (!roots.length) {
      setTimeout(attach, 400);
      return;
    }

    scheduleScan();
  }

  attach();
})()`;

function injectSnippetObserver(mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.executeJavaScript(SNIPPET_OBSERVER_SCRIPT, true).catch((error) => {
    console.error('[Messages] Failed to inject snippet observer:', error.message);
  });
}

module.exports = { SNIPPET_OBSERVER_SCRIPT, injectSnippetObserver };
