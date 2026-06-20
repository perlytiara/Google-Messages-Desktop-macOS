const fs = require('fs');
const { Notification, clipboard } = require('electron');
const { extractAllOtps, isVerificationMessage, normalizeText } = require('./otp');
const { logNotificationPayload } = require('./notification-log');

let suppressForeground = () => {};
let onNotificationShown = () => {};
let onNotificationClick = () => {};

const DEDUPE_MS = 30000;
/** Verification alerts auto-clear after this (must not live forever). */
const VERIFICATION_MAX_MS = 5 * 60 * 1000;
const recentNotifications = new Map();

function setSuppressForegroundCallback(fn) {
  suppressForeground = fn;
}

function setOnNotificationClickCallback(fn) {
  onNotificationClick = fn;
}

function setOnNotificationShownCallback(fn) {
  onNotificationShown = fn;
}

// Backward-compatible alias
function setOnCopyCodeCallback(fn) {
  setSuppressForegroundCallback(fn);
}

function setFocusWindowCallback(_fn) {
  // Notifications never focus the app — user opens Messages from the dock/menu.
}

function parseConversationMeta({ title, body, data, raw }) {
  let conversationUrl = typeof data === 'string' && data.includes('/conversations/') ? data : '';

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.conversationUrl) {
        conversationUrl = parsed.conversationUrl;
      }
    } catch {
      // Ignore malformed raw payloads.
    }
  }

  const sender = title && title !== 'Messages' ? title : '';
  return { sender, conversationUrl, body: normalizeText(body || '') };
}

function isDuplicate(dedupeKey, marker) {
  const key = `${marker}\0${dedupeKey}`;
  const now = Date.now();
  const last = recentNotifications.get(key);
  if (last && now - last < DEDUPE_MS) {
    return true;
  }
  recentNotifications.set(key, now);
  return false;
}

function getActionIndex(event, index) {
  if (typeof index === 'number') {
    return index;
  }

  return event?.actionIndex ?? -1;
}

function flattenValue(value, depth = 0) {
  if (value == null || depth > 4) {
    return '';
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => flattenValue(item, depth + 1)).filter(Boolean).join('\n');
  }

  if (typeof value === 'object') {
    return Object.values(value)
      .map((item) => flattenValue(item, depth + 1))
      .filter(Boolean)
      .join('\n');
  }

  return '';
}

function flattenData(data) {
  if (!data) {
    return '';
  }

  if (typeof data === 'string') {
    try {
      return flattenValue(JSON.parse(data));
    } catch {
      return data;
    }
  }

  return flattenValue(data);
}

function buildSearchableText({ title, body, data, raw }) {
  const parts = [
    body,
    title,
    flattenData(data),
    flattenData(raw),
    typeof raw === 'string' ? raw : '',
  ];

  return normalizeText(parts.filter(Boolean).join('\n'));
}

function copyCode(code) {
  if (code) {
    clipboard.writeText(code);
  }
}

function buildActions(primaryCode) {
  if (!primaryCode) {
    return [];
  }

  return [
    { type: 'button', text: 'Copy Code' },
    { type: 'button', text: 'Dismiss' },
  ];
}

function attachExpiryTimer(notification, isCodeMessage) {
  if (!isCodeMessage) {
    return () => {};
  }

  let timer = setTimeout(() => {
    timer = null;
    notification.close();
  }, VERIFICATION_MAX_MS);

  return () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

function dismissNotification(notification, { copyPrimaryCode = false, primaryCode = null } = {}) {
  if (copyPrimaryCode && primaryCode) {
    copyCode(primaryCode);
  }
  notification.close();
}

function showMessageNotification({ title, body, data, raw, silent, skipDedupe }) {
  if (!Notification.isSupported()) {
    return;
  }

  const bodyText = normalizeText(body || title || '');
  if (!bodyText) {
    return;
  }

  const messageText = buildSearchableText({ title, body, data, raw });
  const isVerification = isVerificationMessage(bodyText);
  const codes = isVerification ? extractAllOtps(bodyText) : [];
  const primaryCode = codes[0] ?? null;
  const dedupeKey = bodyText;

  if (!skipDedupe && isDuplicate(dedupeKey, primaryCode || 'message')) {
    return;
  }

  const sender = title && title !== 'Messages' ? title : '';
  const isCodeMessage = Boolean(primaryCode);
  const displayBody = bodyText;
  const actions = buildActions(primaryCode);
  const conversationMeta = parseConversationMeta({ title, body, data, raw });

  logNotificationPayload({ title, body, data, raw, messageText }, codes);

  const notification = new Notification({
    title: 'Messages',
    body: displayBody,
    silent: silent ?? false,
    ...(actions.length ? { actions } : {}),
  });

  let actionHandled = false;
  const clearExpiry = attachExpiryTimer(notification, isCodeMessage);

  notification.on('click', () => {
    if (actionHandled) {
      return;
    }

    clearExpiry();
    notification.close();
    onNotificationClick(conversationMeta);
  });

  notification.on('action', (event, index) => {
    actionHandled = true;
    clearExpiry();
    suppressForeground();

    const actionIndex = getActionIndex(event, index);
    const actionText = actions[actionIndex]?.text;

    if (actionText === 'Copy Code' && primaryCode) {
      dismissNotification(notification, { copyPrimaryCode: true, primaryCode });
      return;
    }

    dismissNotification(notification);
  });

  notification.on('show', () => {
    onNotificationShown();
    console.log('[Messages] Notification shown:', {
      type: isCodeMessage ? 'verification' : 'regular',
      display: isCodeMessage ? 'persistent-until-dismiss-or-5min' : 'banner',
      sender,
      body: displayBody,
      codes,
      actions: actions.map((action) => action.text),
    });
  });

  notification.on('close', () => {
    clearExpiry();
  });

  notification.show();

  return notification;
}

module.exports = {
  showMessageNotification,
  setOnCopyCodeCallback,
  setSuppressForegroundCallback,
  setOnNotificationShownCallback,
  setOnNotificationClickCallback,
  setFocusWindowCallback,
};
