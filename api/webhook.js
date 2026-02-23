const dotenv = require("dotenv");
const { getConfig } = require("../src/config");
const { authorizeTelegramUser } = require("../src/auth");
const { createTelegramClient } = require("../src/telegram");
const { transcribeVoice } = require("../src/stt");
const { parseTrackingCommand, formatMinutes, isReportCommand } = require("../src/parser");
const { parseCommandWithAi } = require("../src/aiParser");
const { rankByName, isLowConfidence, normalizeText } = require("../src/fuzzy");
const { listProjects, getCurrentUser, createTimeEntry } = require("../src/clockify");
const { createPending, getPending, deletePending, prunePending } = require("../src/store");
const { buildChoiceKeyboard, successMessage } = require("../src/ui");
const { syncDashboardFiles, recordUsageEvent, buildUsageReportMessage } = require("../src/activity");

dotenv.config();

function pickTop3(ranked) {
  return ranked.slice(0, 3);
}

function isSupportedCommandPrefix(text) {
  const source = String(text || "").trim().toLowerCase();
  return /(^|\s)(занеси|занести|добавь|добавить)\s+.*cl(?:o|oc)kify(\s|$)/u.test(source) || /(^|\s)add\s+to\s+clockify(\s|$)/.test(source);
}

function looksLikeTrackingCommand(text) {
  const source = String(text || "").trim().toLowerCase();
  if (!source) return false;
  if (isSupportedCommandPrefix(source)) return true;
  if (source.includes("/")) return true;

  const hasProject = /(^|\s)(проект|project)(\s|:|$)/u.test(source);
  const hasTask = /(^|\s)(работа|задача|task)(\s|:|$)/u.test(source);
  const hasStart = /(^|\s)(время начала|начало|start)(\s|:|$)/u.test(source);
  const hasDuration = /(^|\s)(длительность|duration)(\s|:|$)/u.test(source);
  return hasProject && hasTask && (hasStart || hasDuration);
}

function maybeDecodeCp1251Mojibake(text) {
  const source = String(text || "");
  if (!source) return source;

  // Typical mojibake marker for UTF-8 text decoded as CP1251: "Р...", "С..." bursts.
  const burstCount = (source.match(/[РС][^\s]/g) || []).length;
  if (burstCount < 6) {
    return source;
  }

  const bytes = [];
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    if (code <= 0x7f) {
      bytes.push(code);
      continue;
    }
    if (code === 0x0401) { // Ё
      bytes.push(0xa8);
      continue;
    }
    if (code === 0x0451) { // ё
      bytes.push(0xb8);
      continue;
    }
    if (code >= 0x0410 && code <= 0x044f) {
      bytes.push(code - 0x350);
      continue;
    }
    // Unknown char for CP1251 map: keep as original to avoid damaging text.
    return source;
  }

  const decoded = Buffer.from(bytes).toString("utf8");
  return decoded && decoded.trim() ? decoded : source;
}

