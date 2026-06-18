# Messages

Unofficial Google Messages desktop client for macOS. Native Notification Center alerts with **Copy Code** for verification texts.

Forked from [Alyetama/Google-Messages-Desktop](https://github.com/Alyetama/Google-Messages-Desktop).

## Download

Get the latest release for your Mac:

| Chip | Download |
|------|----------|
| Apple Silicon (M1/M2/M3/M4) | `Messages-1.0.0-arm64.dmg` |
| Intel | `Messages-1.0.0-x64.dmg` |

Releases: [github.com/perlytiara/Google-Messages-Desktop-macOS/releases](https://github.com/perlytiara/Google-Messages-Desktop-macOS/releases)

### Install

1. Open the `.dmg` for your Mac type.
2. Drag **Messages** to Applications.
3. First launch: right-click → **Open** if macOS blocks the unsigned app.
4. Sign in to Google Messages and allow notifications when prompted.
5. In **System Settings → Notifications → Messages**, choose **Persistent** alerts so Copy Code buttons stay visible.

## Features

- Google Messages for Web in a dedicated desktop app.
- Native macOS notifications for incoming texts.
- **Copy Code** / **Dismiss** on verification messages.
- Regular messages show as normal notifications.
- App stays in the menu bar when you close the window (red X).

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

Produces `Messages-1.0.0-arm64.dmg` and `Messages-1.0.0-x64.dmg` in `dist/`.

### Optional: test SMS via Twilio

For developers only. Credentials stay on your machine — never committed to git.

1. Copy `.env.example` to `~/Library/Application Support/messages/.env`, or use **Testing → Configure Test SMS Settings** in the app.
2. Add your own Twilio Account SID, Auth Token, sender ID, and phone number.
3. Use **Testing → Send Real SMS to My Phone** or `npm run test:sms`.

## License

[MIT License](https://opensource.org/license/mit).
