# Roblox Tracking Checklist Audit

Дата: 17.05.2026

Основание: checklist из [ROBLOX_TRACKING_SYSTEM_MAP.md](ROBLOX_TRACKING_SYSTEM_MAP.md).

Формат статусов:

- `DONE` — пункт по current main реально закрыт.
- `PARTIAL` — кусок закрыт, но есть заметный разрыв.
- `CONTRADICTED` — код обещает одно, а live wiring/current UX делают другое.
- `MISSING` — нужного слоя или инструмента по сути нет.

## 1. Итог без смягчений

Текущее состояние по checklist:

- `DONE`: 5
- `PARTIAL`: 20
- `CONTRADICTED`: 1
- `MISSING`: 0

Главный вывод:

- каркас Roblox tracking в main уже есть;
- ядро binding -> presence -> playtime -> flush действительно существует;
- но operator truth, recovery tooling, единая trackability-модель и live wiring всё ещё собраны неровно;
- самая жёсткая поломка сейчас одна: username-repair существует в runtime-модуле, но не wired в живой scheduled playtime path.

## 2. Самые опасные разрывы

### 2.1. Критичные

1. `H / C` — auto-repair verified bindings по username не работает в live hot path.
2. `Q / V / X` — после упрощения панели operator почти не видит health/errors/flush backlog, хотя snapshot и telemetry это считают.
3. `N` — Roblox runtime flush использует plain `saveDb()` и не проходит через общий serialized DB mutation seam.
4. `P / D` — в canonical summary нет явного `isTrackable` и machine-readable reason, почему verified пользователь не trackable.
5. `U` — consumer-модули всё ещё не сведены к одному helper проверки usable/trusted Roblox identity.

### 2.2. Высокие

1. `F` — metadata refresh реализован, но в current config выключен, поэтому refresh drift сам себя не лечит.
2. `Y` — нет отдельного operator tooling для broken verified bindings.
3. `M` — runtime dirty-state есть, но нет внятной причины dirty по каждому профилю.
4. `S` — proof snapshots есть, но отдельной защиты от rename/refresh drift как зафиксированного слоя нет.

## 3. A-Z аудит

### A. Definitions и границы

