const { logReplyEvent } = require('./reply-log');
const { openConversation, waitForConversation } = require('./open-conversation');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { ok: false, reason: 'log-serialize-failed' };
  }
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

const FIND_COMPOSE_FN = String.raw`() => {
  function describe(node) {
    if (!node) return null;
    return {
      tag: node.tagName,
      editable: node.isContentEditable,
      aria: node.getAttribute('aria-label') || '',
      dataE2e: node.getAttribute('data-e2e') || '',
    };
  }

  function pickEditable(root) {
    const selectors = [
      '[data-e2e-message-input] [contenteditable="true"]',
      '[data-e2e-message-input] textarea',
      '[data-e2e-message-input]',
      'textarea[aria-label*="message" i]',
      'textarea[placeholder*="message" i]',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"]',
      'textarea',
    ];

    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (!node || node.disabled) continue;
      const target = node.matches?.('[contenteditable="true"], textarea, input')
        ? node
        : node.querySelector('[contenteditable="true"], textarea, input') || node;
      if (target && !target.disabled) {
        return { target, selector, info: describe(target) };
      }
    }
    return null;
  }

  const host = document.querySelector('mws-message-input');
  if (host && host.shadowRoot) {
    const hit = pickEditable(host.shadowRoot);
    if (hit) return { ok: true, where: 'mws-message-input.shadow', ...hit };
  }

  const view = document.querySelector('mws-conversation-view')
    || document.querySelector('[data-e2e-conversation-view]');
  if (view) {
    const hit = pickEditable(view);
    if (hit) return { ok: true, where: 'conversation-view', ...hit };
  }

  const hit = pickEditable(document);
  if (hit) return { ok: true, where: 'document', ...hit };

  return { ok: false, reason: 'no-compose-input' };
}`;

const READ_DRAFT_FN = String.raw`() => {
  function readNode(node) {
    if (!node) return '';
    if (node.isContentEditable) return (node.textContent || '').trim();
    return String(node.value || '').trim();
  }

  function walk(root, depth, list) {
    if (depth > 10) return;
    root.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]').forEach((node) => {
      if (!node.disabled) list.push(node);
    });
    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) walk(el.shadowRoot, depth + 1, list);
    });
  }

  const drafts = [];
  const seen = new Set();

  function add(node, where) {
    if (!node || seen.has(node)) return;
    seen.add(node);
    const text = readNode(node);
    if (text) drafts.push({ text, where });
  }

  add(document.querySelector('[data-e2e-message-input] textarea'), 'data-e2e-textarea');
  add(document.querySelector('[data-e2e-message-input] [contenteditable="true"]'), 'data-e2e-contenteditable');

  const host = document.querySelector('mws-message-input');
  if (host && host.shadowRoot) {
    add(host.shadowRoot.querySelector('textarea'), 'shadow-textarea');
    add(host.shadowRoot.querySelector('[contenteditable="true"]'), 'shadow-contenteditable');
  }

  const nodes = [];
  walk(document, 0, nodes);
  for (const node of nodes) {
    add(node, 'walk');
  }

  const combined = drafts.map((entry) => entry.text).join('\n').trim();
  return {
    draft: combined,
    drafts,
    where: drafts[0]?.where || 'none',
  };
}`;

