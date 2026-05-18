# Roblox Tracking System Map

Дата: 17.05.2026

Статус: снимок текущего main + идеальный чеклист на переделку Roblox tracking.

## 1. Короткая правда без тумана

- Если под "Roblox айпи" имелся в виду Roblox API, то да: текущая система завязана именно на Roblox API.
- Если под "Roblox айпи" имелся в виду сетевой IP-адрес игрока, то нет: текущий код IP-адреса Roblox-пользователей не хранит и не отслеживает.
- Реальная главная идея системы сейчас такая: мы держим каноническую Discord -> Roblox связку, затем через публичные Roblox API и runtime-поллинг пытаемся понять, был ли подтверждённый Roblox-аккаунт в JJS, сколько времени он там провёл и с кем пересекался.
- Вся Roblox-истина должна сходиться в одном Roblox-домене профиля, а все экраны и расчёты должны читать уже нормализованный summary, а не изобретать свои версии правды.

## 2. Что именно система отслеживает сейчас

Канонический Roblox-домен нормализуется в [src/integrations/shared-profile.js](src/integrations/shared-profile.js).

### 2.1. Identity и binding

- Roblox userId
- Roblox username
- Roblox displayName
- avatarUrl
- profileUrl
- createdAt
- description
- hasVerifiedBadge
- accountStatus

Это отвечает на вопрос "к какому Roblox-аккаунту привязан Discord-пользователь".

### 2.2. Trust и служебная история привязки

- verificationStatus
- verifiedAt
- updatedAt
- lastSubmissionId
- lastReviewedAt
- reviewedBy
- source

Это отвечает на вопрос "насколько мы доверяем этой связке и откуда она взялась".

### 2.3. Refresh metadata

- lastRefreshAt
- refreshStatus
- refreshError
- usernameHistory
- displayNameHistory

Это отвечает на вопрос "когда Roblox-профиль последний раз обновлялся и не устарели ли username/displayName".

### 2.4. JJS playtime и присутствие

- totalJjsMinutes
- jjsMinutes7d
- jjsMinutes30d
- sessionCount
- currentSessionStartedAt
- lastSeenInJjsAt
- dailyBuckets
- hourlyBucketsMsk

Это отвечает на вопрос "был ли пользователь замечен в JJS, когда именно и сколько накопилось времени".

### 2.5. Social / co-play слой

- serverFriends.userIds
- serverFriends.computedAt
- coPlay.peers
- coPlay.computedAt

У каждого co-play peer сейчас могут храниться:

- minutesTogether
- sessionsTogether
- daysTogether
- sharedJjsSessionCount
- lastSeenTogetherAt
- isRobloxFriend

Это отвечает на вопрос "с кем человек регулярно пересекается в JJS и кто из этих людей Roblox-friend, а кто нет".

### 2.6. Runtime-only состояние

В памяти отдельно живёт runtime state из [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js):

- activeSessionsByDiscordUserId
- activeCoPlayPairsByKey
- dirtyDiscordUserIds
- lastPlaytimeSyncAt
- lastFlushAt

Это не то же самое, что persisted profile. Это оперативная правда текущего процесса до flush в базу.

## 3. Что не отслеживается

- IP-адреса Roblox-пользователей
- приватные данные Roblox, которых нет в публичных API, используемых ботом
- playtime для неподтверждённых Roblox-связок
- playtime для verified-связок без валидного safe positive userId
- playtime, если JJS IDs не настроены в конфиге

Критично: "verified" ещё не означает "trackable".

## 4. Owner map: где какая правда живёт

### 4.1. Канонический Roblox-домен

- [src/integrations/shared-profile.js](src/integrations/shared-profile.js)
- Здесь нормализуется схема Roblox-домена.
- Здесь же `applyRobloxAccountSnapshot()` применяет запись Roblox-аккаунта в профиль.
- Здесь же `buildSharedProfileSummary()` превращает raw domain в summary для UI и расчётов.

### 4.2. Запись binding и wiring живого бота

- [welcome-bot.js](welcome-bot.js)
- Здесь строится canonical binding snapshot.
- Здесь `writeCanonicalRobloxBinding()` остаётся основным write seam.
- Здесь же живёт wiring фоновым задачам refresh, playtime sync и runtime flush.

### 4.3. Внешний Roblox API клиент

- [src/integrations/roblox-service.js](src/integrations/roblox-service.js)
- Отсюда идут вызовы `fetchUsersByUsernames`, `fetchUserProfile`, `fetchUserAvatarHeadshots`, `fetchUserUsernameHistory`, `fetchUserPresences`, `fetchUserFriends`.

