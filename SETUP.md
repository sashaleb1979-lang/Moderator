# Setup Guide

## Что делает бот

Бот встречает новичка в welcome-канале, даёт ему кнопку Получить роль, позволяет выбрать 1-2 мейнов, а затем просит одним сообщением отправить точное количество kills в тексте вместе со скрином. Если текущий режим выдачи доступа требует дополнительной проверки, после этого бот отдельно попросит Roblox username для сверки. В review-канал прилетает заявка для модераторов. Стартовая access-role выдаётся либо сразу после заявки, либо после отправки на модерацию, либо только после approve — зависит от текущего режима. После Approve бот выдаёт одну из пяти kill-tier ролей. В welcome-панели есть отдельная кнопка текстового тир-листа с общей нумерацией от первого места до последнего и встроенной статистикой.

В dedicated tierlist-канале бот держит два связанных сообщения: верхнее графическое и нижнее текстовое. Graphic-board собирается автоматически из подтверждённых профилей и обновляется вместе с текстовым рейтингом.

Если у персонажей и kill-tier ролей пустой roleId, бот сам создаст их по русским названиям. Эти роли создаются как обычные role-label без дополнительных прав.
Команды бот регистрирует автоматически при старте.

## Файлы

- welcome-bot.js — новый бот
- src/db/store.js — вынесенный слой загрузки и сохранения welcome-db.json
- scripts/snapshot-db.js — локальный backup-скрипт перед deploy и миграциями
- graphic-tierlist.js — SVG-рендер верхнего graphic-board
- bot.config.json — каналы, роли, персонажи, подписи tier-ролей
- .env.example — обязательные переменные окружения
- assets/missing-tierlist-poster.svg — встроенный poster для remindmissing по умолчанию
- index.js — старый ELO-бот, оставлен как референс

## 1. Установи зависимости

```bash
npm install
```

## 2. Создай .env

Минимум:

```env
DISCORD_TOKEN=...
GUILD_ID=...
BOT_DATA_DIR=./data
DB_PATH=welcome-db.json
CONFIG_PATH=./bot.config.json
```

Если хочешь всё настраивать прямо через Railway variables, бот умеет брать почти весь runtime из env и перекрывать bot.config.json.

Полный список env-переменных:

```env
DISCORD_TOKEN=
GUILD_ID=
BOT_DATA_DIR=./data
DB_PATH=welcome-db.json
CONFIG_PATH=./bot.config.json

VERIFICATION_ENABLED=false
DISCORD_OAUTH_CLIENT_ID=
DISCORD_OAUTH_CLIENT_SECRET=
DISCORD_OAUTH_REDIRECT_URI=
VERIFICATION_CHANNEL_ID=
VERIFICATION_REPORT_CHANNEL_ID=
VERIFICATION_REPORT_SWEEP_MINUTES=60
VERIFICATION_PENDING_DAYS=7

WELCOME_CHANNEL_ID=
REVIEW_CHANNEL_ID=
TIERLIST_CHANNEL_ID=
LOG_CHANNEL_ID=

MODERATOR_ROLE_ID=
ACCESS_ROLE_ID=
WARTIME_ACCESS_ROLE_ID=
TIER_ROLE_1_ID=
TIER_ROLE_2_ID=
TIER_ROLE_3_ID=
TIER_ROLE_4_ID=
TIER_ROLE_5_ID=

WELCOME_TITLE=Jujutsu Shinigans Onboarding
WELCOME_DESCRIPTION=
GET_ROLE_BUTTON_LABEL=Получить роль
TIERLIST_BUTTON_LABEL=Текстовый тир-лист
TIERLIST_TITLE=Текстовый тир-лист
GRAPHIC_TIERLIST_TITLE=Графический тир-лист
GRAPHIC_TIERLIST_SUBTITLE=Подтверждённые игроки и текущая расстановка по kills
GRAPHIC_TIER_COLOR_1=#4d96ff
GRAPHIC_TIER_COLOR_2=#43aa8b
GRAPHIC_TIER_COLOR_3=#f9c74f
GRAPHIC_TIER_COLOR_4=#f46036
GRAPHIC_TIER_COLOR_5=#d7263d
MISSING_TIERLIST_TEXT=Враг народа избегает получения роли!!! Не будь врагом!!! Стань товарищем!!!
MISSING_TIERLIST_IMAGE_URL=
MISSING_TIERLIST_IMAGE_PATH=

KILL_TIER_LABEL_1=Низший ранг
KILL_TIER_LABEL_2=Средний ранг
KILL_TIER_LABEL_3=Высший ранг
KILL_TIER_LABEL_4=Особый ранг
KILL_TIER_LABEL_5=Абсолютный ранг

CHARACTER_CONFIG_JSON=
SNAPSHOT_OUTPUT_DIR=./backups
```

