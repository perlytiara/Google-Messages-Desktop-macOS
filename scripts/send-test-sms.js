#!/usr/bin/env node

const {
  loadConfig,
  sendSms,
  waitForDelivery,
  getFromSender,
  isValidFromSender,
} = require('./twilio-utils');

const message = process.argv.slice(2).join(' ') || 'Your verification message is 482913';

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch {
    console.error('Config not found. Open Messages → Testing → Configure Test SMS Settings.');
    process.exit(1);
  }

  for (const key of ['toNumber', 'twilioAccountSid', 'twilioAuthToken']) {
    if (!config[key] || String(config[key]).includes('X')) {
      console.error(`Missing or invalid "${key}" in test-sms.json`);
      process.exit(1);
    }
  }

  const from = getFromSender(config);
  if (!isValidFromSender(from)) {
    console.error('Missing or invalid twilioFromSender in test-sms.json (use TESTunit or +1...)');
    process.exit(1);
  }

  const fromLabel = /^\+\d+$/.test(from) ? 'Twilio phone number' : 'Alphanumeric sender ID';
  console.log(`From: ${from} (${fromLabel})`);
  console.log(`To:   ${config.toNumber}`);
  console.log(`Body: ${message}`);
  console.log('Sending…');

  try {
    const created = await sendSms(config, message);
    const final = await waitForDelivery(config, created.sid);

    console.log(`Status: ${final.status}`);

    if (final.status === 'delivered') {
      console.log(`Delivered to ${config.toNumber}`);
      return;
    }

    const error = final.error_message || 'Unknown delivery failure';
    console.error(`NOT DELIVERED: ${error}`);
    process.exit(1);
  } catch (error) {
    console.error(`Send failed: ${error.message}`);
    process.exit(1);
  }
}

main();
