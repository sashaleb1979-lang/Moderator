# Master Context Audit Of The Moderator Repository

Дата: 16.05.2026

Статус: центральный контекстный файл по всему репозиторию.

Назначение этого документа:
1. собрать в одном месте, что именно существует в проекте сейчас;
2. показать, где какая система живёт и кто ею владеет;
3. зафиксировать реальные persisted/runtime/data seams;
4. объяснить, какие root-docs уже есть и чем они отличаются друг от друга;
5. честно отметить зоны, где документация уже отстаёт от кода или где слой ещё не доведён до финального cutover.

Этот файл не заменяет доменные планы вроде PROFILE_VISION_PLAN.md, PROFILE_SYNERGY_SYSTEM_PLAN.md, SOURCE_OF_TRUTH_REWRITE_PLAN.md, ACTIVITY_SYSTEM_REBUILD_PLAN.md или ROBLOX_ACTIVITY_PANEL_PLAN.md.
Он выступает как master map репозитория, лежащая в корне и дающая следующему агенту или человеку быстрый, но глубокий вход в кодовую базу.

---

## 1. Быстрые Факты

### 1.1. Что Это За Репозиторий

Это Discord-бот для сервера по Jujutsu Shenanigans / JJS с несколькими крупными подсистемами одновременно:
1. onboarding и выдача стартового доступа;
2. review-поток по kills и kill-tier ролям;
3. текстовый и графический тирлист;
4. legacy ELO и tierlist интеграции;
5. shared profile и приватный профиль игрока;
6. Roblox account linkage, metadata и playtime tracking;
7. activity system с role assignment;
8. verification через Discord OAuth;
9. combo-guide publishing;
10. daily news groundwork;
11. antiteam/help-ticket subsystem;
12. большой SoT-слой для канонизации ролей, каналов, панелей, интеграций и персонажей.

### 1.2. Техническая База

По package.json:
1. Node.js: `>=18.17.0`
2. discord.js: `^14.19.3`
3. dotenv: `^16.4.5`
4. pureimage: `^0.4.13`

### 1.3. Главные Входные Точки

1. `welcome-bot.js` — основной runtime entrypoint и главный orchestration hub.
2. `index.js` — тонкая legacy-обёртка над `welcome-bot.js`.
3. `package.json` — main тоже указывает на `welcome-bot.js`.

### 1.4. Количественная Картина На Момент Замера

Замер по живому репозиторию:
1. `src` содержит 86 файлов.
2. `tests` содержит 72 test-файла.
3. До добавления этого файла в корне было 11 markdown-документов; после появления ROBLOX_ACTIVITY_PANEL_PLAN.md их стало 13.
4. `welcome-bot.js` содержит 20408 строк.

Практический вывод:
1. это уже не маленький бот и не один сценарий;
2. проект фактически состоит из монолита + набора всё более самостоятельных доменных seams;
3. корневые handoff/audit/plan docs являются частью архитектуры проекта, а не вторичной документацией.

### 1.5. Текущее Validation-Ощущение

По текущему состоянию рабочего дерева:
1. активное дерево тестов под `tests/` локально зелёное;
2. проект имеет широкое focused test coverage по activity, SoT, profile, Roblox, tierlist, verification, news и другим доменам;
3. корневые исторические docs содержат старые snapshots pass-count, поэтому их числа нужно читать как исторические слепки, а не как единственный живой baseline.

---

## 2. Физическая Карта Репозитория

### 2.1. Корень Репозитория

В корне сейчас лежат:
1. кодовые entrypoints и инфраструктура:
   - `welcome-bot.js`
   - `index.js`
   - `graphic-tierlist.js`
   - `presentation.js`
   - `package.json`
   - `package-lock.json`
   - `bot.config.json`
   - `.env.example`
2. директории данных и артефактов:
   - `assets/`
   - `graphic_avatar_cache/`
   - `scripts/`
   - `backups/`
3. основное кодовое дерево:
   - `src/`
   - `tests/`
4. документы верхнего уровня:
   - `AGENTS.md`
   - `SETUP.md`
   - `AUDIT_FIX_PLAN.md`
   - `CHARACTER_ROLE_ONBOARDING_RECOVERY_AUDIT.md`
   - `CHARACTER_ROLE_TIERLIST_AUDIT.md`
   - `SOURCE_OF_TRUTH_REWRITE_PLAN.md`
   - `ACTIVITY_SYSTEM_REBUILD_PLAN.md`
   - `DAILY_NEWS_PRODUCT_INTENT.md`
   - `DAILY_NEWS_CHRONICLE_PLAN.md`
   - `PROFILE_VISION_PLAN.md`
   - `PROFILE_SYNERGY_SYSTEM_PLAN.md`
   - `ROBLOX_ACTIVITY_PANEL_PLAN.md`
   - этот файл: `REPOSITORY_CONTEXT_AUDIT.md`