function hasExplicitDateReference(text) {
  const source = normalizeText(text).toLowerCase();
  if (!source) return false;
  return /(^|\s)(вчера|позавчера|yesterday|day before yesterday)(\s|$)/iu.test(source)
    || /(^|\s)(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)(\s|$)/iu.test(source)
    || /(^|\s)(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(\s|$)/i.test(source);
}

function extractProjectLabelSegment(text) {
  const source = normalizeText(text);
  if (!source) return "";
  const match = source.match(/(?:^|\s)(?:project|проект)\s+/iu);
  if (!match) return "";

  const start = (match.index || 0) + String(match[0] || "").length;
  let segment = source.slice(start).trim();
  if (!segment) return "";

  const stopMatch = segment.match(/\s(?:task|работа|задача|start|начало|время начала|duration|длительность)(?:\s|$)/iu);
  if (stopMatch && typeof stopMatch.index === "number" && stopMatch.index >= 0) {
    segment = segment.slice(0, stopMatch.index).trim();
  }

  return segment;
}

const RU_UNITS = {
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
  "девять": 9
};

const RU_TEENS = {
  "десять": 10,
  "одиннадцать": 11,
  "двенадцать": 12,
  "тринадцать": 13,
  "четырнадцать": 14,
  "пятнадцать": 15,
  "шестнадцать": 16,
  "семнадцать": 17,
  "восемнадцать": 18,
  "девятнадцать": 19
};

const RU_TENS = {
  "двадцать": 20,
  "тридцать": 30,
  "сорок": 40,
  "пятьдесят": 50,
  "шестьдесят": 60,
  "семьдесят": 70,
  "восемьдесят": 80,
  "девяносто": 90
};

const EN_UNITS = {
  "zero": 0,
  "one": 1,
  "two": 2,
  "three": 3,
  "four": 4,
  "five": 5,
  "six": 6,
  "seven": 7,
  "eight": 8,
  "nine": 9
};

const EN_TEENS = {
  "ten": 10,
  "eleven": 11,
  "twelve": 12,
  "thirteen": 13,
  "fourteen": 14,
  "fifteen": 15,
  "sixteen": 16,
  "seventeen": 17,
  "eighteen": 18,
  "nineteen": 19
};

const EN_TENS = {
  "twenty": 20,
  "thirty": 30,
  "forty": 40,
  "fifty": 50,
  "sixty": 60,
  "seventy": 70,
  "eighty": 80,
  "ninety": 90
};

function parseRomanInt(token) {
  if (!/^(?=[ivxlcdm]+$)[ivxlcdm]{1,8}$/i.test(token)) return null;
  const src = String(token || "").toUpperCase();
  const map = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let i = 0; i < src.length; i += 1) {
    const cur = map[src[i]];
    const next = map[src[i + 1]] || 0;
    if (!cur) return null;
    total += cur < next ? -cur : cur;
  }
  return total > 0 ? total : null;
}

function parseRuNumberAt(tokens, index) {
  const one = tokens[index];
  const two = tokens[index + 1];
  if (!one) return null;
  if (Object.prototype.hasOwnProperty.call(RU_TEENS, one)) {
    return { value: RU_TEENS[one], consumed: 1 };
  }
  if (Object.prototype.hasOwnProperty.call(RU_TENS, one)) {
    const base = RU_TENS[one];
    if (two && Object.prototype.hasOwnProperty.call(RU_UNITS, two)) {
      return { value: base + RU_UNITS[two], consumed: 2 };
    }
    return { value: base, consumed: 1 };
  }
  if (Object.prototype.hasOwnProperty.call(RU_UNITS, one)) {
    return { value: RU_UNITS[one], consumed: 1 };
  }
  return null;
}

function parseEnNumberAt(tokens, index) {
  const one = tokens[index];
  const two = tokens[index + 1];
  if (!one) return null;
  if (Object.prototype.hasOwnProperty.call(EN_TEENS, one)) {
    return { value: EN_TEENS[one], consumed: 1 };
  }
  if (Object.prototype.hasOwnProperty.call(EN_TENS, one)) {
    const base = EN_TENS[one];
    if (two && Object.prototype.hasOwnProperty.call(EN_UNITS, two)) {
      return { value: base + EN_UNITS[two], consumed: 2 };
    }
    return { value: base, consumed: 1 };
  }
  if (Object.prototype.hasOwnProperty.call(EN_UNITS, one)) {
    return { value: EN_UNITS[one], consumed: 1 };
  }
  return null;
}

function extractNumericValues(text) {
  const source = normalizeText(text).toLowerCase();
  if (!source) return [];
  const tokens = source.split(/\s+/).filter(Boolean);
  const values = [];
  const seen = new Set();

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (/^\d{1,4}$/.test(token)) {
      const value = Number(token);
      const key = String(value);
      if (!seen.has(key)) {
        seen.add(key);
        values.push(key);
      }
      continue;
    }

    const romanValue = parseRomanInt(token);
    if (romanValue != null) {
      const key = String(romanValue);
      if (!seen.has(key)) {
        seen.add(key);
        values.push(key);
      }
      continue;
    }

    const ruParsed = parseRuNumberAt(tokens, i);
    if (ruParsed) {
      const key = String(ruParsed.value);
      if (!seen.has(key)) {
        seen.add(key);
        values.push(key);
      }
      i += ruParsed.consumed - 1;
      continue;
    }

    const enParsed = parseEnNumberAt(tokens, i);
    if (enParsed) {
      const key = String(enParsed.value);
      if (!seen.has(key)) {
        seen.add(key);
        values.push(key);
      }
      i += enParsed.consumed - 1;
    }
  }

  return values;
}

