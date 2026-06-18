const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');

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

const SMS_TEMPLATES = [
  { label: 'Your verification message is 482913', body: 'Your verification message is 482913' },
  { label: 'Our verification message is 839201', body: 'Our verification message is 839201' },
  { label: 'G-482913 Google code', body: 'G-482913 is your Google verification code.' },
  { label: 'Letter prefix Y628441', body: 'Our verification message is Y628441' },
];

function getConfigPath() {
  return path.join(app.getPath('userData'), CONFIG_FILENAME);
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const values = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    values[key] = value;
  }

  return values;
}

function loadConfig() {
  const fileConfig = (() => {
    try {
      return JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'));
    } catch {
      return {};
    }
  })();

  const envFile = parseEnvFile(path.join(app.getPath('userData'), '.env'));
  const projectEnv = parseEnvFile(path.join(process.cwd(), '.env'));

  return {
    toNumber:
      fileConfig.toNumber
      || envFile.TEST_SMS_TO_NUMBER
      || projectEnv.TEST_SMS_TO_NUMBER
      || process.env.TEST_SMS_TO_NUMBER
      || '',
    twilioAccountSid:
      fileConfig.twilioAccountSid
      || envFile.TWILIO_ACCOUNT_SID
      || projectEnv.TWILIO_ACCOUNT_SID
      || process.env.TWILIO_ACCOUNT_SID
      || '',
    twilioAuthToken:
      fileConfig.twilioAuthToken
      || envFile.TWILIO_AUTH_TOKEN
      || projectEnv.TWILIO_AUTH_TOKEN
      || process.env.TWILIO_AUTH_TOKEN
      || '',
    twilioFromSender:
      fileConfig.twilioFromSender
      || fileConfig.twilioFromNumber
      || envFile.TWILIO_FROM_SENDER
      || envFile.TWILIO_FROM_NUMBER
      || projectEnv.TWILIO_FROM_SENDER
      || projectEnv.TWILIO_FROM_NUMBER
      || process.env.TWILIO_FROM_SENDER
      || process.env.TWILIO_FROM_NUMBER
      || DEFAULT_FROM_SENDER,
    twilioFromNumber:
      fileConfig.twilioFromSender
      || fileConfig.twilioFromNumber
      || envFile.TWILIO_FROM_SENDER
      || envFile.TWILIO_FROM_NUMBER
      || projectEnv.TWILIO_FROM_SENDER
      || projectEnv.TWILIO_FROM_NUMBER
      || process.env.TWILIO_FROM_SENDER
      || process.env.TWILIO_FROM_NUMBER
      || DEFAULT_FROM_SENDER,
  };
}

function saveDefaultConfig() {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    return configPath;
  }

  fs.writeFileSync(
    configPath,
    `${JSON.stringify({
      toNumber: '+1XXXXXXXXXX',
      twilioAccountSid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      twilioAuthToken: 'your_auth_token',
      twilioFromSender: 'TESTunit',
      twilioFromNumber: 'TESTunit',
      help: 'twilioFromSender: E.164 phone (+1...) or alphanumeric sender ID (e.g. TESTunit). Verify toNumber in Twilio console.',
    }, null, 2)}\n`,
  );

  return configPath;
}

function openConfig() {
  const configPath = saveDefaultConfig();
  shell.openPath(configPath);
  return configPath;
}

function validateConfig(config) {
  const missing = [];
  if (!config?.toNumber || config.toNumber.includes('X')) {
    missing.push('toNumber');
  }
  if (!config?.twilioAccountSid || config.twilioAccountSid.includes('xxxx')) {
    missing.push('twilioAccountSid');
  }
  if (!config?.twilioAuthToken || config.twilioAuthToken === 'your_auth_token') {
    missing.push('twilioAuthToken');
  }
  if (!isValidFromSender(getFromSender(config))) {
    missing.push('twilioFromSender');
  }
  return missing;
}

async function sendTestSms(body) {
  const config = loadConfig();
  const missing = validateConfig(config);

  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing test SMS config: ${missing.join(', ')}. Use Testing → Configure Test SMS Settings, or set TWILIO_* env vars.`,
    };
  }

  const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');
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
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    },
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return { ok: false, error: `Twilio error (${response.status}): ${data.message || JSON.stringify(data)}` };
  }

  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const statusResponse = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages/${data.sid}.json`,
      { headers: { Authorization: `Basic ${auth}` } },
    );
    const statusData = await statusResponse.json();

    if (statusData.status === 'delivered') {
      return { ok: true, status: 'delivered', from, to: config.toNumber };
    }

    if (statusData.status === 'undelivered' || statusData.status === 'failed') {
      return {
        ok: false,
        status: statusData.status,
        error: statusData.error_message || 'Message was not delivered',
        from,
        to: config.toNumber,
      };
    }
  }

  return { ok: true, status: 'queued', from, to: config.toNumber };
}

module.exports = {
  SMS_TEMPLATES,
  DEFAULT_FROM_SENDER,
  getFromSender,
  isValidFromSender,
  loadConfig,
  openConfig,
  sendTestSms,
};
