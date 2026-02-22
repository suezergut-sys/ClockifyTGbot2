const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const pending = new Map();

function resolvePath(filePath) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(process.cwd(), filePath);
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

function createPending(payload, ttlMs) {
  const id = crypto.randomBytes(6).toString("base64url");
  pending.set(id, {
    ...payload,
    expiresAt: Date.now() + ttlMs
  });
  return id;
}

function getPending(id) {
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

function deletePending(id) {
  pending.delete(id);
}

function prunePending() {
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
