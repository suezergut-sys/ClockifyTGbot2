const dotenv = require("dotenv");
const axios = require("axios");

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("Missing TELEGRAM_BOT_TOKEN");
}

async function main() {
  const base = `https://api.telegram.org/bot${token}`;
  const res = await axios.get(`${base}/getWebhookInfo`, { timeout: 20000 });
  if (!res.data || !res.data.ok) {
    throw new Error("Telegram getWebhookInfo failed");
  }

  const info = res.data.result || {};
  console.log(JSON.stringify({
    ok: true,
    url: info.url || "",
    pendingUpdateCount: info.pending_update_count || 0,
    lastErrorDate: info.last_error_date || null,
    lastErrorMessage: info.last_error_message || null,
    maxConnections: info.max_connections || null,
    ipAddress: info.ip_address || null
  }, null, 2));
}

main().catch((err) => {
  console.error(err.response?.data || err.message);
  process.exit(1);
});
