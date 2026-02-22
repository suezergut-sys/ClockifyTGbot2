const dotenv = require("dotenv");

dotenv.config();

function must(name) {
  const raw = process.env[name];
  if (!raw || !String(raw).trim()) {
    throw new Error(`Missing required env: ${name}`);
  }
  return String(raw).trim();
}

function getConfig() {
  const activityStorageRaw = String(process.env.ACTIVITY_STORAGE || "").trim().toLowerCase();
  const activityStorage = activityStorageRaw || (process.env.VERCEL ? "memory" : "file");
  const interactiveSelectionRaw = String(process.env.INTERACTIVE_SELECTION || "").trim().toLowerCase();
  const interactiveSelection = interactiveSelectionRaw
    ? interactiveSelectionRaw === "true"
    : !Boolean(process.env.VERCEL);

  return {
    telegramBotToken: must("TELEGRAM_BOT_TOKEN"),
    openAiApiKey: must("OPENAI_API_KEY"),
    openAiSttModel: process.env.OPENAI_STT_MODEL || "whisper-1",
    openAiParserModel: process.env.OPENAI_PARSER_MODEL || "gpt-4o-mini",
    clockifyApiKey: must("CLOCKIFY_API_KEY"),
    workspaceId: must("CLOCKIFY_WORKSPACE_ID"),
    clockifyBaseUrl: process.env.CLOCKIFY_BASE_URL || "https://api.clockify.me/api/v1",
    usersDataPath: process.env.USERS_DATA_PATH || "./data/users.json",
    usersJson: process.env.USERS_JSON || "",
    echoTranscription: String(process.env.ECHO_TRANSCRIPTION || "").toLowerCase() === "true",
    debugBotFlow: String(process.env.DEBUG_BOT_FLOW || "").toLowerCase() === "true",
    debugProjectTop: Number(process.env.DEBUG_PROJECT_TOP || 5),
    reportOwnerTgId: String(process.env.REPORT_OWNER_TG_ID || "376957179").trim(),
    pendingTtlMs: Number(process.env.PENDING_TTL_MS || 900000),
    baseTz: process.env.BASE_TZ || "Europe/Belgrade",
    moscowTz: "Europe/Moscow",
    interactiveSelection,
    activityStorage,
    activityDataPath: process.env.ACTIVITY_DATA_PATH || "./data/activity.json",
    activityTablePath: process.env.ACTIVITY_TABLE_PATH || "./data/activity.csv",
    activityDashboardPath: process.env.ACTIVITY_DASHBOARD_PATH || "./index.html"
  };
}

module.exports = {
  getConfig
};
