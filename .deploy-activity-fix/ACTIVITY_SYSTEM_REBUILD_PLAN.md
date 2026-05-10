# План перестроя Activity System

Обновлено: 10.05.2026

## Контекст

Текущая проблема не выглядит как один локальный баг в UI. По коду и по live Railway это комбинация из трёх сбоев:

1. control-plane сбои: часть кнопок и modal flows Activity Panel либо плохо объясняет результат, либо вообще приходит в broken wiring;
2. data-plane drift: raw activity history, derived snapshots, profile mirror и role assignment живут не как один атомарный persisted pipeline;
3. operator UX сбоит не только визуально, но и функционально: важные статусы ephemeral, aggregate counters не объясняют per-user причины, recovery path неявный.

Этот документ фиксирует не косметический redesign панели, а программу стабилизации activity-домена.

## Подтверждённые симптомы

1. Activity Panel перегружена агрегатами, при этом нужные operator-facing причины не держатся между refresh/navigation.
2. Inspect-user modal может падать в generic error вместо внятной per-user диагностики.
3. Полный rebuild может показывать "Пересобрано 110, роли применены 0, пропущено 110" без объяснения per-user причин.
4. Roles-only sync может показывать "Применено 0, пропущено 0. Score не пересчитывался", хотя оператор ожидает действие по только что импортированной истории.
5. Панель показывает "Нужен добор старой истории", но это не оформлено как recovery queue с явными users/reasons/actions.

## Подтверждённые live findings с Railway

1. Railway проект/сервис сейчас живы: проект `spectacular-creation`, environment `production`, service `Moderator`.
2. Активный deployment успешный, бот стартует до ready-state и логинится в Discord.
3. Прод-том `/data` смонтирован; `welcome-db.json` существует и используется как реальная БД.
4. В live БД есть persisted raw activity history и calibration runs по historical import.
5. При этом в одном из live срезов `db.sot.activity.userSnapshots` был пустым объектом, несмотря на наличие raw history.
6. Это означает, что текущая production-проблема не сводится к Railway boot/deploy issue; она уже внутри activity persistence/control plane.

### Live baseline на 10.05.2026

Снятые метрики из production `welcome-db.json`:

1. `totalProfiles = 141`
2. `snapshotCount = 0`
3. `profile.domains.activity count = 141`
4. `userChannelDailyStats rows = 1559`
5. `globalUserSessions rows = 8344`
6. `watchedChannels = 10`
7. `calibrationRuns = 2`
8. `lastFullRecalcAt = 2026-05-09T22:14:26.012Z`
9. `lastDailyRoleSyncAt = 2026-05-09T22:14:26.012Z`
10. `runtime.errors = 0`

Последний persisted rebuild+sync stats:

1. `targetUserCount = 110`
2. `managedRoleHolderCount = 105`
3. `localActivityTargetCount = 110`
4. `missingLocalHistoryUserCount = 18`
5. `rebuiltUserCount = 110`
6. `appliedCount = 0`
7. `skippedCount = 110`
8. `skipReasonCounts = { unchanged: 87, member_too_new: 23 }`

Последний persisted roles-only sync stats:

1. `targetUserCount = 141`
2. `managedRoleHolderCount = 105`
3. `localActivityTargetCount = 141`
4. `missingLocalHistoryUserCount = 0`
5. `rebuiltUserCount = 0`
6. `appliedCount = 0`
7. `skippedCount = 141`
8. `skipReasonCounts = { unchanged: 105, member_too_new: 24, apply_declined: 11, missing_desired_role: 1 }`

Дополнительные live распределения по persisted mirror state:

1. `desiredCore = 13`
2. `appliedCore = 13`
3. `joinAgeUnknown = 26`
4. `gatedNew = 9`
5. `desired/applied match = 130`
6. `desired/applied mismatch = 11`
7. `desired set but applied null = 11`
8. `manualOverride = 0`
9. `autoRoleFrozen = 0`

Интерпретация этого baseline:

1. в production raw activity pipeline наполнен, но committed snapshot index пуст;
2. full rebuild persisted как completed operation, но operator message "пропущено всё" в действительности скрывает, что 87 users были classified как `unchanged`, а 23 как `member_too_new`;
3. roles-only sync уже видит 141 users через mirror/fallback surface, но всё равно имеет 11 `apply_declined` и 1 `missing_desired_role`;
4. часть operator confusion — это плохое объяснение panel/status layer, но часть — реальный drift между canonical snapshot state и profile mirror state.

### Дополнительные прод-defects, подтверждённые по live DB

1. В persisted activity mirrors есть `11` users с невозможной комбинацией:
	- `roleEligibilityStatus = join_age_unknown`
	- `roleEligibleForActivityRole = true`
	- `desiredActivityRoleKey = dead`
	- `appliedActivityRoleKey = null`
