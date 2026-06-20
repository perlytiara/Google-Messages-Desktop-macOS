const PRIORITY_PATTERNS = [
  /(?:your|our|the)\s+verification\s+message\s+is\s+([A-Z]?-?\d{4,8})/i,
  /(?:your|our|the)\s+verification\s+code\s+is\s*[:\s]*([A-Z]?-?\d{4,8})/i,
  /(?:verification\s+message|verification\s+code)\D{0,16}(\d{4,8})/i,
  /G[\-\u2010\u2011\u2012\u2013\u2014\u2212](\d{6})/i,
  /\b(\d{6})\s+is\s+your\b[\w\s]*(?:Google\s+)?verification/i,
  /\*\*(\d{4,8})\*\*/,
  /\b(\d{4,8})\s+is\s+your\b[\w\s]*verification\s+code/i,
];

function normalizeText(text) {
  return String(text || '')
    .replace(/\u200b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCopyCode(code, fullMatch) {
  if (!code) {
    return null;
  }

  const gPrefix = /^G[\-\u2010\u2011\u2012\u2013\u2014\u2212]?(\d{6})$/i.exec(code);
  if (gPrefix) {
    return gPrefix[1];
  }

  if (/^\d+$/.test(code)) {
    return code;
  }

  if (/^[A-Z]\d{4,8}$/i.test(code)) {
    return code;
  }

  const fromGInMatch = /G[\-\u2010\u2011\u2012\u2013\u2014\u2212](\d{6})/i.exec(fullMatch || '');
  if (fromGInMatch) {
    return fromGInMatch[1];
  }

  return code.replace(/[^\dA-Za-z-]/g, '') || code;
}

const VERIFICATION_HINT = /(?:your|our|the)\s+verification|verification\s+(?:message|code)|G[\-\u2010\u2011\u2012\u2013\u2014\u2212]\d{6}|Google\s+verification|\b\d{6}\s+is\s+your\b/i;

function isVerificationMessage(text) {
  return VERIFICATION_HINT.test(normalizeText(text));
}

function extractOtp(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }

  for (const pattern of PRIORITY_PATTERNS) {
    const match = pattern.exec(normalized);
    if (match?.[1]) {
      return normalizeCopyCode(match[1], match[0]);
    }
  }

  const letterPrefixed = /(?:verification\s+message\s+is\s+)([A-Z]\d{4,8})/i.exec(normalized);
  if (letterPrefixed?.[1]) {
    return letterPrefixed[1];
  }

  return null;
}

function extractAllOtps(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }

  const seen = new Set();
  const results = [];

  const primary = extractOtp(normalized);
  if (primary) {
    seen.add(primary);
    results.push(primary);
  }

  for (const match of normalized.matchAll(/(?:your|our|the)\s+verification\s+message\s+is\s+([A-Z]?\d{4,8})/gi)) {
    const code = normalizeCopyCode(match[1], match[0]);
    if (code && !seen.has(code)) {
      seen.add(code);
      results.push(code);
    }
  }

  for (const match of normalized.matchAll(/G[\-\u2010\u2011\u2012\u2013\u2014\u2212](\d{6})/gi)) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      results.push(match[1]);
    }
  }

  return results;
}

module.exports = {
  extractOtp,
  extractAllOtps,
  isVerificationMessage,
  normalizeCopyCode,
  normalizeText,
};