Расшифровка:

- DISCORD_TOKEN — токен Discord-бота
- GUILD_ID — ID твоего сервера
- BOT_DATA_DIR — базовая папка для данных бота; на Railway сюда нужно указывать путь volume, обычно /data
- DB_PATH — путь к JSON-базе; если путь относительный, он считается относительно BOT_DATA_DIR
- CONFIG_PATH — путь к bot.config.json, если оставляешь файловый конфиг
- WELCOME_CHANNEL_ID — канал welcome-панели и приёма заявок (текст с kills + скрин)
- REVIEW_CHANNEL_ID — приватный канал модераторов
- TIERLIST_CHANNEL_ID — отдельный канал, куда бот публикует и обновляет текстовый тир-лист
- LOG_CHANNEL_ID — необязательный канал логов
- MODERATOR_ROLE_ID — роль модератора
- ACCESS_ROLE_ID — базовая стартовая роль, которую бот выдаёт на одном из этапов onboarding в зависимости от текущего режима выдачи доступа
- WARTIME_ACCESS_ROLE_ID — альтернативная стартовая роль для военного режима; нужна только если планируешь включать /onboard setmode wartime
- TIER_ROLE_1_ID ... TIER_ROLE_5_ID — пять ролей kill-tier, можно оставить пустыми и бот создаст их сам
- WELCOME_TITLE — заголовок welcome-панели
- WELCOME_DESCRIPTION — главный текст welcome-панели
- GET_ROLE_BUTTON_LABEL — текст кнопки старта
- TIERLIST_BUTTON_LABEL — текст кнопки показа тир-листа
- TIERLIST_TITLE — заголовок текстового тир-листа
- GRAPHIC_TIERLIST_TITLE — заголовок верхнего graphic-board
- GRAPHIC_TIERLIST_SUBTITLE — подзаголовок верхнего graphic-board
- GRAPHIC_TIER_COLOR_1 ... GRAPHIC_TIER_COLOR_5 — цвета карточек и полос по tier для graphic-board
- MISSING_TIERLIST_TEXT — текст массового напоминания тем, кого нет в тир-листе
- MISSING_TIERLIST_IMAGE_URL — URL картинки для массового напоминания, если хочешь переопределить встроенный poster
- MISSING_TIERLIST_IMAGE_PATH — локальный путь к картинке для массового напоминания; если пусто, бот берёт встроенный poster из репозитория
- KILL_TIER_LABEL_1 ... KILL_TIER_LABEL_5 — названия tier-ролей в интерфейсе
- CHARACTER_CONFIG_JSON — JSON-массив со всеми персонажами; roleId внутри можно не указывать
- SNAPSHOT_OUTPUT_DIR — опциональная папка для snapshot-ов; по умолчанию backups/<ISO> в корне репозитория
- VERIFICATION_ENABLED — включает автономную verification-систему через env override
- DISCORD_OAUTH_CLIENT_ID — Application ID Discord-приложения, через которое работает OAuth
- DISCORD_OAUTH_CLIENT_SECRET — Client Secret того же Discord-приложения
- DISCORD_OAUTH_REDIRECT_URI — полный callback URL вида https://<твой-domain>/verification/callback
- VERIFICATION_CHANNEL_ID — опциональный override канала проверки; обычно удобнее задать через /verify panel
- VERIFICATION_REPORT_CHANNEL_ID — опциональный override канала отчётов; обычно удобнее задать через /verify panel
- VERIFICATION_REPORT_SWEEP_MINUTES — как часто бот проверяет просроченные кейсы и шлёт scary-report модераторам
- VERIFICATION_PENDING_DAYS — через сколько дней pending verification считается просроченным

