const MESSAGE_SCAN_SCRIPT = String.raw`(() => {
  function readConversation(row) {
    if (!row) return null;

    const sender =
      row.querySelector('[data-e2e-conversation-name]')?.textContent?.trim()
      || row.querySelector('mws-conversation-list-item [slot="primary"]')?.textContent?.trim()
      || row.querySelector('[class*="conversation-name"]')?.textContent?.trim()
      || row.querySelector('[class*="title"]')?.textContent?.trim();

    const body =
      row.querySelector('[data-e2e-conversation-snippet]')?.textContent?.trim()
      || row.querySelector('mws-conversation-snippet')?.textContent?.trim()
      || row.querySelector('[class*="snippet"]')?.textContent?.trim()
      || row.querySelector('[class*="preview"]')?.textContent?.trim();

    if (body) {
      return { sender: sender || 'Messages', body };
    }

    const aria = row.getAttribute('aria-label') || '';
    const text = (row.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return null;

    if (aria) {
      const match = aria.match(/^(.*?)[\.,]\s*(.+)$/);
      if (match) {
        return { sender: match[1].trim(), body: match[2].trim() };
      }
    }

    const parts = text.split(/\s{2,}/);
    if (parts.length >= 2) {
      return { sender: parts[0].trim(), body: parts.slice(1).join(' ').trim() };
    }

    return { sender: 'Messages', body: text };
  }

  function scanConversationList() {
    const selectors = [
      'mws-conversation-list-item',
      '[data-e2e-conversation-list-item]',
      '[role="listitem"]',
    ];

    let rows = [];
    for (const selector of selectors) {
      const found = Array.from(document.querySelectorAll(selector));
      if (found.length > rows.length) {
        rows = found;
      }
    }

    if (!rows.length) return [];
    return rows.slice(0, 25).map(readConversation).filter(Boolean);
  }

  function getOpenConversationSender() {
    return document.querySelector('[data-e2e-conversation-title]')?.textContent?.trim()
      || document.querySelector('mws-conversation-view [slot="title"]')?.textContent?.trim()
      || document.querySelector('[class*="conversation-title"]')?.textContent?.trim()
      || document.querySelector('mws-conversation-header')?.textContent?.trim()
      || '';
  }

  function isOutgoingMessage(node) {
    return Boolean(
      node.closest('[class*="outgoing"]')
      || node.closest('[class*="sent"]')
      || node.closest('[data-e2e-outgoing="true"]')
      || node.closest('[aria-label*="You sent"]')
      || node.closest('[aria-label*="Sent"]')
    );
  }

  function scanOpenThread() {
    const sender = getOpenConversationSender() || 'Messages';
    const selectors = [
      'mws-message-wrapper',
      'mws-text-message-content',
      '[data-e2e-message-text]',
      '[class*="message-text"]',
      '[class*="text-msg"]',
    ];

    let nodes = [];
    for (const selector of selectors) {
      const found = Array.from(document.querySelectorAll(selector));
      if (found.length > nodes.length) {
        nodes = found;
      }
    }

    const results = [];
    for (const node of nodes.slice(-20)) {
      const body = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!body || body.length < 2) continue;
      if (isOutgoingMessage(node)) continue;
      results.push({ sender, body });
    }

    return results;
  }

  const items = [...scanConversationList(), ...scanOpenThread()];
  const unique = [];
  const keys = new Set();

  for (const item of items) {
    const key = item.sender + '\u0000' + item.body;
    if (keys.has(key)) continue;
    keys.add(key);
    unique.push(item);
  }

  return {
    url: location.href,
    items: unique,
  };
})()`;

const VERIFICATION_PATTERN = /(?:your|our|the)\s+verification|verification\s+(?:message|code)|G-\d{6}/i;

function isVerificationBody(body) {
  return VERIFICATION_PATTERN.test(body || '');
}

function setupMessageWatcher(mainWindow, onMessageDetected) {
  if (!mainWindow || typeof onMessageDetected !== 'function') {
    return;
  }

  const webContents = mainWindow.webContents;
  const seen = new Map();
  const snippetBySender = new Map();
  const notified = new Set();
  let bootstrapped = false;
  let bootstrapAt = 0;
  let polling = false;

  function messageKey(item) {
    return `${item.sender}\0${item.body}`;
  }

  function deliver(item) {
    const key = messageKey(item);
    if (notified.has(key)) {
      return;
    }

    if (/^you:\s/i.test(item.body)) {
      return;
    }

    notified.add(key);
    seen.set(key, Date.now());
    snippetBySender.set(item.sender, item.body);

    onMessageDetected({
      title: item.sender || 'Messages',
      body: item.body,
      data: '',
      raw: JSON.stringify({ source: 'dom-scan', sender: item.sender, body: item.body }),
      silent: false,
    });
  }

  function processItems(items, allowCatchUp) {
    if (!items?.length) {
      return;
    }

    if (!bootstrapped) {
      for (const item of items) {
        const key = messageKey(item);
        seen.set(key, Date.now());
        snippetBySender.set(item.sender, item.body);
      }
      bootstrapped = true;
      bootstrapAt = Date.now();
      return;
    }

    for (const item of items) {
      const key = messageKey(item);
      const previousSnippet = snippetBySender.get(item.sender);
      const isNew = !seen.has(key);
      const snippetChanged = previousSnippet && previousSnippet !== item.body;
      const catchUpVerification = allowCatchUp
        && isVerificationBody(item.body)
        && !notified.has(key)
        && Date.now() - bootstrapAt < 120000;

      if (isNew || snippetChanged || catchUpVerification) {
        deliver(item);
      }
    }
  }

  async function poll(allowCatchUp = true) {
    if (polling || webContents.isDestroyed()) {
      return;
    }

    polling = true;
    try {
      const result = await webContents.executeJavaScript(MESSAGE_SCAN_SCRIPT);
      processItems(result?.items || [], allowCatchUp);
    } catch (error) {
      console.error('[Messages] Message scan failed:', error.message);
    } finally {
      polling = false;
    }
  }

  const startPolling = () => {
    poll(false);
    setTimeout(() => poll(true), 4000);
    setTimeout(() => poll(true), 10000);
  };

  webContents.on('did-finish-load', startPolling);
  webContents.on('dom-ready', startPolling);
  webContents.on('did-navigate-in-page', startPolling);

  const pollInterval = setInterval(() => poll(true), 1500);

  mainWindow.on('closed', () => clearInterval(pollInterval));
}

module.exports = { MESSAGE_SCAN_SCRIPT, setupMessageWatcher };
