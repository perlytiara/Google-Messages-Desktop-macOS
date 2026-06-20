const MESSAGE_SCAN_SCRIPT = String.raw`(() => {
  function readConversationUrl(row) {
    const link = row.querySelector('a[href*="/conversations/"]');
    if (link && link.href) {
      return link.href;
    }

    const href = row.getAttribute('href');
    if (href && href.includes('/conversations/')) {
      try {
        return new URL(href, location.origin).href;
      } catch {
        return '';
      }
    }

    return '';
  }

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
      return { sender: sender || 'Messages', body, conversationUrl: readConversationUrl(row) };
    }

    const aria = row.getAttribute('aria-label') || '';
    const text = (row.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return null;

    if (aria) {
      const match = aria.match(/^(.*?)[\.,]\s*(.+)$/);
      if (match) {
        return { sender: match[1].trim(), body: match[2].trim(), conversationUrl: readConversationUrl(row) };
      }
    }

    const parts = text.split(/\s{2,}/);
    if (parts.length >= 2) {
      return { sender: parts[0].trim(), body: parts.slice(1).join(' ').trim(), conversationUrl: readConversationUrl(row) };
    }

    return { sender: 'Messages', body: text, conversationUrl: readConversationUrl(row) };
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
    const sender = getOpenConversationSender();
    if (!sender) {
      return [];
    }

    const conversationUrl = /\/conversations\//.test(location.href) ? location.href : '';

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
      results.push({ sender, body, conversationUrl });
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

function normalizeBody(body) {
  return String(body || '').replace(/\s+/g, ' ').trim();
}

function isGenericSender(sender) {
  return !sender || sender === 'Messages';
}

function mergeScanItems(items) {
  const byBody = new Map();

  for (const item of items || []) {
    const body = normalizeBody(item.body);
    if (!body || /^you:\s/i.test(body)) {
      continue;
    }

    const sender = item.sender || 'Messages';
    const existing = byBody.get(body);

    if (!existing) {
      byBody.set(body, {
        sender,
        body,
        conversationUrl: item.conversationUrl || '',
      });
      continue;
    }

    if (isGenericSender(existing.sender) && !isGenericSender(sender)) {
      existing.sender = sender;
    }

    if (!existing.conversationUrl && item.conversationUrl) {
      existing.conversationUrl = item.conversationUrl;
    }
  }

  return Array.from(byBody.values());
}

function setupMessageWatcher(mainWindow, onMessageDetected) {
  if (!mainWindow || typeof onMessageDetected !== 'function') {
    return;
  }

  const webContents = mainWindow.webContents;
  const seen = new Map();
  const snippetBySender = new Map();
  const notified = new Set();
  const notifiedBodies = new Set();
  let deliveryEnabled = false;
  let polling = false;

  function messageKey(item) {
    return `${item.sender}\0${normalizeBody(item.body)}`;
  }

  function markSeen(item) {
    const body = normalizeBody(item.body);
    const key = messageKey(item);
    seen.set(key, Date.now());
    snippetBySender.set(item.sender, body);
    notified.add(key);
    notifiedBodies.add(body);
  }

  function deliver(item) {
    const body = normalizeBody(item.body);
    const key = messageKey(item);

    if (!body || /^you:\s/i.test(body)) {
      return;
    }

    if (notified.has(key) || notifiedBodies.has(body)) {
      return;
    }

    notified.add(key);
    notifiedBodies.add(body);
    seen.set(key, Date.now());
    snippetBySender.set(item.sender, body);

    onMessageDetected({
      title: item.sender || 'Messages',
      body,
      data: item.conversationUrl || '',
      raw: JSON.stringify({
        source: 'dom-scan',
        sender: item.sender,
        body,
        conversationUrl: item.conversationUrl || '',
      }),
      silent: false,
    });
  }

  function processItems(items) {
    const merged = mergeScanItems(items);
    if (!merged.length) {
      return;
    }

    if (!deliveryEnabled) {
      for (const item of merged) {
        markSeen(item);
      }
      return;
    }

    for (const item of merged) {
      const body = normalizeBody(item.body);
      const key = messageKey(item);
      const previousSnippet = snippetBySender.get(item.sender);
      const isNew = !seen.has(key);
      const snippetChanged = previousSnippet && previousSnippet !== body;

      if (isNew || snippetChanged) {
        deliver(item);
      }
    }
  }

  async function poll() {
    if (polling || webContents.isDestroyed()) {
      return;
    }

    polling = true;
    try {
      const result = await webContents.executeJavaScript(MESSAGE_SCAN_SCRIPT);
      processItems(result?.items || []);
    } catch (error) {
      console.error('[Messages] Message scan failed:', error.message);
    } finally {
      polling = false;
    }
  }

  const startPolling = () => {
    deliveryEnabled = false;
    poll();
    setTimeout(() => {
      poll();
      deliveryEnabled = true;
    }, 5000);
  };

  webContents.on('did-finish-load', startPolling);
  webContents.on('dom-ready', startPolling);
  webContents.on('did-navigate-in-page', startPolling);

  const pollInterval = setInterval(poll, 1500);

  mainWindow.on('closed', () => clearInterval(pollInterval));
}

module.exports = { MESSAGE_SCAN_SCRIPT, setupMessageWatcher, mergeScanItems, normalizeBody };
