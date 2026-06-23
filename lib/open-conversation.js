const NAVIGATE_CONVERSATION_SCRIPT = String.raw`({ senderName, conversationUrl }) => {
  function conversationIdFromUrl(url) {
    const match = String(url || '').match(/\/conversations\/([^/?#]+)/);
    return match ? match[1] : '';
  }

  function nameFromRow(row) {
    return (
      row.querySelector('[data-e2e-conversation-name]')?.textContent?.trim()
      || row.querySelector('mws-conversation-list-item [slot="primary"]')?.textContent?.trim()
      || row.querySelector('[class*="conversation-name"]')?.textContent?.trim()
      || row.querySelector('[class*="title"]')?.textContent?.trim()
      || ''
    ).toLowerCase();
  }

  function urlFromRow(row) {
    const link = row.querySelector('a[href*="/conversations/"]');
    if (link) {
      const href = link.getAttribute('href');
      if (href) {
        try {
          return new URL(href, location.origin).href;
        } catch {
          return '';
        }
      }
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

  function spaNavigateTo(url) {
    const targetId = conversationIdFromUrl(url);
    if (!targetId) {
      return false;
    }

    const path = url.startsWith('http')
      ? new URL(url).pathname + new URL(url).search + new URL(url).hash
      : url;

    history.pushState(history.state, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    return true;
  }

  function clickRow(row, rowUrl) {
    row.scrollIntoView({ block: 'center', behavior: 'auto' });

    if (rowUrl) {
      spaNavigateTo(rowUrl);
    }

    const clickTarget =
      row.querySelector('[data-e2e-conversation-list-item]')
      || row.querySelector('mws-conversation-list-item')
      || row.querySelector('[tabindex]')
      || row;

    clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    clickTarget.click();
  }

  const targetSender = String(senderName || '').trim().toLowerCase();
  const targetId = conversationIdFromUrl(conversationUrl);
  const currentId = conversationIdFromUrl(location.href);

  if (targetId && currentId === targetId) {
    return { ok: true, method: 'already-open', id: targetId };
  }

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

  if (targetId) {
    for (const row of rows) {
      const rowUrl = urlFromRow(row);
      const rowId = conversationIdFromUrl(rowUrl);

      if (rowId && rowId === targetId) {
        clickRow(row, rowUrl);
        return { ok: true, method: 'spa-click', id: rowId };
      }
    }
  }

  for (const row of rows) {
    const name = nameFromRow(row);
    const rowUrl = urlFromRow(row);
    const rowId = conversationIdFromUrl(rowUrl);

    const senderMatch = Boolean(
      targetSender
      && name
      && (name === targetSender || name.includes(targetSender) || targetSender.includes(name)),
    );
    const idMatch = Boolean(targetId && rowId && rowId === targetId);

    if (!senderMatch && !idMatch) {
      continue;
    }

    clickRow(row, rowUrl || conversationUrl);

    return {
      ok: true,
      method: 'spa-click',
      name: name || undefined,
      id: rowId || targetId || undefined,
    };
  }

  if (conversationUrl && spaNavigateTo(conversationUrl)) {
    window.dispatchEvent(new Event('hashchange'));
    return { ok: true, method: 'pushState', id: targetId };
  }

  return { ok: false, reason: 'not-found' };
}`;

const CONVERSATION_READY_SCRIPT = String.raw`({ conversationUrl }) => {
  function conversationIdFromUrl(url) {
    const match = String(url || '').match(/\/conversations\/([^/?#]+)/);
    return match ? match[1] : '';
  }

  const targetId = conversationIdFromUrl(conversationUrl);
  const currentId = conversationIdFromUrl(location.href);

  return {
    ready: Boolean(targetId && currentId === targetId),
    currentId,
    targetId,
    href: location.href,
  };
}`;

function conversationIdFromUrl(url) {
  const match = String(url || '').match(/\/conversations\/([^/?#]+)/);
  return match ? match[1] : '';
}

function isConversationUrl(url) {
  return typeof url === 'string' && url.includes('/conversations/');
}

async function runDom(mainWindow, scriptBody, args = {}) {
  const argsJson = JSON.stringify(args);
  const raw = await mainWindow.webContents.executeJavaScript(`(() => {
    try {
      const fn = ${scriptBody};
      return JSON.stringify(fn(${argsJson}));
    } catch (error) {
      return JSON.stringify({ ok: false, reason: 'script-error', error: String(error.message || error) });
    }
  })()`);
  return JSON.parse(raw);
}

async function openConversation(mainWindow, { sender, conversationUrl }) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, reason: 'no-window' };
  }

  if ((!sender || sender === 'Messages') && !isConversationUrl(conversationUrl)) {
    return { ok: false, reason: 'no-target' };
  }

  try {
    const result = await runDom(mainWindow, NAVIGATE_CONVERSATION_SCRIPT, {
      senderName: sender || '',
      conversationUrl: conversationUrl || '',
    });

    if (result?.ok && result.method !== 'already-open') {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    return result;
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

async function waitForConversation(mainWindow, conversationUrl, timeoutMs = 8000) {
  const started = Date.now();
  let last = null;

  while (Date.now() - started < timeoutMs) {
    last = await runDom(mainWindow, CONVERSATION_READY_SCRIPT, { conversationUrl });
    if (last?.ready) {
      return { ok: true, ...last };
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return { ok: false, reason: 'conversation-not-ready', ...last };
}

module.exports = {
  openConversation,
  waitForConversation,
  isConversationUrl,
  conversationIdFromUrl,
};