### 4.4. Background jobs и runtime truth

- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js)
- Здесь живут:
- verified candidate selection
- metadata refresh job
- playtime sync job
- co-play accumulation
- runtime flush
- runtime dirty-state

### 4.5. Scheduling и cadence

- [src/runtime/client-ready-core.js](src/runtime/client-ready-core.js)
- Здесь решается, как часто запускать refresh, playtime sync и runtime flush.

### 4.6. Модераторская read-side панель

- [src/integrations/roblox-panel.js](src/integrations/roblox-panel.js)
- Панель не является source of truth.
- Панель только читает summary/runtime/job telemetry и строит operator projection.

## 5. Что Roblox API реально делает в этой системе

### 5.1. Identity resolution

- `fetchUsersByUsernames()` превращает Roblox username в стабильный userId.
- Это ключевая точка, потому что playtime tracking строится уже не по имени, а по Roblox userId.

### 5.2. Metadata refresh

- `fetchUserProfile()` тянет текущий профиль.
- `fetchUserAvatarHeadshots()` тянет avatar.
- `fetchUserUsernameHistory()` тянет rename history.

### 5.3. Presence polling

- `fetchUserPresences()` даёт `presenceType`, `universeId`, `rootPlaceId`, `placeId`, `gameId`.
- На этом строится ответ на вопрос: пользователь сейчас в JJS, просто online, offline или в opaque fallback-сценарии.

### 5.4. Friend/social enrichment

- `fetchUserFriends()` и friend-related данные есть в API-клиенте и используются отдельными потребителями вроде antiteam/operator tooling.
- Это не core hot path playtime sync.

## 6. Как система должна читаться в одну прямую линию

1. Пользователь получает или уже имеет Roblox binding.
2. Binding записывается в канонический `domains.roblox` через `writeCanonicalRobloxBinding()`.
3. `ensureSharedProfile()` собирает нормализованный профиль и summary.
4. Metadata refresh периодически подтягивает живой Roblox profile/avatar/username history.
5. Playtime sync берёт только verified и реально trackable аккаунты.
6. Presence polling определяет, в JJS ли человек сейчас.
7. Если да, обновляются JJS playtime, lastSeen, current session и co-play peers.
8. Изменённые профили помечаются dirty.
9. Runtime flush пишет dirty truth обратно в DB.
10. Панель, profile view, synergy и другие потребители читают summary и не должны изобретать свои raw-обходы.

## 7. Откуда binding вообще появляется

Основной write seam: [welcome-bot.js](welcome-bot.js).

По текущему main запись Roblox binding используется как минимум здесь:

- `writeCanonicalRobloxBinding()` как общий helper
- submit / onboarding related flow
- review / approval flow
- moderator/manual auth flow
- antiteam integration flow

Практический смысл: сейчас истина о Discord -> Roblox связке не рождается в panel-коде и не должна там рождаться.

## 8. Где эти данные реально используются

### 8.1. Модераторская Roblox-панель

- [src/integrations/roblox-panel.js](src/integrations/roblox-panel.js)
- Показывает подтверждённые Roblox-профили и `✓`, если бот хотя бы раз видел человека в игре.
- Использует verificationStatus, userId/username, totalJjsMinutes, lastSeenInJjsAt, runtime state, job telemetry, refresh diagnostics.

### 8.2. Профиль пользователя

- [src/profile/model.js](src/profile/model.js)
- Показывает:
- статус Roblox-связки
- username/displayName/history
- verified badge
- account status
- server friends count
- JJS minutes 7d/30d/total
- sessionCount
- current session / last seen
- refresh timestamps/errors
- top co-play peers

### 8.3. Synergy / progress логика

- [src/profile/synergy.js](src/profile/synergy.js)
- Использует JJS minutes, lastSeenInJjsAt, currentSessionStartedAt, serverFriendsCount, nonFriendPeerCount, frequentNonFriendCount, topCoPlayPeers.
- На этом строятся form/social/progress axis и более сложные profile explanations.

### 8.4. Proof window snapshots

- [src/profile/synergy-snapshots.js](src/profile/synergy-snapshots.js)
- При review/approved kills снапшотит Roblox playtime truth на момент решения.
- Это потом используется для сравнения роста между окнами доказательств.

### 8.5. Welcome / onboarding identity lock

- [src/onboard/roblox-identity.js](src/onboard/roblox-identity.js)
- Использует verified Roblox identity, чтобы не дать случайно перетереть уже подтверждённую связку в welcome-flow.