const FOCUS_COMPOSE_FN = String.raw`() => {
  function focusNode(node) {
    node.focus({ preventScroll: false });
    node.click();

    if (node.isContentEditable) {
      try {
        const range = document.createRange();
        range.selectNodeContents(node);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch {
        // Selection may fail on some nodes.
      }
    } else if (typeof node.setSelectionRange === 'function') {
      const len = String(node.value || '').length;
      node.setSelectionRange(len, len);
    }

    return {
      tag: node.tagName,
      editable: node.isContentEditable,
      aria: node.getAttribute('aria-label') || node.getAttribute('placeholder') || '',
      active: document.activeElement === node || node.contains(document.activeElement),
    };
  }

  function collect(root, depth, list) {
    if (depth > 10) return;
    root.querySelectorAll('[contenteditable="true"], textarea, input[type="text"]').forEach((node) => {
      if (!node.disabled) list.push(node);
    });
    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) collect(el.shadowRoot, depth + 1, list);
    });
  }

  const host = document.querySelector('mws-message-input');
  const candidates = [];

  const prioritized = document.querySelector('[data-e2e-message-input] textarea')
    || document.querySelector('[data-e2e-message-input] [contenteditable="true"]');
  if (prioritized && !prioritized.disabled) {
    candidates.push(prioritized);
  }

  if (host) {
    collect(host.shadowRoot || host, 0, candidates);
  }
  if (!candidates.length) {
    collect(document, 0, candidates);
  }

  for (const node of candidates) {
    const info = focusNode(node);
    if (info.active) {
      return { ok: true, ...info, where: host ? 'mws-message-input' : 'document' };
    }
  }

  if (candidates.length) {
    const info = focusNode(candidates[candidates.length - 1]);
    return { ok: true, ...info, where: 'fallback-last' };
  }

  return { ok: false, reason: 'no-compose-input' };
}`;

const TYPE_IN_COMPOSE_FN = String.raw`({ text }) => {
  function collect(root, depth, list) {
    if (depth > 10) return;
    root.querySelectorAll('[contenteditable="true"], textarea, input[type="text"]').forEach((node) => {
      if (!node.disabled) list.push(node);
    });
    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) collect(el.shadowRoot, depth + 1, list);
    });
  }

  function findTarget() {
    const prioritized = [
      '[data-e2e-message-input] textarea',
      '[data-e2e-message-input] [contenteditable="true"]',
      'mws-message-input textarea',
      'mws-message-input [contenteditable="true"]',
    ];

    for (const selector of prioritized) {
      const node = document.querySelector(selector);
      if (node && !node.disabled) {
        return { node, where: selector };
      }
    }

    const candidates = [];
    const host = document.querySelector('mws-message-input');
    if (host) {
      collect(host.shadowRoot || host, 0, candidates);
    }
    if (!candidates.length) {
      collect(document, 0, candidates);
    }

    if (!candidates.length) return null;
    const node = candidates[candidates.length - 1];
    return { node, where: host ? 'mws-message-input' : 'doc' };
  }

  function readDraft(node) {
    if (!node) return '';
    return node.isContentEditable ? (node.textContent || '').trim() : String(node.value || '').trim();
  }

  function setNativeValue(node, value) {
    const proto = node.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(node, value);
    else node.value = value;
  }

  function fireInput(node, value) {
    node.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: value,
    }));
    node.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: value,
    }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function trySet(node, value) {
    node.focus();
    node.click();

    if (node.isContentEditable) {
      node.textContent = '';
      node.innerHTML = '';
      node.textContent = value;
      fireInput(node, value);
      if (readDraft(node).includes(value)) return 'contenteditable-text';
      node.focus();
      if (document.execCommand('selectAll', false, null)) {
        document.execCommand('insertText', false, value);
      }
      if (readDraft(node).includes(value)) return 'execCommand';
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', value);
        node.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt,
        }));
      } catch {
        // ClipboardEvent paste may be blocked.
      }
      if (readDraft(node).includes(value)) return 'paste-event';
      return '';
    }

    setNativeValue(node, value);
    fireInput(node, value);
    if (readDraft(node).includes(value)) return 'native-value';
    return '';
  }

  const hit = findTarget();
  if (!hit) return { ok: false, reason: 'no-compose-input' };

  const methods = [];
  let method = trySet(hit.node, text);
  if (method) methods.push(method);

  if (!readDraft(hit.node).includes(text)) {
    hit.node.focus();
    for (const ch of text) {
      hit.node.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      hit.node.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true }));
      if (hit.node.isContentEditable) {
        hit.node.textContent = (hit.node.textContent || '') + ch;
      } else {
        setNativeValue(hit.node, (hit.node.value || '') + ch);
      }
      hit.node.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
      hit.node.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
    }
    methods.push('char-by-char');
  }

  const draft = readDraft(hit.node);
  return {
    ok: draft.includes(text),
    draft: draft.slice(0, 120),
    where: hit.where,
    methods,
    reason: draft.includes(text) ? undefined : 'text-not-in-compose',
  };
}`;

