# testflightchecker

A background worker that monitors public Apple TestFlight invitation links for any app. It sends an alert when a previously closed or full beta becomes available. Email through Resend and Telegram are independently optional; with neither configured, the worker logs status changes.

The checker does not reserve slots or enrol testers. Apple can change its pages, and availability can disappear before you open an invitation.

## Local setup

Requires **Node.js 24 or later** and npm.

```sh
git clone https://github.com/DangerMouseUK/testflightchecker.git
cd testflightchecker
npm ci
```

Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell, or `cp .env.example .env` in a POSIX shell). Replace the fictional invitation code with a real public TestFlight link.

```env
INVITE_URLS=https://testflight.apple.com/join/ABCDEFGH|https://testflight.apple.com/join/IJKLMNOP
POLL_INTERVAL_MS=60000
POLL_JITTER_PERCENTAGE=10
```

`ABCDEFGH` and `IJKLMNOP` are fictional examples. Duplicate invitations are checked once. Only HTTPS links on `testflight.apple.com` with an eight-character alphanumeric `/join/` code are accepted. Query strings, fragments, and a trailing slash are removed.

```sh
npm run build
npm start
```

For development, use `npm run dev`. Production runs use `npm run start:prod` and JSON logging; local interactive terminals use readable logs.

## Configuration

Existing shell environment variables take precedence over `.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `INVITE_URLS` | Required | Pipe-separated public TestFlight invitation links. |
| `POLL_INTERVAL_MS` | `60000` | Positive integer milliseconds between completed polling cycles, up to the Node timer limit. |
| `POLL_JITTER_PERCENTAGE` | `10` | Random timing variation from 0 to 100 percent. The final delay is at least half the interval and at least one second. |
| `PORT` | `8080` | HTTP health server port, from 1 to 65535. |
| `NODE_ENV` | Unset | Set to `production` for production logging. |
| `RESEND_API_KEY` | Blank | Optional email credential. |
| `ALERT_SENDER` | Blank | Sender authorised by Resend, for example `sender@example.com`. |
| `ALERT_RECIPIENT` | Blank | Comma-separated email recipients, for example `recipient@example.com`. |
| `TELEGRAM_BOT_TOKEN` | Blank | Optional Telegram bot credential. |
| `TELEGRAM_CHAT_ID` | Blank | Target Telegram user or group chat. |

Invalid polling values generate a warning and use the defaults. Leave all settings for an unused notification channel blank. Email requires its three settings together; Telegram requires both. Partial channel configuration stops startup and names the missing settings.

For email, create a Resend API key and configure an authorised sender. For Telegram, create a bot through [BotFather](https://t.me/BotFather), start a conversation with it or add it to a group, and configure that chat's ID. Keep both services' credentials private.

## Checking and alerts

- The first recognised check establishes a baseline without an availability alert. Restarting resets this in-memory baseline.
- The full and not-accepting messages both count as unavailable. Apple's joining instructions or a recognised "View in TestFlight" join control count as available.
- Unrecognised HTML, redirects, HTTP errors, and network failures remain unknown. They do not overwrite the last recognised state or trigger availability alerts.
- Unavailable-to-available transitions alert every enabled channel. Available-to-unavailable transitions send Telegram updates when enabled.
- Email attempts delivery up to three times with one- and four-second retry delays. Telegram sends once. Each network request has a 15-second timeout.
- Channel failures are logged independently. The recognised state advances after delivery attempts, so an unchanged status does not repeatedly alert after a delivery failure.
- Polling is sequential and does not overlap. There is no persistent storage or automatic enrolment.

When Telegram is configured, startup sends a confirmation message. Logs omit notification addresses, chat IDs, tokens, raw provider payloads, and error stacks.

## Health and deployment

`GET /healthz` returns liveness, uptime, monitored invitation count, memory use, and the timestamp of the last cycle in which every invitation had a recognised status. That timestamp starts as `null`. Liveness remains healthy during upstream failures; it does not guarantee current slot availability or successful notification delivery.

```sh
docker build -t testflightchecker .
docker run --rm --env-file .env -p 8080:8080 testflightchecker
```

The multi-stage Node.js 24 image compiles TypeScript, installs production dependencies, and runs as the Node user. Private configuration and Git history are excluded from the build context; tests are not included in the image.

`spec.yaml` is a DigitalOcean App Platform template. Connect your own repository in the hosting dashboard, replace its fictional invitation, and set any enabled notification channel's configuration in the platform's secret settings. Publishing this repository does not deploy a running service.

## Validation and credential handling

```sh
npm test -- --runInBand
npm run build
npm audit --omit=dev
```

Tests use fictional configuration and mocked notification requests. Never commit real configuration, logs, credentials, or private diagnostic output. `.env.example` is the only tracked environment template.

If a key or token has appeared in a repository, revoke it in [Resend](https://resend.com/api-keys) or through BotFather and create a replacement before enabling alerts. Deleting files or resetting Git history cannot invalidate a credential or remove copies held elsewhere. See [GitHub's sensitive-data guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).

Package metadata declares the ISC licence.
