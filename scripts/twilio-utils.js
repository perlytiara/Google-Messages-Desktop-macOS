const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_FROM_SENDER = 'TESTunit';

function isValidFromSender(from) {
  if (!from || from.includes('XXXX') || from.includes('YYYY')) {
    return false;
  }

  if (/^\+\d{10,15}$/.test(from)) {
    return true;
  }

  return /^[A-Za-z][A-Za-z0-9]{0,10}$/.test(from);
}

function getFromSender(config) {
  return config.twilioFromSender || config.twilioFromNumber || DEFAULT_FROM_SENDER;
}

function loadConfig() {
  const configPath = path.join(os.homedir(), 'Library', 'Application Support', 'messages', 'test-sms.json');
  const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const from = getFromSender(fileConfig);

  return {
    ...fileConfig,
    twilioFromSender: from,
    twilioFromNumber: from,
  };
}

async function sendSms(config, body) {
  const from = getFromSender(config);
  const params = new URLSearchParams({
    To: config.toNumber,
    From: from,
    Body: body,
  });

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: getAuthHeader(config),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    },
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || `Twilio HTTP ${response.status}`);
  }

  return data;
}

function getAuthHeader(config) {
  const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');
  return `Basic ${auth}`;
}

async function fetchMessage(config, messageSid) {
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages/${messageSid}.json`,
    { headers: { Authorization: getAuthHeader(config) } },
  );

  if (!response.ok) {
    throw new Error(`Could not fetch message ${messageSid}`);
  }

  return response.json();
}

async function waitForDelivery(config, messageSid, attempts = 6, delayMs = 2000) {
  for (let i = 0; i < attempts; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const message = await fetchMessage(config, messageSid);
    if (message.status === 'delivered') {
      return message;
    }
    if (message.status === 'undelivered' || message.status === 'failed') {
      return message;
    }
  }

  return fetchMessage(config, messageSid);
}

module.exports = {
  DEFAULT_FROM_SENDER,
  getFromSender,
  isValidFromSender,
  loadConfig,
  sendSms,
  waitForDelivery,
  fetchMessage,
};
