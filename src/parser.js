const { DateTime } = require("luxon");
const { normalizeText, squashDictatedLetters } = require("./fuzzy");

const FUTURE_WEEKDAY_ERROR_MESSAGE = "Извини, я могу заносить записи только за прошедшую часть текущей недели.";

const RU_NUMBERS = {
  "ноль": 0,
  "нуль": 0,
  "один": 1,
  "одна": 1,
  "два": 2,
  "две": 2,
  "три": 3,
  "четыре": 4,
  "пять": 5,
  "шесть": 6,
  "семь": 7,
  "восемь": 8,
  "девять": 9,
  "десять": 10,
  "одиннадцать": 11,
  "двенадцать": 12,
  "тринадцать": 13,
  "четырнадцать": 14,
  "пятнадцать": 15,
  "шестнадцать": 16,
  "семнадцать": 17,
  "восемнадцать": 18,
  "девятнадцать": 19,
  "двадцать": 20,
  "тридцать": 30,
  "сорок": 40,
  "пятьдесят": 50
};
const EN_NUMBERS = {
  "zero": 0,
  "one": 1,
  "two": 2,
  "three": 3,
  "four": 4,
  "five": 5,
  "six": 6,
  "seven": 7,
  "eight": 8,
  "nine": 9,
  "ten": 10,
  "eleven": 11,
  "twelve": 12,
  "thirteen": 13,
  "fourteen": 14,
  "fifteen": 15,
  "sixteen": 16,
  "seventeen": 17,
  "eighteen": 18,
  "nineteen": 19,
  "twenty": 20,
  "thirty": 30,
  "forty": 40,
  "fifty": 50
};

const WEEKDAY_RULES = [
  { weekday: 1, regex: /(^|\s)(понедельник|понедельника|monday)(\s|$)/u },
  { weekday: 2, regex: /(^|\s)(вторник|вторника|tuesday)(\s|$)/u },
  { weekday: 3, regex: /(^|\s)(среда|среду|среды|wednesday)(\s|$)/u },
  { weekday: 4, regex: /(^|\s)(четверг|четверга|thursday)(\s|$)/u },
  { weekday: 5, regex: /(^|\s)(пятница|пятницу|пятницы|friday)(\s|$)/u },
  { weekday: 6, regex: /(^|\s)(суббота|субботу|субботы|saturday)(\s|$)/u },
  { weekday: 7, regex: /(^|\s)(воскресенье|воскресенья|sunday)(\s|$)/u }
];

const MERIDIEM_REGEX = /(?<!\S)(утра|дня|вечера|ночи|utra|dnya|vechera|nochi|am|pm)(?!\S)/u;
const RU_HALF_TO_HOUR = {
  "первого": 1,
  "второго": 2,
  "третьего": 3,
  "четвертого": 4,
  "четвёртого": 4,
  "пятого": 5,
  "шестого": 6,
  "седьмого": 7,
  "восьмого": 8,
  "девятого": 9,
  "десятого": 10,
  "одиннадцатого": 11,
  "двенадцатого": 12
};

function parseRuNumberToken(token) {
  return Object.prototype.hasOwnProperty.call(RU_NUMBERS, token) ? RU_NUMBERS[token] : null;
}

function parseEnNumberToken(token) {
  return Object.prototype.hasOwnProperty.call(EN_NUMBERS, token) ? EN_NUMBERS[token] : null;
}

function parseNumberTokenAny(token) {
  const ru = parseRuNumberToken(token);
  if (ru != null) return ru;
  return parseEnNumberToken(token);
}

function parseRuMinutePhrase(tokens) {
  if (!tokens.length) return 0;
  if (tokens.length === 1) {
    const v = parseRuNumberToken(tokens[0]);
    return v != null && v >= 0 && v <= 59 ? v : null;
  }

  const first = parseRuNumberToken(tokens[0]);
  const second = parseRuNumberToken(tokens[1]);
  if (first == null || second == null) return null;

  const combined = first + second;
  return combined >= 0 && combined <= 59 ? combined : null;
}

function parseAnyMinutePhrase(tokens) {
  if (!tokens.length) return 0;
  if (tokens.length === 1) {
    const v = parseNumberTokenAny(tokens[0]);
    return v != null && v >= 0 && v <= 59 ? v : null;
  }

  const first = parseNumberTokenAny(tokens[0]);
  const second = parseNumberTokenAny(tokens[1]);
  if (first == null || second == null) return null;
  const combined = first + second;
  return combined >= 0 && combined <= 59 ? combined : null;
}

