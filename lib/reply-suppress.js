function conversationIdFromUrl(url) {
  const match = String(url || '').match(/\/conversations\/([^/?#]+)/);
  return match ? match[1] : '';
}

function normalizeBody(body) {
  return String(body || '').replace(/\s+/g, ' ').trim();
}

function isOutgoingSnippet(body) {
  return /^(you|vous|moi)\s*:/i.test(normalizeBody(body));
}

function stripOutgoingPrefix(body) {
  return normalizeBody(body).replace(/^(you|vous|moi)\s*:\s*/i, '').trim();
}

/** @type {Map<string, { replyText: string, until: number }>} */
const suppressByConversation = new Map();

const SUPPRESS_MS = 2 * 60 * 1000;

function registerReplySuppression({ conversationUrl, replyText, durationMs = SUPPRESS_MS }) {
  const conversationId = conversationIdFromUrl(conversationUrl);
  const text = normalizeBody(replyText);
  if (!conversationId || !text) {
    return;
  }

  suppressByConversation.set(conversationId, {
    replyText: text,
    until: Date.now() + durationMs,
  });
}

function clearExpired() {
  const now = Date.now();
  for (const [id, entry] of suppressByConversation.entries()) {
    if (!entry || entry.until <= now) {
      suppressByConversation.delete(id);
    }
  }
}

function getSuppression(conversationUrl) {
  clearExpired();
  const conversationId = conversationIdFromUrl(conversationUrl);
  if (!conversationId) {
    return null;
  }

  const entry = suppressByConversation.get(conversationId);
  if (!entry || entry.until <= Date.now()) {
    suppressByConversation.delete(conversationId);
    return null;
  }

  return entry;
}

function shouldSuppressReplyEcho({ conversationUrl, body, outgoing = false }) {
  const entry = getSuppression(conversationUrl);
  if (!entry) {
    return false;
  }

  const rawBody = normalizeBody(body);
  if (!rawBody) {
    return false;
  }

  const isOutgoing = outgoing || isOutgoingSnippet(rawBody);
  if (isOutgoing) {
    return true;
  }

  const stripped = stripOutgoingPrefix(rawBody);
  if (stripped === entry.replyText || rawBody === entry.replyText) {
    return true;
  }

  return false;
}

function clearReplySuppression(conversationUrl) {
  const conversationId = conversationIdFromUrl(conversationUrl);
  if (conversationId) {
    suppressByConversation.delete(conversationId);
  }
}

module.exports = {
  registerReplySuppression,
  shouldSuppressReplyEcho,
  clearReplySuppression,
  conversationIdFromUrl,
  isOutgoingSnippet,
};