### 2.2. Assets

Из структуры workspace видно следующие asset-зоны:
1. `assets/characters/`
2. `assets/fonts/`
3. `assets/non-ggs-captcha/`
4. `assets/non-jjs-captcha/`

Назначение:
1. character media для guide/tierlist систем;
2. fonts для graphic/output rendering;
3. captcha assets для non-JJS / non-GGS access веток.

### 2.3. Backup И Quarantine Зоны

В корне есть `backups/` и несколько `.deploy-verification-*` директорий.
Это означает:
1. репозиторий хранит rollout/debug/history artefacts прямо рядом с активным кодом;
2. при глобальных запусках тестов и поисках по файлам легко случайно захватить архивы;
3. нужно различать активное дерево `src/` + `tests/` и исторические/архивные слои.

---

## 3. Где Какая Система Живёт

Ниже — реальная owner-карта по подпапкам и файлам.

### 3.1. `src/onboard` — 18 файлов

Содержимое:
1. `access-grant-mode.js`
2. `access-mode.js`
3. `begin-state.js`
4. `channel-owner.js`
5. `character-role-sync.js`
6. `commands.js`
7. `kill-tiers.js`
8. `non-jjs-captcha.js`
9. `non-jjs-mode.js`
10. `presentation.js`
11. `refresh-runner.js`
12. `roblox-identity.js`
13. `submission-message.js`
14. `text-tierlist-pagination.js`
15. `tierlist-live-members.js`
16. `tierlist-ranking.js`
17. `tierlist-special-members.js`
18. `tierlist-stats.js`

Роль домена:
1. точка входа для онбординга, доступа и выдачи стартовых ролей;
2. slash commands и panel flows;
3. разбор submitted kills;
4. режимы normal / wartime / apocalypse;
5. non-JJS captcha;
6. онбординг-часть presentation state;
7. kill tier helpers и текстовый тирлистовый stats-layer.

Это один из самых старых и самых плотных доменов проекта.

### 3.2. `src/profile` — 5 файлов

Содержимое:
1. `access.js`
2. `entry.js`
3. `model.js`
4. `operator.js`
5. `view.js`

Роль домена:
1. это один из самых чисто разрезанных современных seams в проекте;
2. ACL отделён от routing, read-model, view и runtime orchestration;
3. profile view уже живёт на Components V2;
4. чужие профили gated по server tag, а dead-requester не имеет доступа;
5. profile использует shared-profile, kills history, ELO, tierlist, guide links и social/Roblox context как read-side входы.

Ключевая текущая особенность:
1. ACL берёт server tag из Discord `user.primaryGuild`, а не из role-based конфига.

### 3.3. `src/activity` — 5 файлов

Содержимое:
1. `operator.js`
2. `role-apply.js`
3. `runtime.js`
4. `state.js`
5. `user-state.js`

Роль домена:
1. activity panel, operator actions и per-user inspection;
2. raw activity capture и runtime flush;
3. persisted activity state и watched channels;
4. rebuilding snapshots и activity-role assignment.

По своей сложности это один из самых чувствительных production-доменов.
Отдельный большой recovery context уже лежит в `ACTIVITY_SYSTEM_REBUILD_PLAN.md`.

### 3.4. `src/runtime` — 4 файла

Содержимое:
1. `client-ready-core.js`
2. `roblox-jobs.js`
3. `roblox-runtime-support.js`
4. `serialized-task-runner.js`

Роль домена:
1. startup prelude и periodic job orchestration;
2. Roblox metadata/playtime/flush jobs;
3. сериализация mutation/task paths;
4. сборка recurring interval logic вне `welcome-bot.js`.

Практически это runtime-control-plane проекта.

### 3.5. `src/integrations` — 13 файлов

Содержимое:
1. `character-role-catalog.js`
2. `elo-dormant.js`
3. `elo-graphic.js`
4. `elo-manual-chat.js`
5. `elo-panel.js`
6. `elo-review-store.js`
7. `roblox-panel.js`
8. `roblox-service.js`
9. `shared-profile.js`
10. `tierlist-character-sync.js`
11. `tierlist-dormant.js`
12. `tierlist-live.js`
13. `tierlist-panel.js`