const CLICK_SEND_FN = String.raw`() => {
  function clickNode(btn) {
    btn.focus();
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    btn.click();
  }

  function findButton(root, depth) {
    if (depth > 10) return null;
    const selectors = [
      '[data-e2e-send-button]',
      'mws-message-send-button button',
      'button[aria-label*="Send" i]',
      'button[aria-label*="Envoyer" i]',
      'button[data-tooltip*="Send" i]',
      'button[type="submit"]',
    ];
    for (const selector of selectors) {
      const nodes = root.querySelectorAll(selector);
      for (const node of nodes) {
        if (node && !node.disabled) return node;
      }
    }
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        const found = findButton(el.shadowRoot, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  const host = document.querySelector('mws-message-input');
  const roots = [document];
  if (host && host.shadowRoot) roots.unshift(host.shadowRoot);

  for (const root of roots) {
    const btn = findButton(root, 0);
    if (btn) {
      clickNode(btn);
      return { ok: true, method: 'button', aria: btn.getAttribute('aria-label') || '', disabled: btn.disabled };
    }
  }

  return { ok: false, reason: 'no-send-button' };
}`;

const IS_SEND_READY_FN = String.raw`() => {
  function findButton(root, depth) {
    if (depth > 10) return null;
    const selectors = [
      '[data-e2e-send-button]',
      'mws-message-send-button button',
      'button[aria-label*="Send" i]',
      'button[aria-label*="Envoyer" i]',
      'button[data-tooltip*="Send" i]',
      'button[type="submit"]',
    ];
    for (const selector of selectors) {
      const nodes = root.querySelectorAll(selector);
      for (const node of nodes) {
        if (node) return node;
      }
    }
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        const found = findButton(el.shadowRoot, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  const host = document.querySelector('mws-message-input');
  const roots = [document];
  if (host && host.shadowRoot) roots.unshift(host.shadowRoot);

  for (const root of roots) {
    const btn = findButton(root, 0);
    if (btn) {
      return { ok: !btn.disabled, disabled: Boolean(btn.disabled), aria: btn.getAttribute('aria-label') || '' };
    }
  }

  return { ok: false, disabled: true, reason: 'no-send-button' };
}`;

