const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const BASELINE_FILE = 'watcher-baseline.json';

function getBaselinePath() {
  return path.join(app.getPath('userData'), BASELINE_FILE);
}

function readPersistedBaselines() {
  try {
    const raw = fs.readFileSync(getBaselinePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return new Map();
    }

    return new Map(
      Object.entries(parsed)
        .map(([key, value]) => [key, String(value || '').trim()])
        .filter(([, value]) => value),
    );
  } catch {
    return new Map();
  }
}

function writePersistedBaselines(snippetByConversation) {
  try {
    const payload = Object.fromEntries(snippetByConversation.entries());
    fs.writeFileSync(getBaselinePath(), JSON.stringify(payload, null, 2));
  } catch (error) {
    console.warn('[Messages] Could not persist watcher baseline:', error.message);
  }
}

module.exports = {
  readPersistedBaselines,
  writePersistedBaselines,
  getBaselinePath,
};
