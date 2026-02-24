# ClockifyTGbot

Telegram-бот для занесения времени в Clockify из голосовых и текстовых сообщений с деплоем на Vercel.

## 1. Цели и задачи приложения

### Цель
Сократить время на трекинг задач в Clockify: пользователь отправляет голосовую или текстовую команду в Telegram, бот распознает данные и создает time entry.

### Задачи
- Принимать команды из Telegram через webhook.
- Ограничивать доступ только разрешенными пользователями (allow-list).
- Распознавать голос (STT) и парсить свободный текст команд.
- Надежно находить проект в Clockify, даже при неточном вводе.
- Создавать записи времени в рабочем пространстве Clockify.
- Показывать статистику использования (дашборд + API).

## 2. Основные модули и особенности работы

### Основные модули
- `api/webhook.js` — главный webhook-хендлер Telegram.
- `api/health.js` — health-check и проверка готовности окружения.
- `api/stats.js` — API для дашборда статистики.
- `src/config.js` — загрузка и нормализация переменных окружения.
- `src/auth.js`, `src/store.js` — авторизация Telegram-пользователей и работа с allow-list.
- `src/stt.js` — распознавание голосовых сообщений через OpenAI (`whisper-1` по умолчанию).
- `src/parser.js` — rule-based парсер команды.
- `src/aiParser.js` — AI fallback-парсер (если rule-based не сработал).
- `src/fuzzy.js` — fuzzy matching названий проектов.
- `src/clockify.js` — интеграция с Clockify API.
- `src/activity.js` — сбор статистики и формирование данных/HTML дашборда.
- `src/ui.js` — тексты и клавиатуры (в т.ч. кнопки выбора проекта).
- `index.html` — клиентский дашборд "Статистика ClockifyTGbot".

### Управление пользователями
- Доступ к боту только по allow-list.
- Источник пользователей:
  - `USERS_JSON` (рекомендуется для Vercel), или
  - `USERS_DATA_PATH` (локальный файл).
- Поддерживаются:
  - общий `CLOCKIFY_API_KEY` (fallback),
  - персональные `clockifyApiKey` на пользователя.

Пример `USERS_JSON`:

```json
{"users":[{"tgId":"123456789","clockifyEmail":"user@company.com","clockifyApiKey":"clockify_personal_api_key","active":true}]}
```

### Правила парсера времени (rule-based)
Парсер поддерживает как форматы вида `10:30`, так и разговорные формы:
- `час тридцать` -> `13:30`
- `два пятнадцать` -> `14:15`
- `пол третьего` -> `14:30`

Логика дневного сдвига:
- если не указаны маркеры `утра/дня/вечера`, часы `1..7` интерпретируются как `13..19`;
- часы `8..11` остаются утренними;
- пример: `восемь тридцать` -> `08:30`, а не `20:30`.

Дополнительно поддерживаются даты `вчера/позавчера`, дни недели, и запрет будущих дней в текущей неделе.

### Fuzzy match логика проектов
Поиск проекта работает с учетом:
- опечаток и неполных названий,
- транслитерации RU/LAT,
- римских и арабских чисел (например, `17` <-> `XVII`),
- слепленных форм (`PowerApp17` -> `PowerApp 17`).

При низкой уверенности бот предлагает top-3 проекта кнопками Telegram.
Состояние выбора хранится с TTL (`PENDING_TTL_MS`) в KV (для стабильной работы serverless-инстансов).

### Дашборд статистики
- UI: `GET /` (`index.html`).
- API: `GET /api/stats`.
- Автообновление на странице каждые 10 секунд.
- Показатели: востребованность (сегодня/всего/успешно/ошибки) + последние обращения.
- E-mail в дашборде маскируются: часть между `@` и `.ru` заменяется на `*`.

## 3. Архитектура (техническая реализация)

### Поток обработки
1. Telegram отправляет update в `POST /api/webhook`.
2. Бот проверяет пользователя в allow-list.
3. Для voice: скачивание файла из Telegram -> STT через OpenAI.
4. Парсинг команды:
   - сначала `src/parser.js` (правила),
   - при неуспехе — `src/aiParser.js`.
5. Поиск проекта через `src/fuzzy.js` + список проектов из Clockify.
6. Создание time entry через `src/clockify.js`.
7. Логирование результата в `src/activity.js`.
8. Отдача статистики в `/api/stats` и отображение в `/`.

### Хранилище статистики и pending-состояния
`src/activity.js` поддерживает режимы:
- `file` — локальные файлы (`data/activity.json`, `data/activity.csv`, `index.html`),
- `memory` — in-memory,
- `kv` — Vercel KV / Upstash (рекомендуется для продакшна на Vercel).

Для интерактивных кнопок выбора проекта pending-состояния хранятся в KV, чтобы callbacks корректно обрабатывались между разными serverless-вызовами.

### Роуты
- `GET /api/health` — проверка готовности сервиса и env.
- `POST /api/webhook` — обработка Telegram updates.
- `GET /api/stats` — данные для дашборда.
- `GET /` — dashboard UI.

## 4. Детали установки и настройки

### Требования
- Node.js 18+
- Telegram Bot Token
- OpenAI API Key
- Clockify Workspace ID
- Clockify API key (общий и/или персональные)

### 4.1 Локальная установка
1. Установить зависимости:

```bash
npm install
```

2. Создать `.env` (или использовать ваш локальный шаблон для Vercel-копирования) на основе `.env.example`.

3. Проверить код:

```bash
npm run check
```

4. Запустить локально:

```bash
npm start
```

5. Проверить health:

- `http://127.0.0.1:3010/api/health`

### 4.2 Настройка через GitHub -> Vercel
1. Запушить код в GitHub:
- `https://github.com/suezergut-sys/ClockifyTGbot2`

2. Импортировать репозиторий в Vercel (`Framework Preset: Other`).

3. Добавить env в `Project Settings -> Environment Variables`.

Обязательные:
- `TELEGRAM_BOT_TOKEN`
- `OPENAI_API_KEY`
- `CLOCKIFY_WORKSPACE_ID`
- `CLOCKIFY_API_KEY`
- `USERS_JSON` или `USERS_DATA_PATH`

Рекомендуемые для продакшна:
- `ACTIVITY_STORAGE=kv`
- `INTERACTIVE_SELECTION=true`
- `PENDING_KV_PREFIX=clockify_tg_bot_pending`
- `ACTIVITY_KV_PREFIX=clockify_tg_bot_activity`
- `ACTIVITY_KV_MAX_EVENTS=5000`
- `PENDING_TTL_MS=900000`
- `OPENAI_STT_MODEL=whisper-1`
- `OPENAI_PARSER_MODEL=gpt-4o-mini`

4. Подключить Vercel KV (Upstash) к проекту и убедиться, что появились:
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

5. После деплоя установить webhook Telegram:

```bash
node scripts/registerWebhook.js
```

Перед запуском команды задать:
- `TELEGRAM_WEBHOOK_URL=https://<your-domain>.vercel.app`

Webhook будет: `https://<your-domain>.vercel.app/api/webhook`

Проверка:

```bash
npm run webhook:info
```

### 4.3 Проверка после деплоя
- `https://<your-domain>.vercel.app/api/health` -> `ready: true`
- `https://<your-domain>.vercel.app/` -> открывается дашборд
- Голосовая/текстовая команда от разрешенного пользователя создает запись в Clockify
- Новое событие появляется в дашборде

## Полезные команды

```bash
npm run check
npm run webhook:info
npm run webhook:set
npm run local:bot
```