function applyMeridiem(hour, meridiem) {
  if (!meridiem) return hour;

  if (["утра", "utra", "am"].includes(meridiem)) {
    return hour === 12 ? 0 : hour;
  }
  if (["дня", "вечера", "dnya", "vechera", "pm"].includes(meridiem)) {
    return hour < 12 ? hour + 12 : hour;
  }
  if (["ночи", "nochi"].includes(meridiem)) {
    return hour === 12 ? 0 : hour;
  }
  return hour;
}

function applyWorkdayAfternoonHeuristic(hour, meridiem) {
  if (meridiem) {
    return applyMeridiem(hour, meridiem);
  }
  if (hour >= 1 && hour <= 7) {
    return hour + 12;
  }
  return hour;
}

function stripNaturalTimeNoise(value, removeHourWords) {
  let out = String(value || "");
  out = out
    .replace(/(?<!\S)(начало|время|start|at)(?!\S)/gu, " ")
    .replace(/(?<!\S)(минута|минуты|минут|мин|m)(?!\S)/gu, " ")
    .replace(/(?<!\S)(ровно|около|примерно)(?!\S)/gu, " ")
    .replace(/(?<!\S)(утра|дня|вечера|ночи|utra|dnya|vechera|nochi|am|pm)(?!\S)/gu, " ");

  if (removeHourWords) {
    out = out.replace(/(?<!\S)(час|часа|часов|ч)(?!\S)/gu, " ");
  }

  return out.replace(/\s+/g, " ").trim();
}

function parseHalfPastPhrase(value) {
  const source = String(value || "").trim().replace(/^в\s+/u, "");
  const match = source.match(/^пол\s+([а-яё]+)$/u);
  if (!match) return null;

  const nextHour = RU_HALF_TO_HOUR[match[1]];
  if (!nextHour) return null;

  return {
    hour: nextHour === 1 ? 12 : nextHour - 1,
    minute: 30
  };
}

function parseHourWordPhrase(value) {
  const source = String(value || "").trim().replace(/^в\s+/u, "");
  const match = source.match(/^час(?:\s+(.+))?$/u);
  if (!match) return null;

  const tail = String(match[1] || "").trim();
  if (!tail) {
    return { hour: 1, minute: 0 };
  }

  const minute = parseAnyMinutePhrase(tail.split(" ").filter(Boolean));
  if (minute == null) return null;
  return { hour: 1, minute };
}

