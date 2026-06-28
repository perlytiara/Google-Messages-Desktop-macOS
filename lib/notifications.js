const { Notification, clipboard } = require('electron');
const {
  extractAllOtps,
  isLikelySecurityCode,
  extractCodeSubtitle,
  normalizeText,
} = require('./otp');
const { logNotificationPayload } = require('./notification-log');

let suppressForeground = () => {};
let onNotificationShown = () => {};
let onNotificationClick = () => {};
let onNotificationReply = () => {};
let onNotificationMarkAsRead = () => {};

const DEDUPE_MS = 30000;
/** Verification alerts auto-clear after this (must not live forever). */
const VERIFICATION_MAX_MS = 5 * 60 * 1000;
const recentNotifications = new Map();
/** @type {Map<string, { notification: Notification, count: number }>} */
const activeByGroup = new Map();

function setSuppressForegroundCallback(fn) {
  suppressForeground = fn;
}

function setOnNotificationClickCallback(fn) {
  onNotificationClick = fn;
}

function setOnNotificationShownCallback(fn) {
  onNotificationShown = fn;
}

function setOnNotificationReplyCallback(fn) {
  onNotificationReply = fn;
}

function setOnNotificationMarkAsReadCallback(fn) {
  onNotificationMarkAsRead = fn;
}

// Backward-compatible alias
function setOnCopyCodeCallback(fn) {
  setSuppressForegroundCallback(fn);
}

function setFocusWindowCallback(_fn) {
  // Notifications never focus the app — user opens Messages from the dock/menu.
}

