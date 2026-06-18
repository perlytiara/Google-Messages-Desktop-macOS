const fs = require('fs');
const { Notification, clipboard } = require('electron');
const { extractAllOtps, isVerificationMessage, normalizeText } = require('./otp');
const { logNotificationPayload } = require('./notification-log');

let onCopyCode = () => {};
let focusWindow = () => {};

const ACTION_COPY = 0;
const ACTION_DISMISS = 1;
const DEDUPE_MS = 30000;
const recentNotifications = new Map();

function setOnCopyCodeCallback(fn) {
  onCopyCode = fn;
}

function setFocusWindowCallback(fn) {
  focusWindow = fn;
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
    return [{ type: 'button', text: 'Dismiss' }];
  }

  return [
    { type: 'button', text: 'Copy Code' },
    { type: 'button', text: 'Dismiss' },
  ];
}

function handleCopy(primaryCode, notification) {
  copyCode(primaryCode);
  notification.close();
  onCopyCode();
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
  const dedupeKey = `${title || ''}\0${bodyText}`;

  if (!skipDedupe && isDuplicate(dedupeKey, primaryCode || 'message')) {
    return;
  }

  const sender = title && title !== 'Messages' ? title : '';
  const isCodeMessage = Boolean(primaryCode);
  const displayBody = bodyText;
  const actions = buildActions(primaryCode);

  logNotificationPayload({ title, body, data, raw, messageText }, codes);

  const notification = new Notification({
    title: 'Messages',
    body: displayBody,
    silent: silent ?? false,
    actions,
  });

  notification.on('click', () => {
    if (primaryCode) {
      handleCopy(primaryCode, notification);
      return;
    }

    notification.close();
    focusWindow();
  });

  notification.on('action', (event, index) => {
    const actionIndex = getActionIndex(event, index);

    if (actionIndex === ACTION_COPY) {
      handleCopy(primaryCode, notification);
      return;
    }

    if (actionIndex === ACTION_DISMISS) {
      notification.close();
    }
  });

  notification.on('show', () => {
    console.log('[Messages] Notification shown:', {
      type: isCodeMessage ? 'verification' : 'regular',
      sender,
      body: displayBody,
      codes,
      actions: actions.map((action) => action.text),
    });
  });

  notification.show();

  return notification;
}

module.exports = {
  showMessageNotification,
  setOnCopyCodeCallback,
  setFocusWindowCallback,
};
