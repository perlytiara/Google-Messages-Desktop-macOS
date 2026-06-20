# Messages

Unofficial [Google Messages](https://messages.google.com/web/) desktop client for macOS with native Notification Center alerts, **Copy Code** for verification texts, and quick navigation to the right conversation.

Forked from [Alyetama/Google-Messages-Desktop](https://github.com/Alyetama/Google-Messages-Desktop).

## Screenshots

### Desktop app

Google Messages for Web in a dedicated window. Runs in the background when you close it — notifications keep working.

![Messages desktop app with a clean conversation list](docs/screenshots/messages-app-window.png)

### Regular message notification

Regular texts appear as a **banner** for a few seconds, then move to Notification Center. Click the notification to open that conversation (no full page reload).

![Regular message banner notification](docs/screenshots/notification-regular.png)

### Verification code notification

Verification texts show **Copy Code** and **Dismiss**. Copy stays in the background; the code is copied without jumping to the app. Codes auto-clear after 5 minutes if ignored.

![Verification notification with Copy Code and Dismiss](docs/screenshots/notification-verification.png)

## Download

Get the latest release:

| Chip | File |
|------|------|
| Apple Silicon (M1/M2/M3/M4) | `Messages-1.1.0-arm64.dmg` |
| Intel | `Messages-1.1.0-x64.dmg` |

Releases: [github.com/perlytiara/Google-Messages-Desktop-macOS/releases](https://github.com/perlytiara/Google-Messages-Desktop-macOS/releases)

### Install

1. Download the `.dmg` for your Mac.
2. Drag **Messages** to Applications.
3. First launch: right-click → **Open** if macOS warns about an unsigned developer.
4. Sign in to Google Messages and allow notifications when prompted.
5. For verification codes, set **System Settings → Notifications → Messages → Alerts** so **Copy Code** stays visible. Regular messages work fine as banners.

## Features

- Google Messages for Web in a native desktop window.
- Background operation — close the window (red X) and keep receiving texts.
- Native macOS notifications synced from your paired phone.
- **Copy Code** / **Dismiss** on verification / OTP messages.
- Regular messages use short banners; click to open the thread.
- Opens the correct conversation via in-app navigation (no full reload).
- Dismiss and Copy Code keep you in your current app — no focus stealing.
- Optional developer tools for testing SMS via Twilio (credentials stay local).

## What's new in 1.1.0

- **Smart notifications** — regular vs verification detection with appropriate timing.
- **Copy Code** copies OTPs without opening or hiding the app.
- **Click notification** opens the matching conversation thread instantly.
- **DOM-based message watcher** — reliable alerts when Google Messages syncs new texts.
- **False-positive fixes** — no duplicate alerts, no old messages re-firing on startup.
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

Produces `Messages-1.1.0-arm64.dmg` and `Messages-1.1.0-x64.dmg` in `dist/`.

Build Apple Silicon only:

```bash
npm run dist:arm64
```

### Optional: test SMS via Twilio

For developers only. Credentials are stored locally and are **never** committed to git.

1. Copy `.env.example` to `~/Library/Application Support/messages/.env`, or use **Testing → Configure Test SMS Settings** in the app.
2. Add your own Twilio Account SID, Auth Token, sender ID, and phone number.
3. Use **Testing → Send Real SMS to My Phone** or `npm run test:sms`.

## Privacy

This app wraps Google Messages for Web. Message content is processed locally on your Mac for notifications. Optional Twilio testing stores credentials in `~/Library/Application Support/messages/` only on your machine.

## License

[MIT License](https://opensource.org/license/mit).