function hasNumericMarker(text) {
  return extractNumericValues(text).length > 0;
}

function extractNumericMarkers(text) {
  return extractNumericValues(text);
}

function stripNumericMarkers(text) {
  const source = normalizeText(text).toLowerCase();
  if (!source) return "";
  const tokens = source.split(/\s+/).filter(Boolean);
  const kept = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (/^\d{1,4}$/.test(token)) continue;
    if (parseRomanInt(token) != null) continue;

    const ruParsed = parseRuNumberAt(tokens, i);
    if (ruParsed) {
      i += ruParsed.consumed - 1;
      continue;
    }

    const enParsed = parseEnNumberAt(tokens, i);
    if (enParsed) {
      i += enParsed.consumed - 1;
      continue;
    }

    kept.push(token);
  }

  return kept.join(" ").trim();
}

function enrichProjectQueryWithSourceNumerals(commandText, projectQuery) {
  const query = String(projectQuery || "").trim();
  if (!query) return query;

  const segment = extractProjectLabelSegment(commandText);
  if (!segment) return query;

  const sourceMarkers = extractNumericMarkers(segment);
  if (!sourceMarkers.length) return query;

  const queryMarkers = extractNumericMarkers(query);
  if (!queryMarkers.length) {
    return `${query} ${sourceMarkers.join(" ")}`.trim();
  }

  const sameMarker = queryMarkers.some((marker) => sourceMarkers.includes(marker));
  if (sameMarker) {
    return query;
  }

  const queryBase = stripNumericMarkers(query);
  if (!queryBase) {
    return `${query} ${sourceMarkers.join(" ")}`.trim();
  }

  return `${queryBase} ${sourceMarkers.join(" ")}`.trim();
}

function enrichProjectQueryWithEmbeddedNumerals(commandText, projectQuery) {
  const query = String(projectQuery || "").trim();
  if (!query) return query;
  if (hasNumericMarker(query)) return query;

  const source = normalizeText(commandText).toLowerCase();
  if (!source) return query;
  const queryTokens = normalizeText(query).toLowerCase().split(/\s+/).filter(Boolean);
  const sourceTokens = source.split(/\s+/).filter(Boolean);
  if (!queryTokens.length || !sourceTokens.length) return query;

  // Find numeric tokens immediately following a fuzzy-stem token from query (e.g. "powerapp 17").
  const queryStems = new Set(queryTokens.map((t) => t.replace(/[^a-zа-я0-9]+/giu, "")));
  const collected = [];
  const seen = new Set();
  for (let i = 0; i < sourceTokens.length; i += 1) {
    const token = sourceTokens[i];
    const stem = token.replace(/[^a-zа-я0-9]+/giu, "");
    if (!stem) continue;
    const matchedStem = [...queryStems].some((qStem) => qStem && (stem.includes(qStem) || qStem.includes(stem)));
    if (!matchedStem) continue;

    const nextOne = sourceTokens[i + 1] || "";
    const nextTwo = sourceTokens[i + 2] || "";
    const local = extractNumericMarkers(`${nextOne} ${nextTwo}`.trim());
    for (const marker of local) {
      if (!seen.has(marker)) {
        seen.add(marker);
        collected.push(marker);
      }
    }
  }

  if (!collected.length) return query;

  return `${query} ${collected.join(" ")}`.trim();
}

function enrichProjectQueryNumerals(commandText, projectQuery) {
  const withLabel = enrichProjectQueryWithSourceNumerals(commandText, projectQuery);
  return enrichProjectQueryWithEmbeddedNumerals(commandText, withLabel);
}

async function sendDebug(telegram, chatId, cfg, lines) {
  if (!cfg.debugBotFlow) return;
  const message = ["[debug]", ...lines].join("\n");
  try {
    await telegram.sendText(chatId, message.slice(0, 3500));
  } catch (_err) {
    // Debug output should never break command flow.
  }
}

