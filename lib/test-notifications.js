const { showMessageNotification } = require('./notifications');

const TEST_CONVERSATION_URL = 'https://messages.google.com/web/conversations/test-contact-123';

const REGULAR_SCENARIO = {
  label: 'Regular text (no code)',
  payload: {
    title: 'Alex Chen',
    body: 'Coffee tomorrow at 10? Let me know!',
    data: TEST_CONVERSATION_URL,
    raw: JSON.stringify({
      source: 'test',
      sender: 'Alex Chen',
      body: 'Coffee tomorrow at 10? Let me know!',
      conversationUrl: TEST_CONVERSATION_URL,
    }),
  },
};

const GROUPED_SCENARIO = {
  label: 'Grouped follow-up (same contact)',
  payload: {
    title: 'Alex Chen',
    body: 'Also — can you bring the charger?',
    data: TEST_CONVERSATION_URL,
    raw: JSON.stringify({
      source: 'test',
      sender: 'Alex Chen',
      body: 'Also — can you bring the charger?',
      conversationUrl: TEST_CONVERSATION_URL,
    }),
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
  {
    label: 'French — Votre code de vérification (3Deval)',
    payload: {
      title: '3Deval',
      body: 'Votre code de vérification 3Deval est: 366017',
    },
  },
  {
    label: 'French — Votre code Tinder est',
    payload: {
      title: 'TINDER',
      body: 'Votre code Tinder est 164179 @tinder.com #164179',
    },
  },
  {
    label: 'French — le code est (bank)',
    payload: {
      title: 'Bank',
      body: 'Pour débloquer votre accès, le code est 239159. Ne le partagez pas.',
    },
  },
  {
    label: 'French — code de vérification SIXHUNA',
    payload: {
      title: 'SIXHUNA',
      body: 'Votre code de vérification SIXHUNA est: 025145. Ne partagez pas ce code.',
    },
  },
];

const TEST_SCENARIOS = [REGULAR_SCENARIO, GROUPED_SCENARIO, ...VERIFICATION_FORMATS];

function simulateNotification(payload) {
  showMessageNotification({
    title: payload.title,
    body: payload.body,
    data: payload.data,
    raw: payload.raw,
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
  GROUPED_SCENARIO,
  VERIFICATION_FORMATS,
  TEST_SCENARIOS,
  simulateNotification,
  simulateServiceWorkerMessage,
};
