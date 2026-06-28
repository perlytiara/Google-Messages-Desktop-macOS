const PRIORITY_PATTERNS = [
  // English
  /(?:your|our|the)\s+verification\s+message\s+is\s+([A-Z]?-?\d{4,8})/i,
  /(?:your|our|the)\s+verification\s+code\s+is\s*[:\s]*([A-Z]?-?\d{4,8})/i,
  /(?:verification\s+message|verification\s+code)\D{0,16}(\d{4,8})/i,
  /\b(\d{4,8})\s+is\s+your\b[\w\s]*(?:Google\s+)?verification/i,
  /\b(\d{4,8})\s+is\s+your\b[\w\s]*verification\s+code/i,

  // French — "Votre code de vérification 3Deval est: 366017"
  /(?:votre|notre)\s+code\s+(?:de\s+)?v[ée]rification\s+[\w.-]+\s+est\s*[:\s]+(\d{4,8})/i,
  // French — "Votre code Tinder est 164179"
  /(?:votre|notre)\s+code\s+(?!de\s+v[ée]rification)[^\d]{1,48}?\s+est\s*[:\s]+(\d{4,8})/i,
  // French — "le code est 239159"
  /\ble\s+code\s+est\s*[:\s]+(\d{4,8})/i,
  // French — trailing "est: 123456" after verification wording
  /(?:v[ée]rification|confirmation|s[ée]curit[ée])[^0-9]{0,40}est\s*[:\s]+(\d{4,8})/i,

  // Spanish
  /(?:su|tu)\s+c[óo]digo\s+(?:de\s+)?verificaci[óo]n\s*(?:es|:)\s*(\d{4,8})/i,
  /(?:su|tu)\s+c[óo]digo\s+(?:de\s+)?confirmaci[óo]n\s*(?:es|:)\s*(\d{4,8})/i,

  // German
  /(?:ihr|dein(?:e)?)\s+(?:best[äa]tigungs|verifizierungs)?code\s*(?:ist|:)\s*(\d{4,8})/i,

  // Italian
  /(?:il\s+)?(?:tuo|vostro)\s+codice\s+(?:di\s+)?verifica\s*(?:[èe]|is|:)\s*(\d{4,8})/i,

  // Portuguese
  /(?:seu|teu)\s+c[óo]digo\s+(?:de\s+)?verifica[çc][ãa]o\s*(?:[ée]|is|:)\s*(\d{4,8})/i,

  // Google / common
  /G[\-\u2010\u2011\u2012\u2013\u2014\u2212](\d{6})/i,
  /\*\*(\d{4,8})\*\*/,
];

const VERIFICATION_HINT = new RegExp([
  // English
  String.raw`(?:your|our|the)\s+verification`,
  String.raw`verification\s+(?:message|code)`,
  String.raw`Google\s+verification`,
  String.raw`\b\d{4,8}\s+is\s+your\b`,

  // French
  String.raw`(?:votre|notre|le)\s+code`,
  String.raw`code\s+(?:de\s+)?v[ée]rification`,
  String.raw`v[ée]rification`,
  String.raw`\ble\s+code\s+est\b`,

  // Spanish
  String.raw`c[óo]digo\s+(?:de\s+)?verificaci[óo]n`,
  String.raw`c[óo]digo\s+(?:de\s+)?confirmaci[óo]n`,

  // German
  String.raw`best[äa]tigungscode`,
  String.raw`verifizierungscode`,

  // Italian / Portuguese
  String.raw`codice\s+(?:di\s+)?verifica`,
  String.raw`c[óo]digo\s+(?:de\s+)?verifica`,

  // Google format
  String.raw`G[\-\u2010\u2011\u2012\u2013\u2014\u2212]\d{6}`,
].join('|'), 'i');

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

function isVerificationMessage(text) {
  return VERIFICATION_HINT.test(normalizeText(text));
}

function isLikelySecurityCode(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  if (isVerificationMessage(normalized)) {
    return true;
  }

  return /\ble\s+code\s+est\b/i.test(normalized)
    || /\b(?:one[- ]time|security|confirmation|verification|otp|pin|passcode)\b/i.test(normalized)
    || /\b(?:votre|notre|your|the)\s+code\b/i.test(normalized);
}

function extractCodeSubtitle(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return '';
  }

  const quotedPurpose = /(?:pour|for)\s+"([^"]+)"/i.exec(normalized);
  if (quotedPurpose?.[1]) {
    return quotedPurpose[1];
  }

  const brandedFrench = /code\s+(?:de\s+)?v[ée]rification\s+([\w.-]+)\s+est/i.exec(normalized);
  if (brandedFrench?.[1]) {
    return brandedFrench[1];
  }

  const bankPrefix = /^([\w.-]+)\s*:/.exec(normalized);
  if (bankPrefix?.[1] && isLikelySecurityCode(normalized)) {
    return bankPrefix[1];
  }

  return 'Verification code';
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

  if (isVerificationMessage(normalized)) {
    const hashTag = /#(\d{4,8})\b/.exec(normalized);
    if (hashTag?.[1]) {
      return hashTag[1];
    }

    const trailingDigits = /(?:est|is|ist|es|[èe])\s*[:\s]+(\d{4,8})\b/i.exec(normalized);
    if (trailingDigits?.[1]) {
      return trailingDigits[1];
    }
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

  function add(code, fullMatch) {
    const normalizedCode = normalizeCopyCode(code, fullMatch);
    if (normalizedCode && !seen.has(normalizedCode)) {
      seen.add(normalizedCode);
      results.push(normalizedCode);
    }
  }

  for (const pattern of PRIORITY_PATTERNS) {
    const match = pattern.exec(normalized);
    if (match?.[1]) {
      add(match[1], match[0]);
    }
  }

  const primary = extractOtp(normalized);
  if (primary) {
    add(primary, normalized);
  }

  for (const match of normalized.matchAll(/(?:your|our|the)\s+verification\s+message\s+is\s+([A-Z]?\d{4,8})/gi)) {
    add(match[1], match[0]);
  }

  for (const match of normalized.matchAll(/G[\-\u2010\u2011\u2012\u2013\u2014\u2212](\d{6})/gi)) {
    add(match[1], match[0]);
  }

  if (isVerificationMessage(normalized)) {
    for (const match of normalized.matchAll(/#(\d{4,8})\b/g)) {
      add(match[1], match[0]);
    }
  }

  return results;
}

module.exports = {
  extractOtp,
  extractAllOtps,
  isVerificationMessage,
  isLikelySecurityCode,
  extractCodeSubtitle,
  normalizeCopyCode,
  normalizeText,
  PRIORITY_PATTERNS,
  VERIFICATION_HINT,
};