Пример CHARACTER_CONFIG_JSON:

```json
[
  {
    "id": "cursed_partner",
    "label": "Проклятый союзник",
    "roleId": ""
  },
  {
    "id": "hornet_one",
    "label": "Шершень Первый",
    "roleId": ""
  }
]
```

## 3. Заполни bot.config.json

Нужно указать:

- channels.welcomeChannelId — канал, где висит welcome-панель и куда новичок отправляет заявку сообщением со скрином и kills
- channels.reviewChannelId — приватный канал модераторов
- channels.tierlistChannelId — dedicated канал, где бот держит два сообщения: верхний graphic-board и нижний текстовый тир-лист
- channels.logChannelId — опционально, канал логов
- roles.moderatorRoleId — роль модератора
- roles.accessRoleId — базовая стартовая роль, которая выдаётся по текущему режиму доступа: сразу после заявки, после отправки на модерацию или только после approve
- roles.wartimeAccessRoleId — альтернативная стартовая роль для режима военного времени
- roles.killTierRoleIds.1-5 — пять ролей kill-tier, можно оставить пустыми
- characters — список ролей мейнов
- ui.tierlistButtonLabel — подпись кнопки текстового тир-листа
- ui.tierlistTitle — заголовок самого текстового тир-листа
- graphicTierlist.title — заголовок верхнего graphic-board
- graphicTierlist.subtitle — подзаголовок верхнего graphic-board
- graphicTierlist.tierColors — цвета карточек по tier в верхнем graphic-board
- roblox.metadataRefreshEnabled / roblox.metadataRefreshHours — включает и настраивает 24h refresh Roblox metadata
- roblox.playtimeTrackingEnabled / roblox.playtimePollMinutes — включает estimated JJS playtime tracking; стартовый безопасный poll — 2 минуты
- roblox.runtimeFlushEnabled / roblox.flushIntervalMinutes — cadence для периодического flush Roblox runtime агрегатов; стартовый safe flush — 10 минут
- roblox.jjsUniverseId / roblox.jjsRootPlaceId / roblox.jjsPlaceId — IDs JJS для presence matching и co-play aggregation
- roblox.links.friendRequestsUrl / roblox.links.jjsGameUrl — stable links для friend requests и JJS entrypoint
- roblox.frequentNonFriendMinutes / roblox.frequentNonFriendSessions — пороги для frequent non-friend interactions read model

Каждый персонаж в characters имеет вид:

```json
{
  "id": "cursed_partner",
  "label": "Проклятый союзник",
  "roleId": ""
}
```

id — внутренний ключ.
label — то, что видит пользователь в select menu.
roleId — необязателен. Если пустой, бот сам найдёт или создаст роль по label.

Опциональный Roblox block для backend-only social/profile runtime:

```json
{
  "roblox": {
    "metadataRefreshEnabled": true,
    "metadataRefreshHours": 24,
    "playtimeTrackingEnabled": true,
    "playtimePollMinutes": 2,
    "runtimeFlushEnabled": true,
    "flushIntervalMinutes": 10,
    "jjsUniverseId": 0,
    "jjsRootPlaceId": 0,
    "jjsPlaceId": 0,
    "frequentNonFriendMinutes": 60,
    "frequentNonFriendSessions": 2,
    "links": {
      "friendRequestsUrl": "https://www.roblox.com/users/friends#!/friend-requests",
      "jjsGameUrl": ""
    }
  }
}
```

- jjsUniverseId — предпочтительный идентификатор experience для match по presence
- jjsRootPlaceId — запасной идентификатор root place, если Universe не хватает
- jjsPlaceId — дополнительный точечный place id, если хотите матчить по конкретному place
- friendRequestsUrl — стабильная ссылка на входящие friend requests Roblox
- jjsGameUrl — каноническая ссылка на JJS place или experience, которую потом можно показывать в профиле

