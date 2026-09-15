/**
 * Google Messages web sometimes renders broken English plurals
 * ("2 minute", "3 minute"). Patch visible relative-time labels in the SPA.
 */
const RELATIVE_TIME_FIX_SCRIPT = `(() => {
  if (window.__messagesRelativeTimeFixInstalled) return;
  window.__messagesRelativeTimeFixInstalled = true;

  const BROKEN = /\\b(\\d+)\\s+minute\\b(?!s)/gi;
  const BROKEN_FR_MIN = /\\b(\\d+)\\s+minute\\b(?!s)/gi;
  const BROKEN_HOUR = /\\b(\\d+)\\s+hour\\b(?!s)/gi;
  const BROKEN_DAY = /\\b(\\d+)\\s+day\\b(?!s)/gi;

  function fixText(text) {
    if (!text || text.indexOf('minute') === -1 && text.indexOf('hour') === -1 && text.indexOf('day') === -1) {
      return text;
    }
    let out = text;
    out = out.replace(BROKEN, (_, n) => {
      const num = Number(n);
      return num === 1 ? n + ' minute' : n + ' minutes';
    });
    out = out.replace(BROKEN_HOUR, (_, n) => {
      const num = Number(n);
      return num === 1 ? n + ' hour' : n + ' hours';
    });
    out = out.replace(BROKEN_DAY, (_, n) => {
      const num = Number(n);
      return num === 1 ? n + ' day' : n + ' days';
    });
    return out;
  }

  function walk(node) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const next = fixText(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'INPUT') return;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      walk(child);
    }
  }

  let scheduled = null;
  function schedule() {
    if (scheduled) return;
    scheduled = requestAnimationFrame(() => {
      scheduled = null;
      walk(document.body);
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  schedule();
})();`;

function injectRelativeTimeFix(mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.executeJavaScript(RELATIVE_TIME_FIX_SCRIPT, true).catch((error) => {
    console.error('[Messages] Failed to inject relative-time fix:', error.message);
  });
}

module.exports = { RELATIVE_TIME_FIX_SCRIPT, injectRelativeTimeFix };
