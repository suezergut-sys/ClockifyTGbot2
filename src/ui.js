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

function successMessage(result) {
  return [
    "Создана запись в Clockify",
    `Проект: ${result.projectName}`,
    `Детализация: ${result.taskName}`,
    `Время начала: ${result.startMskView}`,
    `Длительность: ${result.durationView}`,
    "Спасибо, что ведёшь учёт рабочего времени!"
  ].join("\n");
}

module.exports = {
  buildChoiceKeyboard,
  successMessage
};