## 4. Добавь всех персонажей

Сейчас в config лежат только два примера. Добавь весь ваш список. Discord select menu поддерживает до 25 опций, поэтому 18 персонажей помещаются без проблем.

Я не мог добавить всех персонажей сам, потому что у меня нет вашего полного списка русских названий. Как только ты впишешь все labels, бот сам создаст под них роли, если roleId пустой.

## 5. Права бота

Боту нужны:

- View Channels
- Send Messages
- Manage Messages

## Verification на Railway

Если хочешь запустить автономную verification-систему, делай это в таком порядке:

1. В Railway открой сервис Moderator и создай public domain. Для Discord OAuth нужен внешний HTTPS URL; localhost и railway internal domain не подходят.
2. В Discord Developer Portal открой приложение этого бота.
3. В разделе OAuth2 добавь Redirects URL вида `https://<твой-public-domain>/verification/callback`.
4. Оттуда же скопируй Application ID и Client Secret.
5. В Railway Variables добавь:

```env
VERIFICATION_ENABLED=true
DISCORD_OAUTH_CLIENT_ID=...
DISCORD_OAUTH_CLIENT_SECRET=...
DISCORD_OAUTH_REDIRECT_URI=https://<твой-public-domain>/verification/callback
```

6. Перезапусти deploy.
7. В Discord открой `/verify panel` и в базовой модалке укажи:
  - enabled = да
  - verify-роль
  - канал проверки
  - канал отчётов
8. После сохранения панель сама попробует поднять callback-runtime и сразу опубликовать входное сообщение в канале проверки.
9. Потом используй `/verify add`, чтобы вручную поставить участника на verification и выдать ему verify-роль.

Подводные камни:

- Без `DISCORD_OAUTH_CLIENT_SECRET` OAuth не заработает, даже если бот и панель уже открываются.
- Если Redirect URL в Discord не совпадает с `DISCORD_OAUTH_REDIRECT_URI` в Railway символ в символ, callback будет ломаться.
- Система не раздаёт Discord permission overwrites автоматически: доступ verify-роли к одному каналу нужно настроить руками в самом Discord.
- Сейчас Discord OAuth даёт только `identify` и `guilds`, поэтому бот видит список серверов пользователя, но не список его каналов на чужих серверах.
- Manage Roles
- Attach Files
- Embed Links
- Read Message History
- Use Slash Commands

И intents:

- Guilds
- Guild Members
- Guild Messages
- Message Content

## 6. Запуск

```bash
npm start
```

После старта бот:

- зарегистрирует slash-команду /onboard
- зарегистрирует slash-команду /rolepanel
- отправит или обновит welcome-панель
- отправит или обновит верхний graphic-board и нижний текстовый тир-лист в отдельном tierlist-канале
- будет ждать нажатия на кнопки welcome-flow, текстового тир-листа, moderator panel и rolepanel

## 7. Путь новичка

1. Жмёт Получить роль.
2. Выбирает 1 или 2 мейнов.
3. Одним сообщением в welcome-канал отправляет точное количество kills в тексте и прикладывает скрин.
4. Если текущий режим выдачи доступа требует дополнительной проверки, бот просит отдельно указать Roblox username.
5. Бот удаляет сообщение после обработки.
6. Бот создаёт pending-заявку в review-канале.
7. Стартовая роль выдаётся по текущему режиму: сразу после заявки, после отправки на модерацию или только после approve.
8. После Approve модератором бот выдаёт kill-tier роль.

Для переключения режимов онбординга используй:

- /onboard mode — показать текущий режим
- /onboard setmode normal — обычное время, выдаётся roles.accessRoleId
- /onboard setmode wartime — военное время, выдаётся roles.wartimeAccessRoleId
- /onboard setmode apocalypse — новые участники без ролей удаляются сразу после входа

Если человек жмёт кнопку текстового тир-листа, он получает красивый текстовый рейтинг с общей нумерацией, списком игроков, их kills, tier и краткой статистикой по серверу.
Если человек жмёт кнопку быстрой смены мейнов, он может просто обновить своих персонажей без новой заявки по kills.

