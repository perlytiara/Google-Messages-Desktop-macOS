#!/usr/bin/env node

const { loadConfig, getFromSender } = require('./twilio-utils');

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch {
    console.error('No test-sms.json found.');
    process.exit(1);
  }

  const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');
  const headers = { Authorization: `Basic ${auth}` };

  console.log('Twilio SMS config');
  console.log(`  From (sender):    ${getFromSender(config)}`);
  console.log(`  To (your phone):  ${config.toNumber}`);
  console.log('');

  const numbers = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/IncomingPhoneNumbers.json`,
    { headers },
  ).then((r) => r.json());

  console.log('Your Twilio numbers:');
  for (const n of numbers.incoming_phone_numbers || []) {
    console.log(`  ${n.phone_number}`);
  }

  const verified = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/OutgoingCallerIds.json`,
    { headers },
  ).then((r) => r.json());

  console.log('');
  console.log('Verified recipient numbers (trial can only send to these):');
  for (const n of verified.outgoing_caller_ids || []) {
    console.log(`  ${n.phone_number}`);
  }

  const recent = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json?PageSize=8`,
    { headers },
  ).then((r) => r.json());

  console.log('');
  console.log('Recent messages:');
  for (const m of recent.messages || []) {
    const err = m.error_message ? ` — ${m.error_message}` : '';
    console.log(`  ${m.status.padEnd(12)} ${m.from} → ${m.to}${err}`);
    console.log(`               ${(m.body || '').slice(0, 70)}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
