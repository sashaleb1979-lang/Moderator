# Setup Guide

## Что делает бот

Бот встречает новичка в welcome-канале, даёт ему кнопку Получить роль, позволяет выбрать 1-2 мейнов, затем просит ввести точное количество kills и следующим сообщением отправить скрин. После подачи бот сразу выдаёт access-role. В review-канал прилетает заявка для модераторов. После Approve бот выдаёт одну из пяти kill-tier ролей. В welcome-панели есть отдельная кнопка текстового тир-листа с общей нумерацией от первого места до последнего и встроенной статистикой.

В dedicated tierlist-канале бот держит два связанных сообщения: верхнее графическое и нижнее текстовое. Graphic-board собирается автоматически из подтверждённых профилей и обновляется вместе с текстовым рейтингом.

Если у персонажей и kill-tier ролей пустой roleId, бот сам создаст их по русским названиям. Эти роли создаются как обычные role-label без дополнительных прав.
Команды бот регистрирует автоматически при старте.

## Файлы

- welcome-bot.js — новый бот
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
DB_PATH=./welcome-db.json
CONFIG_PATH=./bot.config.json
```

Если хочешь всё настраивать прямо через Railway variables, бот умеет брать почти весь runtime из env и перекрывать bot.config.json.

Полный список env-переменных:

```env
DISCORD_TOKEN=
GUILD_ID=
DB_PATH=./welcome-db.json
CONFIG_PATH=./bot.config.json

WELCOME_CHANNEL_ID=
REVIEW_CHANNEL_ID=
TIERLIST_CHANNEL_ID=
LOG_CHANNEL_ID=

MODERATOR_ROLE_ID=
ACCESS_ROLE_ID=
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
```

Расшифровка:

- DISCORD_TOKEN — токен Discord-бота
- GUILD_ID — ID твоего сервера
- DB_PATH — путь к файлу базы внутри контейнера Railway
- CONFIG_PATH — путь к bot.config.json, если оставляешь файловый конфиг
- WELCOME_CHANNEL_ID — канал welcome-панели и приёма скрина
- REVIEW_CHANNEL_ID — приватный канал модераторов
- TIERLIST_CHANNEL_ID — отдельный канал, куда бот публикует и обновляет текстовый тир-лист
- LOG_CHANNEL_ID — необязательный канал логов
- MODERATOR_ROLE_ID — роль модератора
- ACCESS_ROLE_ID — роль доступа, которая выдаётся сразу после подачи
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

- channels.welcomeChannelId — канал, где висит welcome-панель и куда новичок кидает скрин
- channels.reviewChannelId — приватный канал модераторов
- channels.tierlistChannelId — dedicated канал, где бот держит два сообщения: верхний graphic-board и нижний текстовый тир-лист
- channels.logChannelId — опционально, канал логов
- roles.moderatorRoleId — роль модератора
- roles.accessRoleId — роль, которая сразу выдаётся после подачи заявки
- roles.killTierRoleIds.1-5 — пять ролей kill-tier, можно оставить пустыми
- characters — список ролей мейнов
- ui.tierlistButtonLabel — подпись кнопки текстового тир-листа
- ui.tierlistTitle — заголовок самого текстового тир-листа
- graphicTierlist.title — заголовок верхнего graphic-board
- graphicTierlist.subtitle — подзаголовок верхнего graphic-board
- graphicTierlist.tierColors — цвета карточек по tier в верхнем graphic-board

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

## 4. Добавь всех персонажей

Сейчас в config лежат только два примера. Добавь весь ваш список. Discord select menu поддерживает до 25 опций, поэтому 18 персонажей помещаются без проблем.

Я не мог добавить всех персонажей сам, потому что у меня нет вашего полного списка русских названий. Как только ты впишешь все labels, бот сам создаст под них роли, если roleId пустой.

## 5. Права бота

Боту нужны:

- View Channels
- Send Messages
- Manage Messages
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
- отправит или обновит welcome-панель
- отправит или обновит верхний graphic-board и нижний текстовый тир-лист в отдельном tierlist-канале
- будет ждать нажатия на кнопки welcome-flow, текстового тир-листа и moderator panel

## 7. Путь новичка

1. Жмёт Получить роль.
2. Выбирает 1 или 2 мейнов.
3. Вводит точное количество kills.
4. Следующим сообщением кидает скрин в welcome-канал.
5. Бот удаляет сообщение со скрином.
6. Бот создаёт pending-заявку в review-канале.
7. Бот сразу выдаёт access-role.
8. После Approve модератором бот выдаёт kill-tier роль.

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

Кнопки внутри /onboard panel:

- Обновить welcome — переотправляет и пересобирает welcome-панель
- Обновить тир-листы — обновляет верхний graphic-board и нижний текстовый тир-лист
- Синк tier-ролей — приводит все подтверждённые профили к актуальным tier-ролям
- Напомнить отсутствующим — шлёт DM всем, кого ещё нет в тир-листе
- Обновить сводку — перерисовывает саму панель со свежей статистикой

## 11. Быстрый гайд для Railway

1. Создай новый Railway service под Node.js.
2. Загрузи репозиторий.
3. В Variables вставь минимум DISCORD_TOKEN, GUILD_ID, WELCOME_CHANNEL_ID, REVIEW_CHANNEL_ID, MODERATOR_ROLE_ID, ACCESS_ROLE_ID и CHARACTER_CONFIG_JSON.
TIER_ROLE_1_ID ... TIER_ROLE_5_ID можно не задавать, если бот должен создать tier-роли сам.
4. Если не хочешь возиться с JSON-файлом в контейнере, просто полностью управляй конфигом через Variables.
5. Start Command: npm start.
6. После первого запуска зайди в welcome-канал и проверь, что панель появилась.
7. Проверь, что в tierlist-канале бот создал верхний graphic-board и нижний текстовый тир-лист.
8. Прогони один тестовый submit, потом approve, потом проверь обновление тир-листа и кнопку быстрой смены мейнов.

## 12. Важно

Access-role и moderator-role бот сам не создаёт, потому что они завязаны на права и структуру сервера.
Роли персонажей и kill-tier роли бот создавать умеет сам.
После первого автосоздания бот сохраняет ID роли в своей базе. Потом ты можешь безопасно менять у такой роли цвет, позицию, отображение, mentionable и даже имя: бот всё равно будет держаться за сохранённый ID. Новый дубль он создаст только если эту роль удалить совсем и старый ID перестанет существовать.
Для массовой рассылки отсутствующим в тир-листе можно указать текст через MISSING_TIERLIST_TEXT и подключить картинку через MISSING_TIERLIST_IMAGE_URL или MISSING_TIERLIST_IMAGE_PATH.
Если путь и URL не заданы, бот сам использует встроенный poster asset из assets/missing-tierlist-poster.svg.
Персонажи можно настраивать либо через bot.config.json, либо через CHARACTER_CONFIG_JSON в Railway Variables.
Старый ELO-бот не используется в npm start, но оставлен как референс по старой логике модерации.
Если заданы env-переменные Railway, они перекрывают bot.config.json.
