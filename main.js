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
const {
  showMessageNotification,
  dismissNotificationGroup,
  setSuppressForegroundCallback,
  setOnNotificationShownCallback,
  setOnNotificationClickCallback,
  setOnNotificationReplyCallback,
  setOnNotificationMarkAsReadCallback,
} = require('./lib/notifications');
const {
  attachMainWindow,
  setRunningInBackground,
  captureFrontApp,
  restoreFrontApp,
  suppressActivateDuringReply,
  prepareWindowForBackgroundReply,
  finishBackgroundReply,
  setReplyInProgress,
  handleNotificationInteraction,
  handleNotificationOpen,
  handleAppActivate,
} = require('./lib/notification-foreground');
const { openConversation } = require('./lib/open-conversation');
const { sendReply } = require('./lib/send-reply');
const { markAsRead } = require('./lib/mark-as-read');
const { logReplyEvent, readLastReplyLog } = require('./lib/reply-log');
const { requestMacNotificationPermission, readPermissionState } = require('./lib/permissions');
const { setupServiceWorkerNotificationBridge } = require('./lib/service-worker-bridge');
const { setupMessageWatcher } = require('./lib/message-watcher');
const { readLastNotificationLog, logIncomingPayload } = require('./lib/notification-log');
const {
  REGULAR_SCENARIO,
  GROUPED_SCENARIO,
  SPACED_TEST_SCENARIO,
  VERIFICATION_FORMATS,
  TEST_SCENARIOS,
  simulateNotification,
  simulateServiceWorkerMessage,
  runSpacedNotificationTest,
  runBatchNotificationTest,
  BATCH_TEST_SCENARIO,
} = require('./lib/test-notifications');
const { SMS_TEMPLATES, openConfig, sendTestSms, loadConfig, getFromSender } = require('./lib/test-sms');
const { readSelfTestConfig, writeSelfTestConfig, openSelfTestConfig, ensureSelfTestConfig } = require('./lib/self-test-config');
const { readLastWatcherEvents, getLogPath: getWatcherLogPath } = require('./lib/watcher-debug-log');
const { injectSnippetObserver } = require('./lib/snippet-observer');
const { registerReplySuppression, shouldSuppressReplyEcho, isOutgoingSnippet } = require('./lib/reply-suppress');
const { setupAutoUpdater, checkForUpdates, setMainWindow } = require('./lib/auto-updater');

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

const NOTIFICATION_TEST_FLAG = '--run-notification-tests';

