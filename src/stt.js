const axios = require("axios");
const FormData = require("form-data");

function extFromPath(filePath) {
  const match = String(filePath || "").match(/\.([A-Za-z0-9]+)$/);
  return match ? match[1].toLowerCase() : "ogg";
}

async function transcribeVoice(cfg, telegram, voice) {
  try {
    const fileInfo = await telegram.getFile(voice.file_id);
    if (!fileInfo || !fileInfo.file_path) {
      return {
        ok: false,
        fallback: true,
        message: "Не удалось получить аудио из Telegram. Попробуйте ещё раз."
      };
    }

    const audio = await telegram.downloadFile(fileInfo.file_path);
    const ext = extFromPath(fileInfo.file_path);
    const form = new FormData();
    form.append("model", cfg.openAiSttModel);
    form.append("language", "ru");
    form.append("response_format", "json");
    form.append("file", audio, {
      filename: `voice.${ext}`,
      contentType: voice.mime_type || "audio/ogg"
    });

    const res = await axios.post("https://api.openai.com/v1/audio/transcriptions", form, {
      headers: {
        Authorization: `Bearer ${cfg.openAiApiKey}`,
        ...form.getHeaders()
      },
      timeout: 60000
    });

    const text = String(res.data && res.data.text ? res.data.text : "").trim();
    if (!text) {
      return {
        ok: false,
        fallback: true,
        message: "Речь не распознана. Пожалуйста, повторите голосовое сообщение."
      };
    }

    return {
      ok: true,
      provider: "whisper",
      text
    };
  } catch (_err) {
    return {
      ok: false,
      fallback: true,
      message: "Сервис распознавания сейчас недоступен. Отправьте команду текстом."
    };
  }
}

module.exports = {
  transcribeVoice
};

