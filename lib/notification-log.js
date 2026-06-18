const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function getLogPath() {
  return path.join(app.getPath('userData'), 'last-notification.json');
}

function getIncomingLogPath() {
  return path.join(app.getPath('userData'), 'incoming-log.jsonl');
}

function logNotificationPayload(payload, codes) {
  try {
    fs.writeFileSync(
      getLogPath(),
      `${JSON.stringify({ at: new Date().toISOString(), payload, codes }, null, 2)}\n`,
    );
  } catch (error) {
    console.error('[Messages] Failed to log notification payload:', error);
  }
}

function logIncomingPayload(payload) {
  try {
    fs.appendFileSync(
      getIncomingLogPath(),
      `${JSON.stringify({ at: new Date().toISOString(), payload })}\n`,
    );
  } catch (error) {
    console.error('[Messages] Failed to log incoming payload:', error);
  }
}

function readLastNotificationLog() {
  try {
    return JSON.parse(fs.readFileSync(getLogPath(), 'utf8'));
  } catch {
    return null;
  }
}

module.exports = { logNotificationPayload, logIncomingPayload, readLastNotificationLog };