async function readRawRequestBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        const err = new Error("Payload too large");
        err.statusCode = 413;
        reject(err);
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    req.on("error", reject);
  });
}

async function parseTelegramUpdate(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch (_err) {
      const err = new Error("Invalid JSON body");
      err.statusCode = 400;
      throw err;
    }
  }

  if (Buffer.isBuffer(req.body)) {
    try {
      return JSON.parse(req.body.toString("utf8") || "{}");
    } catch (_err) {
      const err = new Error("Invalid JSON body");
      err.statusCode = 400;
      throw err;
    }
  }

  if (req && typeof req.on === "function") {
    const raw = await readRawRequestBody(req, 2 * 1024 * 1024);
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch (_err) {
      const err = new Error("Invalid JSON body");
      err.statusCode = 400;
      throw err;
    }
  }

  return {};
}

const COMMAND_FORMAT_MESSAGE = [
  "Извини, я понимаю только команды в формате:",
  "Занеси в Clockify",
  "Проект: <название проекта>",
  "Работа:  <описание задачи>",
  "Время начала: <время начала>",
  "Длительность: <в часах или минутах>"
].join("\n");

async function resolveProject(cfg, telegram, chatId, telegramUserId, parsed, usageMeta) {
  const projects = await listProjects(cfg);
  const ranked = rankByName(projects, parsed.projectQuery);
  const topForDebug = ranked.slice(0, Math.max(1, cfg.debugProjectTop || 5));

  await sendDebug(telegram, chatId, cfg, [
    `projectQuery: ${parsed.projectQuery}`,
    `rankedTop: ${topForDebug.map((x) => `${x.score.toFixed(3)} | ${x.item.name}`).join(" || ")}`
  ]);

  if (!ranked.length || ranked[0].score < 0.35) {
    await telegram.sendText(chatId, "Проект не найден. Попробуйте ещё раз.");
    return { ok: false, final: true, reason: "project_not_found" };
  }

  if (isLowConfidence(ranked) && ranked.length > 1) {
    const top = pickTop3(ranked);
    if (!cfg.interactiveSelection) {
      const choices = top.map((x, idx) => `${idx + 1}. ${x.item.name}`).join("\n");
      await telegram.sendText(
        chatId,
        [
          "Найдено несколько похожих проектов:",
          choices,
          "Пришлите команду ещё раз и укажите точное название проекта."
        ].join("\n")
      );
      return { ok: false, final: true, reason: "project_choice_required_exact_name" };
    }

    const pendingId = await createPending(
      cfg,
      {
        type: "project",
        ownerTelegramId: telegramUserId,
        parsed,
        candidates: top.map((x) => ({ id: x.item.id, name: x.item.name })),
        usageMeta: usageMeta || null
      },
      cfg.pendingTtlMs
    );

    await telegram.sendInlineKeyboard(
      chatId,
      "Выбери проект или нажми <отмена>",
      buildChoiceKeyboard("PROJECT", pendingId, top)
    );
    return { ok: false, final: false, reason: "project_choice_pending", pendingId };
  }

  return { ok: true, project: ranked[0].item };
}

async function createClockifyEntry(cfg, telegram, chatId, bindingUser, parsed, project) {
  const apiKey = bindingUser.clockifyApiKey || cfg.clockifyApiKey;

  try {
    // If personal key is not configured, verify that global key belongs to mapped email.
    if (!bindingUser.clockifyApiKey && bindingUser.clockifyEmail) {
      const me = await getCurrentUser(cfg, apiKey);
      const meEmail = String(me && me.email ? me.email : "").toLowerCase();
      if (meEmail && meEmail !== bindingUser.clockifyEmail) {
        await telegram.sendText(
          chatId,
          "Доступ к Clockify для этого пользователя запрещён. Добавьте персональный clockifyApiKey для вашего TG-аккаунта в users.json."
        );
        return { ok: false, reason: "clockify_forbidden_mapped_user" };
      }
    }

    await createTimeEntry(cfg, {
      projectId: project.id,
      taskId: null,
      startIso: parsed.startMskIso,
      endIso: parsed.endMskIso,
      description: parsed.taskQuery,
      apiKey
    });

    await telegram.sendText(
      chatId,
      successMessage({
        projectName: project.name,
        taskName: parsed.taskQuery,
        startMskView: parsed.startMskView,
        endMskView: parsed.endMskView,
        durationView: formatMinutes(parsed.durationMinutes)
      })
    );
    return { ok: true };
  } catch (err) {
    const msg = err.response && err.response.data && err.response.data.message ? String(err.response.data.message) : "Could not create time entry";
    if (err.response && err.response.status === 403) {
      await telegram.sendText(
        chatId,
        "Доступ к Clockify запрещён. Добавьте персональный clockifyApiKey для вашего TG-аккаунта в users.json."
      );
      return { ok: false, reason: "clockify_403" };
    }
    await telegram.sendText(chatId, `Ошибка Clockify: ${msg}. Попробуйте ещё раз.`);
    return { ok: false, reason: "clockify_error" };
  }
}