const VERIFY_SENT_FN = String.raw`({ text, beforeCount, beforeLastText, requireThread }) => {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { ok: false, reason: 'empty' };

  function readNode(node) {
    if (!node) return '';
    if (node.isContentEditable) return (node.textContent || '').trim();
    return String(node.value || '').trim();
  }

  function readAllDrafts() {
    const drafts = [];
    const textarea = document.querySelector('[data-e2e-message-input] textarea');
    const editable = document.querySelector('[data-e2e-message-input] [contenteditable="true"]');
    const host = document.querySelector('mws-message-input');
    const shadowTextarea = host?.shadowRoot?.querySelector('textarea');
    const shadowEditable = host?.shadowRoot?.querySelector('[contenteditable="true"]');

    for (const node of [textarea, editable, shadowTextarea, shadowEditable]) {
      const value = readNode(node);
      if (value) drafts.push(value);
    }
    return drafts;
  }

  function isOutgoing(node) {
    const wrapper = node.closest('mws-message-wrapper')
      || node.closest('[data-e2e-message-wrapper]')
      || node.closest('[class*="message-wrapper"]')
      || node;
    const aria = wrapper.getAttribute?.('aria-label') || '';
    return Boolean(
      wrapper.matches?.('[class*="outgoing"]')
      || wrapper.closest?.('[class*="outgoing"]')
      || wrapper.querySelector?.('[data-e2e-outgoing="true"]')
      || wrapper.getAttribute?.('data-e2e-outgoing') === 'true'
      || /you sent/i.test(aria)
      || /vous avez envoy/i.test(aria),
    );
  }

  function threadSnapshot() {
    const selectors = [
      'mws-message-wrapper',
      'mws-text-message-content',
      '[data-e2e-message-text]',
      '[class*="message-text"]',
    ];
    let nodes = [];
    for (const selector of selectors) {
      const found = Array.from(document.querySelectorAll(selector));
      if (found.length > nodes.length) nodes = found;
    }

    const texts = nodes
      .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    let lastOutgoing = '';
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      const body = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!body) continue;
      if (isOutgoing(node)) {
        lastOutgoing = body;
        break;
      }
    }

    return {
      count: texts.length,
      lastText: texts[texts.length - 1] || '',
      lastOutgoing,
    };
  }

  const drafts = readAllDrafts();
  const stillDrafted = drafts.some((draft) => draft.includes(trimmed));
  if (stillDrafted) {
    return { ok: false, reason: 'draft-still-has-text', drafts: drafts.map((draft) => draft.slice(0, 80)) };
  }

  if (!requireThread) {
    return { ok: true, method: 'draft-cleared' };
  }

  const after = threadSnapshot();
  const countIncreased = Number.isFinite(beforeCount) && after.count > beforeCount;
  const outgoingMatches = after.lastOutgoing.includes(trimmed);
  const lastChanged = beforeLastText !== after.lastText;

  if (countIncreased && outgoingMatches) {
    return { ok: true, method: 'thread-new-outgoing', after };
  }

  if (countIncreased && lastChanged) {
    return { ok: true, method: 'thread-count-increased', after };
  }

  if (outgoingMatches && beforeLastText !== after.lastOutgoing) {
    return { ok: true, method: 'thread-outgoing-updated', after };
  }

  return { ok: false, reason: 'not-in-thread', drafts, after, beforeCount, beforeLastText };
}`;

const SNAPSHOT_THREAD_FN = String.raw`() => {
  const selectors = [
    'mws-message-wrapper',
    'mws-text-message-content',
    '[data-e2e-message-text]',
    '[class*="message-text"]',
  ];

  let nodes = [];
  for (const selector of selectors) {
    const found = Array.from(document.querySelectorAll(selector));
    if (found.length > nodes.length) nodes = found;
  }

  const texts = nodes
    .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  return {
    count: texts.length,
    lastText: texts[texts.length - 1] || '',
  };
}`;

const CLEAR_COMPOSE_FN = String.raw`() => {
  function clearNode(node) {
    if (!node) return false;
    node.focus();
    if (node.isContentEditable) {
      node.textContent = '';
      node.innerHTML = '';
    } else {
      const proto = node.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(node, '');
      else node.value = '';
    }
    node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    return true;
  }

  const textarea = document.querySelector('[data-e2e-message-input] textarea');
  const editable = document.querySelector('[data-e2e-message-input] [contenteditable="true"]');
  const host = document.querySelector('mws-message-input');
  const shadowTextarea = host?.shadowRoot?.querySelector('textarea');
  const shadowEditable = host?.shadowRoot?.querySelector('[contenteditable="true"]');

  let cleared = 0;
  for (const node of [textarea, editable, shadowTextarea, shadowEditable]) {
    if (clearNode(node)) cleared += 1;
  }

  return { ok: cleared > 0, cleared };
}`;

const SYNC_COMPOSE_FN = String.raw`({ text }) => {
  const trimmed = String(text || '').trim();
  const textarea = document.querySelector('[data-e2e-message-input] textarea');
  const editable = document.querySelector('[data-e2e-message-input] [contenteditable="true"]');

  function nudge(node) {
    if (!node) return;
    node.focus();
    node.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: trimmed,
    }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }

  nudge(textarea);
  nudge(editable);

  const host = document.querySelector('mws-message-input');
  if (host?.shadowRoot) {
    nudge(host.shadowRoot.querySelector('textarea'));
    nudge(host.shadowRoot.querySelector('[contenteditable="true"]'));
  }

  return { ok: true };
}`;

