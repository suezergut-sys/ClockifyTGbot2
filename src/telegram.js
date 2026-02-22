const axios = require("axios");

function createTelegramClient(botToken) {
  const api = axios.create({
    baseURL: `https://api.telegram.org/bot${botToken}`,
    timeout: 20000
  });

  async function sendText(chatId, text, extra) {
    await api.post("/sendMessage", {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...extra
    });
  }

  async function sendInlineKeyboard(chatId, text, keyboardRows) {
    await sendText(chatId, text, {
      reply_markup: {
        inline_keyboard: keyboardRows
      }
    });
  }

  async function answerCallbackQuery(callbackQueryId, text) {
    await api.post("/answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text: text || undefined,
      show_alert: false
    });
  }

  async function getFile(fileId) {
    const res = await api.get("/getFile", { params: { file_id: fileId } });
    if (!res.data || !res.data.ok || !res.data.result) {
      throw new Error("Telegram getFile failed");
    }
    return res.data.result;
  }

  async function downloadFile(filePath) {
    const url = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 30000
    });
    return Buffer.from(res.data);
  }

  return {
    sendText,
    sendInlineKeyboard,
    answerCallbackQuery,
    getFile,
    downloadFile
  };
}

module.exports = {
  createTelegramClient
};