## 8. Путь модератора

В review-канале у заявки есть кнопки:

- Approve — одобрить kills и выдать tier-role
- Edit kills — поправить kills до approve
- Reject — отклонить с причиной

## 9. Tier-пороги

- Tier 1: 0-999
- Tier 2: 1000-2999
- Tier 3: 3000-6999
- Tier 4: 7000-10999
- Tier 5: 11000+

## 10. Slash-команды

- /onboard profile — показать свой профиль или профиль выбранного пользователя
- /onboard tierlist — показать текстовый тир-лист
- /onboard stats — показать summary-статистику тир-листа
- /onboard pending — список pending-заявок для модераторов
- /onboard panel — открыть модераторскую панель с кнопками для welcome, tierlists, sync roles и remindmissing
- /onboard remindmissing — отправить DM всем, кого нет в тир-листе
- /onboard modset — вручную установить kills и tier-role пользователю
- /onboard removetier — снять kill-tier роль и очистить approved kills
- /onboard syncroles — пересинхронизировать tier-role по данным в базе
- /rolepanel — отдельная модераторская панель для публикации ивент-сообщений с кнопкой выдачи роли, просмотра уже опубликованных сообщений, точечного отключения, повторной публикации и массового снятия роли у всех

Кнопки внутри /onboard panel:

- Обновить welcome — переотправляет и пересобирает welcome-панель
- Обновить тир-листы — обновляет верхний graphic-board и нижний текстовый тир-лист
- Синк tier-ролей — приводит все подтверждённые профили к актуальным tier-ролям
- Напомнить отсутствующим — шлёт DM всем, кого ещё нет в тир-листе
- Обновить сводку — перерисовывает саму панель со свежей статистикой

Возможности внутри /rolepanel:

- Создать сообщение — собрать plain text или embed-сообщение, выбрать канал, выбрать роль и опубликовать кнопку выдачи роли
- Список сообщений — посмотреть уже опубликованные выдачи, точечно отключить отдельное сообщение, повторно опубликовать его или загрузить в конструктор как новый черновик
- Забрать роль у всех — снять выбранную роль у всех текущих участников сервера с подтверждением и выбором, отключать ли связанные старые кнопки

## 11. Snapshot перед deploy

Перед каждым risky deploy, ручной миграцией или большим рефакторингом сохрани текущий state:

```bash
npm run snapshot:db
```

Скрипт:

- копирует основной welcome-db.json
- читает db.config.integrations.elo.sourcePath и db.config.integrations.tierlist.sourcePath из текущей базы
- если эти legacy-файлы существуют, копирует их в тот же snapshot
- пишет manifest.json с путями источников и статусами copied, missing или not-configured

Важно:

- snapshot из backups/<ISO> считается локальным operational backup, а не файлом для git
- временные DB dump вида .tmp.production-welcome-db.json не коммить
- если нужен clean deploy artifact, собирай его вне репозитория, а не как второе tracked-дерево рядом с корнем
- локальные deploy-деревья вида .deploy-* не держи в rollout-контексте; `railway up` по умолчанию уважает .gitignore, а флаг --no-gitignore для этого репозитория использовать нельзя

По умолчанию snapshot ложится в backups/<ISO>. Если нужна другая папка, задай SNAPSHOT_OUTPUT_DIR. Для относительного пути база берётся от корня репозитория.

Минимальная процедура перед deploy:

1. Убедись, что BOT_DATA_DIR и DB_PATH указывают на текущую живую базу.
2. Запусти npm run snapshot:db.
3. Проверь, что в новом каталоге есть manifest.json, db/welcome-db.json и нужные legacy-файлы integrations/elo или integrations/tierlist.
4. Только после этого выкатывай новый код.

## 12. Быстрый гайд для Railway

