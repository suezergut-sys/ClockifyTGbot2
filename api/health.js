function hasEnv(name) {
  return Boolean(process.env[name] && String(process.env[name]).trim());
}

module.exports = async function health(_req, res) {
  const usersSource = hasEnv("USERS_JSON") ? "USERS_JSON" : (hasEnv("USERS_DATA_PATH") ? "USERS_DATA_PATH" : "none");
  const hasKv = hasEnv("KV_REST_API_URL") && hasEnv("KV_REST_API_TOKEN");
  const activityStorage = String(process.env.ACTIVITY_STORAGE || "").trim().toLowerCase() || (process.env.VERCEL ? (hasKv ? "kv" : "memory") : "file");
  const coreEnv = {
    TELEGRAM_BOT_TOKEN: hasEnv("TELEGRAM_BOT_TOKEN"),
    OPENAI_API_KEY: hasEnv("OPENAI_API_KEY"),
    CLOCKIFY_API_KEY: hasEnv("CLOCKIFY_API_KEY"),
    CLOCKIFY_WORKSPACE_ID: hasEnv("CLOCKIFY_WORKSPACE_ID"),
    USERS_JSON_OR_PATH: hasEnv("USERS_JSON") || hasEnv("USERS_DATA_PATH")
  };

  const env = {
    ...coreEnv,
    INTERACTIVE_SELECTION: hasEnv("INTERACTIVE_SELECTION") || Boolean(process.env.VERCEL),
    ACTIVITY_STORAGE: Boolean(activityStorage),
    KV_REST_API_URL: hasEnv("KV_REST_API_URL"),
    KV_REST_API_TOKEN: hasEnv("KV_REST_API_TOKEN")
  };

  const coreReady = Object.values(coreEnv).every(Boolean);
  const storageReady = activityStorage !== "kv" || hasKv;
  const ready = coreReady && storageReady;
  res.status(200).json({
    ok: true,
    service: "clockify-tg-bot",
    revision: process.env.VERCEL_GIT_COMMIT_SHA || null,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || null,
    ready,
    env,
    usersSource,
    activityStorage
  });
};