### 8.6. Antiteam / operator flows

- [src/antiteam/operator.js](src/antiteam/operator.js)
- Использует trusted Roblox binding как anchor.
- Может тянуть Roblox friends и presence для operator tooling.

### 8.7. Startup и фоновый runtime

- [src/runtime/client-ready-core.js](src/runtime/client-ready-core.js)
- [welcome-bot.js](welcome-bot.js)
- Здесь Roblox jobs вообще включаются, выключаются и рескейджуливаются.

## 9. Что является core tracking, а что только enrichment

### 9.1. Core tracking

- Discord -> Roblox binding
- verification/trust state
- JJS detection через presence + configured JJS IDs
- playtime accumulation
- runtime active sessions
- flush в DB

Если это сломано, счёт реально перестаёт идти.

### 9.2. Enrichment

- avatar
- username/display history
- refresh diagnostics
- server friends
- co-play / social suggestions
- operator panel explanations

Если enrichment сломан, система становится слепее и грязнее, но core playtime может всё ещё жить.

## 10. Самая важная текущая идея системы

Главная идея не в том, чтобы "следить за всем Roblox".

Главная идея такая:

- у нас есть Discord-пользователь;
- у него есть или нет доверенная Roblox-связка;
- если связка доверенная и trackable, мы периодически спрашиваем Roblox presence API, был ли этот конкретный Roblox account в нашем JJS;
- если был, мы наращиваем JJS playtime и связи совместной игры;
- затем все остальные экраны и расчёты используют уже эту накопленную нормализованную правду.

То есть ядро не "панель", не "review", не "friends" и не "synergy".

Ядро = `trusted binding -> presence match -> session accounting -> persist -> read models`.

## 11. Почему сейчас всё ощущается криво

### 11.1. Слишком много смыслов в одном Roblox-домене

- identity
- verification
- refresh metadata
- playtime
- social graph
- panel diagnostics

Из-за этого любая проблема ощущается как "сломался Roblox целиком", хотя на деле мог сломаться только один слой.

### 11.2. Write owner и orchestration всё ещё толстые

- Каноническая схема уже вынесена.
- Но реальные write flows и wiring всё ещё сильно сидят в [welcome-bot.js](welcome-bot.js).

### 11.3. Runtime truth разделена между памятью и базой

- Пока не прошёл flush, часть правды живёт только в runtime memory.
- Это делает отладку и operator reasoning менее прямыми.

### 11.4. Trackable pool уже verified pool

- Пользователь может быть `verified`, но не попасть в trackable candidates.
- Причины: нет safe userId, нет JJS IDs, кривой binding, stale/invalid data.

### 11.5. Модуль и live wiring сейчас не идеально совпадают

- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js) умеет repair verified bindings по username через `fetchUsersByUsernames`.
- Но в текущем main scheduled wiring в [welcome-bot.js](welcome-bot.js) для `runRobloxPlaytimeSyncJob()` не прокидывает `fetchUsersByUsernames`.
- То есть модульная возможность repair есть, а live hot path в этом снапшоте main ею не пользуется.

Это как раз пример того, почему система ощущается карявой: кодовая возможность и реальная продовая сборка правды разошлись.

### 11.6. Нет одного простого документа, который связывает всё в одну модель

- До этого было много знаний по кускам: panel, runtime, hardening, synergy, manual auth.
- Одной прямой карты "что отслеживаем, зачем, где используется" не было.

## 12. Как это в идеале должно работать

Идеальная модель должна быть такой:

1. Один отдельный Roblox domain owner отвечает только за Roblox.
2. Все write paths пишут только в этот owner seam.
3. Есть явная state machine: `unlinked -> pending -> verified -> trackable -> active -> stale/manual_repair`.
4. Identity, metadata, playtime и social graph разделены логически, даже если лежат рядом в одном домене.
5. Playtime pipeline не зависит от UI и operator panel вообще.
6. Repair path либо реально wired в production, либо удалён из обещаний.
7. Все read models читают summary/derived views, а не лезут в raw profile наобум.
8. У каждого слоя есть свои health metrics, fail modes и recovery actions.

Идеальный операторский вопрос должен звучать так:

- у кого есть доверенная связка;
- кто реально trackable;
- кто реально был замечен в JJS;
- у кого broken binding;
- что поломано: binding, refresh, presence polling, flush или panel projection.

## 13. Подробный чеклист A-Z для нормальной Roblox-отслежки

### A. Definitions и границы

