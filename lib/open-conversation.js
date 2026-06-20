const NAVIGATE_CONVERSATION_SCRIPT = String.raw`(({ senderName, conversationUrl }) => {
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
    if (link?.href) {
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

  function clickRow(row) {
    const clickTarget =
      row.querySelector('a[href*="/conversations/"]')
      || row.querySelector('[data-e2e-conversation-list-item]')
      || row.querySelector('[tabindex]')
      || row;

    clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    if (clickTarget !== row) {
      row.click();
    } else {
      row.click();
    }
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

    clickRow(row);

    return {
      ok: true,
      method: 'click',
      name: name || undefined,
      id: rowId || targetId || undefined,
    };
  }

  if (conversationUrl && spaNavigateTo(conversationUrl)) {
    return { ok: true, method: 'pushState', id: targetId };
  }

  return { ok: false, reason: 'not-found' };
})`;

function isConversationUrl(url) {
  return typeof url === 'string' && url.includes('/conversations/');
}

async function openConversation(mainWindow, { sender, conversationUrl }) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, reason: 'no-window' };
  }

  if ((!sender || sender === 'Messages') && !isConversationUrl(conversationUrl)) {
    return { ok: false, reason: 'no-target' };
  }

  try {
    const result = await mainWindow.webContents.executeJavaScript(
      `(${NAVIGATE_CONVERSATION_SCRIPT})(${JSON.stringify({
        senderName: sender || '',
        conversationUrl: conversationUrl || '',
      })})`,
    );

    if (result?.ok && result.method !== 'already-open') {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    return result;
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

module.exports = { openConversation, isConversationUrl };
