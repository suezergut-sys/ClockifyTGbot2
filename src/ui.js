function buildChoiceKeyboard(prefix, pendingId, candidates) {
  const rows = candidates.slice(0, 3).map((c, idx) => [
    {
      text: c.item.name,
      callback_data: `${prefix}|${pendingId}|${idx}`
    }
  ]);

  rows.push([
    {
      text: "Отмена",
      callback_data: `CANCEL|${pendingId}`
    }
  ]);

  return rows;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function successMessage(result) {
  return [
    '<a href="https://app.clockify.me/tracker">Создана запись в Clockify</a>',
    `Проект: ${escapeHtml(result.projectName)}`,
    `Детализация: ${escapeHtml(result.taskName)}`,
    `Время начала: ${escapeHtml(result.startMskView)}`,
    `Длительность: ${escapeHtml(result.durationView)}`,
    "Спасибо, что ведёшь учёт рабочего времени!"
  ].join("\n");
}

module.exports = {
  buildChoiceKeyboard,
  successMessage
};
