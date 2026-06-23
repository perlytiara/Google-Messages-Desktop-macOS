const { readSelfTestConfig } = require('./self-test-config');
const { logWatcherEvent } = require('./watcher-debug-log');
const { readPersistedBaselines, writePersistedBaselines } = require('./watcher-baseline');
const { shouldSuppressReplyEcho } = require('./reply-suppress');

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

  function isRowUnread(row) {
    if (!row) return false;
    return Boolean(
      row.querySelector('[data-e2e-conversation-unread]')
      || row.matches('[data-e2e-conversation-unread="true"]')
      || row.querySelector('[class*="unread"]')
      || row.querySelector('[aria-label*="unread" i]')
      || row.querySelector('[aria-label*="non lu" i]')
      || /\bunread\b|\bnon lu\b/i.test(row.getAttribute('aria-label') || ''),
    );
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

    const conversationUrl = readConversationUrl(row);
    const unread = isRowUnread(row);

    if (body) {
      return { sender: sender || 'Messages', body, conversationUrl, unread };
    }

    const aria = row.getAttribute('aria-label') || '';
    const text = (row.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return null;

    if (aria) {
      const match = aria.match(/^(.*?)[\.,]\s*(.+)$/);
      if (match) {
        return {
          sender: match[1].trim(),
          body: match[2].trim(),
          conversationUrl,
          unread,
        };
      }
    }

    const parts = text.split(/\s{2,}/);
    if (parts.length >= 2) {
      return {
        sender: parts[0].trim(),
        body: parts.slice(1).join(' ').trim(),
        conversationUrl,
        unread,
      };
    }

    return { sender: 'Messages', body: text, conversationUrl, unread };
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
    return rows.slice(0, 50).map(readConversation).filter(Boolean);
  }

  function getOpenConversationSender() {
    return document.querySelector('[data-e2e-conversation-title]')?.textContent?.trim()
      || document.querySelector('mws-conversation-view [slot="title"]')?.textContent?.trim()
      || document.querySelector('[class*="conversation-title"]')?.textContent?.trim()
      || document.querySelector('mws-conversation-header')?.textContent?.trim()
      || '';
  }

  function isOutgoingMessage(node) {
    const wrapper = node.closest('mws-message-wrapper')
      || node.closest('[data-e2e-message-wrapper]')
      || node.closest('[class*="message-wrapper"]')
      || node;

    const aria = wrapper.getAttribute('aria-label') || '';
    return Boolean(
      wrapper.matches?.('[class*="outgoing"]')
      || wrapper.closest?.('[class*="outgoing"]')
      || wrapper.querySelector?.('[data-e2e-outgoing="true"]')
      || wrapper.getAttribute?.('data-e2e-outgoing') === 'true'
      || /you sent/i.test(aria)
      || /vous avez envoy/i.test(aria),
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
      const outgoing = isOutgoingMessage(node);
      results.push({ sender, body, conversationUrl, outgoing });
    }

    return results;
  }

  const items = scanConversationList();
  const unique = [];
  const keys = new Set();

  for (const item of items) {
    const convPart = item.conversationUrl || '';
    const key = convPart + '\u0000' + item.sender + '\u0000' + item.body;
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

function isOutgoingSnippet(body) {
  return /^(you|vous|moi)\s*:/i.test(normalizeBody(body));
}

function conversationIdFromUrl(url) {
  const match = String(url || '').match(/\/conversations\/([^/?#]+)/);
  return match ? match[1] : '';
}

function stripOutgoingPrefix(body) {
  return normalizeBody(body).replace(/^(you|vous|moi)\s*:\s*/i, '').trim();
}

function conversationKey(item) {
  return conversationIdFromUrl(item.conversationUrl) || String(item.sender || 'unknown').trim();
}

function isSystemSnippet(body) {
  const text = normalizeBody(body);
  return /^texting with .+\(sms\/mms\)/i.test(text)
    || /^discuter avec .+\(sms\/mms\)/i.test(text);
}

function pickListSnippets(items) {
  const byConversation = new Map();

  for (const item of mergeScanItems(items)) {
    const convKey = conversationKey(item);
    const body = normalizeBody(item.body);
    if (!body || isSystemSnippet(body)) {
      continue;
    }

    const existing = byConversation.get(convKey);
    if (!existing) {
      byConversation.set(convKey, item);
      continue;
    }

    const existingBody = normalizeBody(existing.body);
    const existingLooksLikeList = isOutgoingSnippet(existingBody) || existingBody.length <= 160;
    const currentLooksLikeList = isOutgoingSnippet(body) || body.length <= 160;

    if (currentLooksLikeList && !existingLooksLikeList) {
      byConversation.set(convKey, item);
    }
  }

  return Array.from(byConversation.values());
}

function mergeScanItems(items) {
  const byKey = new Map();

  for (const item of items || []) {
    const body = normalizeBody(item.body);
    if (!body) {
      continue;
    }

    const sender = item.sender || 'Messages';
    const conv = conversationIdFromUrl(item.conversationUrl) || '';
    const key = `${conv}\0${sender}\0${body}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        sender,
        body,
        conversationUrl: item.conversationUrl || '',
        unread: Boolean(item.unread),
        outgoing: Boolean(item.outgoing) || isOutgoingSnippet(body),
        rawSnippet: body,
      });
      continue;
    }

    if (item.unread) {
      existing.unread = true;
    }

    if (item.outgoing) {
      existing.outgoing = true;
    }

    if (!existing.conversationUrl && item.conversationUrl) {
      existing.conversationUrl = item.conversationUrl;
    }
  }

  return Array.from(byKey.values());
}

function setupMessageWatcher(mainWindow, onMessageDetected) {
  if (!mainWindow || typeof onMessageDetected !== 'function') {
    return () => {};
  }

  const webContents = mainWindow.webContents;
  const seen = new Map();
  const snippetByConversation = readPersistedBaselines();
  const notified = new Set();
  let deliveryEnabled = false;
  let polling = false;
  let initialBaselineDone = false;
  let baselineSeedPromise = null;
  let persistTimer = null;

  function schedulePersistBaselines() {
    if (persistTimer) {
      clearTimeout(persistTimer);
    }
    persistTimer = setTimeout(() => {
      persistTimer = null;
      writePersistedBaselines(snippetByConversation);
    }, 500);
  }

  function seedSnippet(convKey, body, { markNotified = false, item = null } = {}) {
    const normalized = normalizeBody(body);
    if (!normalized) {
      return;
    }

    snippetByConversation.set(convKey, normalized);
    if (item && markNotified) {
      notified.add(messageKey(item));
      seen.set(messageKey(item), Date.now());
    }
    schedulePersistBaselines();
  }

  function messageKey(item) {
    const conv = conversationKey(item);
    const body = isOutgoingSnippet(item.body) ? stripOutgoingPrefix(item.body) : normalizeBody(item.body);
    return `${conv}\0${body}`;
  }

  function recordBaseline(item, { markNotified = false } = {}) {
    const body = normalizeBody(item.body);
    const key = messageKey(item);
    seen.set(key, Date.now());
    snippetByConversation.set(conversationKey(item), body);
    if (markNotified) {
      notified.add(key);
    }
  }

  function markSeen(item) {
    recordBaseline(item, { markNotified: true });
  }

  function deliver(item, reason) {
    const rawBody = normalizeBody(item.body);
    const outgoing = isOutgoingSnippet(rawBody) || Boolean(item.outgoing);
    const config = readSelfTestConfig();

    if (outgoing && !config.notifyOutgoing) {
      return;
    }

    const body = outgoing ? stripOutgoingPrefix(rawBody) || rawBody : rawBody;
    const key = messageKey(item);

    if (!body && !rawBody) {
      return;
    }

    if (notified.has(key)) {
      return;
    }

    notified.add(key);
    seen.set(key, Date.now());

    onMessageDetected({
      title: item.sender || 'Messages',
      body,
      data: item.conversationUrl || '',
      raw: JSON.stringify({
        source: 'snippet-watch',
        reason: reason || 'new',
        sender: item.sender || 'Messages',
        body,
        conversationUrl: item.conversationUrl || '',
        unread: Boolean(item.unread),
        outgoing,
      }),
      silent: false,
    });
  }

  function processItems(items) {
    const merged = pickListSnippets(items);
    if (!merged.length) {
      return;
    }

    if (!deliveryEnabled) {
      for (const item of merged) {
        seedSnippet(conversationKey(item), item.body);
      }
      return;
    }

    for (const item of merged) {
      const rawBody = normalizeBody(item.body);
      if (!rawBody || isSystemSnippet(rawBody)) {
        continue;
      }

      const convKey = conversationKey(item);
      const previousSnippet = snippetByConversation.get(convKey);
      if (previousSnippet === rawBody) {
        continue;
      }

      const outgoing = isOutgoingSnippet(rawBody) || Boolean(item.outgoing);
      seedSnippet(convKey, rawBody);

      if (previousSnippet === undefined) {
        continue;
      }

      if (outgoing) {
        const config = readSelfTestConfig();
        if (!config.notifyOutgoing) {
          continue;
        }
      }

      if (shouldSuppressReplyEcho({
        conversationUrl: item.conversationUrl,
        body: rawBody,
        outgoing: false,
      })) {
        logWatcherEvent('suppressed-reply-echo', {
          sender: item.sender,
          body: rawBody.slice(0, 120),
          conversationUrl: item.conversationUrl || '',
        });
        continue;
      }

      logWatcherEvent('notify', {
        sender: item.sender,
        body: rawBody.slice(0, 120),
        reason: 'snippet-changed',
        outgoing,
        conversationUrl: item.conversationUrl || '',
      });

      deliver(item, 'snippet-changed');
    }
  }

  async function seedBaseline() {
    if (webContents.isDestroyed()) {
      return { count: 0, stable: false };
    }

    polling = true;
    try {
      let lastCount = -1;
      let stablePasses = 0;

      for (let pass = 0; pass < 6; pass += 1) {
        const result = await webContents.executeJavaScript(MESSAGE_SCAN_SCRIPT);
        const merged = pickListSnippets(result?.items || []);

        for (const item of merged) {
          seedSnippet(conversationKey(item), item.body, { markNotified: true, item });
        }

        if (merged.length > 0 && merged.length === lastCount) {
          stablePasses += 1;
        } else {
          stablePasses = 0;
        }

        lastCount = merged.length;
        if (stablePasses >= 2) {
          return { count: merged.length, stable: true };
        }

        await new Promise((resolve) => setTimeout(resolve, 400));
      }

      return { count: lastCount, stable: lastCount > 0 };
    } catch (error) {
      logWatcherEvent('seed-error', { error: error.message });
      return { count: 0, stable: false };
    } finally {
      polling = false;
    }
  }

  async function baselineCurrentConversation() {
    if (polling || webContents.isDestroyed()) {
      return;
    }

    polling = true;
    try {
      const result = await webContents.executeJavaScript(MESSAGE_SCAN_SCRIPT);
      const currentId = conversationIdFromUrl(result?.url || '');
      if (!currentId) {
        return;
      }

      for (const item of pickListSnippets(result?.items || [])) {
        const itemId = conversationIdFromUrl(item.conversationUrl || result?.url || '');
        if (itemId === currentId) {
          seedSnippet(conversationKey(item), item.body);
        }
      }
    } catch (error) {
      console.error('[Messages] Thread baseline failed:', error.message);
    } finally {
      polling = false;
    }
  }

  async function poll() {
    if (polling || webContents.isDestroyed()) {
      return;
    }

    polling = true;
    try {
      const result = await webContents.executeJavaScript(MESSAGE_SCAN_SCRIPT);
      const items = result?.items || [];
      processItems(items);
    } catch (error) {
      logWatcherEvent('poll-error', { error: error.message });
      console.error('[Messages] Message scan failed:', error.message);
    } finally {
      polling = false;
    }
  }

  const runInitialBaseline = () => {
    if (initialBaselineDone) {
      poll();
      return;
    }

    if (baselineSeedPromise) {
      return;
    }

    deliveryEnabled = false;
    baselineSeedPromise = seedBaseline().then((result) => {
      logWatcherEvent('seed-complete', result);
      deliveryEnabled = true;
      initialBaselineDone = true;
      baselineSeedPromise = null;
    });
  };

  webContents.on('did-finish-load', runInitialBaseline);
  webContents.on('dom-ready', runInitialBaseline);

  webContents.on('did-navigate-in-page', () => {
    baselineCurrentConversation().then(() => poll());
  });

  const pollInterval = setInterval(poll, 500);

  mainWindow.on('closed', () => {
    clearInterval(pollInterval);
    if (persistTimer) {
      clearTimeout(persistTimer);
    }
    writePersistedBaselines(snippetByConversation);
  });

  function acknowledgeOutgoingReply(conversationUrl, replyText) {
    const text = String(replyText || '').trim();
    if (!text) {
      return;
    }

    const convKey = conversationIdFromUrl(conversationUrl) || '';
    if (!convKey) {
      return;
    }

    const outgoingSnippet = `You: ${text}`;
    seedSnippet(convKey, outgoingSnippet, {
      markNotified: true,
      item: {
        sender: '',
        body: outgoingSnippet,
        conversationUrl,
      },
    });
  }

  return { poll, acknowledgeOutgoingReply };
}

module.exports = { MESSAGE_SCAN_SCRIPT, setupMessageWatcher, mergeScanItems, normalizeBody };
