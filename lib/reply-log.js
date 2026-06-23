const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function getReplyLogPath() {
  return path.join(app.getPath('userData'), 'reply-log.jsonl');
}

function logReplyEvent(event, data = {}) {
  try {
    fs.appendFileSync(
      getReplyLogPath(),
      `${JSON.stringify({ at: new Date().toISOString(), event, ...data })}\n`,
    );
  } catch (error) {
    console.error('[Messages] Failed to log reply event:', error.message);
  }
}

function readLastReplyLog(limit = 10) {
  try {
    const lines = fs.readFileSync(getReplyLogPath(), 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

module.exports = { logReplyEvent, readLastReplyLog };