Роль домена:
1. внешние/legacy-подобные integration surfaces;
2. shared-profile как канонический normalized mirror users/domains;
3. Roblox API/service слой;
4. ELO submission/review/graphic/panel surfaces;
5. legacy tierlist sync, dormant import и panel read-side.

Это один из центральных доменов, потому что именно здесь встречаются:
1. живые Discord flows;
2. legacy state;
3. read/write to shared profile;
4. bridge between runtime and persisted integration projections.

### 3.6. `src/news` — 3 файла

Содержимое:
1. `moderation.js`
2. `state.js`
3. `voice.js`

Роль домена:
1. канонический news-domain в SoT;
2. raw voice capture;
3. raw moderation capture;
4. groundwork для daily edition/news compiler.

Важно:
1. этот домен уже умеет собирать raw events;
2. но daily compile/publish layer ещё не реализован полностью.

### 3.7. `src/verification` — 2 файла

Содержимое:
1. `operator.js`
2. `runtime.js`

Роль домена:
1. verify panel и moderator operator surface;
2. OAuth runtime и callback server;
3. queue/report/deadline sweep flows.

Verification в проекте опциональна и включается конфигом.

### 3.8. `src/antiteam` — 3 файла

Содержимое:
1. `operator.js`
2. `state.js`
3. `view.js`

Роль домена:
1. anti-team / help / clan-call ticket system;
2. thread/ticket orchestration;
3. Roblox username capture и staff-assist flow;
4. ping roles и escalation.

Это отдельная операционная подсистема, не являющаяся частью onboarding/profile, хотя может использовать те же identity surfaces.

### 3.9. `src/combo-guide` — 5 файлов

Содержимое:
1. `commands.js`
2. `editor.js`
3. `parser.js`
4. `publisher.js`
5. `splitter.js`

Роль домена:
1. парсинг combo/techs материалов;
2. публикация guide-каналов и thread-структуры;
3. редактор и operator surface;
4. текущие guide links для профиля идут именно отсюда и пока Discord-thread based.

### 3.10. `src/db` — 1 файл

Содержимое:
1. `store.js`

Роль домена:
1. загрузка и сохранение `welcome-db.json`;
2. дефолтное состояние БД;
3. миграции/нормализации на load/save;
4. dormant imports;
5. shared-profile sync;
6. SoT dual-write/shadow sync hooks.

Это ключевой слой для понимания фактической persisted truth проекта.

### 3.11. `src/moderation` — 1 файл

Содержимое:
1. `autonomy-guard.js`

Роль домена:
1. отдельный moderation/infrastructure guard state;
2. cross-cutting safety surface.

### 3.12. `src/sot` — 25 файлов + вложенные каталоги

Корневые файлы:
1. `bus.js`
2. `character-aliases.js`
3. `diagnostics.js`
4. `index.js`
5. `loader.js`
6. `native-characters.js`
7. `native-integrations.js`
8. `native-panels.js`
9. `native-roles.js`
10. `report-integrations.js`
11. `report-operator.js`
12. `runtime-alerts.js`
13. `schema.js`

Подкаталог `legacy-bridge`:
1. `compare.js`
2. `panels.js`
3. `write.js`

Подкаталог `resolver`:
1. `channels.js`
2. `characters.js`
3. `influence.js`
4. `integrations.js`
5. `panels.js`
6. `presentation.js`
7. `priority.js`
8. `roles.js`

Подкаталог `recovery`:
1. `plan.js`

Роль домена:
1. это канонический effort по замене множественных source-of-truth на один явный SoT слой;
2. здесь живут schema, loader/save, diagnostics, native writers, resolvers и legacy bridge;
3. это не “мёртвый рефакторинг на будущее”, а реально используемый compatibility and cutover слой;
4. SoT не должен восприниматься как мусорный compat-хвост — это одна из сердцевин проекта.

Практический смысл:
1. roles, channels, panels, integrations и characters всё больше читаются через SoT facade;
2. legacy direct reads/writes постепенно снимаются;
3. при работе с проектом нельзя бездумно обходить `src/sot/*` прямыми writes в старые структуры.

### 3.13. Корневые `src`-файлы вне подпапок

1. `src/role-panel.js`

Роль:
1. generic role grant panel system;
2. auto-resend, picker, button formats, draft validation, custom-id parsing.

---

## 4. Главный Архитектурный Факт: Проект Уже Не Чистый Монолит, Но Ещё И Не Полностью Разрезан

### 4.1. Реальность `welcome-bot.js`

