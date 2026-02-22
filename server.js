const path = require("path");
const express = require("express");
const { createWebhookHandler } = require("./api/webhook");
const healthHandler = require("./api/health");
const statsHandler = require("./api/stats");

const app = express();
app.use(express.json({ limit: "2mb" }));

app.all("/api/webhook", createWebhookHandler());
app.get("/api/stats", statsHandler);
app.get("/health", healthHandler);
app.get("/api/health", healthHandler);
app.get("/", (_req, res) => {
  res.sendFile(path.resolve(__dirname, "index.html"));
});

const port = Number(process.env.PORT || 3010);
app.listen(port, () => {
  console.log(`ClockifyTGbot listening on http://127.0.0.1:${port}`);
});
