# Local run guide

## What was prepared

- Added local route aliases in `server.js`:
  - `GET /`
  - `GET /health`
  - `GET /api/health`
- Added one-command local bot startup with Telegram webhook + tunnel:
  - `npm run local:bot`
- Added scripts:
  - `npm run webhook:set`
  - `npm run webhook:info`

## Required env

Create `.env` from `.env.example` and fill values:

- `TELEGRAM_BOT_TOKEN`
- `OPENAI_API_KEY`
- `CLOCKIFY_API_KEY`
- `CLOCKIFY_WORKSPACE_ID`
- `USERS_JSON` or `USERS_DATA_PATH`

Optional:

- `OPENAI_STT_MODEL` (default `whisper-1`)
- `OPENAI_PARSER_MODEL` (default `gpt-4o-mini`)
- `CLOCKIFY_BASE_URL` (default `https://api.clockify.me/api/v1`)
- `BASE_TZ` (default `Europe/Belgrade`)
- `PENDING_TTL_MS` (default `900000`)
- `DEBUG_BOT_FLOW` (`true|false`, debug messages into Telegram chat)
- `DEBUG_PROJECT_TOP` (how many ranked projects to include in debug, default `5`)
- `REPORT_OWNER_TG_ID` (who can trigger voice/text command `Пришли отчет`)
- `ACTIVITY_DATA_PATH` (JSON table of bot usage)
- `ACTIVITY_TABLE_PATH` (CSV table of bot usage)
- `ACTIVITY_DASHBOARD_PATH` (HTML dashboard file)
- `PORT` (default `3010`)
- `TUNNEL_SUBDOMAIN` (optional fixed localtunnel subdomain)
- `DELETE_WEBHOOK_ON_EXIT` (`true|false`, default `false`)
- `TUNNEL_RECONNECT_DELAY_MS` (default `5000`)
- `TUNNEL_PROVIDER` (`ngrok` by default, or `localtunnel`)
- `NGROK_AUTHTOKEN` (recommended for stable ngrok session)
- `NGROK_REGION` (optional)
- `NGROK_DOMAIN` (optional reserved ngrok domain)
- `NGROK_API_ADDR` (default `127.0.0.1`)
- `NGROK_API_PORT` (default `4040`)

## Start

```bash
npm run local:bot
```

This command:

1. Starts local express server on `PORT`
2. Opens `localtunnel`
3. Registers Telegram webhook to `<tunnel_url>/api/webhook`
4. Keeps processes alive until `Ctrl+C`

## Diagnostics

```bash
npm run webhook:info
curl http://127.0.0.1:3010/api/health
```