`welcome-bot.js` всё ещё является:
1. entrypoint процесса;
2. import hub почти всех подсистем;
3. местом, где собираются Discord handlers;
4. местом, где пока ещё остаётся существенная доля orchestration и legacy routing.

Но одновременно из него уже вынесены отдельные owner seams:
1. `src/profile/*`
2. `src/activity/*`
3. `src/verification/*`
4. `src/runtime/client-ready-core.js`
5. `src/sot/report-operator.js`
6. `src/news/*`

Итог:
1. проект находится в промежуточном состоянии между big-ball-of-mud и owner-based architecture;
2. новые фичи безопаснее добавлять через owner-seams, а не обратно внутрь giant inline blocks;
3. любые широкие переписывания `welcome-bot.js` без локальной гипотезы опасны.

### 4.2. Реальность Про Доменные Владения

Наиболее зрелые разрезы сейчас:
1. profile;
2. activity;
3. verification;
4. runtime startup/periodic scheduling;
5. SoT diagnostics/report/operator.

Наиболее тяжёлые гибридные зоны:
1. onboarding;
2. legacy tierlist;
3. ELO review/admin flow;
4. старые moderator panel flows;
5. shared-profile + Roblox runtime + integration sync пересечения.

---

## 5. Конфигурация, Persistence И Sources Of Truth

### 5.1. Конфигурационные Слои

В проекте есть несколько уровней конфигурации:
1. `bot.config.json` — файловая база каналов, ролей, UI-текстов, персонажей, Roblox/verification настроек;
2. `.env` / Railway env — runtime overrides;
3. `appConfig` — собранный runtime config;
4. `db.config` — persisted operational state;
5. `db.sot` — growing canonical Source of Truth слой поверх старых storage surfaces.

Это один из самых важных фактов по проекту.
Если агент видит значение в `bot.config.json`, это ещё не значит, что именно оно каноническое на runtime.

### 5.2. `bot.config.json`

Текущее содержимое на верхнем уровне:
1. `channels`
2. `roles`
3. `ui`
4. `graphicTierlist`
5. `reminders`
6. `roblox`
7. `verification`
8. `killTierLabels`
9. `characters`

Конфиг уже показывает, что проект включает:
1. onboarding;
2. graphical and text tierlist;
3. Roblox tracking;
4. verification;
5. kill-tier labels;
6. character catalog.

### 5.3. `welcome-db.json` И `src/db/store.js`

`src/db/store.js` показывает, что persisted DB по умолчанию содержит:
1. `config`
2. `profiles`
3. `submissions`
4. `cooldowns`
5. panel state;
6. generated roles;
7. integrations state;
8. onboard mode / access grant mode;
9. autonomy guard;
10. normalized character snapshot;
11. shared-profile projections;
12. SoT shadow/native state.

### 5.4. `db.sot`

SoT уже существует как persisted слой внутри той же DB.
По текущей структуре проекта он отвечает за:
1. roles;
2. channels;
3. panels;
4. integrations;
5. characters;
6. diagnostics/reports/alerts around drift.

То есть проект уже не живёт на одном простом JSON без метамодели.

### 5.5. Shared Profile Как User-Centric Normalized Mirror

`src/integrations/shared-profile.js` — одна из центральных точек проекта.
По коду видно, что shared-profile normalizes и хранит как минимум домены:
1. onboarding;
2. elo;
3. tierlist;
4. activity;
5. verification;
6. Roblox.

Практическая роль shared-profile:
1. это user-centric read/write surface, куда стекаются разные подсистемы;
2. профиль игрока и часть аналитики уже строятся поверх него;
3. он одновременно мощный и опасный, потому что легко становится “вторым SoT”, если писать в него без дисциплины owner seams.

### 5.6. Внешние И Dormant Источники

Проект умеет жить не только на внутренней DB.
Есть отдельные external/dormant source paths для:
1. ELO;
2. tierlist.

Отсюда важный вывод:
1. не все данные рождаются внутри текущего runtime;
2. часть систем импортирует и нормализует чужой/старый state;
3. совместимость с legacy data — не случайность, а один из базовых требований репозитория.

---

## 6. Runtime И Lifecycle

### 6.1. Startup

`src/runtime/client-ready-core.js` показывает, что startup сейчас пытаются удерживать как отдельный testable prelude.

Основные идеи startup слоя:
1. validate dependencies/functions;
2. run managed-role/bootstrap style steps;
3. startup alerts через SoT;
4. command registration;
5. tier role sync;
6. refresh welcome/tierlist surfaces;
7. resume activity runtime;
8. schedule periodic jobs.

