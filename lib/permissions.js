const fs = require('fs');
const path = require('path');
const { app, Notification, dialog } = require('electron');

const PERMISSION_FILE = 'notification-permission.json';

function getPermissionStorePath() {
  return path.join(app.getPath('userData'), PERMISSION_FILE);
}

function readPermissionState() {
  try {
    const raw = fs.readFileSync(getPermissionStorePath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return { prompted: false, granted: false };
  }
}

function writePermissionState(state) {
  fs.writeFileSync(getPermissionStorePath(), JSON.stringify(state));
}

function requestMacNotificationPermission(mainWindow) {
  const state = readPermissionState();
  if (state.prompted) {
    return Promise.resolve(state.granted ? 'granted' : 'denied');
  }

  if (!Notification.isSupported()) {
    writePermissionState({ prompted: true, granted: false });
    return Promise.resolve('denied');
  }

  return dialog.showMessageBox(mainWindow ?? undefined, {
    type: 'question',
    buttons: ['Enable Notifications', 'Not Now'],
    defaultId: 0,
    cancelId: 1,
    title: 'Messages',
    message: 'Turn on notifications for Messages?',
    detail: 'Get alerts for incoming texts in Notification Center.\n\nRegular messages appear briefly as banners, then move to Notification Center.\n\nFor verification codes, set System Settings → Notifications → Messages → Alerts (not Banners) so Copy Code stays visible longer.',
  }).then(({ response }) => {
    if (response !== 0) {
      writePermissionState({ prompted: true, granted: false });
      return 'denied';
    }

    return new Promise((resolve) => {
      const notification = new Notification({
        title: 'Messages',
        body: 'Notifications are enabled.',
      });

      let settled = false;
      const finish = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        const granted = result === 'granted';
        writePermissionState({ prompted: true, granted });
        resolve(granted ? 'granted' : 'denied');
      };

      notification.on('show', () => finish('granted'));
      notification.on('failed', () => finish('denied'));
      notification.show();

      setTimeout(() => finish('granted'), 4000);
    });
  });
}

module.exports = {
  readPermissionState,
  requestMacNotificationPermission,
};