const WAIT_COMPOSE_FN = String.raw`() => {
  const host = document.querySelector('mws-message-input');
  const inShadow = Boolean(host && host.shadowRoot && host.shadowRoot.querySelector('[contenteditable="true"], textarea'));
  const inDoc = Boolean(
    document.querySelector('[data-e2e-message-input]')
    || document.querySelector('[contenteditable="true"]')
    || document.querySelector('textarea'),
  );
  return { ok: inShadow || inDoc, inShadow, inDoc, href: location.href };
}`;

async function waitForCompose(mainWindow, timeoutMs = 12000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await runDom(mainWindow, WAIT_COMPOSE_FN);
    if (last?.ok) return { ok: true, ...last };
    await sleep(200);
  }
  return { ok: false, reason: 'compose-not-ready', ...last };
}

async function focusCompose(mainWindow, { background = false } = {}) {
  const focus = await runDom(mainWindow, FOCUS_COMPOSE_FN);
  if (!focus?.ok) {
    return focus;
  }

  mainWindow.webContents.focus();
  if (!background) {
    mainWindow.focus();
  }

  await sleep(background ? 50 : 40);
  return focus;
}

async function readDraft(mainWindow) {
  return runDom(mainWindow, READ_DRAFT_FN);
}

async function typeViaInsertText(mainWindow, text, { background = false } = {}) {
  const focus = await focusCompose(mainWindow, { background });
  if (!focus?.ok) {
    return { ok: false, reason: 'focus-failed', focus };
  }

  try {
    mainWindow.webContents.insertText(text);
  } catch (error) {
    return { ok: false, reason: 'insertText-error', error: error.message, focus };
  }

  await sleep(60);
  const draft = await readDraft(mainWindow);
  return {
    ok: String(draft.draft || '').includes(text),
    method: 'webContents.insertText',
    draft: String(draft.draft || '').slice(0, 120),
    focus,
    where: draft.where,
  };
}

async function typeViaCdp(mainWindow, text, { background = false } = {}) {
  const wc = mainWindow.webContents;
  const focus = await focusCompose(mainWindow, { background });
  if (!focus?.ok) {
    return { ok: false, reason: 'focus-failed', focus };
  }

  try {
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach('1.3');
    }

    await wc.debugger.sendCommand('Input.insertText', { text });
    await sleep(150);
    const draft = await readDraft(mainWindow);
    return {
      ok: String(draft.draft || '').includes(text),
      method: 'cdp.insertText',
      draft: String(draft.draft || '').slice(0, 120),
      focus,
      where: draft.where,
    };
  } catch (error) {
    return { ok: false, reason: 'cdp-error', error: error.message, focus };
  }
}

async function typeViaKeyboard(mainWindow, text, { background = false } = {}) {
  const focus = await focusCompose(mainWindow, { background });
  if (!focus?.ok) {
    return { ok: false, reason: 'focus-failed', focus };
  }

  const wc = mainWindow.webContents;
  for (const ch of text) {
    wc.sendInputEvent({ type: 'char', keyCode: ch });
    await sleep(8);
  }

  await sleep(120);
  const draft = await readDraft(mainWindow);
  return {
    ok: String(draft.draft || '').includes(text),
    method: 'sendInputEvent.char',
    draft: String(draft.draft || '').slice(0, 120),
    focus,
    where: draft.where,
  };
}

async function sendViaEnter(mainWindow, { background = false } = {}) {
  await focusCompose(mainWindow, { background });
  const wc = mainWindow.webContents;
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return', modifiers: [] });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return', modifiers: [] });
  return { ok: true, method: 'enter-input-event' };
}

