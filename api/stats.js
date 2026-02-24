const dotenv = require("dotenv");
const { getConfig } = require("../src/config");
const { getUsageSnapshot } = require("../src/activity");

dotenv.config();

module.exports = async function stats(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const cfg = getConfig();
    const snapshot = await getUsageSnapshot(cfg, { eventLimit: 200, maskEmails: true });
    res.setHeader("Cache-Control", "no-store, max-age=0");
    return res.status(200).json({
      ok: true,
      generatedAt: snapshot.generatedAt,
      storage: snapshot.storage,
      totalEvents: snapshot.totalEvents,
      summary: snapshot.summaryRows,
      recentEvents: snapshot.events
    });
  } catch (err) {
    const message = err && err.message ? err.message : "Internal error";
    console.error("Stats error:", message, err && err.stack ? err.stack : "");
    return res.status(500).json({ ok: false, error: "Internal error" });
  }
};