function parseNaturalTime(input) {
  const clean = input
    .toLowerCase()
    .replace(/[.,;!?()"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return null;

  const meridiemMatch = clean.match(MERIDIEM_REGEX);
  const meridiem = meridiemMatch ? meridiemMatch[1] : null;
  const soft = stripNaturalTimeNoise(clean, false);
  if (!soft) return null;

  const halfPast = parseHalfPastPhrase(soft);
  if (halfPast) {
    const hour = applyWorkdayAfternoonHeuristic(halfPast.hour, meridiem);
    if (hour > 23) return null;
    return { hour, minute: halfPast.minute };
  }

  const hourWord = parseHourWordPhrase(soft);
  if (hourWord) {
    const hour = applyWorkdayAfternoonHeuristic(hourWord.hour, meridiem);
    if (hour > 23) return null;
    return { hour, minute: hourWord.minute };
  }

  const withoutLabels = stripNaturalTimeNoise(clean, true);
  if (!withoutLabels) return null;

  const numericHm = withoutLabels.match(/\b(\d{1,2})\s+(\d{1,2})\b/);
  if (numericHm) {
    let h = Number(numericHm[1]);
    const m = Number(numericHm[2]);
    if (h <= 23 && m <= 59) {
      h = applyWorkdayAfternoonHeuristic(h, meridiem);
      return { hour: h, minute: m };
    }
  }

  const numericH = withoutLabels.match(/\b(\d{1,2})\b/);
  if (numericH) {
    let h = Number(numericH[1]);
    if (h <= 23) {
      h = applyWorkdayAfternoonHeuristic(h, meridiem);
      return { hour: h, minute: 0 };
    }
  }

  const tokens = withoutLabels.split(" ").filter(Boolean);
  if (!tokens.length) return null;

  let hour = parseNumberTokenAny(tokens[0]);
  if (hour == null || hour > 23) return null;

  const minute = parseAnyMinutePhrase(tokens.slice(1));
  if (minute == null) return null;

  hour = applyWorkdayAfternoonHeuristic(hour, meridiem);
  if (hour > 23 || minute > 59) return null;

  return { hour, minute };
}

function parseDurationMinutes(raw) {
  const source = normalizeText(raw).toLowerCase().replace(",", ".");
  const looksLikeClockTime = /\b\d{1,2}[:.]\d{2}\b/.test(source);

  let h = 0;
  let m = 0;

  const hMatch = source.match(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|ч|час|часа|часов)(?=\s|$)/i);
  if (hMatch) {
    h = Number(hMatch[1]);
  }

  const mMatch = source.match(/(\d+)\s*(m|min|mins|minute|minutes|м|мин|минута|минуты|минут)(?=\s|$)/i);
  if (mMatch) {
    m = Number(mMatch[1]);
  }

  if (!hMatch && !mMatch) {
    if (looksLikeClockTime) {
      return null;
    }
    if (/^\d+$/.test(source)) {
      m = Number(source);
    } else {
      const anyNum = source.match(/(\d+)/);
      if (anyNum) {
        m = Number(anyNum[1]);
      } else {
        return null;
      }
    }
  }

  const total = Math.round(h * 60 + m);
  return Number.isFinite(total) && total > 0 ? total : null;
}

function parseTimePartDetailed(raw, cfg) {
  const input = normalizeText(raw).toLowerCase();
  const nowBase = DateTime.now().setZone(cfg.baseTz);
  const nowMsk = nowBase.setZone(cfg.moscowTz);

  const asClock = input.match(/(\d{1,2})[:.](\d{2})/);
  const hasToday = /(^|\s)(today|сегодня)(\s|$)/iu.test(input);
  const hasYesterday = /(^|\s)(yesterday|вчера)(\s|$)/iu.test(input);
  const hasDayBeforeYesterday = /(^|\s)(позавчера|day before yesterday)(\s|$)/iu.test(input);
  const weekdayHit = WEEKDAY_RULES.find((x) => x.regex.test(input)) || null;

  const dateRu = input.match(/(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?/);
  const dateIso = input.match(/(\d{4})-(\d{2})-(\d{2})/);
  const meridiemMatch = input.match(MERIDIEM_REGEX);
  const meridiem = meridiemMatch ? meridiemMatch[1] : null;

  let day = nowMsk;
  if (hasDayBeforeYesterday) {
    day = day.minus({ days: 2 });
  } else if (hasYesterday) {
    day = day.minus({ days: 1 });
  }

  if (dateRu) {
    const d = Number(dateRu[1]);
    const mo = Number(dateRu[2]);
    const y = Number(dateRu[3] || nowMsk.year);
    day = DateTime.fromObject({ year: y, month: mo, day: d, zone: cfg.moscowTz });
  } else if (dateIso) {
    const y = Number(dateIso[1]);
    const mo = Number(dateIso[2]);
    const d = Number(dateIso[3]);
    day = DateTime.fromObject({ year: y, month: mo, day: d, zone: cfg.moscowTz });
  } else if (weekdayHit) {
    if (weekdayHit.weekday > nowMsk.weekday) {
      return { ok: false, errorCode: "future_weekday" };
    }
    const currentWeekMonday = nowMsk.startOf("day").minus({ days: nowMsk.weekday - 1 });
    day = currentWeekMonday.plus({ days: weekdayHit.weekday - 1 });
  }

  let hour = null;
  let minute = null;
  if (asClock) {
    hour = Number(asClock[1]);
    minute = Number(asClock[2]);
    hour = applyWorkdayAfternoonHeuristic(hour, meridiem);
  } else {
    const natural = parseNaturalTime(input);
    if (!natural) return { ok: false, errorCode: "invalid_time" };
    hour = natural.hour;
    minute = natural.minute;
  }

  if (hour > 23 || minute > 59) return { ok: false, errorCode: "invalid_time" };

  let start = DateTime.fromObject(
    {
      year: day.year,
      month: day.month,
      day: day.day,
      hour,
      minute,
      second: 0,
      millisecond: 0
    },
    { zone: cfg.moscowTz }
  );

  if (!hasToday && !hasYesterday && !hasDayBeforeYesterday && !weekdayHit && !dateRu && !dateIso && start > nowMsk.plus({ minutes: 5 })) {
    start = start.minus({ days: 1 });
  }

  if (!start.isValid) return { ok: false, errorCode: "invalid_time" };
  return { ok: true, value: start };
}

function parseTimePart(raw, cfg) {
  const parsed = parseTimePartDetailed(raw, cfg);
  return parsed.ok ? parsed.value : null;
}

function detectLabeled(part) {
  const lower = normalizeText(part).toLowerCase();
  const idx = lower.indexOf(":");
  if (idx <= 0) return null;

  const key = lower.slice(0, idx).trim();
  const value = part.slice(idx + 1).trim();
  if (!value) return null;

  if (["project", "проект"].includes(key)) return { kind: "project", value };
  if (["task", "работа", "задача"].includes(key)) return { kind: "task", value };
  if (["start", "начало", "время начала"].includes(key)) return { kind: "start", value };
  if (["duration", "длительность"].includes(key)) return { kind: "duration", value };
  return null;
}

function removeCommandPrefix(text) {
  const clean = normalizeText(text);
  const firstLabelIdx = clean.search(/(?<!\S)(проект|работа|задача|время начала|начало|длительность|project|task|start|duration)(?!\S)/iu);
  if (firstLabelIdx > 0) {
    return clean.slice(firstLabelIdx).trim();
  }
  if (/clockify/i.test(clean) && clean.includes(":")) {
    return clean.slice(clean.indexOf(":") + 1).trim();
  }
  return clean
    .replace(/^\s*занеси\s+в\s+clockify\s*[.:,-]?\s*/i, "")
    .replace(/^\s*add\s+to\s+clockify\s*[:,-]?\s*/i, "")
    .trim();
}

function preprocessTranscribedText(text) {
  return normalizeText(text)
    .replace(/[“”«»"]/g, "")
    .replace(/(?<!\S)(слэш|slash)(?!\S)/giu, "/")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripFieldLabel(value, kind) {
  const source = normalizeText(value);
  if (kind === "project") {
    return source.replace(/^(project|проект)\s*[:\-]?\s*/i, "").trim();
  }
  if (kind === "task") {
    return source.replace(/^(task|работа|задача)\s*[:\-]?\s*/i, "").trim();
  }
  if (kind === "start") {
    return source.replace(/^(start|начало|время начала)\s*[:\-]?\s*/i, "").trim();
  }
  if (kind === "duration") {
    return source.replace(/^(duration|длительность)\s*[:\-]?\s*/i, "").trim();
  }
  return source.trim();
}

function parseLabeledFallback(source) {
  const text = normalizeText(source);
  const directProject = text.match(/(?:^|[\s.:,;-])(?:project|проект)\s+(.+?)(?=[\s.:,;-]+(?:task|работа|задача)(?=\s|$))/i);
  const directTask = text.match(/(?:^|[\s.:,;-])(?:task|работа|задача)\s+(.+?)(?=[\s.:,;-]+(?:start|начало|время начала|duration|длительность)(?=\s|$))/i);
  const directStart = text.match(/(?:^|[\s.:,;-])(?:start|начало|время начала)\s+(.+?)(?=[\s.:,;-]+(?:duration|длительность)(?=\s|$))/i);
  const directDuration = text.match(/(?:^|[\s.:,;-])(?:duration|длительность)\s+(.+)$/i);
  if (directProject && directTask && directStart && directDuration) {
    return {
      projectQuery: stripFieldLabel(directProject[1], "project"),
      taskQuery: stripFieldLabel(directTask[1], "task"),
      startRaw: stripFieldLabel(directStart[1], "start"),
      durationRaw: stripFieldLabel(directDuration[1], "duration")
    };
  }

  const rx = /(?<!\S)(время начала|длительность|проект|работа|задача|project|task|start|duration|начало)(?!\S)/giu;
  const labels = [];
  let m = rx.exec(text);
  while (m) {
    labels.push({ raw: m[1].toLowerCase(), index: m.index, end: m.index + m[0].length });
    m = rx.exec(text);
  }
  if (!labels.length) return null;

  const out = { projectQuery: "", taskQuery: "", startRaw: "", durationRaw: "" };
  for (let i = 0; i < labels.length; i += 1) {
    const cur = labels[i];
    const next = labels[i + 1];
    const value = text.slice(cur.end, next ? next.index : text.length).replace(/^[\s:.,;!?-]+|[\s:.,;!?-]+$/g, "");
    if (!value) continue;

    if ((cur.raw === "проект" || cur.raw === "project") && !out.projectQuery) {
      out.projectQuery = stripFieldLabel(value, "project");
      continue;
    }
    if ((cur.raw === "работа" || cur.raw === "задача" || cur.raw === "task") && !out.taskQuery) {
      out.taskQuery = stripFieldLabel(value, "task");
      continue;
    }
    if ((cur.raw === "время начала" || cur.raw === "начало" || cur.raw === "start") && !out.startRaw) {
      out.startRaw = stripFieldLabel(value, "start");
      continue;
    }
    if ((cur.raw === "длительность" || cur.raw === "duration") && !out.durationRaw) {
      out.durationRaw = stripFieldLabel(value, "duration");
    }
  }

  if (!out.projectQuery || !out.taskQuery || !out.startRaw || !out.durationRaw) return null;
  return out;
}

function parseTrackingCommand(input, cfg) {
  const source = squashDictatedLetters(preprocessTranscribedText(removeCommandPrefix(input)));
  const parts = source
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);

  let fallback = null;
  if (parts.length < 4) {
    fallback = parseLabeledFallback(source);
  }

  if (parts.length < 4 && !fallback) {
    return {
      ok: false,
      error: "Format: Add to Clockify: <Project> / <Task> / <Start time> / <Duration>"
    };
  }

  const labeled = {};
  const unlabeled = [];
  for (const part of parts) {
    const d = detectLabeled(part);
    if (d) {
      labeled[d.kind] = d.value;
    } else {
      unlabeled.push(part);
    }
  }

  let durationRaw = labeled.duration || (fallback && fallback.durationRaw) || "";
  let startRaw = labeled.start || (fallback && fallback.startRaw) || "";

  if (!durationRaw || !startRaw) {
    for (const part of unlabeled) {
      if (!startRaw && parseTimePart(part, cfg)) {
        startRaw = part;
        continue;
      }
      if (!durationRaw && parseDurationMinutes(part)) {
        durationRaw = part;
      }
    }
  }

  const remaining = unlabeled.filter((p) => p !== durationRaw && p !== startRaw);
  const projectQuery = stripFieldLabel((fallback && fallback.projectQuery) || labeled.project || remaining[0] || "", "project");
  const taskQuery = stripFieldLabel((fallback && fallback.taskQuery) || labeled.task || remaining[1] || "", "task");
  durationRaw = stripFieldLabel(durationRaw, "duration");
  startRaw = stripFieldLabel(startRaw, "start");

  const durationMinutes = parseDurationMinutes(durationRaw);
  if (!durationMinutes) {
    return { ok: false, error: "Duration not recognized. Example: 1h 30m or 45m" };
  }

  const startParsed = parseTimePartDetailed(startRaw, cfg);
  if (!startParsed.ok) {
    if (startParsed.errorCode === "future_weekday") {
      return { ok: false, code: "future_weekday", error: FUTURE_WEEKDAY_ERROR_MESSAGE };
    }
    return { ok: false, error: "Start time not recognized. Example: 10:30 or today 10:30" };
  }
  const startMsk = startParsed.value;

  if (!projectQuery || !taskQuery) {
    return { ok: false, error: "Project and task are required." };
  }

  const endMsk = startMsk.plus({ minutes: durationMinutes });

  return {
    ok: true,
    value: {
      projectQuery,
      taskQuery,
      durationMinutes,
      startMskIso: startMsk.toISO(),
      endMskIso: endMsk.toISO(),
      startMskView: startMsk.toFormat("dd.LL.yyyy HH:mm"),
      endMskView: endMsk.toFormat("dd.LL.yyyy HH:mm")
    }
  };
}

function isReportCommand(input) {
  const source = normalizeText(input).toLowerCase();
  if (!source) return false;
  return /(^|\s)пришли\s+отч[её]т(\s|$)/u.test(source) || /(^|\s)send\s+report(\s|$)/.test(source);
}

function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

module.exports = {
  parseTrackingCommand,
  formatMinutes,
  parseTimePart,
  isReportCommand
};