- [ ] Зафиксировать в одном месте, что система не отслеживает IP-адреса, а работает через Roblox API, binding и presence.
- [ ] Дать короткие канонические определения для `verified`, `trackable`, `seen_in_jjs`, `opaque_in_game`, `repairable`, `manual_only`, `dirty_runtime`.
- [ ] Убрать из UI и планов двусмысленные слова вроде "видит Roblox" без уточнения слоя.

### B. Binding entrypoints

- [ ] Найти все Roblox write entrypoints и свести их к одному публичному helper/seam.
- [ ] Запретить прямые ad hoc записи в `domains.roblox` вне owner seam.
- [ ] Для каждого entrypoint сохранять `source`, reviewer, timestamps и submission context.

### C. Identity resolution

- [ ] Всегда резолвить username -> userId до записи доверенной связки.
- [ ] Жёстко отбрасывать non-safe, non-positive и явно битые Roblox userId.
- [ ] Делать userId главным техническим ключом, а username считать изменяемым display-слоем.

### D. Verification lifecycle

- [ ] Явно разделить `pending`, `verified`, `failed`, `unverified` и не использовать их как синонимы trackability.
- [ ] Держать отдельный признак `hasVerifiedBinding` и отдельный `isTrackableForPlaytime`.
- [ ] Держать machine-readable причину, почему verified-пользователь не trackable.

### E. Canonical schema

- [ ] Разделить внутри Roblox domain четыре логические секции: `identity`, `refresh`, `playtime`, `social`.
- [ ] Оставить summary-поля производными, а не первичными.
- [ ] Документировать, какие поля persisted, а какие runtime-only.

### F. Metadata refresh

- [ ] Регулярно обновлять `displayName`, `avatarUrl`, `usernameHistory`, `accountStatus`.
- [ ] Не терять прошлую trusted identity при refresh failure.
- [ ] Явно очищать или перезаписывать `refreshError` только owner-командой refresh.

### G. Candidate selection

- [ ] Делать отдельный отчёт по verified users, trackable users, repairable users, manual-only users.
- [ ] Не допускать silent starvation verified-кандидатов из-за батчинга и сортировки.
- [ ] Хранить, почему кандидат не попал в текущий sync cycle.

### H. Username repair

- [ ] Либо полностью wired прокинуть `fetchUsersByUsernames` в live playtime path, либо перестать считать auto-repair рабочим.
- [ ] Считать repaired/unresolved/failed repair как first-class telemetry.
- [ ] Все repaired bindings помечать dirty и доводить до persisted state через flush.

### I. Presence intake

- [ ] Все presence-ответы нормализовать в единую внутреннюю форму.
- [ ] Не путать `online`, `in_game`, `offline` и `unknown`.
- [ ] Отдельно логировать opaque in-game presence без JJS IDs.

### J. JJS matching rules

- [ ] Держать отдельную конфигурацию для `jjsUniverseId`, `jjsRootPlaceId`, `jjsPlaceId`.
- [ ] Явно документировать приоритеты matching rules.
- [ ] Разделить confirmed JJS match и fallback/opaque match в summary и UI.

### K. Session accounting

- [ ] Считать `sessionCount`, `currentSessionStartedAt`, `lastSeenInJjsAt` только через один session owner.
- [ ] Не закрывать сессии как offline, если presence batch просто упал и truth неизвестна.
- [ ] Явно проверять continuation window и max gap правила.

### L. Playtime buckets

- [ ] Поддерживать `totalJjsMinutes`, `jjsMinutes7d`, `jjsMinutes30d`, daily/hourly buckets в одном месте.
- [ ] Держать расчёт rolling windows в runtime owner, а не в UI.
- [ ] Добавить инварианты: минуты не убывают без recovery-механики, bucket keys валидны, переполнение режется одинаково.

### M. Runtime state

- [ ] Явно отделить in-memory runtime state от persisted profile state.
- [ ] У каждого dirty профиля должна быть объяснимая причина dirty.
- [ ] После рестарта runtime должен либо аккуратно восстановиться, либо показать, что truth временно неполна.

### N. Flush / persistence

- [ ] Flush должен быть сериализован и rollback-safe.
- [ ] Должен быть отдельный статус "truth обновлена в памяти, но ещё не сохранена в DB".
- [ ] Operator UI должен честно видеть pending flush, а не фальшивый idle.

### O. Social graph

- [ ] Явно разделить `serverFriends` и `coPlay` как два разных сигнала.
- [ ] Не считать всех non-friend peers автоматически значимыми.
- [ ] Хранить threshold для frequent non-friend как runtime-configurable business rule.