### 6.2. Periodic Jobs

По `buildClientReadyPeriodicJobs` и `buildRobloxPeriodicJobs` в проекте уже есть регулярные задачи для:
1. role-panel auto resend tick;
2. legacy tierlist summary refresh;
3. activity runtime flush;
4. daily activity role sync;
5. verification deadline sweep;
6. Roblox metadata refresh;
7. Roblox playtime sync;
8. Roblox runtime flush.

### 6.3. Serialized Execution

`src/runtime/serialized-task-runner.js` и related usage показывают, что проект осознанно использует serialization для mutation/task paths.
Это значит:
1. race conditions уже были или ожидаются;
2. некоторые write paths считаются transaction-like seams;
3. новые persisted mutations нельзя писать как случайные side effects из любого handler-а.

---

## 7. Детальная Карта Доменных Систем

### 7.1. Onboarding

Текущее назначение onboarding-слоя:
1. welcome panel;
2. begin route selection;
3. main picker;
4. kills + screenshot submit;
5. pending review creation;
6. access-role grant strategy;
7. non-JJS альтернативная ветка;
8. Roblox identity step.

Из repo memory и текущего кода важно помнить:
1. onboarding умеет normal / wartime / apocalypse режимы;
2. begin-route priority уже критична и документирована;
3. Roblox identity в onboarding и profile — связанные, но уже не одинаковые потоки;
4. delayed-access submit path чувствителен к тому, где вычисляется effectiveKills.

### 7.2. Kill Tiers И Milestones

Текущий канонический helper — `src/onboard/kill-tiers.js`.
Из тестов и кода видно, что базовые thresholds сейчас такие:
1. Tier 2: 1000
2. Tier 3: 4000
3. Tier 4: 9000
4. Tier 5: 15000

Kill milestones:
1. `20k`
2. `30k`

Это важно, потому что часть старых документов и setup-текстов может содержать более старые пороги.

### 7.3. Text/Graphic Tierlist

Проект содержит одновременно:
1. `graphic-tierlist.js` — graphic rendering engine;
2. `src/onboard/tierlist-*` helpers для text tierlist и ranking/stats;
3. `src/integrations/tierlist-live.js` — legacy/live tierlist integration;
4. `src/integrations/tierlist-dormant.js` — dormant import path;
5. `src/integrations/tierlist-panel.js` — operator/panel surface;
6. `src/integrations/tierlist-character-sync.js` — mapping between runtime characters and legacy tierlist characters.

Вывод:
1. tierlist в репозитории — это не один модуль, а целый кластер систем;
2. character roles, kills, influence multipliers и legacy state здесь уже исторически переплетены;
3. корневые character-role аудиты остаются обязательным чтением перед правками этой зоны.

### 7.4. ELO

ELO-система представлена несколькими слоями:
1. `src/integrations/elo-review-store.js`
2. `src/integrations/elo-manual-chat.js`
3. `src/integrations/elo-dormant.js`
4. `src/integrations/elo-graphic.js`
5. `src/integrations/elo-panel.js`

Это означает:
1. ELO — не просто поле в профиле;
2. у него есть отдельные submit/review/admin/graphic/dormant surfaces;
3. profile лишь читает его итоговую user-facing проекцию.

### 7.5. Roblox

Roblox domain разбит минимум на три owner-слоя:
1. `src/integrations/roblox-service.js` — service/API layer;
2. `src/runtime/roblox-jobs.js` — periodic runtime tracking and sync;
3. `src/integrations/shared-profile.js` — persisted normalized user projection;
4. `src/integrations/roblox-panel.js` — operator/admin surface.

Что уже видно по runtime-коду:
1. verified bindings repairable и отслеживаемы;
2. playtime tracking включён через periodic sync;
3. runtime хранит active sessions и co-play pairs;
4. JJS presence определяется через configured universe/place settings;
5. co-play уже сильнее, чем просто `оба были онлайн`, но не равен guaranteed party truth.

### 7.6. Activity

Activity system уже доросла до полноценного домена, а не helper-а.
Она включает:
1. state;
2. runtime capture;
3. role apply;
4. user inspection;
5. operator panel.

Из `ACTIVITY_SYSTEM_REBUILD_PLAN.md` видно, что эта система уже сталкивалась с:
1. data-plane drift;
2. mismatch между raw history, snapshots и profile mirrors;
3. operator confusion;
4. orphaned profiles / stale states;
5. rebuild vs roles-only sync semantic gaps.

