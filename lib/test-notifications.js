const { showMessageNotification } = require('./notifications');

const REGULAR_SCENARIO = {
  label: 'Regular text (no code)',
  payload: {
    title: '38691',
    body: 'Coffee tomorrow at 10? Let me know!',
  },
};

const VERIFICATION_FORMATS = [
  {
    label: 'Your verification message is 482913',
    payload: {
      title: '38691',
      body: 'Your verification message is 482913',
    },
  },
  {
    label: 'Our verification message is 839201',
    payload: {
      title: '38691',
      body: 'Our verification message is 839201',
    },
  },
  {
    label: 'G-482913 Google verification',
    payload: {
      title: 'Google',
      body: 'G-482913 is your Google verification code.',
    },
  },
  {
    label: 'Letter-prefixed Y628441',
    payload: {
      title: '38691',
      body: 'Our verification message is Y628441',
    },
  },
  {
    label: '482913 is your verification code',
    payload: {
      title: '38691',
      body: '482913 is your Google verification code.',
    },
  },
  {
    label: 'Short code sender only in title',
    payload: {
      title: '38691',
      body: 'Your verification message is 517384',
    },
  },
];

const TEST_SCENARIOS = [REGULAR_SCENARIO, ...VERIFICATION_FORMATS];

function simulateNotification(payload) {
  showMessageNotification({
    title: payload.title,
    body: payload.body,
    data: payload.data,
    silent: false,
    skipDedupe: true,
  });
}

function simulateServiceWorkerMessage(mainWindow, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    simulateNotification(payload);
    return;
  }

  mainWindow.webContents.send('test:simulate-service-worker-notification', payload);
}

module.exports = {
  REGULAR_SCENARIO,
  VERIFICATION_FORMATS,
  TEST_SCENARIOS,
  simulateNotification,
  simulateServiceWorkerMessage,
};