function conversationIdFromUrl(url) {
  const match = String(url || '').match(/\/conversations\/([^/?#]+)/);
  return match ? match[1] : '';
}

function slugSender(sender) {
  return String(sender || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '') || 'unknown';
}

function buildGroupKey({ sender, conversationUrl }) {
  const id = conversationIdFromUrl(conversationUrl);
  if (id) {
    return `conv:${id}`;
  }

  return `sender:${slugSender(sender)}`;
}

function parseConversationMeta({ title, body, data, raw }) {
  let conversationUrl = typeof data === 'string' && data.includes('/conversations/') ? data : '';
  let sender = '';

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.conversationUrl) {
        conversationUrl = parsed.conversationUrl;
      }
      if (parsed.sender) {
        sender = String(parsed.sender).trim();
      }
    } catch {
      // Ignore malformed raw payloads.
    }
  }

  if (!sender && title && title !== 'Messages') {
    sender = String(title).replace(/^Self-test ·\s*/i, '').trim();
  }

  const normalizedBody = normalizeText(body || '');
  const groupKey = buildGroupKey({ sender, conversationUrl });

  return { sender, conversationUrl, body: normalizedBody, groupKey };
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

function buildRegularActions() {
  return [{ type: 'button', text: 'Mark Read' }];
}

function buildCodeActions() {
  return [{ type: 'button', text: 'Copy Code' }];
}

function buildCodeDisplay({ primaryCode, bodyText }) {
  return {
    body: primaryCode,
    subtitle: extractCodeSubtitle(bodyText),
  };
}

function buildDisplayTitle(contactTitle, messageCount) {
  if (messageCount > 1) {
    return `${contactTitle} (${messageCount})`;
  }

  return contactTitle;
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

function removeFromGroupRegistry(groupKey, notification) {
  const entry = activeByGroup.get(groupKey);
  if (entry && entry.notification === notification) {
    activeByGroup.delete(groupKey);
  }
}

function closePreviousGroupNotification(groupKey) {
  const existing = activeByGroup.get(groupKey);
  if (!existing) {
    return 0;
  }

  try {
    existing.notification.close();
  } catch {
    // Already dismissed.
  }

  activeByGroup.delete(groupKey);
  return existing.count;
}

function dismissNotificationGroup({ sender, conversationUrl }) {
  const groupKey = buildGroupKey({ sender, conversationUrl });
  closePreviousGroupNotification(groupKey);
}

function showMessageNotification({ title, body, data, raw, silent, skipDedupe }) {
  if (!Notification.isSupported()) {
    return;
  }

  let parsedRaw = {};
  if (raw) {
    try {
      parsedRaw = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      parsedRaw = {};
    }
  }

  const bodyText = normalizeText(body || title || '');
  if (!bodyText) {
    return;
  }

  const messageText = buildSearchableText({ title, body, data, raw });
  const codes = extractAllOtps(messageText);
  const primaryCode = codes[0] ?? null;
  const isCodeMessage = Boolean(primaryCode && isLikelySecurityCode(messageText));
  const conversationMeta = parseConversationMeta({ title, body, data, raw });
  const { sender, groupKey } = conversationMeta;
  const dedupeKey = `${groupKey}\0${bodyText}`;

  if (!skipDedupe && isDuplicate(dedupeKey, primaryCode || 'message')) {
    return;
  }

  const codeDisplay = isCodeMessage ? buildCodeDisplay({ primaryCode, bodyText }) : null;
  const displayBody = isCodeMessage ? codeDisplay.body : bodyText;
  const displaySubtitle = isCodeMessage ? codeDisplay.subtitle : undefined;
  const actions = isCodeMessage ? buildCodeActions() : buildRegularActions();
  const previousCount = closePreviousGroupNotification(groupKey);
  const messageCount = previousCount + 1;
  const contactTitle = (parsedRaw.sender || sender || 'Unknown')
    .replace(/^Self-test ·\s*/i, '')
    .trim() || 'Unknown';
  const displayTitle = buildDisplayTitle(contactTitle, messageCount);

  logNotificationPayload({ title, body, data, raw, messageText }, codes);

  const notification = new Notification({
    title: displayTitle,
    body: displayBody,
    ...(displaySubtitle ? { subtitle: displaySubtitle } : {}),
    silent: silent ?? false,
    closeButtonText: 'Dismiss',
    ...(isCodeMessage
      ? { actions }
      : {
          hasReply: true,
          replyPlaceholder: 'Reply…',
          actions,
        }),
  });

  let actionHandled = false;
  let replyHandled = false;
  const clearExpiry = attachExpiryTimer(notification, isCodeMessage);

  notification.on('click', () => {
    if (actionHandled || replyHandled) {
      return;
    }

    clearExpiry();
    notification.close();
    onNotificationClick(conversationMeta);
  });

  notification.on('reply', (_event, replyText) => {
    if (isCodeMessage) {
      return;
    }

    replyHandled = true;
    clearExpiry();

    const trimmed = String(replyText || '').trim();
    if (trimmed) {
      onNotificationReply({ ...conversationMeta, replyText: trimmed });
    }

    notification.close();
  });

  notification.on('action', (event, index) => {
    actionHandled = true;
    clearExpiry();
    suppressForeground();

    const actionIndex = getActionIndex(event, index);
    const actionText = actions[actionIndex]?.text;

    if (actionText === 'Copy Code' && primaryCode) {
      copyCode(primaryCode);
      dismissNotificationGroup({ sender, conversationUrl: conversationMeta.conversationUrl });
      dismissNotification(notification);
      onNotificationMarkAsRead({ ...conversationMeta, body: bodyText });
      return;
    }

    if (actionText === 'Mark Read') {
      dismissNotification(notification);
      onNotificationMarkAsRead({ ...conversationMeta, body: bodyText });
      return;
    }

    dismissNotification(notification);
  });

  notification.on('failed', (_event, error) => {
    console.error('[Messages] Notification failed:', error);
    logNotificationPayload({ title, body, data, raw, messageText, failed: String(error) }, codes);
  });

  notification.on('show', () => {
    onNotificationShown();
    console.log('[Messages] Notification shown:', {
      type: isCodeMessage ? 'verification' : 'regular',
      display: isCodeMessage ? 'code-copy-only' : 'message-with-reply-and-mark-read',
      sender: contactTitle,
      displayTitle,
      displaySubtitle: displaySubtitle || null,
      groupKey,
      messageCount,
      body: displayBody,
      originalBody: isCodeMessage ? bodyText : undefined,
      codes,
      actions: actions.map((action) => action.text),
      hasReply: !isCodeMessage,
      closeButtonText: 'Dismiss',
    });
  });

  notification.on('close', () => {
    clearExpiry();
    removeFromGroupRegistry(groupKey, notification);
  });

  activeByGroup.set(groupKey, { notification, count: messageCount });
  notification.show();

  return notification;
}

module.exports = {
  showMessageNotification,
  dismissNotificationGroup,
  setOnCopyCodeCallback,
  setSuppressForegroundCallback,
  setOnNotificationShownCallback,
  setOnNotificationClickCallback,
  setOnNotificationReplyCallback,
  setOnNotificationMarkAsReadCallback,
  setFocusWindowCallback,
};
