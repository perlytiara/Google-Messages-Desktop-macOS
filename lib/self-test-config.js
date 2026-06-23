const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');

const CONFIG_FILE = 'self-test.json';

const DEFAULT_CONFIG = {
  notifyOutgoing: true,
  numbers: [],
};

function ensureSelfTestConfig() {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    return readSelfTestConfig();
  }

  return writeSelfTestConfig({
    notifyOutgoing: true,
    numbers: ['+1 555 000 0001'],
  });
}

function getConfigPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length >= 10) {
    digits = `33${digits.slice(1)}`;
  }
  return digits;
}

function phonesMatch(a, b) {
  const left = normalizePhone(a);
  const right = normalizePhone(b);
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  return left.slice(-9) === right.slice(-9);
}

function readSelfTestConfig() {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf8');
    const parsed = JSON.parse(raw);
    const notifyOutgoing = parsed.notifyOutgoing !== false
      && parsed.enabled !== false;

    return {
      notifyOutgoing,
      numbers: Array.isArray(parsed.numbers)
        ? parsed.numbers.map((entry) => String(entry || '').trim()).filter(Boolean)
        : [],
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeSelfTestConfig(config) {
  const next = {
    notifyOutgoing: config.notifyOutgoing !== false,
    numbers: Array.isArray(config.numbers)
      ? config.numbers.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [],
  };
  fs.writeFileSync(getConfigPath(), JSON.stringify(next, null, 2));
  return next;
}

function openSelfTestConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    writeSelfTestConfig(DEFAULT_CONFIG);
  }
  shell.openPath(configPath);
  return configPath;
}

module.exports = {
  readSelfTestConfig,
  writeSelfTestConfig,
  openSelfTestConfig,
  ensureSelfTestConfig,
  normalizePhone,
  phonesMatch,
  getConfigPath,
};
