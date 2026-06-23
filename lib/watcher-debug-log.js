const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function getLogPath() {
  return path.join(app.getPath('userData'), 'watcher-debug.jsonl');
}

function logWatcherEvent(event, data = {}) {
  try {
    fs.appendFileSync(
      getLogPath(),
      `${JSON.stringify({ at: new Date().toISOString(), event, ...data })}\n`,
    );
  } catch (error) {
    console.error('[Messages] Watcher debug log failed:', error.message);
  }
}

function readLastWatcherEvents(limit = 10) {
  try {
    const lines = fs.readFileSync(getLogPath(), 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

module.exports = { logWatcherEvent, readLastWatcherEvents, getLogPath };
