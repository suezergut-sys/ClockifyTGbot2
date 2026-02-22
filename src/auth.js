const { getUserByTelegram } = require("./store");

function authorizeTelegramUser(cfg, telegramUser) {
  if (!telegramUser || !telegramUser.id) {
    return { ok: false, reason: "bad_user" };
  }

  const user = getUserByTelegram(cfg, telegramUser);
  if (!user) {
    return { ok: false, reason: "not_allowed" };
  }

  return {
    ok: true,
    user
  };
}

module.exports = {
  authorizeTelegramUser
};
