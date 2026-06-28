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

const MARK_READ_IN_PLACE_SCRIPT = String.raw`({ senderName, conversationUrl }) => {
  function conversationIdFromUrl(url) {
    const match = String(url || '').match(/\/conversations\/([^/?#]+)/);
    return match ? match[1] : '';
  }

  function spaNavigateTo(url) {
    if (!url) {
      return false;
    }

    const path = url.startsWith('http')
      ? new URL(url).pathname + new URL(url).search + new URL(url).hash
      : url;

    history.pushState(history.state, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    return true;
  }

  function nameFromRow(row) {
    return (
      row.querySelector('[data-e2e-conversation-name]')?.textContent?.trim()
      || row.querySelector('mws-conversation-list-item [slot="primary"]')?.textContent?.trim()
      || row.querySelector('[class*="conversation-name"]')?.textContent?.trim()
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

  function isUnreadRow(row) {
    return Boolean(
      row.querySelector('[data-e2e-conversation-unread]')
      || row.matches('[data-e2e-conversation-unread="true"]')
      || row.querySelector('[class*="unread"]')
      || row.querySelector('[aria-label*="unread" i]')
      || row.querySelector('[aria-label*="non lu" i]'),
    );
  }

  function clickMarkReadControl(root) {
    const selectors = [
      '[data-e2e-conversation-mark-read]',
      '[aria-label*="mark as read" i]',
      '[aria-label*="marquer comme lu" i]',
      '[aria-label*="mark read" i]',
    ];

    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (node) {
        node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        node.click();
        return { ok: true, method: 'button-click', selector };
      }
    }

    const buttons = root.querySelectorAll('button, [role="menuitem"], [role="button"]');
    for (const node of buttons) {
      const label = ((node.getAttribute('aria-label') || '') + ' ' + (node.textContent || '')).toLowerCase();
      if (/mark as read|marquer comme lu|mark read/.test(label)) {
        node.click();
        return { ok: true, method: 'label-click' };
      }
    }

    return null;
  }

  function tryContextMenuMarkRead(row) {
    row.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 8,
      clientY: 8,
    }));

    const hit = clickMarkReadControl(document);
    if (hit) {
      return { ok: true, method: 'context-menu', ...hit };
    }

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return null;
  }

  function tryHoverMarkRead(row) {
    row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

    const hit = clickMarkReadControl(row);
    if (hit) {
      return hit;
    }

    const menuButton = row.querySelector(
      '[aria-label*="more" i], [aria-label*="options" i], [aria-label*="actions" i], button[aria-haspopup="menu"]',
    );
    if (menuButton) {
      menuButton.click();
      const menuHit = clickMarkReadControl(document);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      if (menuHit) {
        return { ok: true, method: 'overflow-menu', ...menuHit };
      }
    }

    return null;
  }

  const previousHref = location.href;
  const previousId = conversationIdFromUrl(previousHref);
  const targetSender = String(senderName || '').trim().toLowerCase();
  const targetId = conversationIdFromUrl(conversationUrl);

  function restoreView() {
    if (conversationIdFromUrl(location.href) !== previousId) {
      spaNavigateTo(previousHref);
    }
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

  let targetRow = null;
  for (const row of rows) {
    const rowUrl = urlFromRow(row);
    const rowId = conversationIdFromUrl(rowUrl);
    const name = nameFromRow(row);
    const senderMatch = Boolean(
      targetSender
      && name
      && (name === targetSender || name.includes(targetSender) || targetSender.includes(name)),
    );
    const idMatch = Boolean(targetId && rowId && rowId === targetId);

    if (senderMatch || idMatch) {
      targetRow = row;
      break;
    }
  }

  if (!targetRow) {
    return { ok: false, reason: 'row-not-found', previousHref };
  }

  if (!isUnreadRow(targetRow)) {
    restoreView();
    return { ok: true, method: 'already-read', previousHref };
  }

  const attempts = [
    () => tryHoverMarkRead(targetRow),
    () => tryContextMenuMarkRead(targetRow),
  ];

  for (const attempt of attempts) {
    const hit = attempt();
    restoreView();
    if (hit?.ok) {
      return { ...hit, previousHref, restored: conversationIdFromUrl(location.href) === previousId };
    }
  }

  const rowUrl = urlFromRow(targetRow) || conversationUrl;
  if (rowUrl && conversationIdFromUrl(rowUrl) !== previousId) {
    spaNavigateTo(rowUrl);
    const start = Date.now();
    while (Date.now() - start < 400) {
      // Allow Google Messages web to register the thread as read.
    }
    restoreView();
    return {
      ok: true,
      method: 'navigate-and-restore',
      previousHref,
      restored: conversationIdFromUrl(location.href) === previousId,
    };
  }

  restoreView();
  return { ok: false, reason: 'mark-read-control-not-found', previousHref };
}`;

async function markAsRead(mainWindow, { sender, conversationUrl }) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, reason: 'no-window' };
  }

  try {
    return await runDom(mainWindow, MARK_READ_IN_PLACE_SCRIPT, {
      senderName: sender || '',
      conversationUrl: conversationUrl || '',
    });
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

module.exports = {
  markAsRead,
};