async function typeMessage(mainWindow, text, { background = false } = {}) {
  const attempts = [];

  if (background) {
    let typed = await typeViaInsertText(mainWindow, text, { background });
    attempts.push(typed);

    if (!typed.ok) {
      typed = await typeViaKeyboard(mainWindow, text, { background });
      attempts.push(typed);
    }

    if (!typed.ok) {
      typed = await typeViaCdp(mainWindow, text, { background });
      attempts.push(typed);
    }

    if (!typed.ok) {
      typed = await runDom(mainWindow, TYPE_IN_COMPOSE_FN, { text });
      attempts.push(typed);
    }

    if (!typed.ok && !mainWindow.isVisible()) {
      mainWindow.showInactive();
      await sleep(250);
      typed = await typeViaInsertText(mainWindow, text, { background: false });
      attempts.push({ ...typed, method: typed.method ? `${typed.method}-inactive-fallback` : 'inactive-fallback' });
      if (background) {
        mainWindow.hide();
      }
    }
  } else {
    let typed = await typeViaInsertText(mainWindow, text, { background });
    attempts.push(typed);

    if (!typed.ok) {
      typed = await typeViaCdp(mainWindow, text, { background });
      attempts.push(typed);
    }

    if (!typed.ok) {
      typed = await runDom(mainWindow, TYPE_IN_COMPOSE_FN, { text });
      attempts.push(typed);
    }

    if (!typed.ok) {
      typed = await typeViaKeyboard(mainWindow, text, { background });
      attempts.push(typed);
    }
  }

  return attempts;
}

async function waitForSendReady(mainWindow, timeoutMs = 600) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await runDom(mainWindow, IS_SEND_READY_FN);
    if (last.ok && !last.disabled) {
      return last;
    }
    await sleep(40);
  }
  return last || { ok: false, disabled: true };
}

async function attemptSend(mainWindow, text, { background = false, threadBefore = {} } = {}) {
  const verifyArgs = {
    text,
    beforeCount: threadBefore.count,
    beforeLastText: threadBefore.lastText,
  };

  let sent = await runDom(mainWindow, CLICK_SEND_FN);
  logReplyEvent('send-click', safeJson(sent));

  if (!sent.ok) {
    sent = await sendViaEnter(mainWindow, { background });
    logReplyEvent('send-enter', safeJson(sent));
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const verified = await runDom(mainWindow, VERIFY_SENT_FN, { ...verifyArgs, requireThread: false });
    if (verified.ok) {
      return { ok: true, method: sent.method, verified: verified.method, verifiedDetail: verified };
    }
    await sleep(40);
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const verified = await runDom(mainWindow, VERIFY_SENT_FN, { ...verifyArgs, requireThread: true });
    if (verified.ok) {
      return { ok: true, method: sent.method, verified: verified.method, verifiedDetail: verified };
    }
    await sleep(80);
  }

  await sendViaEnter(mainWindow, { background });
  logReplyEvent('send-enter-retry', { text });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const verified = await runDom(mainWindow, VERIFY_SENT_FN, { ...verifyArgs, requireThread: false });
    if (verified.ok) {
      return { ok: true, method: 'enter-retry', verified: verified.method, verifiedDetail: verified };
    }
    await sleep(50);
  }

  const verified = await runDom(mainWindow, VERIFY_SENT_FN, { ...verifyArgs, requireThread: true });
  return { ok: false, reason: verified.reason || 'send-not-verified', method: sent.method, verifiedDetail: verified };
}

