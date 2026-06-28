const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_DELAY_MS = 8 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let mainWindowRef = null;
let updateWindow = null;
let pendingVersion = null;
let manualCheck = false;
let checkTimer = null;

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowDowngrade = false;

function isUpdaterEnabled() {
  return app.isPackaged && !process.argv.includes('--skip-updater');
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** power);
  return `${value.toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
}

function setMainWindow(window) {
  mainWindowRef = window;
}

function reportProgress(progress) {
  const percent = Math.max(0, Math.min(100, progress?.percent || 0));
  const fraction = percent / 100;

  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.setProgressBar(fraction);
  }

  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.setProgressBar(fraction);
    updateWindow.webContents.send('update:progress', {
      percent,
      transferred: progress?.transferred || 0,
      total: progress?.total || 0,
      bytesPerSecond: progress?.bytesPerSecond || 0,
      version: pendingVersion,
    });
  }

  if (process.platform === 'darwin' && app.dock) {
    if (percent > 0 && percent < 100) {
      app.dock.setBadge(`${Math.round(percent)}%`);
    } else {
      app.dock.setBadge('');
    }
  }
}

function clearProgress() {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.setProgressBar(-1);
  }

  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.setProgressBar(-1);
  }

  if (process.platform === 'darwin' && app.dock) {
    app.dock.setBadge('');
  }
}

function closeUpdateWindow() {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.close();
  }
  updateWindow = null;
}

function ensureUpdateWindow() {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.show();
    return updateWindow;
  }

  updateWindow = new BrowserWindow({
    width: 420,
    height: 168,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Downloading Update',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: require('path').join(__dirname, '..', 'preload-update.js'),
    },
  });

  updateWindow.loadFile(require('path').join(__dirname, '..', 'assets', 'update-progress.html'));
  updateWindow.on('closed', () => {
    updateWindow = null;
  });

  updateWindow.once('ready-to-show', () => {
    if (updateWindow && !updateWindow.isDestroyed()) {
      updateWindow.show();
    }
  });

  return updateWindow;
}

async function promptInstall(version) {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'Update ready',
    message: `Messages ${version} has finished downloading.`,
    detail: 'Restart now to install the update. Your conversations will reload after restart.',
    buttons: ['Restart and Install', 'Install on Quit', 'Later'],
    defaultId: 0,
    cancelId: 2,
  });

  if (response === 0) {
    app.isQuiting = true;
    autoUpdater.quitAndInstall(false, true);
    return;
  }

  if (response === 1) {
    autoUpdater.autoInstallOnAppQuit = true;
    await dialog.showMessageBox({
      type: 'info',
      title: 'Update scheduled',
      message: 'The update will install the next time you quit Messages.',
      buttons: ['OK'],
    });
  }
}

async function showNoUpdateDialog() {
  if (!manualCheck) {
    return;
  }

  await dialog.showMessageBox({
    type: 'info',
    title: 'No updates',
    message: `Messages ${app.getVersion()} is up to date.`,
    buttons: ['OK'],
  });
}

async function showErrorDialog(error) {
  if (!manualCheck) {
    console.error('[Messages] Update error:', error);
    return;
  }

  await dialog.showMessageBox({
    type: 'warning',
    title: 'Update check failed',
    message: 'Could not check for updates right now.',
    detail: String(error?.message || error || 'Unknown error'),
    buttons: ['OK'],
  });
}

function wireAutoUpdaterEvents() {
  autoUpdater.on('checking-for-update', () => {
    console.log('[Messages] Checking for updates…');
  });

  autoUpdater.on('update-available', (info) => {
    pendingVersion = info.version;
    console.log('[Messages] Update available:', info.version);
    ensureUpdateWindow();
    if (updateWindow && !updateWindow.isDestroyed()) {
      updateWindow.webContents.send('update:available', {
        version: info.version,
        currentVersion: app.getVersion(),
      });
    }
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Messages] No update available.');
    closeUpdateWindow();
    clearProgress();
    showNoUpdateDialog().finally(() => {
      manualCheck = false;
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    reportProgress(progress);
  });

  autoUpdater.on('update-downloaded', (info) => {
    pendingVersion = info.version;
    clearProgress();
    closeUpdateWindow();
    promptInstall(info.version).finally(() => {
      manualCheck = false;
    });
  });

  autoUpdater.on('error', (error) => {
    clearProgress();
    closeUpdateWindow();
    showErrorDialog(error).finally(() => {
      manualCheck = false;
    });
  });
}

async function checkForUpdates({ manual = false } = {}) {
  if (!isUpdaterEnabled()) {
    if (manual) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'Updates unavailable',
        message: 'Automatic updates run in the installed Messages.app from /Applications.',
        detail: 'Build and install with npm run install:app, or download the latest release from GitHub.',
        buttons: ['OK'],
      });
    }
    return null;
  }

  manualCheck = manual;

  try {
    return await autoUpdater.checkForUpdates();
  } catch (error) {
    await showErrorDialog(error);
    manualCheck = false;
    return null;
  }
}

function scheduleAutomaticChecks() {
  if (!isUpdaterEnabled()) {
    return;
  }

  setTimeout(() => {
    checkForUpdates({ manual: false });
  }, CHECK_DELAY_MS);

  checkTimer = setInterval(() => {
    checkForUpdates({ manual: false });
  }, CHECK_INTERVAL_MS);
}

function setupAutoUpdater(mainWindow) {
  if (!isUpdaterEnabled()) {
    return;
  }

  setMainWindow(mainWindow);
  wireAutoUpdaterEvents();
  scheduleAutomaticChecks();

  ipcMain.handle('update:get-status', () => ({
    currentVersion: app.getVersion(),
    pendingVersion,
    enabled: isUpdaterEnabled(),
  }));
}

module.exports = {
  setupAutoUpdater,
  checkForUpdates,
  setMainWindow,
  isUpdaterEnabled,
};