1. Создай новый Railway service под Node.js.
2. Загрузи репозиторий.
3. Создай Railway Volume и смонтируй его, например, в /data.
4. В Variables вставь минимум DISCORD_TOKEN, GUILD_ID, BOT_DATA_DIR=/data, WELCOME_CHANNEL_ID, REVIEW_CHANNEL_ID, MODERATOR_ROLE_ID, ACCESS_ROLE_ID и CHARACTER_CONFIG_JSON.
TIER_ROLE_1_ID ... TIER_ROLE_5_ID можно не задавать, если бот должен создать tier-роли сам.
5. Если не хочешь возиться с JSON-файлом в контейнере, просто полностью управляй конфигом через Variables.
6. Start Command: npm start.
7. После первого запуска зайди в welcome-канал и проверь, что панель появилась.
8. Проверь, что в tierlist-канале бот создал верхний graphic-board и нижний текстовый тир-лист.
9. Прогони один тестовый submit, потом approve, потом перезапусти deploy и проверь, что бот обновил старые сообщения, а не создал новые.

## 13. Важно

Access-role и moderator-role бот сам не создаёт, потому что они завязаны на права и структуру сервера.
Роли персонажей и kill-tier роли бот создавать умеет сам.
После первого автосоздания бот сохраняет ID роли в своей базе. Потом ты можешь безопасно менять у такой роли цвет, позицию, отображение, mentionable и даже имя: бот всё равно будет держаться за сохранённый ID. Новый дубль он создаст только если эту роль удалить совсем и старый ID перестанет существовать.
Для массовой рассылки отсутствующим в тир-листе можно указать текст через MISSING_TIERLIST_TEXT и подключить картинку через MISSING_TIERLIST_IMAGE_URL или MISSING_TIERLIST_IMAGE_PATH.
Если путь и URL не заданы, бот сам использует встроенный poster asset из assets/missing-tierlist-poster.svg.
Если DB лежит в Railway Volume через BOT_DATA_DIR, бот переживает redeploy с той же базой и сохранёнными message ID.
Персонажи можно настраивать либо через bot.config.json, либо через CHARACTER_CONFIG_JSON в Railway Variables.

## 14. SoT smoke-check после deploy

После любого deploy или рестарта не ограничивайся тем, что процесс просто поднялся.

Проверь минимум следующее:

1. Открой /onboard sotreport или кнопку SoT Report в moderator panel.
2. Убедись, что channel/role/panel/integration блоки не показывают missing/drift по ожидаемым слотам.
3. Если report показывает unresolved или ambiguous character binding, сначала жми Verify now, потом Recover character, и только после этого трогай ручные overrides.
4. Если нужно руками переназначить channel surface, используй либо `link-channel` внутри SoT report, либо legacy Channels modal в moderator panel. Оба пути теперь идут через один shared apply helper для welcome, review, tierlistText, tierlistGraphic и log.
5. В legacy Channels modal пустое поле теперь означает честный clear соответствующего channel slot: welcome одновременно сбрасывает welcome и nonGgs pair, text/graphic tierlist очищают ещё и tracked message ids, log/review очищают только channel binding.
6. Если нужно руками переназначить panel surface, используй Manual panel внутри SoT report. Поддержанные слоты: welcome, nonGgs, eloSubmit, eloGraphic, tierlistDashboard, tierlistSummary.
7. Если в Manual panel отправить пустой channelId, reset теперь честный: welcome и nonGgs возвращаются в свой fallback/default publish path, а integration-панели eloSubmit, eloGraphic, tierlistDashboard и tierlistSummary удаляют текущий managed message и очищают live snapshot до следующей явной настройки.
8. Для integration panel slots channel section и integration section в `/onboard sotreport` теперь должны сходиться по `eloSubmit` / `eloGraphic` / `tierlistDashboard` / `tierlistSummary`. Если после Verify now они расходятся, считай это кодовым багом, а не нормальным operator drift.
9. Если включён LOG_CHANNEL_ID, проверь, что туда не прилетел throttled alert по unresolved characters или другим SoT проблемам сразу после старта.

Практический порядок operator-response после рестарта:

