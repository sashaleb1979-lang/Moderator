# Source-of-Truth: полный аудит и план переписывания

Дата: 03.05.2026 (revision 2 — расширенная архитектура и safe-replacement рецепты)
Статус: handoff-документ для следующего сильного агента. Кода не переписываем здесь — только полный диагноз и пошаговый, безопасный план рефакторинга. Существующие small-agent аудиты включены и каждый их пункт явно отображён в backlog.
Связанные документы: [CHARACTER_ROLE_TIERLIST_AUDIT.md](CHARACTER_ROLE_TIERLIST_AUDIT.md), [CHARACTER_ROLE_ONBOARDING_RECOVERY_AUDIT.md](CHARACTER_ROLE_ONBOARDING_RECOVERY_AUDIT.md), [AUDIT_FIX_PLAN.md](AUDIT_FIX_PLAN.md). Этот файл — поверх них, обобщающий и **исполнимый**.

Update 04.05.2026:
- continuation-blockers из большого аудита закрыты: influence adapter, custom character leak, silent role-sync failures, ground-truth `/sot-report`
- panel read-cutover добит для refresh/repost/config hot-paths через SoT-backed resolved snapshots без writer-cutover
- text tierlist P-B6 закрыт по runtime/shadow/persistence: split-layout больше не держит live/persisted `messageId`, а legacy single-message состояние на load/save мигрируется в `messageIdSummary`
- welcomePanel/nonGgsPanel больше не сцеплены destructive read-helper-ом: `nonGgsPanel` нормализуется отдельно, fallback на welcome применяется только при missing state, а фактический channelId синхронизируется в общем publish-path
- nonJjs/nonGgs presentation canonicalized: writer и storage теперь живут в `presentation.nonGgs`, legacy `nonJjsUi`/`nonGgsUi` остаются только как fallback для старых db и вычищаются normalizer-ом
- character hot-path cutover начат и доведён до рабочего состояния: `reconcileCharacterRolesFromGuild`/`ensureManagedRoles` больше не пишут `generatedRoles.characters/Labels`, а пишут native-owned records в `db.sot.characters`
- save-path закреплён: legacy bridge и `syncSotShadowState(refreshFromLegacy)` сохраняют manual/native-owned SoT character records вместо перетирания их legacy shadow-ом
- character resolver больше не реанимирует stale `generatedRoles.characters/Labels` для native-owned SoT records; configured catalog в welcome runtime теперь обогащается через SoT facade
- runtime character resolver больше не читает compat `db.config.characters`: managed catalog для hot path строится только из `appConfig.characters`/explicit args, а legacy slot остаётся store+legacy-bridge snapshot-ом
- shared profiles теперь сохраняют raw immutable mirror onboarding arrays до нормализации в `domains.onboarding.raw`, поэтому исходные `mainCharacterIds/mainCharacterLabels/characterRoleIds` больше не теряются при first-load cleanup
- historical role-id fallback выведен из runtime hot path: `buildHistoricalManagedCharacterRoleIds` больше не участвует в `reconcileCharacterRolesFromGuild`/`ensureManagedRoles` и остался только как diagnostic helper для `/sot-report`
- ground-truth `/sot-report` for character diagnostics снова честный: character branch строится из configured catalog + legacy generated slots/historical recovery и не использует `listSotCharacters()` / SoT facade
- Phase 4.4 closed: destructive `cleanupOrphanCharacterRoles` снят с auto-call в `ensureManagedRoles` и оставлен только за явным moderator action через moderator panel
- Phase 4.5 closed for runtime role naming: access-role hot path теперь читает canonical `nonJjsAccessRoleId`; legacy `NON_GGS_ACCESS_ROLE_ID` / `roles.nonGgsAccessRoleId` остались только как bootstrap/load aliases
- Section 7.7 closed in runtime hot path: `profile.mainCharacterLabels` / `profile.characterRoleIds` больше не пишутся напрямую из apply/submit/approve flows и пересчитываются как derived view от `mainCharacterIds` + current managed character catalog
- Phase 5.1 started in existing ground-truth UI: `/sot-report` теперь имеет inline operator buttons `verify-now`, `recover-character`, `link-channel` и explicit orphan cleanup прямо в ephemeral report message
- Phase 5.2 started partial: `/sot-report` modal уже умеет ставить и сбрасывать manual character override через native SoT writer (`source: "manual"` / clear to default) без обходного legacy write-path
- Phase 5.2 expanded partial: base role hot path (`moderator` / `accessNormal` / `accessWartime` / `accessNonJjs`) теперь читает SoT role records, а `/sot-report` получил отдельный manual base-role override modal поверх native SoT writer
- Phase 5.2 expanded further: native role writer и `/sot-report` manual role modal теперь покрывают не только base roles, но и tier-role domains (`killTier:1..5`, `legacyEloTier:1..4`), а runtime tier hot path уже читает их через SoT facade
- Phase 5.2 expanded into panel domain too: `/sot-report` получил manual panel override modal для `welcome` / `nonGgs` channel override через native SoT panel writer, а `refreshWelcomePanel` больше не принудительно mirror-ит `nonGgs` обратно в welcome channel
- Phase 5.2 expanded into integration panels: native panel writer, runtime resolved snapshot helper-ы и existing `/sot-report` manual panel modal теперь покрывают `eloSubmit`, `tierlistDashboard` и `tierlistSummary`, так что integration panel overrides уже живут без отдельного operator surface
- Phase 5.2 expanded further into integration panels: `eloGraphic` теперь тоже входит в native SoT panel slot coverage, existing `/sot-report` manual panel modal умеет ставить/сбрасывать его channel override, legacy ELO graphic publisher предпочитает resolved SoT panel snapshot по channelId, а startup path поднимает этот board так же, как `eloSubmit`
- Phase 5.2 ownership cleanup advanced for manual panel reset semantics: clear больше не делает stale refresh поверх уже закреплённого legacy state; `welcome` / `nonGgs` теперь возвращаются в fallback/default publish path, `eloSubmit` / `eloGraphic` / `tierlistDashboard` / `tierlistSummary` удаляют текущий managed message и очищают live legacy snapshot до следующей явной настройки, а `tierlistDashboard` reset дополнительно стал restart-safe через explicit disabled flag вместо неявного appConfig fallback resurrection
- Phase 5.2 ownership cleanup advanced further for operator surfaces: legacy ELO/Tierlist setup modals (`elo_panel_*`, `tierlist_panel_*`) больше не обходят SoT при panel rebind-и и теперь идут через тот же native panel writer + apply path, что и `/sot-report` Manual panel
- Phase 5.2 ownership cleanup advanced further for channel operator surfaces: legacy moderator channels modal (`panel_config_channels_modal`) больше не держит отдельный owner path для `welcome` / `review` / `tierlistText` / `tierlistGraphic` / `log`, а идёт через тот же shared channel apply helper, что и `/sot-report` `link-channel`, включая explicit clear semantics для пустого значения
- Phase 5.2 channel modal flow hardened further: legacy moderator channels modal теперь применяет только реально изменённые channel slots и делает best-effort rollback уже применённых overrides, если следующий slot падает в batch apply
- Phase 5.4 started partial: character-health alerts теперь пишут throttled summary в `log` channel на startup, после moderator-triggered resync/recovery и через periodic tick, если остаются unresolved/ambiguous/stale-role/stale-verification issues
- broader operator-visible alerting тоже начал расширяться: SoT drift summary (`compareSotVsLegacy`) теперь поднимается из console warning в throttled `log` channel alert на startup и periodic tick, так что panel/integration/presentation drift больше не виден только в stdout
- Phase 5.4 hardened further in runtime: character-health alert теперь гидратирует guild role/member cache перед диагностикой, берёт `source` и `verifiedAt` из resolver-backed character records, а startup/periodic alert orchestration вынесен в testable seam `src/sot/runtime-alerts.js` с focused regression coverage
- Phase 5 operator surface hardened further at behavior level: `/sot-report` button actions, modal-open handlers и modal-submit flows больше не живут монолитным куском внутри `welcome-bot.js`; они вынесены в testable seam `src/sot/report-operator.js` с direct regression coverage на permission, refresh/recover/cleanup, manual character bind, manual role override, manual panel override и link-channel paths
- startup orchestration coverage больше не ограничена только alert slice: core `clientReady` prelude и recurring interval wiring вынесены в `src/runtime/client-ready-core.js`, так что порядок `ensureManagedRoles -> startup alerts -> command register -> tier sync -> welcome refresh -> tierlist refresh` и recurring auto-resend/alert/summary ticks теперь закреплены focused tests
- operator-visible diagnostics read cutover advanced: ground-truth `/sot-report` больше не собирает channel/role/panel sections из legacy/manual hot-path state. Integration snapshots вынесены в `src/sot/report-integrations.js`, а channel/role/panel sections теперь строятся через resolver-backed diagnostics, так что operator report читает тот же resolved SoT view, что и остальной hot path
- integration runtime ownership cleanup пошёл глубже operator report: dormant ELO/Tierlist panel snapshot helpers (`src/integrations/elo-panel.js`, `src/integrations/tierlist-panel.js`) больше не читают `db.config.integrations.*` напрямую и теперь получают panel metadata через resolved integration records, сохраняя legacy fallback fields только как compat shadow
- integration write ownership cleanup now covers the remaining operator-side writes too: `elo_panel_source_modal`, `tierlist_panel_source_modal` и `setLegacyEloRoleGrantEnabled` больше не держат разрозненные direct writes. Для них введён shared owner `src/sot/native-integrations.js`, который пишет persisted override в `db.sot.integrations.*` и одновременно держит legacy compat shadow синхронным, чтобы save-time dual-write не затирал native override
- dormant integration snapshot ownership cleanup advanced one step deeper: `applyDormantEloSync` / `clearDormantEloSync` и `applyDormantTierlistSync` / `clearDormantTierlistSync` больше не являются legacy-only владельцами integration snapshot state. Их writes на `status`, `lastImportAt`, `lastSyncAt`, `submitPanel` / `graphicBoard` / `dashboard` / `summary` теперь проходят через shared `writeNativeIntegrationSnapshot(...)`, который синхронно обновляет и `db.sot.integrations.*`, и compat shadow
- Phase 4.1 closed: initial SoT migrate больше не поднимает `db.config.generatedRoles.characters/Labels` и `db.config.characters` в character core; seed строится из `appConfig.characters` + historical profile/submission bindings, а legacy slots остались только внутри legacy bridge shadow compare/sync
- Phase 4.3 closed: `MANAGED_CHARACTER_ROLE_NAME_ALIASES` удалён из runtime hot path; alias candidates теперь живут в `db.sot.characters[*].evidence.aliasNames`, seeded через `src/sot/character-aliases.js`
- Phase 4.6 closed: runtime больше не мержит `appConfig.characters` в `db.config.characters`; `getCharacterCatalog()` читает SoT-enriched managed catalog, а store оставляет `db.config.characters` только как normalized compat snapshot
- Phase 4.7 closed for channel reads: `getNotificationChannelId` / `getWelcomeChannelId` / `getReviewChannelId` / tierlist channel wrappers удалены, runtime читает channel slots напрямую через `getResolvedChannelId(slot)`
- секции 7.1, 7.2, 7.4, 7.5, 7.6 фактически закрыты в коде через SoT facade в hot path; чеклист синхронизирован
- текущий validation baseline после channel-owner slice: `node --check welcome-bot.js`, `node --test tests/sot-channels.test.js tests/channel-owner.test.js`, `node --test tests/sot-panels.test.js`, `node --test tests/tierlist-panel.test.js`, `node --test tests/tierlist-dormant.test.js`, `node --test tests/onboard-submission-flow.test.js` и `npm test` зелёные, 214/214
- текущий validation baseline после startup-alert hardening slice: `node --check welcome-bot.js`, `node --test tests/sot-runtime-alerts.test.js tests/sot-diagnostics.test.js tests/sot-compare.test.js tests/character-role-catalog.test.js` и `npm test` зелёные, 217/217
- текущий validation baseline после operator/startup extraction cluster: `node --check welcome-bot.js`, `node --test tests/sot-report-operator.test.js tests/client-ready-core.test.js tests/sot-runtime-alerts.test.js tests/sot-diagnostics.test.js tests/sot-compare.test.js tests/character-role-catalog.test.js` и `npm test` зелёные, 240/240
- текущий validation baseline после diagnostics read-cutover cluster: `node --check welcome-bot.js`, `node --test tests/sot-report-operator.test.js tests/client-ready-core.test.js tests/sot-runtime-alerts.test.js tests/sot-diagnostics.test.js tests/sot-integrations.test.js tests/sot-report-integrations.test.js tests/sot-compare.test.js tests/character-role-catalog.test.js` и `npm test` зелёные, 242/242
- текущий validation baseline после dormant panel snapshot cutover: `node --check welcome-bot.js`, `node --test tests/elo-panel.test.js tests/tierlist-panel.test.js tests/sot-integrations.test.js tests/sot-report-integrations.test.js`, и `npm test` зелёные, 244/244
- текущий validation baseline после shared integration writer slice: `node --check welcome-bot.js`, `node --test tests/native-integrations.test.js tests/elo-role-grant-toggle.test.js tests/sot-integrations.test.js tests/elo-panel.test.js tests/tierlist-panel.test.js`, и `npm test` зелёные, 248/248
- текущий validation baseline после dormant integration snapshot owner cutover: `node --check src/integrations/elo-dormant.js`, `node --check src/integrations/tierlist-dormant.js`, `node --check src/sot/native-integrations.js`, `node --test tests/native-integrations.test.js tests/elo-dormant.test.js tests/tierlist-dormant.test.js tests/sot-integrations.test.js`, и `npm test` зелёные, 249/249