Это один из доменов, где production recovery и архитектурный рефакторинг связаны напрямую.

### 7.7. Verification

Verification domain уже имеет:
1. panel and guide surface;
2. queue/runtime payload builders;
3. OAuth callback server helpers;
4. risk rules;
5. report/deadline sweeps.

Но verification отключаема конфигом и потому может казаться вторичной, хотя кодово уже представляет отдельный owner seam.

### 7.8. News / Daily Chronicle

Есть два уровня контекста:
1. `DAILY_NEWS_PRODUCT_INTENT.md` — продуктовая цель;
2. `DAILY_NEWS_CHRONICLE_PLAN.md` — системный план сборки daily edition.

В коде реализованы:
1. news state;
2. raw voice capture;
3. raw moderation capture.

Не реализованы полностью:
1. daily compiler;
2. fixed-time scheduler;
3. edition renderer;
4. public/staff digest publish layer.

### 7.9. Profile

Профиль — один из самых современных user-facing slices.

Сейчас он уже:
1. отдельная feature-система, а не inline кусок `welcome-bot.js`;
2. работает через slash/message/reply/mention routes;
3. private-first и Components V2 based;
4. использует split owners `access/entry/model/view/operator`;
5. читает shared-profile, kills history, ELO, tierlist, guide links и Roblox/social signals.

Связанные корневые документы:
1. `PROFILE_VISION_PLAN.md` — текущее продуктово-техническое видение профиля;
2. `PROFILE_SYNERGY_SYSTEM_PLAN.md` — отдельный план по синергетическим системам профиля, kills/Roblox/social/story blocks и future telemetry.

### 7.10. Antiteam

Antiteam subsystem не выглядит самым большим по количеству файлов, но это отдельный продуктовый поток:
1. ticket lifecycle;
2. clan/help escalation;
3. public + moderator payloads;
4. Roblox username and photo capture;
5. helper stats and ticket helper state.

### 7.11. Combo Guide

Combo-guide system реально живая:
1. она парсит structured content;
2. публикует character messages и threads;
3. строит navigation;
4. даёт links, которые уже используются в profile read-model.

Важно:
1. сейчас guide links в профиле — Discord-thread based;
2. внешние JJS wiki links пока не канонизированы в character catalog.

---

## 8. Документный Ландшафт В Корне

В этом репозитории root markdown docs — это не мусор, а активные рабочие артефакты.

### 8.1. Операционные И Архитектурные Документы

1. `AGENTS.md`
   - локальные рабочие правила по этому репо;
   - owner seams и поведенческие правила для агентов.

2. `SETUP.md`
   - bootstrap/setup guide;
   - env/config overview;
   - high-level product explanation.

3. `SOURCE_OF_TRUTH_REWRITE_PLAN.md`
   - крупнейший системный аудит и план переписывания SoT слоя;
   - главный документ по cutover/compat/priority chains.

4. `ACTIVITY_SYSTEM_REBUILD_PLAN.md`
   - отдельный глубокий recovery and redesign plan для activity domain.

### 8.2. Узкие Аудиты И Handoff-Файлы

1. `AUDIT_FIX_PLAN.md`
   - handoff по тирлистовым коэффициентам, main semantics и ELO review flow.

2. `CHARACTER_ROLE_TIERLIST_AUDIT.md`
   - архитектурный аудит по линии character roles + text tierlist.

3. `CHARACTER_ROLE_ONBOARDING_RECOVERY_AUDIT.md`
   - узкий аудит по восстановлению канонических ролей персонажей в onboarding.

### 8.3. Продуктовые И Feature-Визион Документы

1. `PROFILE_VISION_PLAN.md`
   - текущее целевое видение private profile feature.

2. `PROFILE_SYNERGY_SYSTEM_PLAN.md`
   - отдельная карта будущих кросс-системных profile features.

3. `DAILY_NEWS_PRODUCT_INTENT.md`
   - продуктовая цель daily news edition.

4. `DAILY_NEWS_CHRONICLE_PLAN.md`
   - системный план превращения этого intent в работающий pipeline.

### 8.4. Как Читать Эти Документы Правильно

1. исторические цифры тестов внутри них — snapshots на дату, а не абсолютный current truth;
2. документы иногда описывают конкретный slice изменения, а не весь проект;
3. они полезны именно как доменные карты и risk notes, не как безусловная замена текущему коду.

---

## 9. Тестовое Покрытие И Его Форма

### 9.1. Общее Количество

В `tests/` сейчас 72 файла.

