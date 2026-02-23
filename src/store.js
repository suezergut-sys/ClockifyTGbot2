const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const pending = new Map();
let kvClient;

function resolvePath(filePath) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(process.cwd(), filePath);
}

function hasKvEnv() {
  return Boolean(
    String(process.env.KV_REST_API_URL || "").trim()
    && String(process.env.KV_REST_API_TOKEN || "").trim()
  );
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
    const mod = require("@vercel/kv");
    kvClient = mod && mod.kv ? mod.kv : null;
  } catch {
    kvClient = null;
  }

  return kvClient;
}

function getPendingKvPrefix(cfg) {
  const value = String((cfg && cfg.pendingKvPrefix) || "clockify_tg_bot_pending").trim();
  return value || "clockify_tg_bot_pending";
}

function getPendingKvKey(cfg, id) {
  return `${getPendingKvPrefix(cfg)}:${String(id || "")}`;
}

function parsePendingItem(raw) {
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

function loadUsers(cfg) {
  const hasInlineUsers = Boolean(cfg.usersJson && String(cfg.usersJson).trim());
  let raw = "";

  if (hasInlineUsers) {
    raw = String(cfg.usersJson);
  } else {
    const usersFilePath = resolvePath(cfg.usersDataPath);
    try {
      raw = fs.readFileSync(usersFilePath, "utf8");
    } catch (err) {
      if (err && err.code === "ENOENT") {
        throw new Error(
          `Users file not found at ${usersFilePath}. Set USERS_JSON in Vercel env (recommended) or provide USERS_DATA_PATH to an existing file.`
        );
      }
      throw err;
    }
  }

  const parsed = JSON.parse(raw);
  const users = Array.isArray(parsed.users) ? parsed.users : [];

  return users
    .filter((u) => u && (u.tgId || u.username) && (u.clockifyEmail || u.clockifyUserId))
    .map((u) => ({
      tgId: u.tgId ? String(u.tgId).trim() : "",
      username: u.username ? String(u.username).trim().toLowerCase() : "",
      clockifyEmail: u.clockifyEmail ? String(u.clockifyEmail).trim().toLowerCase() : "",
      clockifyUserId: u.clockifyUserId ? String(u.clockifyUserId).trim() : "",
      clockifyApiKey: u.clockifyApiKey ? String(u.clockifyApiKey).trim() : "",
      active: u.active !== false
    }));
}

function getUserByTelegram(cfg, telegramUser) {
  const users = loadUsers(cfg);
  const tgId = String(telegramUser.id || "");
  const username = String(telegramUser.username || "").trim().toLowerCase();

  return (
    users.find((u) => u.active && u.tgId && u.tgId === tgId) ||
    users.find((u) => u.active && u.username && username && u.username === username) ||
    null
  );
}

async function createPending(cfg, payload, ttlMs) {
  const id = crypto.randomBytes(6).toString("base64url");
  const item = {
    ...payload,
    expiresAt: Date.now() + ttlMs
  };

  const kv = getKvClient();
  if (kv) {
    try {
      const ttlSeconds = Math.max(1, Math.ceil(Number(ttlMs) / 1000));
      await kv.set(getPendingKvKey(cfg, id), JSON.stringify(item), { ex: ttlSeconds });
      return id;
    } catch {
      // Fallback to in-memory map.
    }
  }

  pending.set(id, item);
  return id;
}

async function getPending(cfg, id) {
  const kv = getKvClient();
  if (kv) {
    try {
      const raw = await kv.get(getPendingKvKey(cfg, id));
      const item = parsePendingItem(raw);
      if (!item) {
        return null;
      }

      if (Date.now() > Number(item.expiresAt || 0)) {
        await kv.del(getPendingKvKey(cfg, id));
        return null;
      }

      return item;
    } catch {
      // Fallback to in-memory map.
    }
  }

  const item = pending.get(id);
  if (!item) {
    return null;
  }
  if (Date.now() > item.expiresAt) {
    pending.delete(id);
    return null;
  }
  return item;
}

async function deletePending(cfg, id) {
  const kv = getKvClient();
  if (kv) {
    try {
      await kv.del(getPendingKvKey(cfg, id));
      return;
    } catch {
      // Fallback to in-memory map.
    }
  }

  pending.delete(id);
}

async function prunePending(_cfg) {
  // KV entries are pruned by Redis TTL.
  const now = Date.now();
  for (const [id, value] of pending.entries()) {
    if (now > value.expiresAt) {
      pending.delete(id);
    }
  }
}

module.exports = {
  loadUsers,
  getUserByTelegram,
  createPending,
  getPending,
  deletePending,
  prunePending
};
