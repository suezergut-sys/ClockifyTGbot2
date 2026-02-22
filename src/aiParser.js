const axios = require("axios");
const { DateTime } = require("luxon");

function sanitize(value) {
  return String(value || "").trim();
}

function isGenericLabel(value) {
  const v = sanitize(value).toLowerCase();
  return [
    "project",
    "проект",
    "task",
    "задача",
    "работа"
  ].includes(v);
}

async function parseCommandWithAi(cfg, text) {
  try {
    const nowMsk = DateTime.now().setZone(cfg.moscowTz);

    const body = {
      model: cfg.openAiParserModel,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Extract Clockify command fields from user text.",
            "Input can be Russian/English/translit and free-form speech.",
            "Return ONLY JSON with fields:",
            "projectQuery (string), taskQuery (string), startTimeHHmm (HH:MM 24h), startDate (YYYY-MM-DD), durationMinutes (integer).",
            "projectQuery and taskQuery must be real names from phrase, never generic words like project/task/проект/задача/работа.",
            "If unclear, still infer the closest concrete phrase fragment rather than generic labels.",
            "Interpret relative date words by Europe/Moscow date.",
            `Today date in Moscow is ${nowMsk.toFormat("yyyy-LL-dd")}.`
          ].join(" ")
        },
        {
          role: "user",
          content: text
        }
      ]
    };

    const res = await axios.post("https://api.openai.com/v1/chat/completions", body, {
      headers: {
        Authorization: `Bearer ${cfg.openAiApiKey}`,
        "Content-Type": "application/json"
      },
      timeout: 45000
    });

    const raw = res.data && res.data.choices && res.data.choices[0] && res.data.choices[0].message
      ? res.data.choices[0].message.content
      : "";

    if (!raw) return null;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    const projectQuery = sanitize(parsed.projectQuery);
    const taskQuery = sanitize(parsed.taskQuery);
    const startTimeHHmm = sanitize(parsed.startTimeHHmm);
    const startDate = sanitize(parsed.startDate) || nowMsk.toFormat("yyyy-LL-dd");
    const durationMinutes = Number(parsed.durationMinutes);

    if (!projectQuery || !taskQuery) return null;
    if (isGenericLabel(projectQuery) || isGenericLabel(taskQuery)) return null;
    if (!/^\d{2}:\d{2}$/.test(startTimeHHmm)) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) return null;

    const [hh, mm] = startTimeHHmm.split(":").map((x) => Number(x));
    if (hh > 23 || mm > 59) return null;

    const startMsk = DateTime.fromObject(
      {
        year: Number(startDate.slice(0, 4)),
        month: Number(startDate.slice(5, 7)),
        day: Number(startDate.slice(8, 10)),
        hour: hh,
        minute: mm,
        second: 0,
        millisecond: 0
      },
      { zone: cfg.moscowTz }
    );

    if (!startMsk.isValid) return null;
    const endMsk = startMsk.plus({ minutes: durationMinutes });

    return {
      projectQuery,
      taskQuery,
      durationMinutes,
      startMskIso: startMsk.toISO(),
      endMskIso: endMsk.toISO(),
      startMskView: startMsk.toFormat("dd.LL.yyyy HH:mm"),
      endMskView: endMsk.toFormat("dd.LL.yyyy HH:mm")
    };
  } catch {
    return null;
  }
}

module.exports = {
  parseCommandWithAi
};

