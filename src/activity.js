const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DateTime } = require("luxon");
const { loadUsers } = require("./store");

const MEMORY_STATE_KEY = "__clockify_tg_bot_activity_state";
const STORAGE_MODES = new Set(["file", "memory", "kv"]);
let kvClient;

function resolveFromRoot(relativePath) {
  return path.resolve(process.cwd(), relativePath);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function hasKvEnv() {
  return Boolean(
    String(process.env.KV_REST_API_URL || "").trim()
    && String(process.env.KV_REST_API_TOKEN || "").trim()
  );
}

function normalizeStorageMode(mode) {
  const value = String(mode || "").trim().toLowerCase();
  if (STORAGE_MODES.has(value)) {
    return value;
  }

  if (process.env.VERCEL) {
    return hasKvEnv() ? "kv" : "memory";
  }

  return "file";
}

function getStorageMode(cfg) {
  return normalizeStorageMode(cfg && cfg.activityStorage);
}

function getKvEventsKey(cfg) {
  const prefix = String((cfg && cfg.activityKvPrefix) || "clockify_tg_bot_activity").trim() || "clockify_tg_bot_activity";
  return `${prefix}:events`;
}

function getKvMaxEvents(cfg) {
  const raw = Number((cfg && cfg.activityKvMaxEvents) || 5000);
  if (!Number.isFinite(raw)) return 5000;
  return Math.min(Math.max(Math.round(raw), 200), 20000);
}

function getPaths(cfg) {
  return {
    dataPath: resolveFromRoot((cfg && cfg.activityDataPath) || "./data/activity.json"),
    csvPath: resolveFromRoot((cfg && cfg.activityTablePath) || "./data/activity.csv"),
    indexPath: resolveFromRoot((cfg && cfg.activityDashboardPath) || "./index.html")
  };
}

function createEmptyState() {
  return {
    version: 2,
    createdAt: DateTime.utc().toISO(),
    events: []
  };
}

function normalizeStatus(value) {
  return String(value || "").toLowerCase() === "success" ? "success" : "failed";
}

function normalizeStateShape(state) {
  const source = state && typeof state === "object" ? state : createEmptyState();
  const events = Array.isArray(source.events) ? source.events : [];

  return {
    version: 2,
    createdAt: source.createdAt || DateTime.utc().toISO(),
    events: events.map((item) => ({
      id: String(item && item.id ? item.id : ""),
      ts: String(item && item.ts ? item.ts : ""),
      dateMsk: String(item && item.dateMsk ? item.dateMsk : ""),
      tgId: String(item && item.tgId ? item.tgId : ""),
      email: normalizeEmail(item && item.email ? item.email : ""),
      status: normalizeStatus(item && item.status ? item.status : "failed"),
      source: String(item && item.source ? item.source : ""),
      reason: String(item && item.reason ? item.reason : "")
    }))
  };
}

function createEvent(payload) {
  const nowMsk = DateTime.now().setZone("Europe/Moscow");
  return {
    id: crypto.randomUUID(),
    ts: nowMsk.toUTC().toISO(),
    dateMsk: nowMsk.toFormat("dd.LL.yyyy HH:mm:ss"),
    tgId: String(payload && payload.tgId ? payload.tgId : ""),
    email: normalizeEmail(payload && payload.email ? payload.email : ""),
    status: normalizeStatus(payload && payload.status ? payload.status : "failed"),
    source: String(payload && payload.source ? payload.source : ""),
    reason: String(payload && payload.reason ? payload.reason : "")
  };
}

function readFileState(dataPath) {
  try {
    const raw = fs.readFileSync(dataPath, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeStateShape(parsed);
  } catch {
    return createEmptyState();
  }
}

function writeFileState(dataPath, state) {
  const dir = path.dirname(dataPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dataPath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function getMemoryState() {
  if (!globalThis[MEMORY_STATE_KEY]) {
    globalThis[MEMORY_STATE_KEY] = createEmptyState();
  }

  globalThis[MEMORY_STATE_KEY] = normalizeStateShape(globalThis[MEMORY_STATE_KEY]);
  return globalThis[MEMORY_STATE_KEY];
}

function setMemoryState(state) {
  globalThis[MEMORY_STATE_KEY] = normalizeStateShape(state);
  return globalThis[MEMORY_STATE_KEY];
}

function getKvClient() {
  if (typeof kvClient !== "undefined") {
    return kvClient;
  }

  if (!hasKvEnv()) {
    kvClient = null;
    return kvClient;
  }

  try {
    // Lazy load to avoid hard dependency in environments without KV.
    const mod = require("@vercel/kv");
    kvClient = mod && mod.kv ? mod.kv : null;
  } catch {
    kvClient = null;
  }

  return kvClient;
}

function parseKvItem(raw) {
  if (!raw) return null;
  if (typeof raw === "object") {
    return raw;
  }
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

async function readKvState(cfg) {
  const kv = getKvClient();
  if (!kv) {
    return createEmptyState();
  }

  try {
    const key = getKvEventsKey(cfg);
    const rawItems = await kv.lrange(key, 0, getKvMaxEvents(cfg) - 1);
    const eventsNewestFirst = Array.isArray(rawItems)
      ? rawItems.map(parseKvItem).filter(Boolean)
      : [];

    const eventsOldestFirst = eventsNewestFirst.reverse();
    return normalizeStateShape({
      version: 2,
      createdAt: DateTime.utc().toISO(),
      events: eventsOldestFirst
    });
  } catch (_err) {
    return createEmptyState();
  }
}

async function readState(cfg) {
  const mode = getStorageMode(cfg);

  if (mode === "memory") {
    return getMemoryState();
  }

  if (mode === "kv") {
    return readKvState(cfg);
  }

  const { dataPath } = getPaths(cfg);
  return readFileState(dataPath);
}

function csvEscape(value) {
  const source = String(value == null ? "" : value);
  return `"${source.replace(/"/g, '""')}"`;
}

function statusLabel(status) {
  return status === "success" ? "Успешно" : "Неуспешно";
}

function buildCsv(state) {
  const header = "date_msk,status,tg_id,email,source,reason";
  const rows = state.events.map((item) =>
    [
      csvEscape(item.dateMsk),
      csvEscape(statusLabel(item.status)),
      csvEscape(item.tgId),
      csvEscape(item.email),
      csvEscape(item.source),
      csvEscape(item.reason)
    ].join(",")
  );
  return [header, ...rows].join("\n") + "\n";
}

function writeCsv(csvPath, state) {
  const dir = path.dirname(csvPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(csvPath, buildCsv(state), "utf8");
}

function eventKey(item) {
  const email = normalizeEmail(item.email);
  if (email) return email;
  return `tg:${item.tgId || "unknown"}`;
}

function eventLabel(item) {
  const email = normalizeEmail(item.email);
  if (email) return email;
  return `tg:${item.tgId || "unknown"}`;
}

function createStatsMap(state, nowMsk) {
  const startOfToday = nowMsk.startOf("day");
  const stats = new Map();

  for (const item of state.events) {
    const key = eventKey(item);
    const label = eventLabel(item);

    if (!stats.has(key)) {
      stats.set(key, {
        key,
        label,
        total: 0,
        today: 0,
        success: 0,
        failed: 0
      });
    }

    const row = stats.get(key);
    row.total += 1;
    if (item.status === "success") row.success += 1;
    else row.failed += 1;

    const ts = DateTime.fromISO(item.ts || "", { zone: "utc" });
    if (ts.isValid && ts.setZone("Europe/Moscow") >= startOfToday) {
      row.today += 1;
    }
  }

  return stats;
}

function getCatalogFromUsers(cfg) {
  try {
    const users = loadUsers(cfg).filter((u) => u.active !== false);
    const map = new Map();

    for (const user of users) {
      const email = normalizeEmail(user.clockifyEmail);
      const key = email || `tg:${user.tgId || "unknown"}`;
      const label = email || `tg:${user.tgId || "unknown"}`;
      if (!map.has(key)) {
        map.set(key, { key, label });
      }
    }

    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return [];
  }
}

function buildSummaryRows(cfg, state) {
  const nowMsk = DateTime.now().setZone("Europe/Moscow");
  const stats = createStatsMap(state, nowMsk);
  const catalog = getCatalogFromUsers(cfg);

  if (!catalog.length) {
    return [...stats.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  return catalog.map((item) => {
    const hit = stats.get(item.key);
    return {
      key: item.key,
      label: item.label,
      total: hit ? hit.total : 0,
      today: hit ? hit.today : 0,
      success: hit ? hit.success : 0,
      failed: hit ? hit.failed : 0
    };
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildDashboardHtml(cfg, state) {
  const summaryRows = buildSummaryRows(cfg, state)
    .map((row) => `\n        <tr><td>${escapeHtml(row.label)}</td><td>${row.today}</td><td>${row.total}</td><td>${row.success}</td><td>${row.failed}</td></tr>`)
    .join("");

  const eventsRows = state.events
    .slice(-200)
    .reverse()
    .map((item) => `\n        <tr><td>${escapeHtml(item.dateMsk)}</td><td>${escapeHtml(statusLabel(item.status))}</td><td>${escapeHtml(item.email || item.tgId)}</td><td>${escapeHtml(item.reason)}</td></tr>`)
    .join("");

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ClockifyTGbot - Отчёт использования</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; background: #f5f7fb; color: #1f2937; }
    .card { max-width: 1080px; margin: 0 auto 18px auto; background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.08); }
    h1, h2 { margin-top: 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { text-align: left; padding: 10px; border-bottom: 1px solid #e5e7eb; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Отчёт использования бота</h1>
    <p>Сводка по пользователям (сегодня и всего).</p>
    <table>
      <thead>
        <tr><th>Пользователь (email)</th><th>Сегодня</th><th>Всего</th><th>Успешно</th><th>Ошибки</th></tr>
      </thead>
      <tbody>${summaryRows}
      </tbody>
    </table>
  </div>
  <div class="card">
    <h2>Последние обращения</h2>
    <table>
      <thead>
        <tr><th>Дата (MSK)</th><th>Статус</th><th>Пользователь</th><th>Причина</th></tr>
      </thead>
      <tbody>${eventsRows}
      </tbody>
    </table>
  </div>
</body>
</html>
`;
}

function writeDashboardHtml(indexPath, cfg, state) {
  fs.writeFileSync(indexPath, buildDashboardHtml(cfg, state), "utf8");
}

async function persistState(cfg, state) {
  const normalized = normalizeStateShape(state);
  const mode = getStorageMode(cfg);

  if (mode === "memory") {
    return setMemoryState(normalized);
  }

  if (mode === "file") {
    const { dataPath, csvPath, indexPath } = getPaths(cfg);
    writeFileState(dataPath, normalized);
    writeCsv(csvPath, normalized);
    writeDashboardHtml(indexPath, cfg, normalized);
    return normalized;
  }

  return normalized;
}

async function syncDashboardFiles(cfg) {
  const mode = getStorageMode(cfg);
  const state = await readState(cfg);

  if (mode === "file") {
    return persistState(cfg, state);
  }

  return state;
}

async function recordUsageEvent(cfg, payload) {
  const event = createEvent(payload);
  const mode = getStorageMode(cfg);

  if (mode === "kv") {
    const kv = getKvClient();
    if (kv) {
      try {
        await kv.lpush(getKvEventsKey(cfg), JSON.stringify(event));
        await kv.ltrim(getKvEventsKey(cfg), 0, getKvMaxEvents(cfg) - 1);
        return event;
      } catch (_err) {
        // Fall through to in-memory fallback to avoid losing event completely.
      }
    }
  }

  const state = await readState(cfg);
  state.events.push(event);
  await persistState(cfg, state);
  return event;
}

async function getUsageSnapshot(cfg, options) {
  const state = await readState(cfg);
  const summaryRows = buildSummaryRows(cfg, state);
  const eventLimitRaw = Number(options && options.eventLimit ? options.eventLimit : 200);
  const eventLimit = Math.min(Math.max(Math.round(eventLimitRaw), 1), 1000);
  const recentEvents = state.events.slice(-eventLimit).reverse();

  return {
    generatedAt: DateTime.utc().toISO(),
    storage: getStorageMode(cfg),
    totalEvents: state.events.length,
    summaryRows,
    events: recentEvents
  };
}

async function buildUsageReportMessage(cfg) {
  const snapshot = await getUsageSnapshot(cfg, { eventLimit: 500 });
  const rows = snapshot.summaryRows;
  const lines = ["Пользователь (email) | Сегодня | Всего |"];

  for (const row of rows) {
    lines.push(`${row.label} | ${row.today} | ${row.total} |`);
  }

  if (rows.length === 0) {
    lines.push("Нет данных | 0 | 0 |");
  }

  return lines.join("\n");
}

async function incrementSuccessByEmail(cfg, email) {
  await recordUsageEvent(cfg, {
    email,
    status: "success",
    source: "legacy",
    reason: "legacy_increment"
  });
  return true;
}

module.exports = {
  syncDashboardFiles,
  recordUsageEvent,
  getUsageSnapshot,
  buildUsageReportMessage,
  incrementSuccessByEmail
};