async function processCommand(cfg, telegram, chatId, telegramUser, bindingUser, commandText, usageMeta) {
  let parserUsed = "rules";
  let parsed = parseTrackingCommand(commandText, cfg);
  if (!parsed.ok) {
    if (!hasExplicitDateReference(commandText)) {
      const aiParsed = await parseCommandWithAi(cfg, commandText);
      if (aiParsed) {
        parsed = { ok: true, value: aiParsed };
        parserUsed = "ai";
      }
    }
  }

  if (parsed.ok) {
    parsed.value.projectQuery = enrichProjectQueryNumerals(commandText, parsed.value.projectQuery);
    await sendDebug(telegram, chatId, cfg, [
      `parser: ${parserUsed}`,
      `projectQuery: ${parsed.value.projectQuery}`,
      `taskQuery: ${parsed.value.taskQuery}`,
      `start: ${parsed.value.startMskView}`,
      `durationMinutes: ${parsed.value.durationMinutes}`
    ]);
  } else {
    await sendDebug(telegram, chatId, cfg, [
      `parser: fail`,
      `error: ${parsed.error || "unknown parse error"}`
    ]);
  }

  if (!parsed.ok) {
    if (parsed.code === "future_weekday") {
      await telegram.sendText(chatId, parsed.error);
      return { final: true, status: "failed", reason: "future_weekday" };
    }
    await telegram.sendText(chatId, COMMAND_FORMAT_MESSAGE);
    return { final: true, status: "failed", reason: "parse_failed" };
  }

  const projectResolved = await resolveProject(cfg, telegram, chatId, String(telegramUser.id), parsed.value, usageMeta);
  if (!projectResolved.ok) {
    if (projectResolved.final) {
      return { final: true, status: "failed", reason: projectResolved.reason || "project_resolution_failed" };
    }
    return { final: false, status: "pending", reason: projectResolved.reason || "pending_selection", pendingId: projectResolved.pendingId };
  }

  const entry = await createClockifyEntry(cfg, telegram, chatId, bindingUser, parsed.value, projectResolved.project);
  if (!entry || !entry.ok) {
    return { final: true, status: "failed", reason: (entry && entry.reason) || "clockify_create_failed" };
  }

  return { final: true, status: "success", reason: "time_entry_created" };
}

function parseCallbackData(data) {
  const parts = String(data || "").split("|");
  if (parts[0] === "CANCEL" && parts[1]) {
    return { type: "cancel", pendingId: parts[1] };
  }
  if ((parts[0] === "PROJECT" || parts[0] === "TASK") && parts[1] && parts[2] != null) {
    const index = Number(parts[2]);
    if (Number.isInteger(index) && index >= 0 && index <= 2) {
      return { type: parts[0].toLowerCase(), pendingId: parts[1], index };
    }
  }
  return null;
}