### 9.2. Группы Покрытия По Доменам

Замер по имени файлов показывает как минимум такие группы:
1. `activity*` — 5
2. `antiteam*` — 4
3. `character*` — 2
4. `client-ready*` — 1
5. `combo-guide*` — 2
6. `db*` — 1
7. `elo*` — 6
8. `native-integrations*` — 1
9. `news*` — 3
10. `non-jjs*` — 1
11. `onboard*` — 4
12. `profile*` — 5
13. `roblox*` — 4
14. `snapshot*` — 1
15. `sot*` — 18
16. `text-tierlist*` — 1
17. `tierlist*` — 7
18. `verification*` — 2
19. плюс отдельные infra tests вроде `autonomy-guard`, `channel-owner`, `serialized-task-runner` и соседние focused slices.

### 9.3. Что Это Означает

1. самый насыщенный по explicit unit/integration coverage слой — SoT;
2. activity, profile, tierlist и ELO тоже уже имеют заметную защиту регрессий;
3. проект больше не в состоянии “без тестов”; наоборот, тесты являются важным навигационным инструментом по owner seams.

---

## 10. Что Уже Реально Сильно Построено

### 10.1. SoT Как Системный Вектор

SoT — это не идея на будущее.
Это уже активная часть архитектуры.

Признаки этого:
1. есть schema, loader, native writers, diagnostics, resolvers, report operator, runtime alerts;
2. есть legacy bridge для compare/write/panels;
3. есть отдельный большой rewrite plan;
4. есть focused tests по нескольким SoT подсистемам.

### 10.2. Profile Как Новая Продуктовая Система

Profile уже находится в более зрелом состоянии, чем многие старые user-facing surfaces:
1. split owners;
2. private-first UX;
3. Components V2;
4. live data composition из нескольких доменов;
5. отдельные vision и synergy docs.

### 10.3. Runtime Scheduling

`src/runtime/client-ready-core.js` показывает, что startup/interval orchestration уже начали выносить в testable control-plane.
Это хороший архитектурный знак.

### 10.4. Shared Profile

Shared profile уже фактически стал центральным user aggregation layer.

### 10.5. Activity Как Полноценный Domain

Activity уже не “пара счётчиков сообщений”, а полноценная система с:
1. runtime;
2. persisted state;
3. recovery проблемами;
4. operator surfaces;
5. отдельным rebuild plan.

---

## 11. Где Проект Сейчас Сложен И Опасен

### 11.1. `welcome-bot.js` Всё Ещё Слишком Большой

20408 строк — это не просто косметическая проблема.
Это значит:
1. локальный баг легко имеет широкие side effects;
2. behaviour ownership часто приходится сначала отыскивать, а потом уже чинить;
3. монолитный router/hot-path всё ещё существует как operational truth.

### 11.2. Много Параллельных Truth-Layers

Сейчас рядом живут:
1. file config;
2. env overrides;
3. runtime config;
4. db.config;
5. db.sot;
6. shared-profile domains;
7. external/dormant imports;
8. иногда отдельные live/external state surfaces.

Это не делает проект плохим, но делает его требовательным к дисциплине.

### 11.3. Не Вся Документация Одинаково Свежая

Есть явные зоны doc drift:
1. `SETUP.md` описывает базовую картину, но часть деталей уже исторически устарела;
2. старые test-count snapshots в root docs отстают от текущего объёма тестов;
3. старые tier thresholds в части документации могут расходиться с текущим `src/onboard/kill-tiers.js`;
4. в проекте встречаются naming inconsistencies вроде `Shinigans` vs `Shenanigans`, `nonGgs` vs `nonJjs`.

### 11.4. Legacy Совместимость Здесь Реально Важна

Репозиторий нельзя безопасно править с предположением “старые compat paths можно просто выкинуть”.

Практика проекта показывает обратное:
1. legacy tierlist/ELO/import state всё ещё реально используются;
2. SoT rewrite идёт через compat bridge, а не через мгновенный destructive replacement;
3. многие риски живут именно в местах, где старый и новый слой пересекаются.

### 11.5. Root Docs Частично Являются Операционным Memory Layer

Это редкий, но важный факт.
Тут handoff docs не “для красоты”, а реально несут knowledge, которого может не быть в одном файле кода.

---

## 12. Честные Несостыковки И Наблюдения

### 12.1. `SETUP.md` Нельзя Считать Единственной Истиной

По сравнению с текущим кодом и аудитными файлами setup-слой выглядит местами устаревшим.

