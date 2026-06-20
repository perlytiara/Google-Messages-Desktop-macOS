const {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  session,
  Menu,
  dialog,
} = require('electron');
const path = require('path');
const { execFileSync } = require('child_process');
const { showMessageNotification, setSuppressForegroundCallback, setOnNotificationShownCallback, setOnNotificationClickCallback } = require('./lib/notifications');
const {
  attachMainWindow,
  setRunningInBackground,
  captureFrontApp,
  handleNotificationInteraction,
  handleNotificationOpen,
  handleAppActivate,
} = require('./lib/notification-foreground');
const { openConversation } = require('./lib/open-conversation');
const { requestMacNotificationPermission, readPermissionState } = require('./lib/permissions');
const { setupServiceWorkerNotificationBridge } = require('./lib/service-worker-bridge');
const { setupMessageWatcher } = require('./lib/message-watcher');
const { readLastNotificationLog, logIncomingPayload } = require('./lib/notification-log');
const {
  REGULAR_SCENARIO,
  VERIFICATION_FORMATS,
  TEST_SCENARIOS,
  simulateNotification,
  simulateServiceWorkerMessage,
} = require('./lib/test-notifications');
const { SMS_TEMPLATES, openConfig, sendTestSms, loadConfig, getFromSender } = require('./lib/test-sms');

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

let mainWindow;
let messagesSession;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Messages',
    icon: path.join(__dirname, 'assets', 'google-messages-icon.icns'),
    backgroundColor: '#1a1a1a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      partition: 'persist:messages',
      backgroundThrottling: false,
    },
  });

  mainWindow.webContents.setBackgroundThrottling(false);
  mainWindow.loadURL('https://messages.google.com/web/conversations');

  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error('[Messages] Page failed to load:', code, description, url);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
      setRunningInBackground(true);
    }
  });

  mainWindow.on('show', () => {
    setRunningInBackground(false);
  });

  mainWindow.on('blur', () => {
    captureFrontApp();
  });

  attachMainWindow(mainWindow);
  setSuppressForegroundCallback(handleNotificationInteraction);
  setOnNotificationShownCallback(captureFrontApp);
  setOnNotificationClickCallback(handleNotificationClick);
  setupServiceWorkerNotificationBridge(mainWindow, messagesSession);
  setupMessageWatcher(mainWindow, (payload) => {
    handleIncomingNotification(null, payload);
  });
}

function handleIncomingNotification(_event, payload) {
  captureFrontApp();
  logIncomingPayload(payload);
  showMessageNotification(payload);
}

async function handleNotificationClick({ sender, conversationUrl, body }) {
  handleNotificationOpen();

  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const result = await openConversation(mainWindow, { sender, conversationUrl, body });
  if (!result.ok) {
    console.warn('[Messages] Could not open conversation:', result.reason || result, { sender, conversationUrl });
  }
}

function promptForTestMessage(defaultText) {
  const script = `text returned of (display dialog "Enter the SMS body to simulate:" default answer "${defaultText.replace(/"/g, '\\"')}" buttons {"Cancel", "Simulate"} default button "Simulate")`;

  try {
    return execFileSync('osascript', ['-e', script], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function runCustomSimulation() {
  const body = promptForTestMessage('Your verification message is 482913');
  if (!body) {
    return;
  }

  simulateServiceWorkerMessage(mainWindow, {
    title: 'Test SMS',
    body,
  });
}

function showTwilioHelp() {
  const config = loadConfig();
  shell.openExternal('https://console.twilio.com/us1/monitor/logs/sms');
  shell.openExternal('https://help.twilio.com/');

  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Twilio SMS help',
    message: 'See blocked or failed texts in your Twilio dashboard',
    detail: [
      'We did not change your Twilio account. The Messages app only calls Twilio’s API using your saved settings.',
      '',
      'Your setup:',
      `  FROM (sender): ${getFromSender(config)}`,
      `  TO (your personal phone):  ${config.toNumber || '(not set)'}`,
      '',
      'The sender is set to the alphanumeric ID TESTunit (not a phone number).',
      'Texts must go TO your personal phone (the one with Google Messages), not to the Twilio number.',
      '',
      'If Twilio shows "Message blocked", open Monitor → Logs → Messaging in the Twilio console (just opened in your browser) or contact Twilio Support.',
      '',
      'Config file:',
      '~/Library/Application Support/messages/test-sms.json',
    ].join('\n'),
  });
}

async function runTestSms(template) {
  const result = await sendTestSms(template.body);

  if (!result.ok) {
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Test SMS not delivered',
      message: 'Twilio could not deliver the text to your phone',
      detail: `${result.error}\n\nFrom: ${result.from || 'Twilio +1 number'}\nTo: ${result.to || 'your phone'}\n\nIf it says "Message blocked", Twilio or your carrier stopped it — not the Messages app. Wait and retry, or verify a US +1 phone in the Twilio console and set it as toNumber in test-sms.json.`,
    });
    return;
  }

  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Test SMS sent',
    message: `Delivered (${result.status || 'ok'}) — check your phone`,
    detail: `${template.body}\n\nFrom: ${result.from}\nTo: ${result.to}`,
  });
}