async function handleCallback(cfg, telegram, callback) {
  const cq = callback || {};
  const tgUser = cq.from;
  const chatId = cq.message && cq.message.chat ? cq.message.chat.id : null;
  if (!tgUser || !chatId) return;

  const auth = authorizeTelegramUser(cfg, tgUser);
  if (!auth.ok) {
    await telegram.answerCallbackQuery(cq.id, "Недоступно");
    return;
  }

  const parsedData = parseCallbackData(cq.data);
  if (!parsedData) {
    await telegram.answerCallbackQuery(cq.id, "Неверная кнопка");
    return;
  }

  const pending = await getPending(cfg, parsedData.pendingId);
  if (!pending) {
    await telegram.answerCallbackQuery(cq.id, "Выбор устарел");
    return;
  }

  if (String(pending.ownerTelegramId) !== String(tgUser.id)) {
    await telegram.answerCallbackQuery(cq.id, "Это не ваш выбор");
    return;
  }

  if (parsedData.type === "cancel") {
    await deletePending(cfg, parsedData.pendingId);
    await telegram.answerCallbackQuery(cq.id, "Отменено");
    await telegram.sendText(chatId, "Операция прервана. Попробуй прислать аудио сообщение заново.");
    if (pending.usageMeta) {
      await recordUsageEvent(cfg, {
        ...pending.usageMeta,
        status: "failed",
        reason: "user_canceled_selection"
      });
    }
    return;
  }

  const candidate = pending.candidates[parsedData.index];
  if (!candidate) {
    await telegram.answerCallbackQuery(cq.id, "Вариант не найден");
    return;
  }

  await telegram.answerCallbackQuery(cq.id, "Принято");

  if (pending.type === "project" && parsedData.type === "project") {
    await deletePending(cfg, parsedData.pendingId);

    const project = { id: candidate.id, name: candidate.name };
    const result = await createClockifyEntry(cfg, telegram, chatId, auth.user, pending.parsed, project);
    if (pending.usageMeta) {
      await recordUsageEvent(cfg, {
        ...pending.usageMeta,
        status: result && result.ok ? "success" : "failed",
        reason: result && result.ok ? "time_entry_created_after_selection" : ((result && result.reason) || "clockify_create_failed_after_selection")
      });
    }
    return;
  }

  await telegram.sendText(chatId, "Неверный тип выбора. Попробуйте ещё раз.");
}