2. Текущая runtime-логика `resolveActivityRoleTiming(...)` не должна честно производить такой state; для `join_age_unknown` она возвращает `roleEligibleForActivityRole = false`.
3. Все 11 записей сидят на одном `recalculatedAt = 2026-05-09T15:31:44.660Z`, что выглядит как один stale/contradictory persisted bucket, а не как случайный шум.
4. `runtime.errors` в persisted state пусты, значит текущая система не поднимает этот drift как runtime failure и не помогает оператору отличить stale mirror от нормального role decision.
5. Последние persisted audit entries по activity показывают в основном role mapping updates, watch channel sync и historical imports. Явного persisted per-user trail для rebuild/sync failures нет.
6. Узкая live-проверка через Discord API подтвердила, что все 11 users из mismatch bucket вообще не фетчатся как текущие members guild.
7. Значит bucket `apply_declined = 11` в последнем roles-only sync очень вероятно соответствует orphaned/stale profile records, а не "живым users, которым почему-то не смогли выдать роль".
8. Узкая live-проверка missing-local-history queue подтвердила, что `18` users из строки "Нужен добор старой истории" — это текущие guild members с уже существующим persisted activity mirror и applied role `dead`, но без попадания в raw local history target set.
9. Эти 18 users выглядят как live recovery bucket, а не как мусорные orphaned profiles: они действительно присутствуют в guild и действительно держат managed activity role.

Следствие для recovery:

1. Проблема уже не только в пустом `userSnapshots`, но и в том, что `profile.domains.activity` может содержать логически противоречивые persisted mirrors.
2. Recovery не должен безусловно доверять existing profile mirrors как каноническому источнику truth.
3. Нужно отдельное live-восстановление committed snapshots и нормализация contradictory mirrors после кодового fixes, а не только повторный запуск panel actions.
4. В operator diagnostics нужен отдельный bucket для orphaned/stale activity profiles: user есть в persisted activity/profile state, но уже отсутствует в guild и потому любой role apply обречён на `apply_declined`.
5. В operator diagnostics нужен и второй отдельный bucket для live members with managed activity roles but no local history: это и есть содержательный смысл текущего "need old history top-up", и его нужно показывать как recovery queue с users/reasons/next action, а не как голую aggregate count.

## Подтверждённые code findings

### 1. Broken modal wiring в welcome-bot

`handleActivityPanelModalSubmitInteraction` требует `parseRequestedUserId` для inspect-user modal, но текущий activity modal submit wiring в `welcome-bot.js` передаёт только role/channel parsers и не передаёт `parseRequestedUserId` или `resolveMemberRoleIds`.

Следствие: inspect-user path может срываться не на валидации user input, а раньше — на сломанном dependency contract между welcome-bot и activity operator.

### 2. Разные target sets для rebuild и role sync

`runDailyActivityRoleSync` пересобирает users из history-target set, а не из snapshot-target set. При этом `collectActivityHistoryTargetUserIds` не включает `state.userSnapshots`, тогда как отдельный snapshot-target helper включает.

Следствие: можно получить rebuilt/apply semantics, которые выглядят сломанными для оператора:

- raw history есть;
- snapshots уже есть или должны быть;
- rebuild/sync смотрит на другой набор users;
- panel status показывает aggregate counts, но не объясняет расхождение.

### 3. statusText панели одноразовый и неперсистентный

Панель строится от `buildActivityOperatorPanelPayload({ statusText })`, а кнопки rebuild/sync/refresh просто подставляют новый `statusText` в текущий render. Эти сообщения не живут как persisted operator diagnostics и легко исчезают на следующем refresh/navigation.

Следствие: оператор видит, что "нужное не обновляется", хотя часть действий реально завершилась, но их результат не закреплён как stable state.

### 4. Нет persisted per-user skip reasons

Сейчас panel в основном показывает aggregate skipReasonCounts и bounded runtime errors. Для старого активного пользователя без роли нет надёжного persisted trail вида:

- был ли он target-ом,
- был ли snapshot,
- какой desired role был вычислен,
- почему apply был skipped,
- нужен ли import, rebuild, roles-only sync или nothing.

### 5. Текущий save/load boundary закрепляет mirror-only drift

Подтверждённое текущее поведение persistence boundary:

1. `createDbStore.save(...)` сначала запускает `syncSharedProfiles(workingDb)`, затем `syncSotState(workingDb)`.
2. `normalizeActivityState(...)` сохраняет `userSnapshots` только если они уже пришли в `source.userSnapshots`; иначе нормализует в пустой объект.
3. Следствие: если `db.sot.activity.userSnapshots` уже пусты, но `profile.domains.activity` наполнен, текущий save path не восстанавливает snapshots из mirrors автоматически.
4. Значит once-lost snapshots становятся sticky persisted drift, а не self-healing state.

Это ещё не доказывает точный first-loss path, но уже подтверждает, что текущая система не имеет automatic recovery boundary после такой потери snapshot index.

## Целевая архитектура

Нужно свести activity к одному каноническому persisted pipeline:

`raw history -> committed snapshots -> profile mirror -> role decision -> persisted operator diagnostics`

Правила:

