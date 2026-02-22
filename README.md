# ClockifyTGbot

Telegram-бот для занесения времени в Clockify из голосовых и текстовых сообщений.

Проект подготовлен для двух режимов:
- `local` (через `server.js`)
- `Vercel serverless` (через `api/webhook.js` и `api/health.js`)

## Что делает бот

1. Принимает webhook-обновления Telegram (`POST /api/webhook`).
2. Проверяет пользователя по allow-list (`USERS_JSON` или `USERS_DATA_PATH`).
3. Для voice-сообщений делает STT через OpenAI (`whisper-1` по умолчанию).
4. Парсит команду (rule-based + AI fallback).
5. Находит проект в Clockify (fuzzy matching).
6. Создает time entry в Clockify.
7. При неуверенном совпадении просит выбрать проект через inline-кнопки.

## Важные изменения для Vercel

- Добавлен безопасный режим хранения активности: `ACTIVITY_STORAGE=memory`.
- В режиме `memory` бот не пишет в файловую систему (важно для Vercel).
- На Vercel по умолчанию отключен интерактивный выбор проекта: `INTERACTIVE_SELECTION=false`.
- Парсинг `req.body` в webhook сделан устойчивым для разных runtime-вариантов.

## Структура

- `api/webhook.js` - основной webhook-хендлер.
- `api/health.js` - health-check и проверка env.
- `src/config.js` - централизованная конфигурация env.
- `src/activity.js` - учет обращений (`file` или `memory` storage).
- `src/stt.js` - распознавание голоса через OpenAI.
- `src/parser.js`, `src/aiParser.js` - парсинг команд.
- `src/clockify.js` - работа с Clockify API.
- `src/telegram.js` - работа с Telegram Bot API.
- `scripts/registerWebhook.js` - установка webhook.
- `scripts/webhookInfo.js` - проверка webhook в Telegram.

## Требования

- Node.js 18+
- Telegram Bot Token
- OpenAI API Key
- Clockify Workspace ID
- Clockify API key (общий fallback) и/или персональные ключи пользователей

## Переменные окружения

Обязательные:
- `TELEGRAM_BOT_TOKEN`
- `OPENAI_API_KEY`
- `CLOCKIFY_WORKSPACE_ID`
- `CLOCKIFY_API_KEY`
- `USERS_JSON` или `USERS_DATA_PATH`

Рекомендуемые:
- `OPENAI_STT_MODEL=whisper-1`
- `OPENAI_PARSER_MODEL=gpt-4o-mini`
- `CLOCKIFY_BASE_URL=https://api.clockify.me/api/v1`
- `BASE_TZ=Europe/Belgrade`
- `PENDING_TTL_MS=900000`
- `INTERACTIVE_SELECTION=false` (для Vercel)
- `ACTIVITY_STORAGE=memory` (для Vercel)

## Локальный env для копирования в Vercel

Создан файл:
- `.env.vercel.local`

Это локальный (git-ignored) файл со списком переменных для Vercel.
Используйте его как источник при заполнении `Project Settings -> Environment Variables` в Vercel.

Шаблон общих переменных в репозитории:
- `.env.example`

## Локальный запуск

```bash
npm install
npm run check
npm start
```

Проверка:
- `http://127.0.0.1:3010/api/health`

## Деплой через GitHub -> Vercel

### 1. Пуш в GitHub

Репозиторий:
- `https://github.com/suezergut-sys/ClockifyTGbot2`

Команды:

```bash
git init
git add .
git commit -m "Prepare project for Vercel"
git branch -M main
git remote add origin https://github.com/suezergut-sys/ClockifyTGbot2.git
git push -u origin main
```

### 2. Импорт проекта в Vercel

1. Vercel -> `Add New...` -> `Project`.
2. Выберите `ClockifyTGbot2`.
3. Framework Preset: `Other`.
4. Build Command: пусто.
5. Output Directory: пусто.
6. Install Command: `npm install`.

### 3. Добавление env в Vercel

Из `.env.vercel.local` добавьте переменные в:
- `Project Settings -> Environment Variables`

Для прод-окружения обязательно поставьте:
- `ACTIVITY_STORAGE=memory`
- `INTERACTIVE_SELECTION=false`

Для allow-list пользователей на Vercel рекомендуется:
- `USERS_JSON` (вместо `USERS_DATA_PATH`)

Пример `USERS_JSON`:

```json
{"users":[{"tgId":"123456789","clockifyEmail":"user@company.com","clockifyApiKey":"clockify_personal_api_key","active":true}]}
```

### 4. Деплой

Запустите Deploy в Vercel UI.

### 5. Настройка Telegram webhook

После первого деплоя возьмите домен Vercel, например:
- `https://clockifytgbot2.vercel.app`

Локально задайте:
- `TELEGRAM_WEBHOOK_URL=https://clockifytgbot2.vercel.app`

И выполните:

```bash
node scripts/registerWebhook.js
```

Webhook будет установлен на:
- `https://clockifytgbot2.vercel.app/api/webhook`

Проверить текущее состояние webhook:

```bash
npm run webhook:info
```

## Проверка после деплоя

1. Откройте `https://<your-vercel-domain>/api/health`.
2. Убедитесь, что `ready: true`.
3. Отправьте команду боту из разрешенного аккаунта Telegram.

## Типовые проблемы

- `ready=false` в `/api/health`:
  не хватает обязательных env.

- Telegram не доставляет обновления:
  проверьте `npm run webhook:info` и URL webhook.

- `403` от Clockify:
  у пользователя нет корректного персонального `clockifyApiKey`, либо не подходит fallback-ключ.

- Потеря статистики активности на Vercel:
  это ожидаемо при `ACTIVITY_STORAGE=memory` (serverless без постоянного диска).

- Кнопки выбора проекта в неоднозначных случаях не показываются на Vercel:
  это ожидаемо при `INTERACTIVE_SELECTION=false`; укажите точное название проекта в повторной команде.

## Полезные команды

```bash
npm run check
npm run webhook:info
npm run webhook:set
npm run local:bot
```