function createWebhookHandler() {
  return async function webhookHandler(req, res) {
    const revision = process.env.VERCEL_GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || "local";

    if (req.method === "GET") {
      return res.status(200).json({ ok: true, route: "webhook", revision });
    }

    if (req.method !== "POST") {
      return res.status(405).send("Method not allowed");
    }

    try {
      const cfg = getConfig();
      await prunePending(cfg);
      const telegram = createTelegramClient(cfg.telegramBotToken);
      await syncDashboardFiles(cfg);
      const update = await parseTelegramUpdate(req);

      const updateId = update && typeof update.update_id !== "undefined" ? update.update_id : null;
      if (update.callback_query) {
        const fromId = update.callback_query && update.callback_query.from ? update.callback_query.from.id : null;
        console.log("[webhook] callback", { revision, updateId, fromId });
      } else if (update.message || update.edited_message) {
        const msg = update.message || update.edited_message;
        const fromId = msg && msg.from ? msg.from.id : null;
        const hasVoice = Boolean(msg && msg.voice);
        const hasText = Boolean(msg && msg.text);
        console.log("[webhook] message", { revision, updateId, fromId, hasVoice, hasText });
      } else {
        console.log("[webhook] non-message update", { revision, updateId, keys: Object.keys(update || {}) });
      }

      if (update.callback_query) {
        await handleCallback(cfg, telegram, update.callback_query);
        return res.status(200).json({ ok: true, callback: true });
      }

      const message = update.message || update.edited_message;
      if (!message || !message.chat || !message.from) {
        return res.status(200).json({ ok: true, ignored: "not_message" });
      }

      const chatId = message.chat.id;
      const tgUser = message.from;
      const auth = authorizeTelegramUser(cfg, tgUser);

      if (!auth.ok) {
        await telegram.sendText(chatId, "Доступ запрещён.");
        return res.status(200).json({ ok: true, denied: true });
      }

      const text = String(message.text || "").trim();
      if (text === "/start" || text === "/help") {
        await telegram.sendText(
          chatId,
          COMMAND_FORMAT_MESSAGE
        );
        return res.status(200).json({ ok: true, help: true });
      }

      let commandText = "";
      const sourceType = message.voice ? "voice" : (text ? "text" : "unknown");
      const usageMeta = {
        tgId: String(tgUser.id),
        email: auth.user && auth.user.clockifyEmail ? auth.user.clockifyEmail : "",
        source: sourceType
      };
      if (message.voice) {
        console.log("[webhook] voice:start", { revision, updateId, fromId: tgUser.id, voiceDuration: message.voice.duration || null });
        const stt = await transcribeVoice(cfg, telegram, message.voice);
        console.log("[webhook] voice:stt_result", {
          revision,
          updateId,
          ok: stt.ok,
          fallback: !!stt.fallback,
          textLength: stt.text ? String(stt.text).length : 0,
          textPreview: stt.text ? String(stt.text).slice(0, 180) : ""
        });
        if (!stt.ok) {
          await telegram.sendText(chatId, stt.message || "Речь не распознана. Попробуйте ещё раз.");
          await recordUsageEvent(cfg, {
            ...usageMeta,
            status: "failed",
            reason: "stt_failed"
          });
          console.log("[webhook] voice:stt_failed_response_sent", { revision, updateId });
          return res.status(200).json({ ok: true, stt_failed: true, fallback: !!stt.fallback });
        }
        commandText = maybeDecodeCp1251Mojibake(stt.text);
        await sendDebug(telegram, chatId, cfg, [
          `sttRaw: ${String(stt.text || "").slice(0, 800)}`,
          `sttDecoded: ${String(commandText || "").slice(0, 800)}`
        ]);
        if (!looksLikeTrackingCommand(commandText)) {
          console.log("[webhook] voice:weak_prefix_but_continue", { revision, updateId });
        }
      } else if (text) {
        commandText = maybeDecodeCp1251Mojibake(text);
        await sendDebug(telegram, chatId, cfg, [
          `inputText: ${String(commandText || "").slice(0, 800)}`
        ]);
        if (!looksLikeTrackingCommand(commandText) && !isReportCommand(commandText)) {
          await telegram.sendText(chatId, COMMAND_FORMAT_MESSAGE);
          await recordUsageEvent(cfg, {
            ...usageMeta,
            status: "failed",
            reason: "wrong_prefix_text"
          });
          console.log("[webhook] text:wrong_prefix_response_sent", { revision, updateId });
          return res.status(200).json({ ok: true, ignored: "wrong_prefix_text" });
        }
      } else {
        await telegram.sendText(chatId, COMMAND_FORMAT_MESSAGE);
        await recordUsageEvent(cfg, {
          ...usageMeta,
          status: "failed",
          reason: "empty_message"
        });
        console.log("[webhook] empty_message_response_sent", { revision, updateId });
        return res.status(200).json({ ok: true, ignored: "empty" });
      }

      if (isReportCommand(commandText)) {
        if (String(tgUser.id) !== cfg.reportOwnerTgId) {
          await telegram.sendText(chatId, "Команда отчета доступна только администратору.");
          return res.status(200).json({ ok: true, report: false, denied: true });
        }
        const reportText = await buildUsageReportMessage(cfg);
        await telegram.sendText(chatId, reportText);
        return res.status(200).json({ ok: true, report: true });
      }

      console.log("[webhook] command:processing", { revision, updateId });
      const outcome = await processCommand(cfg, telegram, chatId, tgUser, auth.user, commandText, usageMeta);
      if (outcome && outcome.final) {
        await recordUsageEvent(cfg, {
          ...usageMeta,
          status: outcome.status || "failed",
          reason: outcome.reason || "unknown"
        });
      }
      console.log("[webhook] command:processed", { revision, updateId });
      return res.status(200).json({ ok: true });
    } catch (err) {
      if (err && err.statusCode === 400) {
        return res.status(400).json({ ok: false, error: "Invalid JSON body" });
      }
      if (err && err.statusCode === 413) {
        return res.status(413).json({ ok: false, error: "Payload too large" });
      }
      const message = err && err.message ? err.message : "Internal error";
      console.error("Webhook error:", message, err && err.stack ? err.stack : "");
      return res.status(500).json({ ok: false, error: "Internal error" });
    }
  };
}

module.exports = createWebhookHandler();
module.exports.createWebhookHandler = createWebhookHandler;