function setupApplicationMenu() {
  const isMac = process.platform === 'darwin';

  const testingSubmenu = [
    {
      label: 'Preview Regular Message (instant)',
      click: () => simulateNotification(REGULAR_SCENARIO.payload),
    },
    {
      label: 'Preview Verification Formats (instant)',
      submenu: VERIFICATION_FORMATS.map((scenario) => ({
        label: scenario.label,
        click: () => simulateNotification(scenario.payload),
      })),
    },
    { type: 'separator' },
    {
      label: 'Simulate Incoming SMS (Service Worker path)',
      submenu: TEST_SCENARIOS.map((scenario) => ({
        label: scenario.label,
        click: () => simulateServiceWorkerMessage(mainWindow, scenario.payload),
      })),
    },
    { type: 'separator' },
    {
      label: 'Custom Verification Message…',
      accelerator: 'CommandOrControl+Shift+T',
      click: () => runCustomSimulation(),
    },
    {
      label: 'Quick Test (direct notification)',
      click: () => simulateNotification({
        title: 'Google',
        body: 'Your verification message is 482913',
      }),
    },
    {
      label: 'Show Last Real Notification Payload',
      click: () => {
        const last = readLastNotificationLog();
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Last notification payload',
          message: last ? 'Most recent notification captured by Messages' : 'No notification logged yet',
          detail: last ? JSON.stringify(last, null, 2) : 'Trigger an SMS, then check again.',
        });
      },
    },
    { type: 'separator' },
    {
      label: 'Send Real SMS to My Phone',
      submenu: [
        {
          label: 'Regular message (no code)',
          click: () => runTestSms({
            label: 'Regular',
            body: 'Coffee tomorrow at 10? Let me know!',
          }),
        },
        { type: 'separator' },
        ...SMS_TEMPLATES.map((template) => ({
          label: template.label,
          click: () => runTestSms(template),
        })),
        { type: 'separator' },
        {
          label: 'Configure Test SMS Settings…',
          click: () => {
            const configPath = openConfig();
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Test SMS settings',
              message: 'Edit your Twilio settings file',
              detail: `File opened:\n${configPath}\n\nFrom (sender): ${getFromSender(loadConfig())} — alphanumeric TESTunit or E.164 phone\nTo (your phone): set toNumber to the phone that receives texts / runs Google Messages.`,
            });
          },
        },
        {
          label: 'Twilio Help — view message logs',
          click: () => showTwilioHelp(),
        },
      ],
    },
  ];

  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { label: 'Testing', submenu: testingSubmenu },
    { role: 'windowMenu' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  messagesSession = session.fromPartition('persist:messages');

  messagesSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'notifications') {
      callback(false);
      return;
    }

    callback(true);
  });

  messagesSession.setPermissionCheckHandler((_webContents, permission) => {
    if (permission === 'notifications') {
      return false;
    }

    return true;
  });

  ipcMain.on('notification:incoming', handleIncomingNotification);

  ipcMain.handle('notification:request-permission', async () => {
    const status = await requestMacNotificationPermission(mainWindow);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('notification:permission-changed', status);
    }
    return status;
  });

  setupApplicationMenu();
  createMainWindow();

  mainWindow.webContents.once('did-finish-load', async () => {
    if (readPermissionState().prompted) {
      return;
    }

    const status = await requestMacNotificationPermission(mainWindow);
    mainWindow.webContents.send('notification:permission-changed', status);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  handleAppActivate({ createMainWindow });
});

app.on('before-quit', () => {
  app.isQuiting = true;
});