Примеры:
1. current kill-tier thresholds по коду: 1000 / 4000 / 9000 / 15000;
2. старые документы могли описывать другие пороги;
3. в вопросе character roles исторические документы и память указывают, что live semantics уже менялись сильнее, чем это отражено в setup-тексте.

Вывод:
1. `SETUP.md` нужен для развёртывания и high-level понимания;
2. для точной правки поведения нужно проверять текущий код и свежие root audits.

### 12.2. В Проекте Уже Есть Несколько “Сердец”, Но Они Разного Типа

Если искать одно-единственное сердце репозитория, получится ошибка.

Фактически есть несколько центральных слоёв:
1. `welcome-bot.js` — operational heart;
2. `src/db/store.js` — persistence heart;
3. `src/integrations/shared-profile.js` — user data heart;
4. `src/sot/*` — canonical truth heart;
5. root plans/audits — human handoff heart.

Этот файл нужен именно потому, что без такой карты легко спутать эти “сердца” друг с другом.

---

## 13. Как Подходить К Репозиторию Новому Агенту

### 13.1. Если Нужен Общий Вход

Читать в таком порядке:
1. `AGENTS.md`
2. этот файл `REPOSITORY_CONTEXT_AUDIT.md`
3. `SETUP.md`
4. затем нужный доменный план или аудит.

### 13.2. Если Задача Про Startup / Routing / Панели

Смотреть:
1. `welcome-bot.js`
2. `src/runtime/client-ready-core.js`
3. `src/sot/report-operator.js`
4. соответствующий domain operator.

### 13.3. Если Задача Про Characters / Roles / Channels / Panels / Integrations Truth

Смотреть:
1. `SOURCE_OF_TRUTH_REWRITE_PLAN.md`
2. `src/sot/schema.js`
3. `src/sot/loader.js`
4. `src/sot/resolver/*`
5. `src/sot/native-*`
6. `src/sot/legacy-bridge/*`

### 13.4. Если Задача Про Activity

Смотреть:
1. `ACTIVITY_SYSTEM_REBUILD_PLAN.md`
2. `src/activity/*`
3. `src/integrations/shared-profile.js`
4. `src/runtime/client-ready-core.js`

### 13.5. Если Задача Про Profile

Смотреть:
1. `PROFILE_VISION_PLAN.md`
2. `PROFILE_SYNERGY_SYSTEM_PLAN.md`
3. `src/profile/*`
4. `src/integrations/shared-profile.js`
5. `src/runtime/roblox-jobs.js`

### 13.6. Если Задача Про News

Смотреть:
1. `DAILY_NEWS_PRODUCT_INTENT.md`
2. `DAILY_NEWS_CHRONICLE_PLAN.md`
3. `src/news/*`
4. `src/runtime/client-ready-core.js`

---

## 14. Итоговая Оценка Состояния Репозитория

### 14.1. Что Это Не Такоe

Этот проект уже нельзя считать:
1. простым onboarding-ботом;
2. только tierlist-ботом;
3. только moderation utility;
4. неструктурированным кодом без тестов.

### 14.2. Что Это На Самом Деле

Это большой Discord runtime с несколькими продуктами внутри одного процесса:
1. onboarding/access;
2. rankings/tierlists/ELO;
3. shared user profile;
4. Roblox/game telemetry;
5. activity governance;
6. verification;
7. news groundwork;
8. antiteam and operator tooling;
9. SoT rewrite and compatibility framework.

### 14.3. Главный Практический Вывод

Любая серьёзная правка в этом репозитории должна сначала ответить на три вопроса:
1. какой слой здесь owner — runtime, integration, shared-profile, SoT, operator, view или legacy bridge;
2. где лежит persisted truth для этой сущности;
3. какой соседний root-doc уже описывает risk/history этой зоны.

Если эти три вопроса не задать, очень легко:
1. поправить только shadow layer;
2. сломать compat-переход;
3. задублировать owner;
4. оставить проект в ещё более размытом состоянии, чем до правки.

---

## 15. Роль Этого Файла Дальше

Этот файл должен оставаться:
1. первым большим входом в репозиторий;
2. картой того, что где лежит;
3. указателем на существующие узкие планы и handoff docs;
4. честным снимком того, что проект уже большой, слоистый и partly-mid-migration.

Если проект будет дальше расти, поддерживать актуальность этого файла нужно не по мелочам, а по крупным сдвигам:
1. новый доменный owner;
2. новый persisted truth layer;
3. крупный cutover;
4. закрытие legacy surface;
5. появление новой корневой продуктовой системы.