- Статус: `PARTIAL`
- Вердикт: границы уже описаны в [ROBLOX_TRACKING_SYSTEM_MAP.md](ROBLOX_TRACKING_SYSTEM_MAP.md), но канонические определения всё ещё размазаны между документом, runtime и panel read-side.
- Что закрыто:
- прямо зафиксировано, что Roblox IP не отслеживается;
- scope через Roblox API, binding и presence описан.
- Что не закрыто:
- термины `trackable`, `repairable`, `manual_only`, `dirty_runtime` не вынесены в один канонический кодовый словарь;
- эти состояния выводятся в разных местах разными слоями.
- Доказательства:
- [ROBLOX_TRACKING_SYSTEM_MAP.md](ROBLOX_TRACKING_SYSTEM_MAP.md)
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js#L82)
- [src/integrations/roblox-panel.js](src/integrations/roblox-panel.js#L565)
- Приоритет: `MEDIUM`
- Что делать:
- завести единый Roblox tracking glossary/state model рядом с owner seam, а не только в root-доке.

### B. Binding entrypoints

- Статус: `DONE`
- Вердикт: Roblox binding entrypoints в current main действительно сведены к одному основному write seam.
- Что закрыто:
- канонический helper есть;
- review/onboarding/manual/antiteam flows пишут через него;
- служебные поля `source`, reviewer, timestamps сохраняются через options.
- Доказательства:
- [welcome-bot.js](welcome-bot.js#L3589)
- [welcome-bot.js](welcome-bot.js#L5078)
- [welcome-bot.js](welcome-bot.js#L8267)
- [welcome-bot.js](welcome-bot.js#L8369)
- [welcome-bot.js](welcome-bot.js#L8433)
- [welcome-bot.js](welcome-bot.js#L8501)
- [welcome-bot.js](welcome-bot.js#L14498)
- Приоритет: `LOW`

### C. Identity resolution

- Статус: `PARTIAL`
- Вердикт: username -> userId resolution существует и используется, но production repair-path разорван.
- Что закрыто:
- Roblox API client умеет `fetchUsersByUsernames()`;
- binding flows в welcome/manual path умеют резолвить username в userId;
- non-safe/non-positive userId режутся.
- Что не закрыто:
- runtime auto-repair verified bindings по username не wired в scheduled sync.
- Доказательства:
- [src/integrations/roblox-service.js](src/integrations/roblox-service.js#L241)
- [welcome-bot.js](welcome-bot.js#L3589)
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js#L108)
- [welcome-bot.js](welcome-bot.js#L937)
- [tests/roblox-jobs.test.js](tests/roblox-jobs.test.js#L314)
- Приоритет: `CRITICAL`
- Что делать:
- либо реально прокинуть `fetchUsersByUsernames` в scheduled playtime sync, либо перестать считать auto-repair частью live system.

### D. Verification lifecycle

- Статус: `PARTIAL`
- Вердикт: базовые verification states нормализованы, но trackability до сих пор не выделена как отдельная first-class truth.
- Что закрыто:
- `unverified`, `pending`, `verified`, `failed` существуют;
- `hasVerifiedAccount` строится в summary.
- Что не закрыто:
- нет явного summary-поля `isTrackableForPlaytime`;
- нет machine-readable reason, почему verified-пользователь не trackable;
- panel вычисляет это read-side локально, а не читает из canonical summary.
- Доказательства:
- [src/integrations/shared-profile.js](src/integrations/shared-profile.js#L890)
- [src/integrations/shared-profile.js](src/integrations/shared-profile.js#L1083)
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js#L82)
- [src/integrations/roblox-panel.js](src/integrations/roblox-panel.js#L627)
- Приоритет: `HIGH`
- Что делать:
- поднять trackability и blocker reason в canonical derived layer, а не оставлять только в panel projection.

### E. Canonical schema

- Статус: `PARTIAL`
- Вердикт: Roblox domain уже каноничен, но логические секции всё ещё смешаны в одном объекте сильнее, чем требует checklist.
- Что закрыто:
- нормализация Roblox-домена есть;
- summary остаётся производным слоем;
- playtime/social уже вложены отдельными блоками.
- Что не закрыто:
- identity и refresh пока всё ещё лежат плоско рядом, а не как чётко разделённые sub-sections;
- persisted/runtime distinction живёт скорее в знании и документации, чем в явной схеме.
- Доказательства:
- [src/integrations/shared-profile.js](src/integrations/shared-profile.js#L890)
- [src/integrations/shared-profile.js](src/integrations/shared-profile.js#L1008)
- Приоритет: `MEDIUM`
- Что делать:
- при следующем schema pass разнести Roblox domain на `identity`, `refresh`, `playtime`, `social` явно.

### F. Metadata refresh

- Статус: `PARTIAL`
- Вердикт: слой refresh хорошо реализован, но в current config по умолчанию выключен, поэтому live self-healing username/display drift сейчас не гарантирован.
- Что закрыто:
- refresh job есть;
- тянутся profile/avatar/username history;
- refresh failure не теряет trusted identity;
- `refreshError` живёт в owner seam.
- Что не закрыто:
- регулярное обновление в current config не происходит, потому что `metadataRefreshEnabled` выключен.
- Доказательства:
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js#L528)
- [welcome-bot.js](welcome-bot.js#L925)
- [bot.config.json](bot.config.json#L51)
- Приоритет: `HIGH`
- Что делать:
- решить, refresh должен быть реально включён в проде или архитектурно считаться optional enrichment и не участвовать в обещаниях.

### G. Candidate selection

- Статус: `PARTIAL`
- Вердикт: candidate selection owner есть, но причины отсева пользователей почти не выходят наружу.
- Что закрыто:
- verified candidates выбираются централизованно;
- repairable candidates тоже выделяются централизованно.
- Что не закрыто:
- нет per-user skip telemetry;
- starvation/control reasoning по verified pool оператору не виден как first-class truth.
- Доказательства:
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js#L82)
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js#L108)
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js#L636)
- Приоритет: `MEDIUM`
- Что делать:
- добавить per-user/aggregate breakdown причин, почему verified user не попал в tracking cycle.

### H. Username repair

- Статус: `CONTRADICTED`
- Вердикт: это самый жёсткий разрыв в current main.
- Что закрыто:
- модуль умеет repair verified bindings по username;
- тесты это подтверждают.
- Что сломано:
- live scheduled `syncRobloxPlaytime` не передаёт `fetchUsersByUsernames`, поэтому repair-path фактически не работает;
- модульная возможность и живая wiring-реальность противоречат друг другу.
- Доказательства:
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js#L150)
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js#L176)
- [welcome-bot.js](welcome-bot.js#L937)
- [tests/roblox-jobs.test.js](tests/roblox-jobs.test.js#L314)
- Приоритет: `CRITICAL`
- Что делать:
- прокинуть `fetchUsersByUsernames: robloxApiClient.fetchUsersByUsernames.bind(robloxApiClient)` в scheduled sync.

### I. Presence intake

- Статус: `PARTIAL`
- Вердикт: нормализация presence хорошая, но opaque fallback считается и телеметрируется, а не логируется как отдельный operator event-layer.
- Что закрыто:
- offline/online/in_game/in_studio различаются;
- opaque in-game cases учитываются отдельно.
- Что не закрыто:
- checklist просил отдельное логирование opaque cases; сейчас это скорее counter/summary truth, а не отдельный log/report seam.
- Доказательства:
- [src/integrations/roblox-service.js](src/integrations/roblox-service.js#L18)
- [src/integrations/roblox-service.js](src/integrations/roblox-service.js#L158)
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js#L353)
- [tests/roblox-jobs.test.js](tests/roblox-jobs.test.js#L766)
- Приоритет: `MEDIUM`
- Что делать:
- решить, нужен ли именно лог/alert seam для opaque cases, а не только counter в summary.

### J. JJS matching rules

- Статус: `PARTIAL`
- Вердикт: matching rules реализованы, но их приоритет и operator-facing semantics ещё не оформлены достаточно жёстко.
- Что закрыто:
- конфиг для `jjsUniverseId`, `jjsRootPlaceId`, `jjsPlaceId` есть;
- matching код есть;
- fallback opaque mode есть.
- Что не закрыто:
- приоритеты matching rules не оформлены как отдельный контракт;
- operator UI сейчас не объясняет, по какому именно правилу юзер считался JJS match.
- Доказательства:
- [bot.config.json](bot.config.json#L57)
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js#L342)
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js#L360)
- Приоритет: `MEDIUM`
- Что делать:
- зафиксировать order of precedence и surface reason в debug/audit tooling.

### K. Session accounting

- Статус: `DONE`
- Вердикт: session accounting owner и базовые safety rules уже соблюдены.
- Что закрыто:
- `sessionCount`, `currentSessionStartedAt`, `lastSeenInJjsAt` считает один runtime owner;
- sessions не закрываются как offline при failed presence batch;
- continuation window/max gap заданы явно.
- Доказательства:
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js#L636)
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js#L750)
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js#L799)
- [tests/roblox-jobs.test.js](tests/roblox-jobs.test.js#L602)
- Приоритет: `LOW`

### L. Playtime buckets

- Статус: `DONE`
- Вердикт: bucket accounting собран достаточно цельно.
- Что закрыто:
- `totalJjsMinutes`, `jjsMinutes7d`, `jjsMinutes30d`, daily/hourly buckets живут в одном owner seam;
- rolling windows считаются в runtime owner;
- нормализация bucket keys и trimming есть.
- Доказательства:
- [src/integrations/shared-profile.js](src/integrations/shared-profile.js#L328)
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js#L282)
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js#L776)
- Приоритет: `LOW`

### M. Runtime state

- Статус: `PARTIAL`
- Вердикт: separation есть, но dirty-state остаётся слишком немым.
- Что закрыто:
- in-memory runtime state отделён от persisted profile state;
- runtime collections нормализуются отдельным owner seam.
- Что не закрыто:
- у dirty профиля нет явной machine-readable причины dirty;
- после рестарта truth восстанавливается частично, но оператору не объясняется, где сейчас memory-vs-persist gap.
- Доказательства:
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js#L29)
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js#L36)
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js#L888)
- Приоритет: `HIGH`
- Что делать:
- добавить dirty-reason model и restart reconciliation truth в operator/read-side tooling.

### N. Flush / persistence

- Статус: `PARTIAL`
- Вердикт: flush path работает, но checklist в жёстком виде ещё не закрыт.
- Что закрыто:
- pending flush truth считается;
- runtime flush как отдельный job есть.
- Что не закрыто:
- `saveDb()` остаётся plain save wrapper, а не глобально сериализованным mutation seam;
- operator UI после упрощения панели больше не показывает flush backlog честно на главном экране;
- нет внятного user-level статуса "в памяти уже обновлено, в DB ещё нет".
- Доказательства:
- [welcome-bot.js](welcome-bot.js#L907)
- [welcome-bot.js](welcome-bot.js#L916)
- [welcome-bot.js](welcome-bot.js#L946)
- [src/integrations/roblox-panel.js](src/integrations/roblox-panel.js#L565)
- [src/integrations/roblox-panel.js](src/integrations/roblox-panel.js#L667)
- Приоритет: `HIGH`
- Что делать:
- либо завести serialized flush seam, либо чётко признать flush best-effort path и дать честный operator drilldown по dirty users.

### O. Social graph

- Статус: `DONE`
- Вердикт: social signals разделены заметно лучше, чем раньше.
- Что закрыто:
- `serverFriends` и `coPlay` разделены;
- frequent non-friend не равен всем non-friend peers;
- threshold configurable через runtime config.
- Доказательства:
- [src/integrations/shared-profile.js](src/integrations/shared-profile.js#L311)
- [src/integrations/shared-profile.js](src/integrations/shared-profile.js#L371)
- [src/integrations/shared-profile.js](src/integrations/shared-profile.js#L1020)
- Приоритет: `LOW`

### P. Summary / read models

- Статус: `PARTIAL`
- Вердикт: summary layer реально существует, но checklist-уровень operator fields в нём ещё не полный.
- Что закрыто:
- profile consumers в целом читают summary;
- `hasVerifiedAccount`, `serverFriendsCount`, `topCoPlayPeers` уже есть.
- Что не закрыто:
- в summary нет явных `isTrackable`, `refreshHealth`, `playtimeHealth` полей;
- panel вынуждена сама собирать часть tracking/read-side truth поверх summary.
- Доказательства:
- [src/integrations/shared-profile.js](src/integrations/shared-profile.js#L1008)
- [src/integrations/shared-profile.js](src/integrations/shared-profile.js#L1083)
- [src/integrations/shared-profile.js](src/integrations/shared-profile.js#L1106)
- [src/integrations/roblox-panel.js](src/integrations/roblox-panel.js#L627)
- Приоритет: `HIGH`
- Что делать:
- расширить canonical summary, чтобы panel и другие consumer-ы не пересобирали trackability/health локально.

### Q. Moderator panel

- Статус: `PARTIAL`
- Вердикт: read-side требование выполнено, но checklist в текущем виде не закрыт из-за потери operator drilldowns после упрощения панели.
- Что закрыто:
- панель остаётся read-side;
- главный экран отвечает на вопрос "кто подтверждён и кого бот видел в игре".
- Что не закрыто:
- отдельный error drilldown для broken binding, refresh failures, flush backlog, failed batches отсутствует в текущем payload;
- snapshot и issues для этого считаются, но не рендерятся в UI.
- Доказательства:
- [src/integrations/roblox-panel.js](src/integrations/roblox-panel.js#L565)
- [src/integrations/roblox-panel.js](src/integrations/roblox-panel.js#L686)
- [src/integrations/roblox-panel.js](src/integrations/roblox-panel.js#L1031)
- Приоритет: `HIGH`
- Что делать:
- не возвращать старую сложную multi-view панель, а добавить отдельный минимальный error/debug drilldown рядом с основным списком.

### R. Profile surfaces

- Статус: `PARTIAL`
- Вердикт: surfaces в целом читают summary, но профиль до сих пор выводит больше Roblox-шума, чем требует checklist.
- Что закрыто:
- progress/synergy работают через summary/proof snapshots.
- Что не закрыто:
- профиль показывает много low-signal Roblox detail одновременно;
- объяснимость без знания runtime internals стала лучше, но ещё не идеальна.
- Доказательства:
- [src/profile/model.js](src/profile/model.js#L704)
- [src/profile/synergy.js](src/profile/synergy.js#L527)
- [src/profile/synergy-snapshots.js](src/profile/synergy-snapshots.js#L35)
- Приоритет: `MEDIUM`
- Что делать:
- разделить Roblox info на operator detail и user-facing actionable subset.

### S. Progress proof windows

- Статус: `PARTIAL`
- Вердикт: основной snapshot contract есть, но checklist просил ещё отдельную защиту от rename/refresh drift, а это явно не выделено.
- Что закрыто:
- proof window снапшотится при review;
- сравнение опирается на snapshot truth.
- Что не закрыто:
- нет отдельного зафиксированного anti-drift guardrail слоя для rename/refresh drift по proof snapshots.
- Доказательства:
- [src/profile/synergy-snapshots.js](src/profile/synergy-snapshots.js#L35)
- [src/profile/synergy-snapshots.js](src/profile/synergy-snapshots.js#L56)
- [src/profile/synergy.js](src/profile/synergy.js#L1385)
- Приоритет: `MEDIUM`
- Что делать:
- добавить тесты/guardrails на snapshot stability при rename/refresh changes.

### T. Onboarding и identity lock

- Статус: `DONE`
- Вердикт: onboarding identity lock в current main закрыт лучше, чем многие другие блоки.
- Что закрыто:
- welcome-flow не может тихо перетереть trusted identity;
- bootstrap читает Roblox-specific fields;
- manual override остаётся отдельным admin-type action path.
- Доказательства:
- [src/onboard/roblox-identity.js](src/onboard/roblox-identity.js#L9)
- [src/onboard/roblox-identity.js](src/onboard/roblox-identity.js#L14)
- [welcome-bot.js](welcome-bot.js#L3651)
- Приоритет: `LOW`

### U. Antiteam и другие интеграции

- Статус: `PARTIAL`
- Вердикт: consumer-ы понимают trusted Roblox anchor похоже, но не через один shared helper.
- Что закрыто:
- antiteam, onboarding и profile реально опираются на verified Roblox truth.
- Что не закрыто:
- antiteam всё ещё использует свою trust logic и даже legacy fallbacks, а не единый helper usable Roblox identity;
- checklist-уровень единого consumer contract не достигнут.
- Доказательства:
- [src/antiteam/operator.js](src/antiteam/operator.js#L749)
- [src/onboard/roblox-identity.js](src/onboard/roblox-identity.js#L27)
- [src/integrations/shared-profile.js](src/integrations/shared-profile.js#L1083)
- Приоритет: `HIGH`
- Что делать:
- вынести единый helper usable/trusted Roblox identity и заставить consumer-ы читать его.

### V. Config и feature flags

- Статус: `PARTIAL`
- Вердикт: effective config path хороший, но current UI больше не отражает весь health state честно.
- Что закрыто:
- Roblox flags собраны в одном effective config path;
- config merge есть.
- Что не закрыто:
- checklist просил, чтобы UI всегда показывал "выключено" vs "сломано";
- после упрощения панели такие distinction внутри snapshot есть, но в основном payload почти не видны.
- Доказательства:
- [bot.config.json](bot.config.json#L51)
- [bot.config.json](bot.config.json#L54)
- [welcome-bot.js](welcome-bot.js#L956)
- [src/integrations/roblox-panel.js](src/integrations/roblox-panel.js#L581)
- [src/integrations/roblox-panel.js](src/integrations/roblox-panel.js#L1031)
- Приоритет: `HIGH`
- Что делать:
- вернуть в operator UX хотя бы один компактный health block с disabled vs error truth.

### W. Scheduling и backpressure

- Статус: `PARTIAL`
- Вердикт: coordinator и dedupe есть, но полноценная backpressure/degradation story всё ещё неполная.
- Что закрыто:
- refresh/playtime/flush идут через один Roblox coordinator;
- dedupe/in-flight guard есть.
- Что не закрыто:
- нет отдельной задокументированной политики degradation под нагрузкой;
- cadence статична, а не adaptive.
- Доказательства:
- [src/runtime/client-ready-core.js](src/runtime/client-ready-core.js#L47)
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js#L409)
- [welcome-bot.js](welcome-bot.js#L918)
- [welcome-bot.js](welcome-bot.js#L937)
- [welcome-bot.js](welcome-bot.js#L946)
- Приоритет: `MEDIUM`
- Что делать:
- описать и при необходимости реализовать high-load degradation policy отдельно от correctness rules.

### X. Observability

- Статус: `PARTIAL`
- Вердикт: job telemetry есть, но operator observability всё ещё слабее checklist-цели.
- Что закрыто:
- counters по jobs, failed batches, touched users, opaque users, dirty users есть;
- отдельный snapshot builder есть;
- `skippedReason` machine-readable уже есть.
- Что не закрыто:
- `skippedReason` только job-wide, а не per-user;
- health snapshot существует в коде, но после упрощения панели не виден оператору достаточно прямо.
- Доказательства:
- [src/integrations/roblox-panel.js](src/integrations/roblox-panel.js#L168)
- [src/integrations/roblox-panel.js](src/integrations/roblox-panel.js#L155)
- [src/integrations/roblox-panel.js](src/integrations/roblox-panel.js#L686)
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js#L636)
- Приоритет: `HIGH`
- Что делать:
- вывести короткий health snapshot обратно в operator surface и добавить richer skip diagnostics.

### Y. Recovery и repair tooling

- Статус: `PARTIAL`
- Вердикт: runtime умеет repair classification, но operator tooling под это ещё недоделан.
- Что закрыто:
- repairable и manual-only cohort-ы считаются на одном runtime/panel basis;
- repair telemetry есть.
- Что не закрыто:
- нет отдельной утилиты или panel action со списком broken verified bindings;
- нет отдельного smoke-report после recovery.
- Доказательства:
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js#L108)
- [src/integrations/roblox-panel.js](src/integrations/roblox-panel.js#L677)
- [src/integrations/roblox-panel.js](src/integrations/roblox-panel.js#L788)
- Приоритет: `HIGH`
- Что делать:
- добавить recovery list/tooling до следующего крупного UX pass.

### Z. Tests, rollout и cleanup

- Статус: `PARTIAL`
- Вердикт: тестовое покрытие хорошее, но rollout/cleanup часть checklist ещё не закончена.
- Что закрыто:
- есть focused tests по binding/refresh/playtime/panel/summary consumers;
- есть тесты на opaque in-game, failed batch, repair, panel projection.
- Что не закрыто:
- current main всё ещё содержит compat paths, которые payload уже не использует, например legacy `roblox_stats_view_*` IDs в panel handler;
- live repair wiring и тестовая capability всё ещё не совпадают.
- Доказательства:
- [tests/roblox-jobs.test.js](tests/roblox-jobs.test.js#L314)
- [tests/roblox-jobs.test.js](tests/roblox-jobs.test.js#L602)
- [tests/roblox-jobs.test.js](tests/roblox-jobs.test.js#L766)
- [tests/roblox-panel.test.js](tests/roblox-panel.test.js#L194)
- [src/integrations/roblox-panel.js](src/integrations/roblox-panel.js#L1078)
- Приоритет: `MEDIUM`
- Что делать:
- после выравнивания live wiring и operator tooling вычистить мёртвые compat promises.

## 4. Финальный приговор

Если резать совсем жёстко, current main находится в состоянии:

- не "всё сломано";
- не "всё готово";
- а "ядро уже существует, но вокруг него до сих пор слишком много несовпадений между канонической правдой, live wiring и operator UX".

Самое слабое место сейчас не само presence/playtime ядро.

Самое слабое место сейчас такое:

- система уже умеет считать много важной Roblox truth;
- но часть этой truth не доходит до оператора;
- часть recovery capability не wired в production hot path;
- а часть consumer-ов всё ещё читают trust/usable identity по своим локальным правилам.

Практический приоритет после этого аудита:

1. Починить live wiring username-repair.
2. Вернуть минимальный operator health/drilldown без возврата к старой перегруженной панели.
3. Поднять `isTrackable` и blocker reason в canonical summary.
4. Свести consumer-ов к одному helper usable Roblox identity.
5. Решить, metadata refresh — реально живой слой или официально optional enrichment.