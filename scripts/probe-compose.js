#!/usr/bin/env node

const { app, BrowserWindow } = require('electron');

const PROBE = String.raw`(() => {
  function describeInput(node) {
    if (!node) return null;
    return {
      tag: node.tagName,
      type: node.type || '',
      contentEditable: node.isContentEditable,
      ariaLabel: node.getAttribute('aria-label') || '',
      placeholder: node.getAttribute('placeholder') || '',
      dataE2e: node.getAttribute('data-e2e') || node.getAttribute('data-e2e-message-input') || '',
      disabled: Boolean(node.disabled),
      valueLen: node.isContentEditable ? (node.textContent || '').length : (node.value || '').length,
    };
  }

  const inputs = [];
  const selectors = [
    '[data-e2e-message-input]',
    'mws-message-input',
    'mws-message-input textarea',
    'mws-message-input [contenteditable="true"]',
    'textarea',
    '[contenteditable="true"]',
  ];

  for (const sel of selectors) {
    document.querySelectorAll(sel).forEach((node) => {
      inputs.push({ selector: sel, ...describeInput(node) });
    });
  }

  const host = document.querySelector('mws-message-input');
  if (host && host.shadowRoot) {
    host.shadowRoot.querySelectorAll('textarea, [contenteditable="true"]').forEach((node) => {
      inputs.push({ selector: 'shadow', ...describeInput(node) });
    });
  }

  const sendButtons = [];
  for (const sel of ['[data-e2e-send-button]', 'mws-message-send-button', 'button[aria-label*="Send" i]']) {
    document.querySelectorAll(sel).forEach((node) => {
      sendButtons.push({
        selector: sel,
        tag: node.tagName,
        disabled: Boolean(node.disabled),
        ariaLabel: node.getAttribute('aria-label') || '',
      });
    });
  }

  return {
    href: location.href,
    title: document.querySelector('[data-e2e-conversation-title]')?.textContent?.trim() || '',
    inputs,
    sendButtons,
  };
})()`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: 'persist:messages',
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const quitTimer = setTimeout(() => {
    console.error('[probe-compose] Timed out — quitting.');
    app.quit();
  }, 20000);

  try {
    await win.loadURL('https://messages.google.com/web/conversations/Cgg5pUlxzVCRuhICMTk');
    await new Promise((r) => setTimeout(r, 5000));

    const info = await win.webContents.executeJavaScript(PROBE);
    console.log(JSON.stringify(info, null, 2));
  } catch (error) {
    console.error('[probe-compose] Failed:', error.message);
  } finally {
    clearTimeout(quitTimer);
    win.destroy();
    app.quit();
  }
});