### P. Summary / read models

- [ ] Все UI и расчёты должны читать `profile.summary.roblox`, а не raw domain как попало.
- [ ] Summary должен содержать готовые operator fields: `hasVerifiedAccount`, `isTrackable`, `serverFriendsCount`, `topCoPlayPeers`, `refreshHealth`, `playtimeHealth`.
- [ ] Summary builder должен быть единственным местом, где raw Roblox domain превращается в прикладную картину.

### Q. Moderator panel

- [ ] Панель должна оставаться read-side, а не write-owner для Roblox truth.
- [ ] Основной экран должен отвечать на один вопрос: кто подтверждён и кого бот реально видел в игре.
- [ ] Отдельный drilldown нужен только для ошибок: broken binding, refresh failures, flush backlog, failed batches.

### R. Profile surfaces

- [ ] Profile card должна показывать только те Roblox сигналы, которые реально помогают решению, а не весь сырой мусор.
- [ ] Прогресс и synergy должны использовать только нормализованные summary/proof snapshots.
- [ ] Все Roblox-поля в профиле должны быть объяснимы человеку без знания runtime internals.

### S. Progress proof windows

- [ ] При review kills обязательно снапшотить playtime window в тот же момент.
- [ ] Сравнение окон должно опираться на snapshot truth, а не на текущий живой профиль.
- [ ] Нужна отдельная проверка, что proof snapshots не ломаются при rename или refresh drift.

### T. Onboarding и identity lock

- [ ] Welcome-flow не должен иметь права тихо перетереть уже trusted Roblox binding.
- [ ] Manual override должен быть явным admin-only действием.
- [ ] Bootstrap с существующего профиля должен читать только Roblox-specific fields, а не generic profile.userId.

### U. Antiteam и другие интеграции

- [ ] Внешние consumer-модули должны читать trusted Roblox anchor из канонического summary.
- [ ] Нельзя, чтобы antiteam, onboarding и panel по-разному понимали trusted Roblox binding.
- [ ] Все интеграции должны использовать единый helper проверки usable Roblox identity.

### V. Config и feature flags

- [ ] Все Roblox runtime flags держать в одном effective config path.
- [ ] В UI всегда показывать, выключена функция или сломана.
- [ ] Нельзя смешивать "feature disabled" и "job error" в один и тот же health текст.

### W. Scheduling и backpressure

- [ ] Refresh, playtime и flush должны идти через общий coordinator, а не свободно гоняться друг с другом.
- [ ] У каждого job kind должен быть dedupe/in-flight guard.
- [ ] На высоких нагрузках должны деградировать cadence и batch processing, а не correctness.

### X. Observability

- [ ] Для каждого Roblox job нужны counters, duration, failed batches, touched users, opaque users, dirty users.
- [ ] Нужен отдельный health snapshot, который можно посмотреть без чтения сырых логов Railway.
- [ ] Любой skipped reason должен быть machine-readable и виден оператору.

### Y. Recovery и repair tooling

- [ ] Должна быть отдельная утилита или panel action для списка broken verified bindings.
- [ ] Repairable и manual-only cases должны строиться одной и той же классификацией, что и runtime.
- [ ] После recovery должен быть отдельный smoke-report: сколько починилось, сколько осталось, что всё ещё manual-only.

### Z. Tests, rollout и cleanup

- [ ] Для каждого слоя нужны узкие tests: binding writes, refresh, presence sync, session accounting, flush, panel projection, summary consumers.
- [ ] Перед rollout нужны smoke cases на живом конфиге: verified trackable, verified repairable, opaque in-game, failed batch, flush pending.
- [ ] После стабилизации нужно удалить мёртвые compat paths, которые обещают поведение, уже не wired в main.

## 14. Самое практичное резюме

Если сжать всё до одной фразы:

- мы не отслеживаем Roblox IP;
- мы отслеживаем доверенную Roblox identity, затем presence в JJS и производные от неё playtime/co-play сигналы;
- эти сигналы потом питают panel, profile view, synergy, progress snapshots и antiteam tooling;
- главная текущая проблема не в отсутствии данных как таковых, а в том, что identity, refresh, runtime, social и UI исторически спутаны и не везде одинаково wired.

Следующая правильная цель после этого документа:

- выровнять live wiring с заявленной моделью;
- затем отделить core tracking pipeline от enrichment и operator UI;
- затем оставить модератору один понятный ответ: кто реально подтверждён, кто реально trackable и кого бот реально видел в игре.