1. канонический source of truth для role decisions: `db.sot.activity.userSnapshots`;
2. `profile.domains.activity` — read-side mirror и compat fallback, но не primary source для decision logic;
3. import/rebuild/sync должны иметь один commit boundary и не оставлять persisted raw history без committed snapshots;
4. panel должна читать не ephemeral statusText, а persisted operator diagnostics и per-user diagnosis surfaces.

## Фазы работ

### Phase 0 — Freeze incident shape

Цель: зафиксировать production baseline до правок.

Сделать:

1. снять snapshot текущего live состояния: raw history counts, snapshot count, calibration runs, role mappings, last rebuild/sync stats;
2. подтвердить exact mismatch surfaces между live DB, panel status и кодом;
3. сохранить эти факты как before-state для recovery verification.

### Phase 1 — Repair interaction correctness

Цель: сначала починить сломанные operator actions, потом менять UX.

Сделать:

1. починить wiring `welcome-bot.js -> handleActivityPanelModalSubmitInteraction` для inspect-user modal;
2. нормализовать error boundaries для activity button/modal flows;
3. убедиться, что import/rebuild/sync идут через serial execution и отвечают детерминированно;
4. различать invalid input и internal wiring/runtime failure в user-facing replies.

### Phase 1 — Make persistence transactional

Цель: activity state не должен расползаться между raw history, snapshots и mirrors.

Сделать:

1. ввести явный commit boundary для snapshot rebuild/save;
2. запретить успешный rebuild/save path, который оставляет `db.sot.activity.userSnapshots` пустым при наличии rebuild results;
3. синхронизовать snapshot commit и `profile.domains.activity` mirror;
4. добавить invariant checks на destructive snapshot loss.

### Phase 1 — Rebuild target semantics

Цель: rebuild/sync должны работать по объяснимым и предсказуемым target sets.

Сделать:

1. разделить users с raw local history, users с committed snapshots и managed-role holders without local history;
2. `runDailyActivityRoleSync` не должен игнорировать snapshot users;
3. roles-only sync должен оставаться snapshot-first с mirror fallback только как compat path;
4. panel и per-user inspection должны объяснять, в какой queue/user-set сейчас находится пользователь.

### Phase 1 — Turn import into recovery job

Цель: historical import должен быть recovery workflow, а не blind button.

Сделать:

1. отделить import planning/progress от final rebuild/sync;
2. сделать per-channel checkpoint-safe execution и partial-failure accounting;
3. формализовать "Нужен добор старой истории" как recovery queue;
4. показывать, какие users реально blocked only by missing local history.

### Phase 2 — Replace Activity Panel information architecture

Цель: превратить панель из noisy aggregate dump в рабочий control surface.

Рекомендуемая структура:

1. `Overview` — только system health, next step, latest successful actions;
2. `Recovery Queue` — users/groups blocked by missing history, join-age issues, missing mappings, apply failures;
3. `User Lookup` — single-user diagnosis и next action;
4. `Config` — watched channels, role mappings, scoring/runtime config отдельно от recovery actions.

### Phase 2 — Persist observability

Цель: operator state должен переживать refresh и рестарт.

Сделать:

1. хранить last import, last rebuild, last roles-only sync, top failed users, snapshot drift counts, last action summaries;
2. bounded runtime/operator diagnostics сохранять в `state.runtime` / `state.ops`;
3. panel render делать от persisted diagnostics, а не от ephemeral `statusText`.

### Phase 3 — Expand regression coverage

Цель: поймать именно те сбои, которые уже ушли в production.

Добавить тесты на:

1. missing modal wiring из `welcome-bot.js`;
2. empty `userSnapshots` при наличии raw history;
3. rebuild target selection excluding snapshot users;
4. partial import failures и checkpoint monotonicity;
5. stale profile mirrors и snapshot-first role plan;
6. per-user diagnosis output и stable operator messaging.

### Phase 3 — Staged live recovery

Цель: после кода вернуть production в объяснимое и стабильное состояние.

Сделать:

1. backup `/data/welcome-db.json`;
2. one-off rebuild committed snapshots from persisted raw history;
3. проверить non-zero snapshot count и корректные role mappings;
4. выполнить controlled sync;
5. вручную проверить старого активного user, gated newcomer и managed-role holder без local history.

## Принципы

1. Не лечить это ещё одной косметической panel polish правкой.
2. Не смешивать incident recovery и feature work: сначала stabilise, потом redesign.
3. Не считать profile mirror каноническим source of truth для role decisions.
4. Не доверять aggregate counts без persisted per-user explanation.
5. После каждого substantive fix делать focused validation, затем полный `node --test`, а для runtime issues — ещё и live verification.

## Ожидаемый результат

После выполнения плана activity-система должна стать:

1. детерминированной: import/rebuild/sync не дают разных истин для одного и того же user state;
2. объяснимой: по каждому user можно понять exact current status и next action;
3. устойчивой: Railway restart/save cycle не теряет committed snapshots;
4. операторской: panel показывает recovery queue и реальные blockers, а не только красивые aggregate counters.