> Phase 4 honest blockers (updated): character migration block закрыт: SoT migration/runtime matching больше не зависят от `db.config.generatedRoles.characters/Labels`, `db.config.characters` или hardcoded alias const. Legacy character slots остаются только внутри legacy bridge shadow compare/sync до полного decommission. Phase 4 cleanup по naming/profile hot path тоже закрыт; дальше основной хвост уже в phase 5 operator surface.

> Phase 5 partial status: `/sot-report` уже получил verify/recover/link-channel/manual-character-override/manual-role-override (base + tier-role domains)/manual-panel-override (`welcome` / `nonGgs` / `eloSubmit` / `eloGraphic` / `tierlistDashboard` / `tierlistSummary`)/orphan-cleanup actions, а alert pipeline частично живёт через throttled startup/moderator-sync/periodic log alerts по character health и SoT drift. Panel clear/reset semantics для всех поддержанных manual panel slots теперь честные, а channel operator duplicate-owner seam для `welcome` / `review` / `tierlistText` / `tierlistGraphic` / `log` закрыт через shared apply helper; из реального хвоста остаются более глубокий writer ownership cleanup, wider behavior-level verification и более системный multi-domain alert policy.

> Главная цель: ввести один явный, проверяемый и версионированный Source-of-Truth (далее — **SoT**) для всех ключевых сущностей бота, безопасно мигрировать поведение, и удалить старые «угадывающие» слои так, чтобы они не мешали.

---

## 0. TL;DR (что именно делаем)

1. Вводим один новый персистентный слой `db.sot` (с `sotVersion`), где для каждой управляемой сущности явно хранится `id → { value, source, verifiedAt, evidence }`.
2. Вокруг него строим стабильный API-фасад `src/sot/*` с детерминированной priority chain: `manualOverride → persistedSot → configured → historical/recovered → discoverable`. Все кодпасы боту дёргают только этот фасад, никаких прямых обращений к `appConfig`/`db.config.generatedRoles`/`profile.characterRoleIds`/legacy state.
3. Внедряем поэтапно: shadow-mode → dual-write → dual-read → cutover → удаление legacy. На каждом шаге держим зелёные тесты и production smoke-check.
4. Делаем мониторинг и diagnostic surface (модераторская команда `/sot-report`), чтобы любые расхождения и unresolved binding-и были видны не из логов, а из Discord.
5. После cutover destructive-операции (auto-create / auto-delete ролей) физически удаляем из кода — оставляем только manual moderator action через панель + recovery wizard.

---

## 1. Полный реестр «переменных» (источников и потребителей)

В системе одни и те же сущности существуют **в нескольких местах одновременно** и читаются из разных мест в разных code-path. Ниже — полная инвентаризация. Это и есть тот «множественный SoT», который мы заменяем одним явным.

### 1.1. Персонажи (canonical character → label → guild role)

