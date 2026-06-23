# Messages

Unofficial [Google Messages](https://messages.google.com/web/) desktop client for macOS with native Notification Center alerts, **background quick reply**, **Copy Code** for verification texts, and quick navigation to the right conversation.

Forked from [Alyetama/Google-Messages-Desktop](https://github.com/Alyetama/Google-Messages-Desktop).

## Screenshots

### Desktop app

Google Messages for Web in a dedicated window. Runs in the background when you close it — notifications keep working.

![Messages desktop app with a clean conversation list](docs/screenshots/messages-app-window.png)

### Regular message notification

Regular texts show the **contact name** (or phone number if the contact is not saved) as the title, with the message preview below. Reply inline from Notification Center without opening the app. Multiple texts from the same contact are grouped into one alert. Click the notification to open that conversation (no full page reload).

![Regular message banner notification](docs/screenshots/notification-regular.png)

### Verification code notification

Verification texts show **Copy Code** and **Dismiss**. Copy stays in the background; the code is copied without jumping to the app. Codes auto-clear after 5 minutes if ignored.

![Verification notification with Copy Code and Dismiss](docs/screenshots/notification-verification.png)

## Download

Get the latest release:

| Chip | File |
|------|------|
| Apple Silicon (M1/M2/M3/M4) | `Messages-1.5.2-arm64.dmg` |
| Intel | `Messages-1.5.2-x64.dmg` |

Releases: [github.com/perlytiara/Google-Messages-Desktop-macOS/releases](https://github.com/perlytiara/Google-Messages-Desktop-macOS/releases)

### Install

1. Download the `.dmg` for your Mac.
2. Drag **Messages** to Applications.
3. First launch: right-click → **Open** if macOS warns about an unsigned developer.
4. Sign in to Google Messages and allow notifications when prompted.
5. For verification codes, set **System Settings → Notifications → Messages → Alerts** so **Copy Code** stays visible. Regular messages work fine as banners.

### Upgrade from an older build

If you installed a previous version manually, quit Messages and replace the app in `/Applications`, or run from a clone:

```bash
npm run install:app
```

That rebuilds, installs to `/Applications/Messages.app`, and relaunches.

## Features

- Google Messages for Web in a native desktop window.
- Background operation — close the window (red X) and keep receiving texts.
- Native macOS notifications synced from your paired phone.
- **Background quick reply** — reply from Notification Center without the app stealing focus.
- **Contact name or number** as the notification title (no extra app label in the banner).
- Notifications grouped **by contact** (one alert per person, updated as new texts arrive).
- **Copy Code** / **Dismiss** on verification / OTP messages.
- Regular messages use short banners with a reply field; click to open the thread.
- Opens the correct conversation via in-app navigation (no full reload).
- **Persistent message baseline** — restarts do not re-notify for old conversations.
- **Single-instance app** — no duplicate Messages icons in the Dock.
- **Incoming-only notifications** — messages you send (including quick replies) no longer trigger a second banner that looks like it came from the contact.
- Optional developer tools for testing SMS via Twilio (credentials stay local).

## What's new in 1.5.2

- **Fix false reply notifications** — replying from Notification Center no longer triggers a second alert that shows your contact’s name with your own message text.
- **Outgoing messages blocked by default** — only incoming texts notify; legacy self-test config no longer enables notify-on-send accidentally.
- **Reply echo suppression** — dismisses the banner on reply and suppresses watcher echoes for that thread.
- **Config migration** — old `enabled` flag in `self-test.json` is removed and mapped to safe defaults.

## What's new in 1.5.1

- **Faster notification replies** — reduced wait times before typing and sending from a quick reply.
- **Persistent snippet baseline** — conversation previews saved to disk to prevent duplicate alerts after restart.
- **Stable startup scan** — waits for the inbox to finish loading before delivering notifications.

## What's new in 1.5.0

- **Background quick reply** — type a response in Notification Center; Messages sends it in the background without popping the window to the front.
- **Cleaner notification layout** — contact name (or phone number) as the title, message text as the body. No redundant subtitle line.
- **Reliable send pipeline** — replies type into Google Messages correctly, click Send, and verify the message actually left the compose box.
- **Faster replies** — reduced delays when the conversation is already open; send completes in about a second in typical cases.
- **No duplicate alerts on restart** — conversation snippets are saved to disk and the watcher waits for a stable inbox scan before delivering notifications.
- **Smarter message detection** — watches the conversation list (not open-thread noise) and ignores system placeholder snippets.
- **Testing menu** — pipeline test, notification previews, reply debug log, watcher log, and version display under **Testing** in the menu bar.
- **`npm run install:app`** — one command to rebuild and install to `/Applications/Messages.app`.

## What's new in 1.2.0

- **Inline quick reply** — type a response directly in Notification Center without opening Messages.
- **Grouped by contact** — multiple texts from the same person update one notification instead of flooding the list.
- Verification texts still use **Copy Code** + **Dismiss** (no inline reply on OTP alerts).

## What's new in 1.1.0

- **Smart notifications** — regular vs verification detection with appropriate timing.
- **Copy Code** copies OTPs without opening or hiding the app.
- **Click notification** opens the matching conversation thread instantly.
- **DOM-based message watcher** — reliable alerts when Google Messages syncs new texts.
- **Banner + alert behavior** — regular messages auto-dismiss; verification codes persist (with 5-minute max).

## Development

```bash
git clone https://github.com/perlytiara/Google-Messages-Desktop-macOS.git
cd Google-Messages-Desktop-macOS
npm install
npm start
```

### Build locally

```bash
npm run dist
```

Produces `Messages-1.5.2-arm64.dmg` and `Messages-1.5.2-x64.dmg` in `dist/`.

Build Apple Silicon only:

```bash
npm run dist:arm64
```

Install the built app to `/Applications`:

```bash
npm run install:app
```

### Optional: test SMS via Twilio

For developers only. Credentials are stored locally and are **never** committed to git.

1. Copy `.env.example` to `~/Library/Application Support/messages/.env`, or use **Testing → Configure Test SMS Settings** in the app.
2. Add your own Twilio Account SID, Auth Token, sender ID, and phone number.
3. Use **Testing → Send Real SMS to My Phone** or `npm run test:sms`.

### Debug logs

When troubleshooting notifications or replies:

| Log | Location |
|-----|----------|
| Incoming notifications | `~/Library/Application Support/messages/incoming-log.jsonl` |
| Notification replies | `~/Library/Application Support/messages/reply-log.jsonl` |
| Message watcher | `~/Library/Application Support/messages/watcher-debug.jsonl` |
| Snippet baseline | `~/Library/Application Support/messages/watcher-baseline.json` |

Use **Testing → Show Last Reply Debug Log** and **Testing → Run Full Notification Pipeline Test** in the app menu.

## Privacy

This app wraps Google Messages for Web. Message content is processed locally on your Mac for notifications. Optional Twilio testing stores credentials in `~/Library/Application Support/messages/` only on your machine.

## License

[MIT License](https://opensource.org/license/mit).
