const express = require("express");
const { createWebhookHandler } = require("./api/webhook");
const healthHandler = require("./api/health");

const app = express();
app.use(express.json({ limit: "2mb" }));

app.all("/api/webhook", createWebhookHandler());
app.get("/health", healthHandler);
app.get("/api/health", healthHandler);
app.get("/", healthHandler);

const port = Number(process.env.PORT || 3010);
app.listen(port, () => {
  console.log(`ClockifyTGbot listening on http://127.0.0.1:${port}`);
});