function handleNotificationTestLaunch(argv = process.argv) {
  if (!Array.isArray(argv) || !argv.includes(NOTIFICATION_TEST_FLAG)) {
    return;
  }

  setTimeout(() => {
    runBatchNotificationTest(BATCH_TEST_SCENARIO);
  }, 1500);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (Array.isArray(argv) && argv.includes(NOTIFICATION_TEST_FLAG)) {
      runBatchNotificationTest(BATCH_TEST_SCENARIO);
      return;
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

let mainWindow;
let triggerMessageScan = () => {};
let acknowledgeOutgoingReply = () => {};
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
  setMainWindow(mainWindow);
  setSuppressForegroundCallback(handleNotificationInteraction);
  setOnNotificationShownCallback(captureFrontApp);
  setOnNotificationClickCallback(handleNotificationClick);
  setOnNotificationReplyCallback(handleNotificationReply);
  setOnNotificationMarkAsReadCallback(handleNotificationMarkAsRead);
  setupServiceWorkerNotificationBridge(mainWindow, messagesSession);
  const watcher = setupMessageWatcher(mainWindow, (payload) => {
    handleIncomingNotification(null, payload);
  });
  triggerMessageScan = watcher?.poll || (() => {});
  acknowledgeOutgoingReply = watcher?.acknowledgeOutgoingReply || (() => {});

  const injectObserver = () => injectSnippetObserver(mainWindow);
  mainWindow.webContents.on('did-finish-load', injectObserver);
  mainWindow.webContents.on('dom-ready', injectObserver);
}

function handleIncomingNotification(_event, payload) {
  captureFrontApp();
  logIncomingPayload(payload);

  let conversationUrl = typeof payload.data === 'string' ? payload.data : '';
  let outgoing = false;
  if (payload.raw) {
    try {
      const parsed = JSON.parse(payload.raw);
      if (parsed.conversationUrl) {
        conversationUrl = parsed.conversationUrl;
      }
      outgoing = Boolean(parsed.outgoing);
    } catch {
      // Ignore malformed raw payloads.
    }
  }

  if (outgoing || isOutgoingSnippet(payload.body)) {
    const config = readSelfTestConfig();
    if (!config.notifyOutgoing) {
      return;
    }
  }

  if (shouldSuppressReplyEcho({
    conversationUrl,
    body: payload.body,
    outgoing: false,
  })) {
    return;
  }

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

async function handleNotificationMarkAsRead({ sender, conversationUrl }) {
  captureFrontApp();
  suppressActivateDuringReply(15000);
  dismissNotificationGroup({ sender, conversationUrl });

  if (!mainWindow || mainWindow.isDestroyed()) {
    restoreFrontApp();
    return;
  }

  const { wasHidden } = prepareWindowForBackgroundReply();

  try {
    const result = await markAsRead(mainWindow, { sender, conversationUrl, background: true });
    console.log('[Messages] Mark as read (background):', {
      sender,
      conversationUrl,
      method: result.method,
      ok: result.ok,
    });
  } finally {
    finishBackgroundReply({ wasHidden });
    restoreFrontApp();
  }
}

async function handleNotificationReply({ sender, conversationUrl, replyText }) {
  captureFrontApp();
  suppressActivateDuringReply(20000);

  const trimmed = String(replyText || '').trim();
  registerReplySuppression({ conversationUrl, replyText: trimmed });
  dismissNotificationGroup({ sender, conversationUrl });

  if (!mainWindow || mainWindow.isDestroyed()) {
    logReplyEvent('skipped', { reason: 'no-window', sender, conversationUrl, replyText: trimmed });
    restoreFrontApp();
    return;
  }

  const { wasHidden } = prepareWindowForBackgroundReply();
  setReplyInProgress(true);

  try {
    const result = await sendReply(mainWindow, {
      sender,
      conversationUrl,
      text: trimmed,
      background: true,
    });

    if (result.ok) {
      acknowledgeOutgoingReply(conversationUrl, trimmed);
      console.log('[Messages] Reply sent (background):', {
        sender,
        conversationUrl,
        method: result.method,
        verified: result.verified,
      });
    } else {
      console.warn('[Messages] Reply failed (background):', result.reason || result, {
        sender,
        conversationUrl,
        replyText: trimmed,
      });
    }
  } finally {
    setReplyInProgress(false);
    finishBackgroundReply({ wasHidden });
    restoreFrontApp();
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

async function runWatcherDiagnostic() {
  ensureSelfTestConfig();
  simulateNotification({
    title: 'Pipeline Test',
    body: 'If you see this banner, macOS notifications work in Messages.',
    skipDedupe: true,
  });

  triggerMessageScan();
  await new Promise((resolve) => setTimeout(resolve, 600));

  const config = readSelfTestConfig();
  const events = readLastWatcherEvents(6);
  const lastIncoming = readLastNotificationLog();

  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Notification pipeline test',
    message: `Messages ${app.getVersion()} — check for a test banner now`,
    detail: [
      '1. A test notification should have appeared just now.',
      '2. If YES → macOS notifications work. Real SMS needs Google Messages web to sync.',
      '3. If NO → System Settings → Notifications → Messages → allow Alerts.',
      '',
      `Notify on sent messages: ${config.notifyOutgoing ? 'ON' : 'OFF'}`,
      `Your SIM numbers: ${config.numbers.length ? config.numbers.join(', ') : '(add in Configure My SIM Numbers)'}`,
      '',
      `Last detected message: ${lastIncoming?.payload?.body || '(none logged)'}`,
      '',
      'Recent watcher activity:',
      events.length
        ? events.map((entry) => JSON.stringify(entry)).join('\n')
        : '(no watcher events — is Google Messages logged in?)',
      '',
      `Watcher log: ${getWatcherLogPath()}`,
    ].join('\n'),
  });
}

function setupApplicationMenu() {
  const isMac = process.platform === 'darwin';

  const testingSubmenu = [
    {
      label: `Version ${app.getVersion()}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Run Full Notification Pipeline Test',
      click: () => runWatcherDiagnostic(),
    },
    {
      label: 'Preview Regular Message (instant)',
      click: () => simulateNotification(REGULAR_SCENARIO.payload),
    },
    {
      label: 'Preview Grouped Follow-up (same contact)',
      click: () => simulateNotification(GROUPED_SCENARIO.payload),
    },
    {
      label: 'Run Batch Test (5 messages, 8s apart)',
      click: () => runBatchNotificationTest(BATCH_TEST_SCENARIO),
    },
    {
      label: 'Run Spaced Test (10s apart)',
      click: () => runSpacedNotificationTest(SPACED_TEST_SCENARIO),
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
    {
      label: 'Show Last Reply Debug Log',
      click: () => {
        const entries = readLastReplyLog(8);
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Reply debug log',
          message: entries.length ? 'Recent notification reply attempts' : 'No reply attempts logged yet',
          detail: entries.length
            ? entries.map((entry) => JSON.stringify(entry, null, 2)).join('\n\n')
            : 'Reply from a notification, then check again.\n\nLog file:\n~/Library/Application Support/messages/reply-log.jsonl',
        });
      },
    },
    { type: 'separator' },
    {
      label: 'Notify When I Send a Message',
      type: 'checkbox',
      checked: readSelfTestConfig().notifyOutgoing,
      click: (menuItem) => {
        const config = readSelfTestConfig();
        writeSelfTestConfig({ ...config, notifyOutgoing: menuItem.checked });
      },
    },
    {
      label: 'Configure My SIM Numbers…',
      click: () => {
        const configPath = openSelfTestConfig();
        const config = readSelfTestConfig();
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Self-SMS test numbers',
          message: 'Add both SIM numbers so you can test notifications by texting yourself',
          detail: [
            'File opened:',
            configPath,
            '',
            'Add your phone numbers in any format, for example:',
            '  "+1 555 123 4567"',
            '  "07 00 00 00 00"',
            '',
            'When "Notify When I Send a Message" is on, you also get a banner for texts you send',
            '(useful for dual-SIM testing). Incoming texts always notify.',
            '',
            `Currently configured: ${config.numbers.length ? config.numbers.join(', ') : '(none — add your numbers)'}`,
          ].join('\n'),
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
            {
              label: 'Check for Updates…',
              click: () => checkForUpdates({ manual: true }),
            },
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

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    ensureSelfTestConfig();
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
    ipcMain.on('watcher:scan-now', () => {
      triggerMessageScan();
    });

    ipcMain.handle('notification:request-permission', async () => {
      const status = await requestMacNotificationPermission(mainWindow);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('notification:permission-changed', status);
      }
      return status;
    });

    setupApplicationMenu();
    createMainWindow();
    setupAutoUpdater(mainWindow);
    handleNotificationTestLaunch();

    mainWindow.webContents.once('did-finish-load', async () => {
      if (readPermissionState().prompted) {
        return;
      }

      const status = await requestMacNotificationPermission(mainWindow);
      mainWindow.webContents.send('notification:permission-changed', status);
    });
  });
}

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
