/**
 * macOS activates the app when a notification button is clicked. We cannot
 * prevent that, but we can (1) avoid showing our window if it was closed and
 * (2) return keyboard focus to the app the user was in before.
 *
 * Never call app.hide() — that makes the whole app vanish from the Dock.
 */

const { execFileSync } = require('child_process');
const { app } = require('electron');

let mainWindow = null;
let runningInBackground = false;
let pendingActivateShow = null;
let replyInProgress = false;
let notificationInteractionUntil = 0;

function setReplyInProgress(value) {
  replyInProgress = Boolean(value);
  if (replyInProgress) {
    notificationInteractionUntil = Date.now() + 20000;
    clearPendingActivateShow();
  }
}

function isReplyInProgress() {
  return replyInProgress;
}
let lastExternalFrontApp = null;
let frontAppPoll = null;

const ACTIVATE_DEFER_MS = 600;
const NOTIFICATION_SUPPRESS_MS = 4000;
const OWN_APP_NAMES = new Set(['Messages']);

function attachMainWindow(window) {
  mainWindow = window;
  if (app.name) {
    OWN_APP_NAMES.add(app.name);
  }
}

function isOwnApp(name) {
  return !name || OWN_APP_NAMES.has(name);
}

function isWindowHidden() {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible());
}

function suppressActivateDuringReply(durationMs = 10000) {
  notificationInteractionUntil = Date.now() + durationMs;
  clearPendingActivateShow();
}

function prepareWindowForBackgroundReply() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { wasHidden: false };
  }

  const wasHidden = !mainWindow.isVisible();

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
    if (wasHidden) {
      mainWindow.hide();
    }
  }

  return { wasHidden };
}

function finishBackgroundReply({ wasHidden }) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (wasHidden || runningInBackground) {
    hideMainWindowOnly();
  }
}

function captureFrontApp() {
  if (process.platform !== 'darwin') {
    return;
  }

  try {
    const name = execFileSync(
      'osascript',
      ['-e', 'tell application "System Events" to return name of first application process whose frontmost is true'],
      { encoding: 'utf8' },
    ).trim();

    if (!isOwnApp(name)) {
      lastExternalFrontApp = name;
    }
  } catch {
    // Accessibility may block this; restore becomes a no-op.
  }
}

function activateApplication(name) {
  if (!name || isOwnApp(name)) {
    return;
  }

  try {
    execFileSync('open', ['-a', name]);
    return;
  } catch {
    // Fall through to AppleScript.
  }

  const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  try {
    execFileSync('osascript', ['-e', `tell application "${escaped}" to activate`]);
  } catch {
    try {
      execFileSync(
        'osascript',
        ['-e', `tell application "System Events" to tell process "${escaped}" to set frontmost to true`],
      );
    } catch {
      // Best effort only.
    }
  }
}

function restoreFrontApp() {
  if (process.platform !== 'darwin' || !lastExternalFrontApp) {
    return;
  }

  const target = lastExternalFrontApp;
  for (const delay of [0, 120, 350]) {
    setTimeout(() => activateApplication(target), delay);
  }
}

function keepWindowClosedIfBackground() {
  if (replyInProgress) {
    return;
  }

  if (runningInBackground || isWindowHidden()) {
    hideMainWindowOnly();
  }
}

function revealMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
  runningInBackground = false;
  return true;
}

function setRunningInBackground(value) {
  runningInBackground = value;

  if (value && process.platform === 'darwin') {
    captureFrontApp();
    if (!frontAppPoll) {
      frontAppPoll = setInterval(captureFrontApp, 1000);
    }
    return;
  }

  if (frontAppPoll) {
    clearInterval(frontAppPoll);
    frontAppPoll = null;
  }
}

function clearPendingActivateShow() {
  if (pendingActivateShow) {
    clearTimeout(pendingActivateShow);
    pendingActivateShow = null;
  }
}

function hideMainWindowOnly() {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.hide();
  }
}

function isNotificationInteractionActive() {
  return Date.now() < notificationInteractionUntil;
}

function handleNotificationInteraction() {
  notificationInteractionUntil = Date.now() + NOTIFICATION_SUPPRESS_MS;
  clearPendingActivateShow();
  keepWindowClosedIfBackground();
  restoreFrontApp();
}

let openedFromNotificationUntil = 0;

function handleNotificationOpen() {
  openedFromNotificationUntil = Date.now() + 5000;
  notificationInteractionUntil = 0;
  clearPendingActivateShow();
  revealMainWindow();
}

function handleAppActivate({ createMainWindow }) {
  if (Date.now() < openedFromNotificationUntil) {
    if (!revealMainWindow()) {
      createMainWindow();
    }
    return;
  }

  if (isNotificationInteractionActive()) {
    keepWindowClosedIfBackground();
    restoreFrontApp();
    return;
  }

  clearPendingActivateShow();

  pendingActivateShow = setTimeout(() => {
    pendingActivateShow = null;

    if (isNotificationInteractionActive()) {
      keepWindowClosedIfBackground();
      restoreFrontApp();
      return;
    }

    if (!revealMainWindow()) {
      createMainWindow();
    }
  }, ACTIVATE_DEFER_MS);
}

module.exports = {
  attachMainWindow,
  setRunningInBackground,
  setReplyInProgress,
  isReplyInProgress,
  captureFrontApp,
  restoreFrontApp,
  suppressActivateDuringReply,
  prepareWindowForBackgroundReply,
  finishBackgroundReply,
  handleNotificationInteraction,
  handleNotificationOpen,
  handleAppActivate,
  revealMainWindow,
};