1. Открой `/onboard sotreport` и обнови report кнопкой Verify now, если открывался старый ephemeral snapshot.
2. Если alert или report показывает unresolved или ambiguous character binding, сначала жми Recover characters, потом ещё раз Verify now.
3. Если после Recover binding всё ещё не сходится, только тогда используй Manual character для точечного native SoT bind.
4. Если report показывает неверный role slot, сначала проверь configured/manual source в role section, и только потом используй Manual role.
5. Если surface уехал в неверный канал, сначала проверь channel section, затем используй link-channel для channel slot или Manual panel для panel slot. Не смешивай эти две операции вслепую.
6. Если LOG_CHANNEL_ID включён, сразу после старта проверь, нет ли `SOT_CHARACTER_ALERT[startup]` или `SOT_DRIFT_ALERT[startup]`. Это не просто шум, а сигнал, что smoke-check не пройден.
7. Если после Verify now и Recover characters alert повторяется, deploy не считается здоровым, даже если process поднялся.

Короткая расшифровка log-channel alert-ов:

- `SOT_CHARACTER_ALERT[startup]` или `SOT_CHARACTER_ALERT[periodic]` — в character domain остались unresolved, ambiguous, stale-role или stale-verification проблемы.
- `SOT_DRIFT_ALERT[startup]` или `SOT_DRIFT_ALERT[periodic]` — persisted SoT и legacy shadow больше не совпадают в одном из доменов compare bridge.
- Один и тот же alert throttled, поэтому отсутствие спама не означает, что проблема исчезла. Источник истины всё равно `/onboard sotreport`.

## 15. Release gate

Перед deploy или сразу после серьёзного refactor проходи хотя бы такой минимум:

```bash
npm run snapshot:db
node --check welcome-bot.js
node --test tests/sot-report-operator.test.js
node --test tests/client-ready-core.test.js
node --test tests/sot-runtime-alerts.test.js
node --test tests/sot-channels.test.js
node --test tests/channel-owner.test.js
node --test tests/sot-panels.test.js
node --test tests/sot-integrations.test.js
node --test tests/sot-report-integrations.test.js
node --test tests/native-integrations.test.js
node --test tests/tierlist-panel.test.js
node --test tests/tierlist-dormant.test.js
node --test tests/onboard-submission-flow.test.js
npm test
```

Если менялся ELO surface, добавь ещё:

```bash
node --test tests/elo-dormant.test.js
node --test tests/elo-panel.test.js
node --test tests/elo-graphic.test.js
node --test tests/elo-role-grant-toggle.test.js
```

Если менялся integration source path, dormant import или panel snapshot surface, добавь ещё:

```bash
node --test tests/db-store.test.js
node --test tests/sot-diagnostics.test.js
node --test tests/native-integrations.test.js
node --test tests/elo-dormant.test.js
node --test tests/elo-role-grant-toggle.test.js
node --test tests/elo-panel.test.js
node --test tests/tierlist-panel.test.js
node --test tests/tierlist-dormant.test.js
```

Если менялся character/runtime recovery path, добавь ещё:

```bash
node --test tests/sot-characters.test.js
node --test tests/character-role-sync.test.js
```

Rollback criteria после deploy:

1. `/onboard sotreport` показывает неожиданный missing или MISSING по channel/role/panel slot, который до deploy был живым.
2. После Verify now и Recover characters остаются unresolved или ambiguous bindings без понятного operator explanation.
3. В log channel прилетает `SOT_DRIFT_ALERT[startup]` или `SOT_CHARACTER_ALERT[startup]`, и проблема не исчезает после одного ручного smoke-cycle.
4. Startup после deploy перестаёт переиспользовать managed messages и начинает создавать лишние дубликаты panel/board surfaces.

Если rollback criteria сработал:

1. Не делай новые manual overrides поверх сломанного deploy, пока не снят snapshot и не зафиксирован фактический report.
2. Возьми свежий `npm run snapshot:db`, сохрани вывод `/onboard sotreport` и только потом откатывай код или восстанавливай state.
3. После rollback снова пройди SoT smoke-check целиком, а не только `npm test`.

Старый ELO-бот не используется в npm start, но оставлен как референс по старой логике модерации.
Если заданы env-переменные Railway, они перекрывают bot.config.json.
