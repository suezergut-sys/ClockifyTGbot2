const dotenv = require("dotenv");
const axios = require("axios");

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;

if (!token) {
  throw new Error("Missing TELEGRAM_BOT_TOKEN");
}
if (!webhookUrl) {
  throw new Error("Missing TELEGRAM_WEBHOOK_URL");
}

async function main() {
  const url = `https://api.telegram.org/bot${token}/setWebhook`;
  const res = await axios.post(url, {
    url: `${webhookUrl.replace(/\/$/, "")}/api/webhook`
  });
  console.log(res.data);
}

main().catch((err) => {
  console.error(err.response?.data || err.message);
  process.exit(1);
});