async function typeAndSend(mainWindow, text, { background = false } = {}) {
  const compose = await waitForCompose(mainWindow);
  if (!compose.ok) {
    return { ok: false, reason: 'compose-not-ready', step: 'wait-compose', compose };
  }

  const found = await runDom(mainWindow, FIND_COMPOSE_FN);
  logReplyEvent('compose-found', safeJson(found));

  const threadBefore = await runDom(mainWindow, SNAPSHOT_THREAD_FN);
  await runDom(mainWindow, CLEAR_COMPOSE_FN);

  let attempts = await typeMessage(mainWindow, text, { background });
  let typed = attempts[attempts.length - 1] || { ok: false, reason: 'no-attempt' };

  logReplyEvent('typed', safeJson({ ...typed, attempts, background }));

  if (!typed.ok) {
    const draft = await readDraft(mainWindow);
    return { ok: false, reason: typed.reason || 'text-not-in-compose', step: 'type', typed, draft, found, attempts };
  }

  let sendReady = await waitForSendReady(mainWindow, 500);
  logReplyEvent('send-ready', safeJson(sendReady));

  if (!sendReady?.ok) {
    await runDom(mainWindow, SYNC_COMPOSE_FN, { text });
    sendReady = await waitForSendReady(mainWindow, 400);
    logReplyEvent('send-ready-retry', safeJson(sendReady));
  }

  await runDom(mainWindow, SYNC_COMPOSE_FN, { text });
  await sleep(60);

  const sendResult = await attemptSend(mainWindow, text, { background, threadBefore });
  if (sendResult.ok) {
    return {
      ok: true,
      method: sendResult.method,
      verified: sendResult.verified,
      typed,
      attempts,
      background,
      threadBefore,
      sendReady,
    };
  }

  if (background && !mainWindow.isVisible()) {
    mainWindow.showInactive();
    await sleep(150);
    await runDom(mainWindow, CLEAR_COMPOSE_FN);
    attempts = await typeMessage(mainWindow, text, { background: false });
    typed = attempts[attempts.length - 1] || typed;
    await runDom(mainWindow, SYNC_COMPOSE_FN, { text });
    await sleep(80);
    sendReady = await waitForSendReady(mainWindow, 800);
    logReplyEvent('send-final-retry', safeJson({ typed, sendReady }));
    const finalSend = await attemptSend(mainWindow, text, { background: false, threadBefore });
    mainWindow.hide();
    if (finalSend.ok) {
      return {
        ok: true,
        method: finalSend.method,
        verified: finalSend.verified,
        typed,
        attempts,
        background,
        threadBefore,
        sendReady,
        finalRetry: true,
      };
    }
  }

  const draft = await readDraft(mainWindow);
  const threadAfter = await runDom(mainWindow, SNAPSHOT_THREAD_FN);
  return {
    ok: false,
    reason: sendResult.reason || 'send-not-verified',
    step: 'verify',
    method: sendResult.method,
    typed,
    draft,
    attempts,
    background,
    threadBefore,
    threadAfter,
    sendReady,
  };
}

async function sendReply(mainWindow, { sender, conversationUrl, text, background = false }) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, reason: 'no-window' };
  }

  const replyText = String(text || '').trim();
  if (!replyText) {
    return { ok: false, reason: 'empty-text' };
  }

  if (!conversationUrl || !conversationUrl.includes('/conversations/')) {
    return { ok: false, reason: 'no-target' };
  }

  const payload = { sender, conversationUrl, text: replyText, background };
  logReplyEvent('start', payload);

  try {
    let nav = await openConversation(mainWindow, { sender, conversationUrl });
    logReplyEvent('nav', safeJson({ payload, nav }));

    if (!nav.ok) {
      logReplyEvent('failure', safeJson({ ...payload, step: 'navigate', nav }));
      return { ok: false, ...nav };
    }

    let ready = await waitForConversation(mainWindow, conversationUrl, 10000);
    if (!ready.ok) {
      nav = await openConversation(mainWindow, { sender, conversationUrl });
      ready = nav.ok ? await waitForConversation(mainWindow, conversationUrl, 8000) : ready;
    }
    logReplyEvent('ready', safeJson({ payload, nav, ready }));

    if (!ready.ok) {
      logReplyEvent('failure', safeJson({ ...payload, step: 'wait', nav, ready }));
      return { ok: false, ...ready, nav: nav.method };
    }

    const navDelay = nav.method === 'already-open' ? 100 : 350;
    await sleep(navDelay);

    const result = await typeAndSend(mainWindow, replyText, { background });
    const fullResult = safeJson({
      ...result,
      nav: nav.method,
      conversationId: ready.targetId,
      url: mainWindow.webContents.getURL(),
    });

    logReplyEvent(result.ok ? 'success' : 'failure', safeJson({ ...payload, result: fullResult }));
    return result.ok ? fullResult : { ok: false, ...fullResult };
  } catch (error) {
    logReplyEvent('error', safeJson({ ...payload, error: error.message }));
    return { ok: false, reason: error.message };
  }
}

module.exports = { sendReply };