| Слой | Где живёт | Кто пишет | Кто читает |
|---|---|---|---|
| Каноничный список ID/label | [bot.config.json](bot.config.json) `characters[]` | человек / ENV `CHARACTER_CONFIG_JSON` | `appConfig.characters` |
| Runtime catalog | `appConfig.characters` (build-time) | [welcome-bot.js](welcome-bot.js#L370) `buildRuntimeConfig` | весь runtime |
| Persisted compat snapshot | `db.config.characters` | [src/db/store.js](src/db/store.js) `createDbStore.load/save` normalizer | legacy bridge shadow builder only |
| Generated role mapping | `db.config.generatedRoles.characters[id] = roleId` | legacy pre-SoT state | legacy bridge shadow + resolver fallback only |
| Generated role label | `db.config.generatedRoles.characterLabels[id] = roleName` | legacy pre-SoT state | legacy bridge shadow + resolver fallback only |
| Alias seeds | `db.sot.characters[id].evidence.aliasNames[]` | [src/sot/character-aliases.js](src/sot/character-aliases.js) initial migration seed / manual SoT edits | reconcile, diagnostics |
| Профиль игрока | `profile.mainCharacterIds[]`, `profile.mainCharacterLabels[]`, `profile.characterRoleIds[]` | applyMainSelection | historical recovery, UI карточки |
| Submission | `submission.mainCharacterIds[]`, `submission.mainRoleIds[]` | submit flow | review UI, historical recovery |
| Live guild | `member.roles.cache` | модераторы Discord | `getLiveCharacterStatsContext` |
| Legacy tierlist state | `state.json` `characters[]`, `mainIds` | legacy-tierlist (внешний) | tierlist-character-sync |
| Custom additions | `submitAddCharacterUnified` | ручной mod input | legacy tierlist, ранее — picker |

Получаем 11 параллельных представлений одной сущности с **неявным приоритетом** (сейчас приоритет «угадывается» внутри `buildManagedCharacterEntries` и `reconcileCharacterRolesFromGuild`).

### 1.2. Роли — Tier (kill T1..T5)

| Слой | Где |
|---|---|
| ENV | `TIER_ROLE_1_ID..TIER_ROLE_5_ID` |
| File config | `bot.config.json` `roles.killTierRoleIds["1".."5"]` |
| Runtime | `appConfig.roles.killTierRoleIds` |
| Generated | `db.config.generatedRoles.tiers["1".."5"]` |
| Live guild | `guild.roles` (resolve by name `formatTierLabel(t)`) |
| Helper | `getTierRoleId(tier)` — fallback chain ENV → config → generated |
| Legacy ELO tier | `roles.legacyEloTierRoleIds["1".."4"]` (своя ось) |

Конфликт: `resolveLegacyTierlistInfluenceFromMember` исторически читал **только** `appConfig`, а не `getTierRoleId` (см. [AUDIT_FIX_PLAN.md](AUDIT_FIX_PLAN.md) Bug A). Это типичный пример размытого SoT.

### 1.3. Роли доступа

| Сущность | ENV | bot.config.json | runtime |
|---|---|---|---|
| `accessRoleId` (мирный режим) | `ACCESS_ROLE_ID` | `roles.accessRoleId` | `appConfig.roles.accessRoleId` |
| `wartimeAccessRoleId` | `WARTIME_ACCESS_ROLE_ID` | `roles.wartimeAccessRoleId` | `appConfig.roles.wartimeAccessRoleId` |
| `nonGgsAccessRoleId` | 2 имени ENV (`NON_JJS_ACCESS_ROLE_ID`, `NON_GGS_ACCESS_ROLE_ID`) | 2 ключа (`nonJjsAccessRoleId`, `nonGgsAccessRoleId`) | один runtime ключ |
| `moderatorRoleId` | `MODERATOR_ROLE_ID` | `roles.moderatorRoleId` | runtime |
| Текущий режим | — | — | `db.config.onboardMode` |
| Combo guide editor roles | — | — | `db.comboGuide.editorRoleIds[]` |

Замусорено двойными именами `nonJjs`/`nonGgs` и нормализуется в трёх разных местах.

### 1.4. Каналы

| Сущность | ENV | bot.config.json | db.config |
|---|---|---|---|
| welcomeChannelId | `WELCOME_CHANNEL_ID` | `channels.welcomeChannelId` | `welcomePanel.channelId`, `nonGgsPanel.channelId` |
| reviewChannelId | `REVIEW_CHANNEL_ID` | `channels.reviewChannelId` | `db.config.reviewChannelId` |
| tierlistChannelId | `TIERLIST_CHANNEL_ID` | `channels.tierlistChannelId` | `tierlistBoard.text.channelId`, `tierlistBoard.graphic.channelId` |
| notifications/log | `LOG_CHANNEL_ID` | `channels.logChannelId` | `db.config.notificationChannelId` |
| integrations.tierlist.dashboard.channelId | — | — | `db.config.integrations.tierlist.dashboard.channelId` |
| integrations.tierlist.summary.channelId | — | — | `db.config.integrations.tierlist.summary.channelId` |
| integrations.elo.submitPanel.channelId | — | — | `db.config.integrations.elo.submitPanel.channelId` |
| integrations.elo.graphicBoard.channelId | — | — | `db.config.integrations.elo.graphicBoard.channelId` |

Каналы — отдельный кошмар: 8+ ключей, fallback-цепочки разной формы в каждом getter (`getReviewChannelId`, `getTextTierlistChannelId`, …), каждый со своей логикой `isPlaceholder`/`||`.

### 1.5. Сообщения панелей (channelId + messageId)

* welcomePanel, nonGgsPanel
* tierlistBoard.text (3 разных messageId: `messageId`, `messageIdSummary`, `messageIdPages`)
* tierlistBoard.graphic
* integrations.tierlist.dashboard / summary
* integrations.elo.graphicBoard / submitPanel
* roleGrantMessages (registry)
* review messages в `submission.reviewMessageId`

Каждое — своя пара (channelId, messageId) с собственным lifecycle и собственным fallback. Унификация даст огромный win.

### 1.6. Презентация (UI тексты, кнопки, цвета)

* `appConfig.ui.*` (build-time)
* `db.config.presentation.welcome.*` (live override)
* `db.config.presentation.tierlist.*` (live override + labels[1..5])
* `db.config.nonJjsUi.*` (отдельно от presentation, дубль)
* `appConfig.killTierLabels[1..5]` vs `db.config.presentation.tierlist.labels`
* `appConfig.graphicTierlist.tierColors` vs `db.config.presentation.tierlist.graphic.colors`

Один и тот же текст можно поменять из 3 разных мест и каждый rebuild читает по-своему.

### 1.7. Интеграции (ELO + legacy tierlist)

* `db.config.integrations.elo.{sourcePath, mode, status, lastImportAt, lastSyncAt, roleGrantEnabled, submitPanel, graphicBoard}`
* `db.config.integrations.tierlist.{sourcePath, mode, status, lastImportAt, lastSyncAt, dashboard, summary}`
* Внешний `state.json` (live ELO, live tierlist) — своя реальность
* `db.profiles[uid].domains.elo`, `domains.tierlist` — третья реальность (snapshot)
* `welcome-db.json.ratings` (вообще из ELO)

Получили 4 параллельных snapshot одной интеграции.

### 1.8. Профиль игрока (онбординг state)

В одном профиле живут одновременно:

* плоские поля (`mainCharacterIds`, `mainCharacterLabels`, `characterRoleIds`, `approvedKills`, `killTier`, `accessGrantedAt`, …)
* зеркало в `domains.onboarding`
* зеркало в `summary`
* поле `sharedProfileVersion`

`shared-profile.js` нормализует независимо `mainCharacterIds` и `characterRoleIds` (разные slice/limit) — это и есть тот хрупкий инвариант, на котором держится `buildHistoricalManagedCharacterRoleIds`.

### 1.9. Submissions

* `submission.mainCharacterIds[]`, `mainRoleIds[]`, `mainCharacterLabels[]`
* плюс отдельные `reviewChannelId`, `reviewMessageId`
* lifecycle: pending → approved/rejected/expired
* у каждого — свой snapshot влияющий на historical recovery

### 1.10. Кэши и runtime maps

* `guildCache`
* `liveCharacterStatsContextCache` (TTL)
* `mainDrafts`, `submitSessions`, `mainsPickerSessions`, `legacyEloSubmitSessions`, `legacyEloManualModsetSessions`, `nonGgsCaptchaSessions`, `rolePanelDrafts`, `roleCleanupSelections`, `roleRecordSelections`, `rolePanelPickers`

Не SoT-данные, но если SoT меняется (например, замапили роль), эти кэши надо инвалидировать (сейчас инвалидация делается руками в каждом writer-е, легко забыть).

---

## 2. Полный реестр проблем

### 2.1. Архитектурные

**P-A1. Нет явного приоритета источников.**
В каждом домене есть свой ad-hoc fallback (`appConfig || generated || historical || guess by name`). Эти chain-ы реализованы в разных функциях по-разному, легко рассинхронизируются.

**P-A2. Неотделимые домены.**
В welcome-bot.js (14 328 строк) одновременно живут: bootstrap, конфиг, нормализация профиля, role architecture, ELO sync, tierlist sync, panels, UI, modal handlers, cleanup. Любая правка в одной зоне может тихо ломать соседнюю.

**P-A3. Денормализация без обратной связи.**
Профили и submissions содержат `characterRoleIds` снимком. Эти снимки — основа `buildHistoricalManagedCharacterRoleIds`, но их валидность никто не верифицирует против live guild. Грязный исторический snapshot → грязный recovery.

**P-A4. Hardcoded knowledge как канон.**
`MANAGED_CHARACTER_ROLE_NAME_ALIASES` фактически выполняет роль canonical mapping table, но: (а) спрятан как const в монолите, (б) содержит русские строки имён и (в) при переименовании роли модератором сразу разваливается.

**P-A5. Нет версии у конфига db.config.**
Нет `db.config.version`. Любая структурная миграция полагается на «defaultы при отсутствии ключа», что усложняет последовательные refactor-ы и rollback.

### 2.2. Поведенческие

**P-B1. Silent failures в role sync.**
`syncManagedCharacterRoles` оборачивает `add/remove` в `.catch(() => {})`. Пользователь видит «мейн выбран», роль может не выдаться, оператор не знает. (welcome-bot.js около 3590)

**P-B2. Phantom entries в picker и stats.**
Достаточно непустого `roleId` в `getCharacterEntries`, чтобы роль попала в picker и в `getLiveCharacterStatsContext`, даже если её на guild уже нет. ([welcome-bot.js#L2036](welcome-bot.js#L2036), [welcome-bot.js#L1043](welcome-bot.js#L1043))

**P-B3. Destructive cleanup orphan-ов.**
`cleanupOrphanCharacterRoles` чистит `generated.characters[id]` без подтверждения, что роль реально исчезла (а не просто id выбыл из канона). Сильно усложнит будущее «временное» добавление character-id.

**P-B4. Position-aligned arrays.**
`buildHistoricalManagedCharacterRoleIds` зависит от позиционного выравнивания `mainCharacterIds[i]` ↔ `characterRoleIds[i]`. Но `shared-profile.normalizeStringArray` дедуплицирует/обрезает массивы независимо. Любая частичная порча — wrong mapping.

**P-B5. Двойное имя nonJjs/nonGgs.**
ENV, ключи bot.config.json, ключи db.config — всё в трёх вариантах. Любой новый writer может выбрать «не тот» и тихо сломать миграцию.

**P-B6. Множественные messageId tierlist board.**
`tierlistBoard.text.{messageId, messageIdSummary, messageIdPages}` — три параллельных id с собственным fallback в [welcome-bot.js#L788-L797](welcome-bot.js#L788). При первом обновлении после редизайна один из них вылетает, и публикация делает дубль.

**P-B7. Несоответствие unresolved counter и persisted state.**
Описано в `CHARACTER_ROLE_ONBOARDING_RECOVERY_AUDIT.md` §4.3. Семантика возврата у `ensureManagedRoles` и сохранение в `generatedRoles.characters` рассинхронизированы.

**P-B8. Cluster lookup для текстового тирлиста.**
`buildLegacyTierlistClusterLookup` строит карту по `buckets.S/A/B/C/D` без проверки, что character реально присутствует в `meta`. При null-ах раньше падало с `Assignment to constant variable.` (см. лог).

### 2.3. Операционные

**P-O1. Нет prod snapshot процедуры.**
Никто не делает versioned dump welcome-db.json перед миграцией. Любая ошибка → потеря state.

**P-O2. Recovery полностью server-side.**
Модератор не может через UI увидеть «какие entries unresolved». Сейчас это видно только в startup log.

**P-O3. Нет deployment confirmation.**
Локальный fix → main → Railway. Нет smoke-check после restart, поэтому регрессы (как пропавший JJS-блок) ловятся только пользователем.

**P-O4. Тесты покрывают только helpers.**
welcome-bot.js почти не unit-test-абельный, integration-тесты руками. Любой рефакторинг рискует.

---

## 3. Целевая архитектура SoT

### 3.1. Принципы

1. **Один источник, один writer, много reader-ов.** Каждое поле SoT имеет ровно один publisher (writer), все потребители читают через фасад.
2. **Явный приоритет.** Жёсткая цепочка `manualOverride → persistedSot → configured → historical → discovered`. Без угадываний на месте.
3. **Каждое значение — record, а не голая строка.** `{ value, source, verifiedAt, evidence }`. Это даёт diagnostic surface и rollback granularity.
4. **Версионируем persisted state.** `db.sotVersion` + миграционный пайплайн (similarly как `sharedProfileVersion`).
5. **Никаких destructive действий по умолчанию.** Все cleanup только через явный moderator action.
6. **Caches инвалидируются через event-bus.** Каждый writer SoT публикует событие, кеши подписаны.
7. **Тестируемость > удобство.** Все resolver-ы — чистые функции, side-effect-ы только в адаптерах.

### 3.2. Каноническая schema (новый `db.sot`)

```jsonc
{
  "sotVersion": 1,
  "lastVerifiedAt": "2026-05-03T12:00:00.000Z",

  "channels": {
    "welcome":         { "value": "1234", "source": "env|file|manual", "verifiedAt": "..." },
    "review":          { "value": "...", "source": "...", "verifiedAt": "..." },
    "tierlistText":    { "value": "...", "source": "...", "verifiedAt": "..." },
    "tierlistGraphic": { "value": "...", "source": "...", "verifiedAt": "..." },
    "log":             { "value": "...", "source": "...", "verifiedAt": "..." },
    "eloSubmit":       { ... },
    "eloGraphic":      { ... },
    "tierlistDashboard": { ... },
    "tierlistSummary":   { ... }
  },

  "roles": {
    "moderator":   { "value": "...", "source": "..." },
    "accessNormal":  { ... },
    "accessWartime": { ... },
    "accessNonJjs":  { ... },
    "killTier":   { "1": { ... }, "2": { ... }, ..., "5": { ... } },
    "legacyEloTier": { "1": { ... }, ..., "4": { ... } }
  },

  "characters": {
    "<characterId>": {
      "id": "honored_one",
      "label": "Годжо",
      "roleId": "999...",
      "source": "manual|configured|recovered|alias",
      "verifiedAt": "2026-05-03T...",
      "evidence": {
        "exactName": true,
        "overlap": 17,
        "coverage": 0.85,
        "roleShare": 0.92,
        "preferredMatch": false
      }
    }
  },

  "panels": {
    "welcome":         { "channelId": "...", "messageId": "...", "lastUpdated": "..." },
    "nonGgs":          { ... },
    "tierlistText":    { "channelId": "...", "messageIds": { "summary": "...", "pages": "..." }, "lastUpdated": "..." },
    "tierlistGraphic": { ... },
    "eloSubmit":       { ... },
    "eloGraphic":      { ... }
  },

  "presentation": {
    "welcome":  { "title": "...", "description": "...", "steps": [...], "buttons": {...} },
    "tierlist": { "textTitle": "...", "graphicTitle": "...", "labels": {...}, "colors": {...} },
    "nonGgs":   { "title": "...", "description": "...", "buttonLabel": "..." }
  },

  "modes": {
    "onboard": { "value": "peace|wartime", "since": "..." }
  },

  "integrations": {
    "elo":      { "sourcePath": "...", "status": "...", "lastImportAt": "...", "lastSyncAt": "...", "roleGrantEnabled": true },
    "tierlist": { "sourcePath": "...", "status": "...", "lastImportAt": "...", "lastSyncAt": "..." }
  },

  "influence": {
    "default": 1,
    "tiers": { "1": 0.5, "2": 1, "3": 5, "4": 25, "5": 100 }
  }
}
```

> **Профили остаются пользовательскими данными**, но их поля `characterRoleIds`/`mainCharacterLabels` становятся **derived view** через `derivePerProfileMains(profile, sot)` и **не используются** для recovery (recovery идёт только по `mainCharacterIds[]` + live guild). Этим закрываем P-B4.

### 3.3. Module layout

```
src/sot/
  index.js                — публичный фасад (getChannel, getRole, getCharacter, …)
  schema.js               — JSON-schema + дефолты + миграции (0→1, 1→2, …)
  loader.js               — load/save/migrate db.sot, atomic rename, pre-write snapshot
  resolver/
    channels.js           — priority chain для каналов
    roles.js              — priority chain для ролей (без characters)
    characters.js         — резолв character → role (manual → configured → recovered → discovered)
    panels.js             — channelId+messageId единого формата
    presentation.js       — UI overrides
    integrations.js       — sourcePath/status и т.д.
  recovery/
    plan.js               — buildManagedCharacterRoleRecoveryPlan (вынесенная и расширенная)
    confirm.js            — moderator confirm flow API
  diagnostics.js          — собирает unified status report (для /sot-report и для логов)
  events.js               — простой in-process event bus (cache invalidation)
  legacy-adapters/
    profile.js            — read-only adapter старых профилей (compat layer)
    legacy-state.js       — адаптер state.json
```

### 3.4. Стабильный API (ровно тот, через который читают все потребители)

```js
const sot = require("./src/sot");

sot.getChannel("review");                  // → { value, source, verifiedAt } | null
sot.getRole("accessNormal");
sot.getKillTierRole(3);
sot.getCharacter("honored_one");           // → { id, label, roleId, source, evidence } | null
sot.listCharacters({ pickerOnly: true });  // resolved + verified
sot.getPanel("welcome");
sot.getPresentation("welcome");
sot.getInfluence();                        // { default, tiers }
sot.getMode("onboard");

sot.write("characters", "honored_one", { roleId, label, source: "manual", verifiedAt });
sot.write("channels", "review", { value, source: "manual" });

sot.diagnose();                            // полный report для UI/logs

sot.events.on("change", ({ domain, key }) => { invalidateCacheFor(domain, key); });
```

### 3.5. Verification rules

Каждый resolver обязан **проверить** что value валидно перед публикацией:

* `getChannel(...)` ⇒ канал с этим id существует в guild и доступен боту → `verifiedAt`. Если нет — value всё ещё возвращается, но `verifiedAt = null` и `diagnose()` помечает as `stale`.
* `getRole(...)` / `getCharacter(...)` ⇒ роль с этим id есть в guild → `verifiedAt`.
* Если verification fails 3 раза подряд (TTL N часов), publisher пытается заново выбрать через priority chain.

### 3.6. Запреты (что новый код **не делает**)

* Не читает `process.env.*` напрямую (кроме `loader/bootstrap.js`).
* Не читает `appConfig.*` напрямую (кроме того же loader-а).
* Не читает `db.config.generatedRoles.*`, `db.config.characters`, и т.д. — всё через фасад.
* Не делает `guild.roles.create(...)` без явного moderator action.
* Не делает `member.roles.add(...).catch(() => {})` — все ошибки логируются И возвращаются в caller.
* Не строит historical role recovery из `profile.characterRoleIds`.

---

## 4. Полный пошаговый план миграции (5 фаз × N step-ов)

> Каждый step заканчивается **commit + green tests + smoke-check**. Это критично для обратимости.

### Фаза 0 — Подготовка и фикс боли заранее

1. **0.1 Snapshot procedure.** Скрипт `scripts/snapshot-db.js`, выгружающий welcome-db.json + integrations state.json в `backups/<ISO>/`. Запускается перед каждым deploy. Документируется в `SETUP.md`.
2. **0.2 Diagnostic command.** `panel_sot_report` (или slash `/sot-report`) — текущая правда: какие channels/roles/characters resolved/unresolved, source, evidence. Делается на старом коде, **не зависит от SoT-фасада**, чтобы был ground-truth.
3. **0.3 Test seam.** Извлечь `loadDb`/`saveDb` в `src/db/store.js` без поведенческих изменений. Уже даёт +60% тестируемости.

Точка прерывания: после 0.x можно остановить рефакторинг и в любой момент вернуться, ничего не сломав.

### Фаза 1 — Построить новый слой `src/sot/`

4. **1.1 schema.js + дефолты.** Создать `db.sot` с `sotVersion: 0`, populate из текущих `appConfig` + `db.config.*` через **migrate-only** функцию (idempotent). Никто ещё SoT не читает.
5. **1.2 loader.js.** atomic write через temp file + rename. Pre-write snapshot. Версия `1` после успешной миграции.
6. **1.3 resolver/channels.js + tests.** Чистая функция, читает из заранее переданного state.
7. **1.4 resolver/roles.js + tests.**
8. **1.5 resolver/characters.js + recovery/plan.js (refactor существующего).** Перенести `buildManagedCharacterRoleRecoveryPlan` сюда. Расширить тесты на ambiguity / missing / duplicate.
9. **1.6 resolver/panels.js + presentation.js + integrations.js.**
10. **1.7 events.js + diagnostics.js.**
11. **1.8 facade index.js.**

После фазы 1 в репо есть полностью рабочий и протестированный SoT-слой, **никем не используемый**. Это и есть «безопасное внедрение».

### Фаза 2 — Dual-write (двойная запись)

12. **2.1 Каналы.** Все writer-ы каналов (`db.config.notificationChannelId`, `db.config.reviewChannelId`, `welcomePanel.channelId`, …) дополнительно вызывают `sot.write("channels", ...)`. Чтения остаются старыми. После каждого save — сравнение «старое поле» vs `db.sot.channels.*` пишется в diagnostic log.
13. **2.2 Роли.** То же для `generatedRoles.tiers` → `db.sot.roles.killTier.*`.
14. **2.3 Characters.** `reconcileCharacterRolesFromGuild` пишет результат и в `generatedRoles.characters/Labels`, и в `db.sot.characters.*` с полными `evidence`.
15. **2.4 Panels / presentation / integrations.** Каждый writer обновляет SoT.
16. **2.5 Influence.** writer перенесён.
17. **2.6 Validation harness.** В CI и при startup — функция `compareSotVsLegacy(db)`, которая ругается, если SoT и legacy расходятся. Расхождения чинятся точечно.

После фазы 2 SoT всегда валиден на проде, но никто ещё не читает его в hot path.

### Фаза 3 — Dual-read (постепенный переход чтений)

Для каждого домена — отдельный step с smoke-check:

18. **3.1 Каналы.** Заменить `getReviewChannelId / getWelcomeChannelId / getTextTierlistChannelId / …` на враппер `sot.getChannel(...)`. Старые имена сохраняем как тонкие алиасы. Один commit per domain.
19. **3.2 Tier role helpers.** `getTierRoleId`, `getLegacyEloTierRoleId`, `getKillTierRoleId` → `sot.getKillTierRole`. Это автоматически чинит **P-A1** + **AUDIT_FIX_PLAN Bug A** окончательно (тестом).
20. **3.3 Characters.** `getCharacterEntries / getCharacterPickerEntries / getLiveCharacterStatsContext / syncManagedCharacterRoles / applyMainSelection / submitAddCharacterUnified` ходят в `sot.listCharacters`. Picker фильтрует по `verifiedAt != null` ⇒ закрывает **P-B2**.
21. **3.4 Panels.** Все панели читают (channelId + messageId) через `sot.getPanel`. Tierlist text panel получает один источник для `messageIds.summary/pages` ⇒ закрывает **P-B6**.
22. **3.5 Presentation.** UI builders берут тексты из `sot.getPresentation`. Дубль `nonJjsUi` мигрирован в `sot.presentation.nonGgs`.
23. **3.6 Integrations / Influence.** `resolveLegacyTierlistInfluenceFromMember` берёт мультипликаторы из `sot.getInfluence()`, role ids — из `sot.getKillTierRole`.

Каждый step — отдельный коммит и отдельный smoke-check на проде. Если что-то сломалось — rollback одного шага.

### Фаза 4 — Cutover и удаление legacy

Только после того, как фаза 3 в проде стабильна минимум 1 release-window:

24. **4.1 Удалить legacy fallback’и в writer-ах.** Закрыто для character domain: runtime writers уже не пишут `db.config.generatedRoles.characters/Labels`, SoT migration/runtime matching их больше не читают; legacy slots остались только в legacy bridge shadow compare/sync.
25. **4.2 Удалить historical recovery из profiles.** `buildHistoricalManagedCharacterRoleIds` удаляется или переводится в read-only diagnostic helper. Профили перестают хранить `characterRoleIds`/`mainRoleIds` как SoT (оставляем только `mainCharacterIds` + denormalized labels для UI).
26. **4.3 Удалить hardcoded `MANAGED_CHARACTER_ROLE_NAME_ALIASES`.** Закрыто: runtime больше не читает hardcoded const; alias candidates идут через `db.sot.characters[*].evidence.aliasNames`.
27. **4.4 Убрать destructive cleanup.** `cleanupOrphanCharacterRoles` оставляем только за явным moderator click.
28. **4.5 Чистка ENV/file dual naming.** Закрыто для access-role runtime: canonical key в hot path — `nonJjsAccessRoleId`; legacy `NON_GGS_ACCESS_ROLE_ID` и `roles.nonGgsAccessRoleId` остались только bootstrap/load aliases.
29. **4.6 Удалить `db.config.characters` merge.** Закрыто: runtime catalog больше не мержится через `db.config.characters`, store держит legacy slot только как normalized compat snapshot.
30. **4.7 Удалить старые getter-ы.** Закрыто для channel slots: `getNotificationChannelId`, `getReviewChannelId`, `getWelcomeChannelId`, `getTextTierlistChannelId`, `getGraphicTierlistChannelId` удалены; runtime читает channels напрямую через `getResolvedChannelId(slot)`.

### Фаза 5 — Доработка операционки

31. **5.1 `/sot-report` UI.** Partial: ground-truth report уже имеет inline кнопки `verify-now`, `recover-character`, `link-channel` и orphan cleanup; остальные domain-specific actions ещё pending.
32. **5.2 Manual override workflow.** Partial: report modal уже умеет ставить/сбрасывать manual character override (`source: "manual"`), manual role override для base + tier domains (`moderator` / `accessNormal` / `accessWartime` / `accessNonJjs` / `killTier:1..5` / `legacyEloTier:1..4`), manual panel channel override для `welcome` / `nonGgs` / `eloSubmit` / `eloGraphic` / `tierlistDashboard` / `tierlistSummary`, а channel relink flow вынесен в отдельный report modal; дальше pending уже не столько coverage, сколько ownership cleanup, behavior tests и confirm UX.
33. **5.3 Rollout playbook.** В `SETUP.md`: snapshot → deploy → ensure ready → smoke-check → confirm. С чек-листом.
34. **5.4 Алёрты.** Partial: unresolved/ambiguous/stale-role/stale-verification issues уже пишут throttled summary в `log` channel на startup, после moderator-triggered resync/recovery и через periodic tick; более широкий multi-domain alerting policy ещё pending.

---

## 5. Безопасность миграции

### 5.1 Инварианты, которые нельзя нарушать

* Никогда не удалять Discord-роли/каналы/сообщения автоматически в процессе миграции.
* Никогда не очищать `db.config.generatedRoles.characters` как «мусорный» — только аддитивные изменения до фазы 4.
* `welcome-db.json` пишется атомарно (write-temp + rename), а в фазе 1 ещё и со snapshot’ом.
* Каждый коммит — отдельный shippable change, чтобы можно было `git revert <SHA>` без каскадов.

### 5.2 Roll-back карта

| Фаза | Способ отката |
|---|---|
| 0 | revert коммита, никакого state изменения |
| 1 | revert. `db.sot` не читается → no impact |
| 2 | revert. SoT остаётся в db, но legacy-поля валидны |
| 3 | revert конкретного домена — тонкий шов |
| 4 | revert удаления legacy-полей. Снапшоты помогают восстановить, если уже потёрли |
| 5 | revert UI |

### 5.3 Контракт на каждый PR

* unit-тесты на затронутый resolver
* integration-тест: `loadDb → migrate → save → load → стабильно`
* `node --check welcome-bot.js`
* CHANGELOG-строка
* manual smoke-check шаги

---

## 6. Тест-стратегия

* **Unit:** каждый resolver — pure function over fixture (`tests/sot/<domain>.test.js`). Покрытие приоритетов, ambiguity, missing.
* **Migration tests:** `tests/sot/migrate.test.js` — сохранённый dump welcome-db.json (anonymized) → миграция v0→v1 → snapshot diff.
* **Integration tests на welcome-bot:** harness, который грузит fixture-db и `appConfig`, инстанцирует SoT, прогоняет ключевые flow (picker, role sync, stats).
* **E2E smoke в Discord:** скрипт-чек-лист из 8 пунктов (см. `CHARACTER_ROLE_ONBOARDING_RECOVERY_AUDIT.md` §6.4 + ELO/tierlist + welcome panel).

---

## 7. Чек-лист по каждому домену (что должно быть в SoT)

Это табличный «definition of done» для фаз 2–4:

### 7.1 Channels
- [x] welcome / review / tierlistText / tierlistGraphic / log / eloSubmit / eloGraphic / tierlistDashboard / tierlistSummary
- [x] verifyChannelExists() called после write
- [x] все 8 getter-ов из welcome-bot заменены на `sot.getChannel` (тонкие алиасы поверх `getSotChannelValue`)

### 7.2 Roles
- [x] moderator / accessNormal / accessWartime / accessNonJjs
- [x] killTier 1..5
- [x] legacyEloTier 1..4
- [x] auto-create только в фазе 5 через явный moderator action (auto-create отсутствует в hot path)

### 7.3 Characters
- [x] для каждого `bot.config.json.characters[]` есть запись в SoT
- [x] manual moderator overrides не перезаписываются recovery (см. `shouldPreserveManualRecord` в legacy-bridge)
- [x] runtime writer owned by `db.sot.characters` в welcome hot path; legacy `generatedRoles.characters/Labels` больше не пишутся из `reconcileCharacterRolesFromGuild` / `ensureManagedRoles`
- [ ] `aspiring_mangaka` (последний unresolved) — diagnostic helper подсказывает кандидатов
- [x] picker использует `sot.listCharacters` (через `listSotCharacters` в welcome-bot)

### 7.4 Panels & Presentation
- [x] tierlist text panel — один `messageIds.summary`+`messageIds.pages`, без legacy `messageId`
- [x] welcomePanel и nonGgsPanel — отдельные записи
- [x] presentation тексты единые (нет дубля `nonJjsUi` vs `presentation.nonGgs`)

### 7.5 Integrations
- [x] elo.sourcePath / tierlist.sourcePath / dashboard / summary / submitPanel / graphicBoard
- [x] roleGrantEnabled
- [x] статусы lastImportAt/lastSyncAt — централизованы

### 7.6 Influence
- [x] default + tiers 1..5
- [x] `resolveLegacyTierlistInfluenceFromMember` ходит в `sot.getInfluence()` + `sot.getKillTierRole(t)`

### 7.7 Profiles (clean-up)
- [x] `mainCharacterIds[]` остаётся
- [x] `mainCharacterLabels[]`, `characterRoleIds[]` объявлены **derived**, не writable извне в runtime hot path
- [x] raw immutable mirror исходных onboarding arrays сохраняется в `domains.onboarding.raw`
- [x] `buildHistoricalManagedCharacterRoleIds` переведён в diagnostic-only helper и больше не участвует в runtime reconcile/sync

---

## 8. Риск-регистр

| ID | Риск | Вероятность | Митигация |
|---|---|---|---|
| R1 | Дрейф SoT vs legacy в фазе 2 | средняя | `compareSotVsLegacy` на каждом save |
| R2 | Потеря recovered mapping при rollback фазы 4 | средняя | snapshot перед каждым deploy + хранение legacy ещё 2 release |
| R3 | Производительность writer-а при snapshot | низкая | гонит только differential snapshot, сжимает gzip |
| R4 | Refactor ломает текущий tierlist refresh | высокая | отдельный domain commit + smoke-check |
| R5 | Расхождение `unresolved counter` (известный баг) | известная | специально fix в фазе 1.5, тест-кейс |
| R6 | Проблемы с правами Railway volume на write temp | низкая | проверить на staging перед прод |
| R7 | Конкурентные writes (cron + interaction) | средняя | mutex на `saveDb`, или write-queue в loader |

---

## 9. Готовый бэклог задач (нумерованный)

> Это backlog, который можно вести как issues. Каждая задача — отдельный PR.

* **#1** scripts/snapshot-db.js + раздел в SETUP.md
* **#2** `panel_sot_report` (старая реализация, ground-truth)
* **#3** Извлечь `loadDb/saveDb` в `src/db/store.js`
* **#4** `src/sot/schema.js` + миграция v0
* **#5** `src/sot/loader.js` (atomic write + snapshot)
* **#6** `src/sot/resolver/channels.js` + tests
* **#7** `src/sot/resolver/roles.js` + tests
* **#8** `src/sot/resolver/characters.js` + recovery/plan.js refactor
* **#9** `src/sot/resolver/panels.js`
* **#10** `src/sot/resolver/presentation.js`
* **#11** `src/sot/resolver/integrations.js`
* **#12** `src/sot/events.js` + cache invalidation hooks
* **#13** `src/sot/diagnostics.js` + JSON output
* **#14** `src/sot/index.js` фасад
* **#15** Dual-write channels
* **#16** Dual-write roles
* **#17** Dual-write characters
* **#18** Dual-write panels/presentation/integrations
* **#19** Dual-write influence
* **#20** `compareSotVsLegacy` + startup ругательства
* **#21** Dual-read channels (одним коммитом)
* **#22** Dual-read tier role helpers (фикс Bug A окончательно)
* **#23** Dual-read characters (picker + sync + stats)
* **#24** Dual-read panels
* **#25** Dual-read presentation
* **#26** Dual-read integrations + influence
* **#27** Удалить старые getter-ы каналов
* **#28** Удалить hardcoded `MANAGED_CHARACTER_ROLE_NAME_ALIASES`
* **#29** Удалить historical recovery из profiles
* **#30** Удалить destructive cleanup (только manual)
* **#31** Удалить dual `nonJjs`/`nonGgs`
* **#32** `/sot-report` UI с кнопками recover/link/verify
* **#33** Manual override workflow
* **#34** Алёрты в log channel
* **#35** Rollout playbook + чек-лист в SETUP.md

---

## 10. Точки соприкосновения с уже описанными аудитами

| Существующий долг | Где закрывается |
|---|---|
| `aspiring_mangaka` unresolved (`CHARACTER_ROLE_ONBOARDING_RECOVERY_AUDIT.md` §6.1) | #8 + #32 (manual через diagnostic UI) |
| Расхождение unresolved counter (§6.2) | #8 + #20 |
| Hardcoded canonical mapping (§6.3) | #28 + #32 |
| Picker phantom entries (`CHARACTER_ROLE_TIERLIST_AUDIT.md` §7.3) | #23 |
| Silent failures sync (§7.4) | #23 (вернуть ошибки наверх) |
| Welcome-bot.js перегружен (§7.5) | весь backlog (постепенный extraction) |
| Position-aligned arrays (§7.1) | #29 |
| `Bug A` Coefficients (`AUDIT_FIX_PLAN.md`) | #22 (закроет окончательно через тесты) |

---

## 11. Что делать в этом прогоне (быстрый старт)

Если у нас есть свободные tokens после плана — стартовать строго по порядку, минимально:

1. Реализовать **#1** (snapshot script) — это самостоятельный файл `scripts/snapshot-db.js`.
2. Реализовать **#3** (extract `loadDb/saveDb`) — поведенчески нейтральный refactor, +тестируемость.

Эти два шага не меняют поведение и не требуют миграции данных. Это правильное «безопасное начало».

---

## 12. Что осталось доделать (бюджет токенов закончится)

Если этот прогон закроет максимум планирование + #1 и #3, **следующий прогон** должен:

### 12.1 Подготовительный prep следующего агента

* Прочитать этот файл целиком + `CHARACTER_ROLE_*_AUDIT.md` + `AUDIT_FIX_PLAN.md`.
* Проверить, что `scripts/snapshot-db.js` и `src/db/store.js` уже в main.
* Снять снапшот `welcome-db.json` локально, поместить (anonymized) fixture в `tests/fixtures/welcome-db.fixture.json`.

### 12.2 Реализация в следующий прогон (по приоритету)

1. **#4** schema + миграция v0 (`src/sot/schema.js`). Включает: типы записей `{value, source, verifiedAt, evidence}`, дефолты, idempotent `migrateDb(db)`. Тесты — fixture in/out.
2. **#5** loader — atomic write через `fs.renameSync(tmp, dst)`, pre-write snapshot в `backups/<ISO>/`.
3. **#6, #7** resolvers/channels.js + roles.js + полный test set. Цель: покрыть приоритеты ENV → file → db.config → live, ambiguity, missing.
4. **#8** перенос `buildManagedCharacterRoleRecoveryPlan` из `src/integrations/character-role-catalog.js` в `src/sot/recovery/plan.js`, оставить старый модуль как тонкий re-export для обратной совместимости.
5. **#9–#11** остальные resolver-ы (panels/presentation/integrations).
6. **#12** event bus + первый потребитель: `liveCharacterStatsContextCache` инвалидируется по `events.on("change", { domain: "characters" })`.
7. **#13** diagnostics.js — формирует структуру для `/sot-report`.
8. **#14** index.js фасад.
9. Открыть PR-ы строго по одному домену.

### 12.3 Открытые вопросы, которые нужно подтвердить с пользователем перед фазой 4

* Можно ли удалить `nonGgs` legacy ключ или оставить как read-alias навсегда?
* Можно ли удалять `db.config.generatedRoles.*` после фазы 4 или оставить read-only legacy slot ещё на месяц?
* Какой минимальный smoke-window перед cutover (рекомендация: 1 неделя prod + 0 алёртов)?
* Нужны ли модератору inline команды (`/sot-link-channel`) или достаточно панели?

### 12.4 Если прогон ещё больше: следующая итерация — фаза 2 (dual-write)

Начать с **#15** (channels dual-write) и идти вниз по списку до **#20** (compare harness). Это самая «скучная», но самая важная фаза — она даёт безопасный мост.

---

## 13. Краткий summary

* Корень всех проблем — **не один баг, а отсутствие явного канона**. У нас 11 параллельных представлений персонажей, 8+ путей к каналу, 4 источника интеграций, 2 имени для одного и того же nonJjs.
* Решение — отдельный модуль `src/sot/`, единый персистентный slot `db.sot` с записями вида `{value, source, verifiedAt, evidence}` и стабильным API-фасадом.
* Миграция строго поэтапная: snapshot → новый слой без читателей → dual-write → dual-read по доменам → cutover → удаление legacy.
* Каждая фаза reversible: revert одного коммита возвращает поведение.
* Параллельно вводим `/sot-report` для модераторов и алёрты в log channel.
* После cutover destructive auto-create/auto-delete операции запрещены, hardcoded aliases удаляются, historical recovery либо удаляется, либо переезжает в diagnostic-only.

> Этот документ можно использовать как input для следующего прогона. Он самодостаточен.

---

# Часть II — Расширенная архитектура и safe-replacement рецепты (revision 2)

> Эта часть добавлена после того, как были детально перечитаны small-agent аудиты ([CHARACTER_ROLE_TIERLIST_AUDIT.md](CHARACTER_ROLE_TIERLIST_AUDIT.md) и [CHARACTER_ROLE_ONBOARDING_RECOVERY_AUDIT.md](CHARACTER_ROLE_ONBOARDING_RECOVERY_AUDIT.md)). Каждая боль из них здесь явно картирована и закрыта на конкретном шаге миграции.

---

## 14. Архитектура SoT — детальная (модули, типы, контракты)

### 14.1 Доменная модель (типы)

Все записи SoT приведены к **одному shape** — `SotRecord<T>`. Это даёт diagnostic surface, rollback granularity и единый writer.

```ts
// псевдо-TS, в JS — JSDoc

type SotSource =
  | "manual"      // явный override модератора (highest precedence, не перезаписывается)
  | "configured"  // bot.config.json или ENV
  | "recovered"   // overlap-based recovery по historical evidence
  | "alias"       // совпало через известный alias-name
  | "name"        // совпало по точному имени (hard match)
  | "discovered"  // авто-обнаружено в guild (lowest precedence)
  | "default";    // системный дефолт (для presentation/colors/etc.)

interface SotRecord<T = string> {
  value: T;                    // canonical value (roleId / channelId / label / ...)
  source: SotSource;
  verifiedAt: string | null;   // ISO; null если value есть, но не подтверждено в guild
  evidence?: {                 // только для characters / recovery
    overlap?: number;
    coverage?: number;
    roleShare?: number;
    holderCount?: number;
    exactName?: boolean;
    preferredMatch?: boolean;
    candidates?: Array<{ roleId: string; roleName: string; overlap: number }>;
  };
  history?: Array<{ at: string; from: SotSource; to: SotSource; oldValue: T | null }>;
}

interface SotCharacterRecord extends SotRecord<string /* roleId */> {
  id: string;       // canonical character id из bot.config.json
  label: string;    // live server label (Годжо), не английский archetype
  englishLabel: string; // backup для logs/diagnostic ("Honored One")
}

interface SotPanelRecord {
  channelId: SotRecord<string>;
  messageIds: { [slot: string]: SotRecord<string> }; // tierlistText: summary, pages
  lastUpdated: string | null;
}
```

### 14.2 Layout файлов (с обязанностями)

```
src/sot/
  index.js                    — публичный фасад (read API + write API + events)
  schema.js                   — типы записей, дефолтная пустая структура, JSON-schema validator
  migrate.js                  — миграции v0→v1, v1→v2, ... idempotent
  loader.js                   — load/save db.sot, atomic temp+rename, snapshot до write
  bus.js                      — простой EventEmitter, события { domain, key, oldValue, newValue, source }
  diagnostics.js              — формирует SotReport: { resolved, unresolved, ambiguous, stale, mismatched }
  resolver/
    priority.js               — общая priority-chain функция (применяется ко всем доменам)
    channels.js               — ENV → bot.config → live db.sot → guild verify
    roles.js                  — то же для access/moderator/tier ролей
    characters.js             — manual → configured → recovered → alias → name → discovered
    panels.js                 — pair (channelId, messageIds), live verify через message fetch
    presentation.js           — UI overrides
    integrations.js           — sourcePath + status
    influence.js              — multipliers по tier
  recovery/
    plan.js                   — refactor существующего buildManagedCharacterRoleRecoveryPlan
    confirm.js                — moderator confirm flow (manual override запись)
    suggestions.js            — генерирует «возможно это роль X» для unresolved character
  legacy-bridge/
    write.js                  — функции dual-write в старые поля (используется в фазе 2)
    compare.js                — compareSotVsLegacy(db) → массив расхождений (фаза 2 + CI)
    deprecated-getters.js     — re-exports старых имён (getReviewChannelId и т.п.) поверх sot.* для постепенной замены
  guards/
    invariants.js             — проверки: «никогда не удаляем role/channel/message без явного flag», runtime assertions
```

### 14.3 Public API фасада (точные сигнатуры)

```js
// src/sot/index.js

// READ (никаких side-effect, только снимок текущего state)
sot.getChannel(slot)              // → SotRecord<string> | null   slot: "welcome"|"review"|...
sot.getRole(slot)                 // → SotRecord<string> | null   slot: "moderator"|"accessNormal"|...
sot.getKillTierRole(tier)         // → SotRecord<string> | null   tier: 1..5
sot.getLegacyEloTierRole(tier)    // → SotRecord<string> | null   tier: 1..4
sot.getCharacter(id)              // → SotCharacterRecord | null
sot.listCharacters(opts)          // → SotCharacterRecord[]   opts: { pickerOnly?, includeUnresolved? }
sot.getPanel(slot)                // → SotPanelRecord | null
sot.getPresentation(slot)         // → плоский объект текстов
sot.getInfluence()                // → { default, tiers: { 1..5 } }
sot.getMode(slot)                 // → SotRecord<string>  slot: "onboard"
sot.getIntegration(slot)          // → объект интеграции

// WRITE (единственная точка изменения)
sot.write.channel(slot, { value, source })          // → SotRecord, fires bus
sot.write.role(slot, { value, source })
sot.write.character(id, { roleId, label, source, evidence })
sot.write.panel(slot, { channelId?, messageIds?, source })
sot.write.presentation(slot, partial)
sot.write.influence(partial)
sot.write.manualOverride(domain, key, value)        // ставит source: "manual" — highest precedence
sot.write.clearManualOverride(domain, key)

// DIAGNOSTICS
sot.diagnose()                                       // → SotReport
sot.diagnoseCharacter(id)                            // → детальный отчёт по 1 character
sot.compareWithLegacy(db)                            // → массив расхождений (для фазы 2)

// RECOVERY (используется panel_sync_roles)
sot.recovery.plan(guild, profiles, submissions)      // → { recovered, ambiguous, unresolved }
sot.recovery.suggestionsFor(characterId, guild)      // → возможные кандидаты для unresolved

// EVENTS
sot.bus.on("change", (event) => {})
sot.bus.on("verify-failed", (event) => {})
sot.bus.on("recovery-applied", (event) => {})
```

### 14.4 Priority chain (универсальная)

Один общий `applyPriorityChain(layers, verify)`:

```js
// resolver/priority.js
async function applyPriorityChain(layers, verify) {
  // layers: [{ source, value }] in order from highest to lowest
  for (const layer of layers) {
    if (!layer || !layer.value) continue;
    const ok = await verify(layer.value);
    if (ok) return { ...layer, verifiedAt: nowIso() };
  }
  // ничего не верифицировано — возвращаем самый "сильный" layer без verifiedAt
  for (const layer of layers) {
    if (layer?.value) return { ...layer, verifiedAt: null };
  }
  return null;
}
```

Применение для **characters**:

```js
const layers = [
  { source: "manual",     value: manualOverride?.roleId },
  { source: "configured", value: appConfig.characters[id]?.roleId },
  { source: "recovered",  value: recoveryPlan.recoveredRoleIds[id] },
  { source: "alias",      value: aliasMatchedRoleId },
  { source: "name",       value: exactNameMatchedRoleId },
  { source: "discovered", value: lastSeenInGuildRoleId },
];
return applyPriorityChain(layers, (roleId) => guildHasRole(guild, roleId));
```

**Manual override никогда не пересоздаётся автоматически** — это закрывает риск, что recovery затрёт ручной выбор модератора.

### 14.5 Verify-функции (по доменам)

| Домен | Verify |
|---|---|
| channel | `client.channels.fetch(id)` → not null and not deleted |
| role | `guild.roles.cache.has(id) || guild.roles.fetch(id)` → existing |
| character.roleId | то же что role + не входит в blacklist (мод/access/tier) |
| panel.messageId | `channel.messages.fetch(id)` → existing |
| presentation | всегда true (тексты не верифицируются в guild) |

Verify асинхронный, но кешируется внутри SoT с TTL 60s. Это решает проблему **P-B2 (phantom entries в picker)** — если verify провалился N раз подряд, `verifiedAt = null`, и `listCharacters({ pickerOnly: true })` отбрасывает запись.

### 14.6 Cache invalidation через bus

Текущая проблема: `liveCharacterStatsContextCache` инвалидируется руками в каждом writer-е, легко забыть.

В новой архитектуре:

```js
// welcome-bot.js (фаза 3.3+)
sot.bus.on("change", (e) => {
  if (e.domain === "characters" || e.domain === "roles") {
    invalidateLiveCharacterStatsContext();
  }
});
```

Один subscribe на старте бота — все будущие writer-ы автоматически триггерят invalidation.

---

## 15. Безопасные replacement-рецепты по узлам (legacy → new)

> Каждый рецепт — самодостаточный мини-плейбук. Делается одним PR. Не зависит от других рецептов в этой секции (внутри своего домена).

### 15.1 Замена `getReviewChannelId / getNotificationChannelId / getWelcomeChannelId / getTextTierlistChannelId / getGraphicTierlistChannelId`

**Legacy (welcome-bot.js):**
```js
function getReviewChannelId() {
  const configured = String(db.config.reviewChannelId || "").trim();
  const fallback = String(appConfig.channels.reviewChannelId || "").trim();
  const channelId = configured || fallback;
  return isPlaceholder(channelId) ? "" : channelId;
}
```

**Шаг 1 (фаза 2 — dual-write).** В loader/saveDb добавить:
```js
sot.write.channel("review", {
  value: db.config.reviewChannelId || appConfig.channels.reviewChannelId,
  source: db.config.reviewChannelId ? "manual" : "configured",
});
```
Старый getter остаётся.

**Шаг 2 (фаза 3 — dual-read).** Меняем тело getter-а на тонкий враппер:
```js
function getReviewChannelId() {
  return sot.getChannel("review")?.value || "";
}
```
Все вызывающие места не меняются. Smoke-check: review-канал по-прежнему резолвится.

**Шаг 3 (фаза 4 — удаление).** После 1-недельного prod-window получатели начинают звать `sot.getChannel("review")?.value` напрямую. Старая функция помечается deprecated и удаляется.

Точно так же — для всех 8 channel-getter-ов.

### 15.2 Замена `getTierRoleId` → `sot.getKillTierRole` (закрывает Bug A окончательно)

**Legacy ([welcome-bot.js#L3608](welcome-bot.js#L3608)):**
```js
function getTierRoleId(tier) {
  const tierKey = String(tier);
  const generatedRoles = getGeneratedRoleState();
  return String(appConfig.roles.killTierRoleIds?.[tierKey] || generatedRoles.tiers?.[tierKey] || "").trim();
}
```

**Проблема (Bug A в [AUDIT_FIX_PLAN.md](AUDIT_FIX_PLAN.md)):** `resolveLegacyTierlistInfluenceFromMember` мимо этого helper-а смотрит сразу в `appConfig.roles.killTierRoleIds[tierKey]` (без generated fallback). Это даёт `0/39` пересчёт.

**Шаг 1 (фаза 2).** Dual-write всех 5 tier ids в `db.sot.roles.killTier.{1..5}`.

**Шаг 2 (фаза 3.2).**
```js
function getTierRoleId(tier) {
  return sot.getKillTierRole(tier)?.value || "";
}
```
И **один и тот же** вызов используется в `resolveLegacyTierlistInfluenceFromMember`. Bug A закрыт регрессионным тестом: fixture-member с T3 → resolver возвращает `mult = config.tiers[3]`.

**Шаг 3 (фаза 4).** В `resolveLegacyTierlistInfluenceFromMember` (`src/integrations/tierlist-live.js`) полностью удаляется чтение `appConfig?.roles?.killTierRoleIds?.[tierKey]`. Только `sot.getKillTierRole(t)`.

### 15.3 Замена picker-pipeline (закрывает P-B2 + onboarding regress из small-agent аудита §3.2)

**Legacy:**
```js
function getCharacterEntries() {
  return buildManagedCharacterEntries({
    managedCharacters: getManagedCharacterCatalog(),
    historicalRoleIds: getHistoricalManagedCharacterRoleIds(),
    generatedRoleIds: getGeneratedRoleState().characters,
  });
}
function getCharacterPickerEntries() {
  return getCharacterEntries().filter((entry) => entry.id && entry.label);
}
```

**Проблема:** picker допускает entry с `roleId` указывающим на несуществующую роль (phantom). Также picker раньше скрывал entries без roleId, из-за чего ломалось всё UI.

**Целевое поведение:**
1. Picker всегда показывает все `bot.config.json.characters[]` (никогда не пустой).
2. Для каждого entry либо `verifiedAt != null` (нормальный путь), либо помечен как `unresolved` (показывается, но при выборе бот отвечает «попроси модератора `/sot-report` recovery»).
3. Никаких entries, ссылающихся на удалённые роли — verify их отрежет.

**Шаг 1 (фаза 3.3).**
```js
function getCharacterPickerEntries() {
  const records = sot.listCharacters({ pickerOnly: false });
  return records.map((r) => ({
    id: r.id,
    label: r.label,
    roleId: r.value,                       // SotRecord<string>
    resolved: r.verifiedAt !== null,
  }));
}
```

**Шаг 2.** В `completeMainSelection` сначала проверяем `entry.resolved`. Если `false`:
```js
return respondToOnboardError(
  interaction,
  `Для ${entry.label} пока не найдена каноническая роль. Попроси модератора нажать "Синк ролей" или открыть /sot-report.`
);
```

Никакого silent failure (`P-B1`). Если `member.roles.add` падает с ошибкой — она пробрасывается наверх и логируется.

### 15.4 Замена `syncManagedCharacterRoles` (убираем silent failure P-B1)

**Legacy:**
```js
async function syncManagedCharacterRoles(member, selectedCharacterIds, reason) {
  ...
  for (const roleId of allManagedRoleIds) {
    if (member.roles.cache.has(roleId) && !selectedRoleIds.has(roleId)) {
      await member.roles.remove(roleId, reason).catch(() => {}); // ❌
    }
  }
  for (const roleId of selectedRoleIds) {
    if (!member.roles.cache.has(roleId)) {
      await member.roles.add(roleId, reason).catch(() => {});    // ❌
    }
  }
}
```

**New (фаза 3.3):**
```js
async function syncManagedCharacterRoles(member, selectedCharacterIds, reason) {
  const failures = [];
  ...
  for (const roleId of toRemove) {
    try { await member.roles.remove(roleId, reason); }
    catch (e) { failures.push({ op: "remove", roleId, error: e?.message || String(e) }); }
  }
  for (const roleId of toAdd) {
    try { await member.roles.add(roleId, reason); }
    catch (e) { failures.push({ op: "add", roleId, error: e?.message || String(e) }); }
  }
  if (failures.length) {
    sot.bus.emit("role-sync-failed", { userId: member.id, failures });
    throw new RoleSyncError(failures);
  }
  return selectedEntries;
}
```

Все ошибки пробрасываются. `completeMainSelection` ловит `RoleSyncError` и сообщает пользователю «не удалось выдать роль X — попроси модератора».

### 15.5 Замена historical role recovery (закрывает P-B4 + small-agent §7.1)

Сейчас `buildHistoricalManagedCharacterRoleIds` использует **позиционное выравнивание** `mainCharacterIds[i]` ↔ `characterRoleIds[i]`. Но `shared-profile.normalizeStringArray` дедуплицирует независимо ⇒ wrong mapping на грязной базе.

**Замена:** historical recovery строится **только** по `mainCharacterIds[]` + live guild role membership через `buildManagedCharacterRoleRecoveryPlan`:

```js
// src/sot/recovery/plan.js (refactor существующего)
buildManagedCharacterRoleRecoveryPlan({
  managedCharacters,           // canonical из bot.config
  profiles,                    // только mainCharacterIds[]
  submissions,                 // только mainCharacterIds[]
  guildRoles,                  // [{ id, name, memberUserIds[] }]
  manualOverrides,             // db.sot.characters[id].source === "manual"
  configuredRoleIds,           // appConfig.characters[].roleId
  aliasMap,                    // временный, удалится после фазы 4 (см. 15.6)
})
```

Никакой опоры на `profile.characterRoleIds` / `submission.mainRoleIds`. Эти поля становятся derived UI-only.

В фазе 4 они полностью удаляются из shared-profile schema и из normalization.

### 15.6 Замена hardcoded `MANAGED_CHARACTER_ROLE_NAME_ALIASES` (P-A4 + small-agent §3.4)

Статус: закрыто в коде.

1. Initial SoT migration seeding идёт через [src/sot/character-aliases.js](src/sot/character-aliases.js): для canonical configured characters пишутся alias-source records с `evidence.aliasNames`.
2. Runtime больше не читает hardcoded alias const в монолите: `getManagedCharacterRoleNameCandidates()` использует `entry.label` + `entry.evidence.aliasNames`.
3. Character core больше не импортирует `db.config.generatedRoles.characters/Labels` и `db.config.characters` в `migrateLegacyState()`; legacy character slots остались только в legacy bridge shadow compare/sync.
4. Следующий путь добавления новых алиасов — только через SoT/manual workflow, а не через новый const в runtime.

### 15.7 Замена `buildCharactersRankingEmbed` cluster bug (P-B8 + small-agent §5.4)

**Корень бага** найден: [welcome-bot.js#L1496](welcome-bot.js#L1496):
```js
const clusterByLegacyId = new Map();
```
Затем в [welcome-bot.js#L1508](welcome-bot.js#L1508) внутри `try`:
```js
clusterByLegacyId = buildLegacyTierlistClusterLookup({ buckets, meta, rawState: live.rawState });
```
Это `Assignment to constant variable.` — exception ловится во `catch` и пишется как `[characters-ranking] failed to resolve tierlist clusters`.

**Pre-rewrite фикс (1 commit, до фазы 0):** заменить `const` на `let`. Это standalone safe fix, никак не связанный с SoT, но закрывает живой production-симптом немедленно.

```diff
- const clusterByLegacyId = new Map();
+ let clusterByLegacyId = new Map();
```

Этот фикс должен попасть в первый PR следующего прогона (в backlog как **#0.0 quick-fix**).

После фазы 3.6, `clusterByLegacyId` собирается через `sot.recovery.suggestionsFor` API и проблема structural уходит сама.

### 15.8 Замена `submitAddCharacterUnified` (custom additions leak — small-agent §4.5)

Текущая проблема: custom character добавление протекает обратно в role architecture / picker.

**Замена:**

1. Custom characters пишутся **только в legacy tierlist domain** — НЕ в `bot.config.json.characters` и НЕ в `db.sot.characters`.
2. Создаётся отдельный slot `db.sot.tierlistCustomCharacters[id]` с `source: "tierlist-custom"`. Этот slot **не виден** в `sot.listCharacters({ pickerOnly: true })`.
3. `getManagedCharacterCatalog()` больше не мержит custom characters в runtime catalog. Закрывает leakage.

### 15.9 Замена double-naming `nonJjs` / `nonGgs` (P-B5)

Сейчас в коде живут одновременно: `nonJjsAccessRoleId`, `nonGgsAccessRoleId`, `NON_JJS_ACCESS_ROLE_ID`, `NON_GGS_ACCESS_ROLE_ID`, `nonJjsUi`, `db.config.presentation.nonGgs`, `appConfig.ui.nonGgsTitle`/`nonJjsTitle`.

**План:**

1. Caнонический ключ — `nonJjs` (это видимое пользователю название, JJS = Jujutsu Shinigans).
2. Миграция читает оба варианта, пишет один — `db.sot.roles.accessNonJjs` / `db.sot.presentation.nonJjs`.
3. ENV: оставляем оба имени читабельными в loader, но writer всегда пишет в `db.sot`.
4. Фаза 4: из кода удаляем все `nonGgs*` идентификаторы. ENV `NON_GGS_ACCESS_ROLE_ID` остаётся аккуратно read-aliased в `loader/bootstrap.js` ещё на 1 месяц (deprecation warning в startup log).

### 15.10 Замена tierlist text panel `messageId / messageIdSummary / messageIdPages` (P-B6)

Сейчас 3 параллельных id с custom fallback в [welcome-bot.js#L788-L797](welcome-bot.js#L788).

**Замена (фаза 3.4):**

```js
// db.sot.panels.tierlistText
{
  channelId: SotRecord<string>,
  messageIds: {
    summary: SotRecord<string>,
    pages: SotRecord<string>,
  },
  lastUpdated: "ISO"
}
```

Старый `messageId` читается миграцией: если есть, и `messageIdSummary` пуст → миграция кладёт его в `summary` и удаляет `messageId`. Никаких трёх параллельных id.

В builder-ах (`buildTextTierlistPayloads`) вместо `getTextTierlistManagedMessageIds` используется только `sot.getPanel("tierlistText").messageIds`. После фазы 4 legacy ключи удаляются.

### 15.11 Замена `cleanupOrphanCharacterRoles` (P-B3)

Текущее поведение: при каждом `ensureManagedRoles` чистит `generatedRoles.characters[id]` для id, отсутствующего в catalog.

**Замена:**

1. Auto-cleanup полностью отключается.
2. Появляется кнопка `panel_sot_cleanup_orphans` в moderator panel — **только moderator action**.
3. UI показывает список orphan-ов с предложением удалить.
4. Никаких автоматических `delete generated.characters[id]` без явного клика.

---

## 16. Закрытие конкретных пунктов small-agent аудитов

### 16.1 Из [CHARACTER_ROLE_TIERLIST_AUDIT.md](CHARACTER_ROLE_TIERLIST_AUDIT.md)

| Пункт audit-а | Закрытие |
|---|---|
| §4.1 Смешение канонических и runtime additions | §15.8 + #28 |
| §4.2 Фрагментированный SoT (6 источников roleId) | §3 + вся фаза 3 |
| §4.3 Резолв роли по имени хрупок | §14.4 + §15.5 (priority chain убирает зависимость от exact name match) |
| §4.4 Повреждение JJS-блока в text tierlist | §14.5 verify + §15.7 cluster fix |
| §4.5 Custom additions протекают в picker | §15.8 |
| §5.1 welcome-bot.js монолит | весь backlog (постепенный extraction) |
| §5.2 workspace ≠ running bot | §0.1 snapshot + §5.3 deployment confirmation |
| §5.3 нет prod state | §0.1 snapshot + §17.4 anonymized fixture |
| §5.4 устаревшая документация | этот документ — единый актуальный канон |
| §6.4 промежуточный регресс с пропавшим JJS-блоком | §15.3 picker всегда показывает + §15.7 cluster fix |
| §7.1 historical fallback на слабом инварианте | §15.5 |
| §7.2 много косвенных слоёв | §14.4 priority chain |
| §7.3 picker не валидирует существование роли | §14.5 + §15.3 |
| §7.4 ошибки role assignment проглатываются | §15.4 |
| §7.5 welcome-bot.js слишком много знает | extraction в `src/sot/*` |
| §8.1 нет настоящего prod state | §0.1 + §17.4 |
| §8.2 нет explicit canonical mapping | весь §3.2 (`db.sot.characters`) |
| §8.3 нет diagnostic для модератора | §5.1 `/sot-report` |
| §8.4 нет deployment прозрачности | §5.3 rollout playbook |

### 16.2 Из [CHARACTER_ROLE_ONBOARDING_RECOVERY_AUDIT.md](CHARACTER_ROLE_ONBOARDING_RECOVERY_AUDIT.md)

| Пункт audit-а | Закрытие |
|---|---|
| §1.1 picker исчезал из-за пустого roleId | §15.3 picker всегда показывает все managed |
| §1.2 alias-таблица как mapping | §15.6 миграция alias → manual override |
| §3.1 overlap-based recovery helper | §15.5 (refactor в `src/sot/recovery/plan.js`) |
| §3.2 picker перестал исчезать | подтверждается в §15.3, добавляется test |
| §3.3 persisted live server labels (`characterLabels`) | §3.2 — `SotCharacterRecord.label` (live) + `englishLabel` (backup) |
| §3.4 alias-layer для канонических ролей | §15.6 |
| §3.5 фильтр non-character role names | переезжает в `src/sot/resolver/characters.js` как `isCharacterRoleCandidate(role)` |
| §3.6 startup и moderator sync запускают recovery | `panel_sync_roles` → `sot.recovery.plan` |
| §3.7 тесты в character-role-catalog | переносятся в `tests/sot/recovery.test.js` |
| §4.2 18 из 19 восстановлено | aspiring_mangaka — закрывается через `/sot-report` UI: модератор выбирает роль вручную → `source: "manual"` |
| §4.3 unresolved counter не совпадает | §17.1 (root cause + fix) |
| §5.1 1 unresolved | через diagnostic UI (#32) |
| §5.2 recovery still partly heuristic | §14.4 priority chain делает порядок явным |
| §5.3 unresolved counter mismatch | §17.1 |
| §5.4 cluster Assignment to constant | §15.7 (#0.0 quick-fix) |
| §6.1–6.4 что делать дальше | весь backlog #1..#35 + §17 |

---

## 17. Известные production-дефекты — root cause и concrete fix-step

### 17.1 Расхождение unresolved counter vs persisted state

**Симптом:** startup log пишет `unresolved: 2`, но в `db.config.generatedRoles.characters` отсутствует только 1 character.

**Гипотеза root cause** (требует подтверждения тестом в фазе 1.5):

В [welcome-bot.js#L2362](welcome-bot.js#L2362) `reconcileCharacterRolesFromGuild`:

1. `recoveryPlan.unresolved` собирается из `analyses.filter((a) => !a.best)` ⇒ это characters, у которых **нет ни одного guild candidate с overlap или exact-name**.
2. Затем второй цикл (`for entry of getManagedCharacterCatalog()`) вызывает `ensureRoleByName(...)` с цепочкой `[entry.roleId, recovered, historical, generated]`. Этот цикл может **успешно резолвить** через alias-name (`ensureRoleByName` пробует все `roleNames`), даже если в `recoveryPlan` character был помечен unresolved.
3. В итоге `generatedRoles.characters[id]` записывается, но `recoveryPlan.unresolved` уже зафиксирован до этого второго цикла.

**Fix (фаза 1.5, #8 в backlog):**

* Объединить два цикла в один pipeline:
  1. собираем layers (manual, configured, recovered, alias, name)
  2. применяем priority chain
  3. финальный `unresolved` = те, у кого верифицированный roleId не найден ни в одном layer
* `unresolved` в return-value `ensureManagedRoles` должен сходиться с реальным missing set по построению.

**Тест:** fixture с 19 characters, 18 верифицируются, 1 unresolved → unresolvedCount === 1, missing set size === 1.

### 17.2 Cluster `Assignment to constant variable`

См. §15.7. Фикс — `let` вместо `const` на [welcome-bot.js#L1496](welcome-bot.js#L1496). Quick-fix #0.0.

### 17.3 Bug A coefficients 0/N

См. §15.2. Закрывается переходом `resolveLegacyTierlistInfluenceFromMember` на `sot.getKillTierRole(t)`.

### 17.4 Anonymized prod fixture

В фазе 0 необходимо:

1. Запросить у пользователя свежий `welcome-db.json` (или скрипт-снапшот из Railway volume).
2. Anonymize: `userId` → `user_<sha1prefix>`, `displayName` → `Member <i>`, `username` → `member<i>`.
3. Положить в `tests/fixtures/welcome-db.fixture.json`.
4. Использовать как basis для migration tests + recovery tests.

Без этого фикстура recovery остаётся гипотетической.

---

## 18. Расширенная schema `db.sot` (на пример живой записи)

```jsonc
{
  "sotVersion": 1,
  "lastVerifiedAt": "2026-05-03T12:00:00.000Z",

  "channels": {
    "review": {
      "value": "1234567890",
      "source": "manual",
      "verifiedAt": "2026-05-03T11:55:00.000Z"
    },
    "tierlistText": { "value": "...", "source": "configured", "verifiedAt": "..." }
  },

  "roles": {
    "moderator":     { "value": "...", "source": "configured", "verifiedAt": "..." },
    "accessNormal":  { "value": "...", "source": "configured", "verifiedAt": "..." },
    "accessWartime": { "value": "1496376994966011954", "source": "configured", "verifiedAt": "..." },
    "accessNonJjs":  { "value": "...", "source": "configured", "verifiedAt": "..." },
    "killTier": {
      "1": { "value": "...", "source": "discovered", "verifiedAt": "..." },
      "2": { "value": "...", "source": "discovered", "verifiedAt": "..." },
      "3": { "value": "...", "source": "discovered", "verifiedAt": "..." },
      "4": { "value": "...", "source": "discovered", "verifiedAt": "..." },
      "5": { "value": "...", "source": "discovered", "verifiedAt": "..." }
    },
    "legacyEloTier": { "1": {...}, "2": {...}, "3": {...}, "4": {...} }
  },

  "characters": {
    "honored_one": {
      "id": "honored_one",
      "value": "RoleId123",
      "label": "Годжо",
      "englishLabel": "Honored One",
      "source": "manual",
      "verifiedAt": "2026-05-03T11:55:00.000Z",
      "evidence": {
        "exactName": false,
        "overlap": 17,
        "coverage": 0.94,
        "roleShare": 0.85,
        "holderCount": 20,
        "preferredMatch": true
      },
      "history": [
        { "at": "2026-05-01T...", "from": "alias", "to": "recovered", "oldValue": "RoleId123" },
        { "at": "2026-05-03T...", "from": "recovered", "to": "manual", "oldValue": "RoleId123" }
      ]
    },
    "aspiring_mangaka": {
      "id": "aspiring_mangaka",
      "value": "",
      "label": "Aspiring Mangaka",
      "englishLabel": "Aspiring Mangaka",
      "source": "default",
      "verifiedAt": null,
      "evidence": {
        "candidates": [
          { "roleId": "X", "roleName": "Чарльз", "overlap": 0 }
        ]
      }
    }
  },

  "panels": {
    "tierlistText": {
      "channelId": { "value": "...", "source": "manual", "verifiedAt": "..." },
      "messageIds": {
        "summary": { "value": "...", "source": "manual", "verifiedAt": "..." },
        "pages":   { "value": "...", "source": "manual", "verifiedAt": "..." }
      },
      "lastUpdated": "2026-05-03T..."
    }
  },

  "presentation": { /* мигрировано из db.config.presentation */ },
  "modes": { "onboard": { "value": "peace", "source": "manual" } },
  "integrations": { /* мигрировано */ },
  "influence": {
    "default": { "value": 1, "source": "configured" },
    "tiers": {
      "1": { "value": 0.5, "source": "manual" },
      "2": { "value": 1, "source": "manual" },
      "3": { "value": 5, "source": "manual" },
      "4": { "value": 25, "source": "manual" },
      "5": { "value": 100, "source": "manual" }
    }
  }
}
```

### 18.1 Migration v0 → v1 (idempotent)

Псевдо-код миграции:

```js
function migrateDbV0toV1(db, { appConfig, fileConfig }) {
  if (db.sotVersion >= 1) return db;
  db.sot ||= emptySotStructure();

  // channels
  for (const [slot, key] of CHANNEL_SLOT_TO_DB_KEY) {
    const value = String(db.config[key] || appConfig.channels[slot] || "").trim();
    const source = db.config[key] ? "manual" : (value ? "configured" : "default");
    if (value) db.sot.channels[slot] = { value, source, verifiedAt: null };
  }

  // roles
  for (const [slot, envRoute] of ROLE_SLOT_TO_APPCONFIG) {
    const value = String(envRoute(appConfig) || "").trim();
    if (value) db.sot.roles[slot] = { value, source: "configured", verifiedAt: null };
  }
  for (const tier of [1,2,3,4,5]) {
    const fromConfig = String(appConfig.roles.killTierRoleIds?.[tier] || "").trim();
    const fromGenerated = String(db.config.generatedRoles?.tiers?.[tier] || "").trim();
    const value = fromConfig || fromGenerated;
    if (!value) continue;
    db.sot.roles.killTier[tier] = {
      value,
      source: fromConfig ? "configured" : "discovered",
      verifiedAt: null,
    };
  }

  // characters — самое важное
  const generated = db.config.generatedRoles?.characters || {};
  const generatedLabels = db.config.generatedRoles?.characterLabels || {};
  for (const entry of appConfig.characters) {
    const id = entry.id;
    const configuredRoleId = String(entry.roleId || "").trim();
    const generatedRoleId = String(generated[id] || "").trim();
    const value = configuredRoleId || generatedRoleId;
    db.sot.characters[id] = {
      id,
      value,
      label: String(generatedLabels[id] || entry.label || "").trim() || entry.label,
      englishLabel: entry.label,
      source: configuredRoleId ? "configured" : (generatedRoleId ? "discovered" : "default"),
      verifiedAt: null,
      evidence: {},
      history: [],
    };
  }

  // panels, presentation, integrations, influence — аналогично
  ...

  db.sotVersion = 1;
  db.__needsSaveAfterLoad = true;
  return db;
}
```

**Важно:** миграция **никогда не удаляет** старые поля `db.config.generatedRoles.*`. Она их только читает. Удаление — отдельный шаг в фазе 4 после пол-month prod.

---

## 19. Уточнённый план следующего прогона (revision 2)

Обновляет §11–§12 с учётом новых деталей.

### 19.1 Quick-fix батч (до начала рефакторинга, 1 PR)

* **#0.0** [welcome-bot.js#L1496](welcome-bot.js#L1496): `const clusterByLegacyId` → `let`. Заодно добавить тест на `buildLegacyTierlistClusterLookup` non-empty path. Закрывает живой production warning.

### 19.2 Старт безопасного рефакторинга

* **#1** `scripts/snapshot-db.js` + раздел в `SETUP.md`. Перед каждым deploy.
* **#2** `panel_sot_report` (на старом коде, ground-truth). Минимум 5 секций: channels, roles, characters, panels, integrations.
* **#3** `src/db/store.js` — extract `loadDb / saveDb` как pure I/O. Test seam.

### 19.3 Фаза 1 — построение SoT

* **#4** `src/sot/schema.js` — типы `SotRecord`, `SotCharacterRecord`, `SotPanelRecord`, дефолтная пустая структура.
* **#5** `src/sot/migrate.js` — v0→v1, idempotent, тест на live anonymized fixture.
* **#6** `src/sot/loader.js` — atomic write (temp + rename), pre-write snapshot в `backups/<ISO>/`.
* **#7** `src/sot/bus.js` — простой EventEmitter.
* **#8** `src/sot/resolver/priority.js` + `channels.js` + tests.
* **#9** `src/sot/resolver/roles.js` + tests (включая kill tier 1..5).
* **#10** `src/sot/resolver/characters.js` + миграция `buildManagedCharacterRoleRecoveryPlan` в `src/sot/recovery/plan.js`. Закрывает unresolved counter mismatch (§17.1).
* **#11** `src/sot/resolver/panels.js` (tierlistText унификация messageIds).
* **#12** `src/sot/resolver/presentation.js`.
* **#13** `src/sot/resolver/integrations.js` + `influence.js`.
* **#14** `src/sot/diagnostics.js` (выходной формат для `/sot-report`).
* **#15** `src/sot/index.js` — фасад.

### 19.4 Фаза 2 (заготовка только, не сливать сразу с фазой 1)

* **#16** `src/sot/legacy-bridge/write.js` + первый dual-write слот (channels.review).
* **#17** `src/sot/legacy-bridge/compare.js` + CI-проверка.

### 19.5 Открытые вопросы для пользователя (требуют ответа перед фазой 4)

1. Можно ли запросить свежий **anonymized snapshot** `welcome-db.json`? Без него миграция и recovery тесты остаются на синтетике.
2. Можно ли удалить ENV `NON_GGS_ACCESS_ROLE_ID` после фазы 4 (с deprecation log в 1 release-window)?
3. Ок ли минимальный smoke-window 1 неделя prod без алёртов перед каждым шагом cutover (фаза 4)?
4. Нужны ли модератору slash-команды (`/sot-link-channel`, `/sot-link-character`) в дополнение к панели, или только UI?
5. Сколько времени держать `db.config.generatedRoles.*` в read-only legacy slot после cutover (рекомендация: 1 месяц)?

### 19.6 Что должно быть готово после следующего прогона (acceptance)

* `node --test` зелёный, +20–30 новых тестов
* `node --check welcome-bot.js` clean
* В репо есть полностью рабочий `src/sot/*` слой и `scripts/snapshot-db.js`
* В welcome-bot.js **никаких изменений в hot path** — фаза 3 ещё не началась
* Этот документ обновлён до revision 3 с записями «реализовано: #N» по каждой выполненной задаче

---

## 20. Финальная карта зависимостей задач

```
#0.0 ──────────────────────────────────────── (independent quick fix)

#1 ── snapshot script
#2 ── /sot-report ground-truth
#3 ── extract loadDb/saveDb
        │
#4 ── schema ──┐
#5 ── migrate ─┤
#6 ── loader ──┤
#7 ── bus ─────┘
        │
#8 ── priority + channels ──┐
#9 ── roles ────────────────┤
#10 ── characters + recovery┤
#11 ── panels ──────────────┤
#12 ── presentation ────────┤
#13 ── integrations + infl ─┤
#14 ── diagnostics ─────────┤
#15 ── facade ──────────────┘
        │
        ▼ (фаза 2 — следующий прогон)
#16 ── dual-write channels
#17 ── compare harness
        │
        ▼
... остальное по §4
```

---

## 21. Принципы безопасности (повторяю для критичности)

1. **Каждый PR shippable независимо.** Никаких зависимых friend-PR-ов.
2. **Snapshot перед каждым deploy.** Без исключений.
3. **Никакого destructive action без явного moderator click** даже в diagnostic surface.
4. **Никакого silent `.catch(() => {})`** в новом коде. Только логирование + reraise.
5. **Manual override (`source: "manual"`) — sacred.** Никакой recovery его не перетирает.
6. **Verify перед read.** Если verifiedAt slishком старый — записать `null`, но не удалять value.
7. **Hardcoded knowledge — на испытательном сроке.** Любая const-таблица → миграция в SoT → удаление.
8. **Тест-fixture > синтетика.** Anonymized prod snapshot обязателен для recovery тестов.

---

## 22. Финальный summary revision 2

* Добавлены конкретные **типы записей** (`SotRecord<T>`, `SotCharacterRecord`), сигнатуры фасада (§14.3) и priority chain (§14.4).
* Расписаны 11 точечных **safe-replacement рецептов** (§15) с before/after для самых болючих мест: channel-getters, tier-role helper, picker, role-sync, historical recovery, alias-table, cluster bug, custom additions, nonJjs/nonGgs, tierlist messageIds, orphan cleanup.
* Каждый пункт обоих small-agent аудитов **явно картирован** в backlog (§16).
* Найден **root cause** живого production warning `Assignment to constant variable.` ([welcome-bot.js#L1496](welcome-bot.js#L1496)) и предложен немедленный quick-fix #0.0.
* Найдена **гипотеза root cause** для unresolved counter mismatch и заложен fix в #10.
* Нарисована полная **migration v0→v1** schema с примером живой записи character.
* Уточнён **acceptance** для следующего прогона: фаза 0 + полностью готовый `src/sot/*` без изменений hot path.

