# Welcome / Helper / Profile Intake Surgical Plan v2

## Цель

Собрать рабочий и безопасный план миграции, в котором:

- welcome panel работает автономно как surface для онбординга;
- bot helper panel работает автономно как surface для kills / ELO / Roblox / main actions;
- кнопки в профиле для kills и ELO работают по тому же контракту, что и панели, без отдельной скрытой логики;
- доменная логика submit-потоков остаётся общей, но runtime-routing и panel lifecycle перестают быть спутанными;
- изменения делаются поэтапно, без широкого рефактора hot path в один заход.

Это не план "сразу всё переделать". Это план точной миграции с совместимостью, промежуточными stop-line и минимальным риском перерезать старые рабочие ветки.

## Что исправлено в v2

Этот документ уже перепроверен против текущего кода и уточнён в четырёх местах, которые были слишком расплывчаты в первой версии:

- зафиксирован явный source carrier для profile surface при сохранении общих custom ids;
- этап 1 расширен до реальных runtime seams, а не только до локальной пары refreshWelcomePanel / refreshBotHelperPanel;
- карта зависимостей теперь учитывает resolved panel records и native panel override слой, а не только raw db.config;
- профильный surface уточнён: в v2 речь идёт про full self-profile action rows, а не про любой экран профиля подряд.

## Короткий честный вывод по текущему состоянию

Сейчас система уже частично разделена, но не автономна.

- welcome panel и bot helper panel рендерятся как разные поверхности;
- profile view уже показывает self-action кнопки для kills и ELO;
- реальный submit-routing всё ещё живёт в одном общем owner-пути внутри welcome-bot.js;
- kills принимает смесь из helper-intake session и старого welcome submit fallback;
- ELO всё ещё имеет отдельный legacy submit hub как самостоятельную поверхность;
- render-path местами сам мутирует submit state;
- welcome refresh побочно тянет helper refresh.

Именно поэтому задача опасна для большого одномоментного рефактора: визуально surface уже разделены, но decision-making и state lifecycle ещё нет.

## Канонический продуктовый контракт после миграции

После завершения всех 4 этапов система должна работать так:

1. Welcome panel

- ведёт нового пользователя по обычному onboarding-пути;
- сама не зависит от bot helper panel для своей отрисовки и своего startup lifecycle;
- может arm'ить kills intake в своём surface, если продуктово welcome остаётся допустимой точкой submit на период совместимости;
- не перехватывает чужие сообщения вне активной intake-session.

2. Bot helper panel

- живёт как независимая helper-панель с собственным refresh/auto-resend lifecycle;
- в idle-режиме не трогает сообщения;
- после нажатия на kills или ELO arm'ит короткую intake-session примерно на 5 минут;
- принимает только целевое сообщение в рамках armed-session.

3. Profile self-action buttons

- кнопки kills и ELO в профиле не создают отдельный submit-owner;
- они запускают тот же общий intake flow, что и welcome/helper, но с source=profile;
- в v2 под этим понимается full self-profile action row; compact-card остаётся отдельным read-only surface, пока не будет отдельного продуктового решения;
- поведение после нажатия должно быть таким же: arm сессии, ожидание одного сообщения, отсутствие лишней зачистки чата.

4. Общая доменная логика

- проверка kills;
- проверка ELO;
- Roblox gating;
- pending rules;
- review creation;
- approval/reject lifecycle.

Всё это должно остаться общим и не дублироваться по surface.

## Текущая карта owner-путей и зависимостей

### 1. Surface/UI owners

- welcome panel payload: welcome-bot.js
- helper panel payload: src/onboard/bot-helper-panel.js
- profile self actions: src/profile/view.js

Важное уточнение по profile surface:

- action rows с kills / ELO сейчас рендерятся только в полном self-profile view;
- compact-card открывается отдельной кнопкой elo_submit_card и в текущем коде не является submit surface;
- значит v2 фиксирует в продукте именно full self-profile как канонический профильный surface для kills / ELO, если отдельное расширение на compact-card не будет согласовано позже.

В profile view уже есть общие action-button ids:

- onboard_begin
- onboard_change_mains
- elo_submit_open
- profile_bind_roblox

Это хороший знак: profile уже использует общий action язык и не требует отдельного profile-submit runtime.

### 2. Routing owners

Сейчас ключевой routing сосредоточен в welcome-bot.js:

- interaction handler для onboard_begin;
- interaction handler для onboard_change_mains;
- interaction handler для elo_submit_open;
- messageCreate handler для фактического приёма kills/ELO;
- startup / refresh logic для welcome/helper panels.

Это hot path. Любая широкая правка здесь опасна.

### 3. Session/state owners

- src/onboard/helper-intake.js хранит короткую helper session с TTL;
- submitSession в welcome-bot.js хранит onboarding context;
- pending submission state хранится в db.submissions;
- profile operator owns только profile-specific actions, не kills/ELO submit logic.

### 4. Profile routing fact

Profile operator не владеет kills/ELO routing.

- src/profile/view.js только рендерит onboard_begin и elo_submit_open кнопки;
- src/profile/operator.js обрабатывает профильные кнопки типа profile_bind_roblox и profile navigation;
- unknown custom ids идут дальше в общие handlers welcome-bot.js.

Это значит, что profile-кнопки уже завязаны на общий submit flow и должны остаться частью общей миграции, а не отдельного side-project.

### 5. Runtime coupling, который надо разрезать

- refreshWelcomePanel сейчас побочно вызывает refreshBotHelperPanel;
- helper panel не имеет своего самостоятельного ensure-path на startup;
- getKillsSubmitTargetChannelId использует helper -> welcome fallback;
- messageCreate одновременно знает про helper session и про welcome submit fallback;
- ELO submit flow всё ещё знает отдельный legacy ELO submit hub.

### 6. Panel ownership owner

- канонический owner panel channel/message state читается не только из raw db.config, а через resolved panel records;
- runtime уже использует getResolvedPanelRecord и getResolved*Snapshot как фактическую точку чтения panel ownership;
- изменения channel ownership и cleanup managed messages проходят через syncLegacyPanelSnapshot и writeAndApplyNativePanelOverride, а не только через прямое редактирование db.config;
- ELO submit panel сейчас вообще dual-source: resolved eloSubmit snapshot плюс legacy rawDb submit panel state.

## Зависимости, которые обязательно учитывать в плане

### A. Файлы верхнего уровня риска

- welcome-bot.js
- src/runtime/client-ready-core.js
- src/onboard/refresh-runner.js
- src/profile/view.js
- src/profile/operator.js
- src/onboard/helper-intake.js
- src/onboard/bot-helper-panel.js
- src/onboard/presentation.js

### B. State / resolved-panel / config зависимости

- db.config.welcomePanel
- db.config.botHelperPanel
- db.config.nonGgsPanel
- db.config.integrations.elo.submitPanel
- db.config.integrations.elo.graphicBoard
- getResolvedPanelRecord / getResolvedWelcomePanelSnapshot / getResolvedBotHelperPanelSnapshot / getResolvedEloSubmitPanelSnapshot
- syncLegacyPanelSnapshot как compat bridge между resolved snapshot и legacy mutable state
- writeAndApplyNativePanelOverride как канонический mutation seam для managed panel ownership
- dual-source seam для ELO submit panel: resolved snapshot + getLegacyEloSubmitPanelState
- submitSession
- helper intake short-lived session
- pending submission state

### C. Поведенческие зависимости

- resolveOnboardBeginRoute
- completeMainSelection
- buildSubmitStepPayload
- messageCreate submit acceptance
- profile self-action buttons
- Roblox identity lock / resume rules
- pending submission denial rules

### D. Тестовые зависимости

Уже существующие важные тесты:

- tests/onboard-helper-intake.test.js
- tests/onboard-helper-intake-smoke.test.js
- tests/bot-helper-panel.test.js
- tests/profile-operator.test.js
- tests/welcome-bot-startup-smoke.test.js
- tests/client-ready-core.test.js

Новые обязательные smoke tests понадобятся позже, но их нельзя писать до появления нового owner seam.

## Контракт source carrier

Это обязательное уточнение для v2.

Поскольку profile surface уже использует общие custom ids onboard_begin и elo_submit_open, source=profile нельзя определять эвристически по подписи кнопки, displayMode, порядку components или текущему channelId.

### Предпочтительный carrier для v2

- short-lived profile surface context, привязанный к message id приватного profile payload;
- shared handlers читают этот context по interaction.message.id и только так решают, что launch source равен profile;
- сам action id остаётся общим: onboard_begin или elo_submit_open.

### Допустимый fallback carrier только если message-bound context технически недоступен

- thin wrapper ids, которые нормализуются обратно в общие onboard_begin / elo_submit_open внутри одного routing seam;
- это допустимо только как технический fallback, а не как новый параллельный profile runtime.

### Что запрещено

- выводить source=profile из текста кнопки;
- выводить source=profile из displayMode или layout профиля;
- выводить source=profile из того, что interaction пришёл "примерно от profile UI";
- смешивать source detection с выбором target channel или submit eligibility.

## Политика переименований

Это критично: массовые rename на ранних этапах запрещены.

### Что нельзя переименовывать на этапах 1-2

- файл welcome-bot.js;
- custom ids onboard_begin, onboard_change_mains, elo_submit_open;
- файл src/profile/view.js и его публичные helper ids;
- db config keys welcomePanel, botHelperPanel, integrations.elo.submitPanel;
- существующие submitSession / pending state ключи.

Причина: это слишком много wiring-точек, snapshot-тестов и живых compat-shвов.

### Допустимые rename-кандидаты только после стабилизации поведения

- HELPER_INTAKE_ACTIONS -> SUBMIT_INTAKE_ACTIONS
- HELPER_INTAKE_SESSION_EXPIRE_MS -> SUBMIT_INTAKE_SESSION_TTL_MS
- createHelperIntakeSessionStore -> createSubmitIntakeSessionStore
- armKillsHelperIntakeSession -> armKillsIntakeSession
- armLegacyEloHelperIntakeSession -> armEloIntakeSession
- getHelperIntakeSession -> getSubmitIntakeSession
- clearHelperIntakeSession -> clearSubmitIntakeSession
- clearAllHelperSubmitSessions -> clearSubmitIntakeSessions

### Правило rename

На этапах 1-3 разрешены только алиасы или двуязычные compat-экспорты, но не жёсткая замена всех символов сразу.

Сначала стабилизируется поведение.
Потом добавляются новые canonical имена.
Только в самом конце удаляются старые helper-only имена.

## Главный архитектурный принцип

Нужен один канонический intake owner и несколько launch surfaces.

Нельзя делать:

- отдельный intake flow для welcome;
- отдельный intake flow для helper;
- отдельный intake flow для profile buttons;
- отдельный четвёртый intake flow для legacy ELO submit hub.

Нужно делать:

- один intake session owner;
- один message acceptance owner;
- несколько surface launch points;
- явный source у запуска: welcome | helper | profile.

## Этап 1. Развязать lifecycle welcome panel и helper panel

### Цель этапа

Отделить lifecycle панелей друг от друга без изменения submit behavior.

### Почему это первый этап

Пока welcome refresh тянет helper refresh, никакой автономности нет даже на runtime-уровне. Это самая дешёвая и безопасная развязка, потому что она не трогает submit acceptance и review logic.

### Точный порядок работ

1. Вынести отдельный ensureBotHelperPanel path рядом с существующим refreshBotHelperPanel.
2. Убрать побочный вызов helper refresh из welcome refresh.
3. Переподключить startup wiring так, чтобы helper startup вызывался независимо от welcome. Правильный способ: вызвать ensureBotHelperPanel отдельно в welcome-bot.js после runClientReadyCore, а не добавлять refreshBotHelperPanel как параметр в runClientReadyCore. Контракт runClientReadyCore и его тесты менять нельзя: функция уже имеет assertFunction на refreshWelcomePanel и не знает про helper lifecycle.
4. Аудировать refresh seams в applyUiMutation / commitMutation и src/onboard/refresh-runner.js; не добавлять helper scope, если в том же diff нет реального caller.
5. Сохранить нынешнюю helper auto-resend логику без semantic change.
6. Не трогать messageCreate, submitSession, pending logic и ELO submit routing.

### Файлы этапа

- welcome-bot.js
- src/runtime/client-ready-core.js только для чтения/аудита, но не для изменения контракта runClientReadyCore
- src/onboard/refresh-runner.js, если меняется refresh scope или wiring mutation refresh
- tests/client-ready-core.test.js для узкой проверки, что существующие startup smoke не сломались
- при необходимости tests/welcome-bot-startup-smoke.test.js
- при необходимости tests/bot-helper-panel.test.js

### Что запрещено на этом этапе

- менять getKillsSubmitTargetChannelId;
- менять behavior onboard_begin;
- менять helper-intake store;
- трогать profile actions;
- трогать legacy ELO submit hub.

### Риски этапа

- helper panel может перестать появляться на startup, если новый ensure-path не будет действительно вызван;
- welcome startup smoke может остаться зелёным, но helper runtime silently деградирует, если не добавить отдельную проверку helper startup wiring;
- mutation refresh paths могут остаться полусклеенными, если проверить только refreshWelcomePanel и забыть про client-ready / refresh-runner seams.

### Обязательная проверка после этапа

- узкий срез tests/client-ready-core.test.js;
- узкий startup smoke для welcome;
- узкий helper startup / refresh smoke;
- затем полный npm test.

### Критерий завершения этапа

- welcome panel поднимается сама;
- helper panel поднимается сама;
- падение helper refresh не ломает welcome refresh;
- падение welcome refresh не запрещает helper refresh;
- submit behavior не изменился.

## Этап 2. Ввести канонический intake owner без cutover

### Цель этапа

Создать новый общий intake seam, но пока не переключать на него все старые ветки.

### Почему это второй этап

Удалять старые fallback-path заранее нельзя. Сначала нужен новый owner, который можно подключать по одной ветке.

### Целевой owner на этом этапе

Новый канонический owner должен описывать:

- action: kills | elo
- source: welcome | helper | profile
- channelId
- rawText
- createdAt

TTL управляется самим store через константу HELPER_INTAKE_SESSION_EXPIRE_MS, а не полем в session-объекте. Это уже так в текущем коде и меняться не должно.

### Точный порядок работ

1. Оставить существующий файл src/onboard/helper-intake.js как стабильную точку входа.
2. Добавить новые generic alias exports внутри того же модуля или через новый thin-wrapper модуль.
3. Расширить session payload полем source.
4. Оставить helper-only имена как compat alias.
5. Не убирать старый welcome fallback и не трогать legacy ELO hub.
6. Добавить unit tests на source-aware intake session store.

### Почему нельзя сразу переименовать файл

Файловый rename на этом шаге даст слишком много шума в diff и не добавит поведенческой ценности. Для LLM это лишний риск.

### Файлы этапа

- src/onboard/helper-intake.js
- возможно новый thin wrapper в src/onboard, если нужен generic entrypoint
- tests/onboard-helper-intake.test.js

### Что запрещено на этом этапе

- трогать profile custom ids;
- переносить submit acceptance из messageCreate;
- вырезать hasActiveWelcomeSubmitSession;
- вырезать legacy ELO submit hub;
- менять пользовательский текст в широком объёме.

### Риски этапа

- случайный semantic drift из-за rename вместо alias strategy;
- потеря обратной совместимости, если старые helper-only вызовы не будут прозрачно поддержаны.

### Обязательная проверка после этапа

- unit tests на session store;
- существующий helper idle smoke;
- затем npm test.

### Критерий завершения этапа

- новый канонический intake session contract существует;
- старые вызовы продолжают работать;
- поведение пользователя не изменилось;
- profile / welcome / helper ещё не переключены массово.

## Этап 3. Перевести welcome, helper и profile buttons на единый intake contract

### Цель этапа

Подключить все launch surfaces к одному owner без разрастания веток.

### Это центральный этап

Именно здесь система становится действительно понятной: profile не отдельный submit runtime, helper не отдельный hidden runtime, welcome не fallback-магия, а три точки входа в один intake flow.

### Главный принцип этапа

Не плодить новые custom ids для profile kills/ELO.

Profile уже использует:

- onboard_begin
- elo_submit_open

Это надо сохранить. Вместо новых ids добавляется явный source carrier в routing.

### Точный порядок работ

1. Зафиксировать source carrier. Предпочтительный v2 вариант: short-lived profile surface context по message id приватного profile payload. Fallback только один: thin wrapper ids, которые нормализуются в одном shared routing seam.
2. Перестать мутировать intake state из render-path buildSubmitStepPayload.
3. Перенести arm logic в interaction owner-пути:
   - onboard_begin
   - completeMainSelection
   - elo_submit_open
   - cancel paths
4. Не реанимировать elo_submit_modal как часть нового контракта. По аудиту это legacy dead-path без живого showModal caller; если продукт когда-либо снова захочет modal ELO submit, это должно вернуться как отдельное осознанное решение, а не как скрытый хвост общего intake flow.
5. Для launch source проставлять source=welcome | helper | profile через явный carrier, а не через эвристики.
6. Profile buttons оставить на тех же custom ids, но при их активации не создавать новый параллельный flow.
7. В messageCreate сначала читать только новый канонический intake session.
8. Старый welcome fallback пока оставить как compat branch за feature-equivalent guard.
9. Добавить новые smoke tests:
   - helper armed kills accepts one message;
   - helper armed elo accepts one message;
   - profile kills button arms тот же flow, что и panel;
   - profile elo button arms тот же flow, что и panel.

### Как именно должны вести себя profile buttons после этапа

#### Profile kills button

- scope v2: только full self-profile action row;
- не создаёт отдельную profile submit-session модель;
- запускает тот же begin/intake flow;
- если есть resumable onboarding session, уважает её;
- если нужен picker, открывает существующий picker;
- после arm пользователь отправляет сообщение в целевой intake channel по тем же правилам, что и из панели.

#### Profile elo button

- scope v2: только full self-profile action row; elo_submit_card продолжает открывать compact-card и не становится submit action;
- не создаёт отдельный profile elo runtime;
- использует тот же elo_submit_open flow;
- arm'ит тот же intake session с source=profile;
- ожидает одно сообщение с текстом и скрином;
- не чистит лишние сообщения вне active session.

### Файлы этапа

- welcome-bot.js
- src/profile/view.js
- src/profile/operator.js
- tests/profile-operator.test.js
- tests/onboard-helper-intake-smoke.test.js
- новые smoke tests для profile and armed submit flows
- отдельный shared-handler routing smoke для profile source carrier

### Что запрещено на этом этапе

- удалять legacy ELO submit hub;
- массово менять copy/presentation;
- делать большой rename symbols across repo;
- переносить весь messageCreate из welcome-bot.js в новую систему целиком.

### Риски этапа

- потеря resume-path через submitSession;
- двойной arm из нескольких call sites;
- случайное изменение target channel, если source и channel resolution будут смешаны;
- profile кнопки могут начать вести себя иначе, чем welcome/helper, если сделать profile-specific shortcut вместо общего flow.

### Обязательная проверка после этапа

- узкие tests/profile-operator.test.js;
- shared-handler profile routing smoke;
- armed helper kills smoke;
- armed helper ELO smoke;
- profile kills/ELO smoke;
- welcome-bot startup smoke;
- затем полный npm test.

### Критерий завершения этапа

- все три surface используют один intake contract;
- render-path больше не arm'ит session silently;
- profile buttons ведут в тот же flow, а не в отдельный runtime;
- idle chat по-прежнему не трогается;
- старый welcome fallback ещё существует только как compat, но уже не является главным owner.

## Этап 4. Вырезать старые хвосты и закрепить канонические имена

### Цель этапа

Только после стабилизации поведения убрать остаточные owner-пути, устаревшие названия и legacy submit surfaces.

### Почему это только четвёртый этап

Именно этот этап чаще всего "перехерачивает код", если сделать его раньше. До него система уже должна быть зелёной и пройти smoke на новом owner.

### Точный порядок работ

1. Удалить старый welcome submit fallback из messageCreate только после того, как welcome flow уже читает новый intake owner.
2. Перевести legacy ELO submit hub из самостоятельного submit-owner в compat-only/admin-tail или полностью убрать его, если больше нет runtime-потребителя. В этот же cleanup входит удаление dead-path handler-а elo_submit_modal, если grep по репозиторию подтверждает отсутствие живого caller-а.
3. Любую чистку panel channel/message ownership делать через resolved panel record и native override seams, а не прямым обнулением raw db config.
4. Почистить misleading copy в presentation и admin texts.
5. Добавить canonical symbol aliases и только потом заменить старые helper-only имена на generic intake names.
6. Удалить compat aliases только если diff по использованию пустой и тесты закрывают новый контракт.

### Файлы этапа

- welcome-bot.js
- src/onboard/helper-intake.js или его generic wrapper
- src/onboard/presentation.js
- ELO admin/setup paths в welcome-bot.js: handlers elo_panel_submit_setup, elo_panel_submit_setup_modal, elo_review_open — только если legacy ELO submit hub действительно переводится в compat-only
- smoke tests и routing tests

### Что именно можно вырезать только здесь

- hasActiveWelcomeSubmitSession как отдельный параллельный owner;
- helper-only naming, если generic intake owner уже реально канонический;
- отдельный live path legacy ELO submit hub;
- старые строки про "отправь следующим сообщением в этот канал", если runtime уже живёт по другому контракту.

### Риски этапа

- потеря last compat consumer;
- поломка moderator admin expectations по ELO panel setup;
- ложная уверенность после unit tests без полного smoke.

### Обязательная проверка после этапа

- focused tests по onboarding/profile/ELO submit flows;
- startup smoke;
- полный npm test;
- ручной smoke сценариев:
  - welcome only
  - helper only
  - profile kills
  - profile ELO

### Критерий завершения этапа

- нет параллельных submit-owner paths;
- нет скрытого legacy fallback, который принимает сообщения сам по себе;
- profile, welcome и helper используют один и тот же канонический intake seam;
- символы и copy совпадают с реальным поведением.

## Что LLM делать нельзя

Чтобы миграция осталась ювелирной, модель не должна:

- делать один огромный рефактор welcome-bot.js;
- выносить всю onboarding логику из welcome-bot.js одним PR;
- придумывать новые profile-specific custom ids для kills/ELO;
- делать массовый rename на сотни строк до стабилизации поведения;
- одновременно трогать startup, submit routing, ELO hub и profile operator;
- удалять compat ветки без новых smoke-тестов.

## Что LLM делать можно

- резать один owner seam за раз;
- создавать thin wrappers и compat aliases;
- добавлять source-aware intake session contract;
- добавлять focused smoke tests до cleanup;
- разводить startup/refresh зависимости отдельно от submit routing;
- переносить arm logic из render-path в interaction-path маленькими патчами.

## Финальный порядок выполнения без самодеятельности

1. Этап 1: только lifecycle welcome/helper panels.
2. Этап 2: только generic intake owner, без cutover.
3. Этап 3: только surface cutover для welcome/helper/profile buttons.
4. Этап 4: только cleanup legacy paths, copy и rename.

Если на любом этапе ломается хотя бы один из сценариев startup, helper idle, profile self-action или pending submit resume, выполнение останавливается и следующий этап запрещён.

## Финальный ожидаемый результат

В результате кодовая база должна прийти не к "трём разным submit системам", а к одному каноническому submit intake seam с тремя surface-входами:

- welcome panel
- bot helper panel
- profile full self-action buttons

Именно так можно получить рабочий честный продукт без широкого разрушительного рефактора.

## Пост-аудитный архитектурный remediation plan

Этот блок описывает не сам cutover, а доработку после уже выполненного перехода на общий intake contract. Его задача: убрать остаточный архитектурный шум, зафиксировать invariants и не оставить ловушки для следующей итерации.

### Решение по пункту 1 аудита: не чинить, а удалять

Пункт про elo_submit_modal не должен жить как bugfix backlog.

- по аудиту у handler-а нет живого showModal caller-а;
- канонический ELO launch path уже проходит через elo_submit_open и armed intake session;
- починка source-loss внутри dead-path только закрепляет ложный runtime contract.

Правильное решение:

1. Не инвестировать в локальный fix внутри elo_submit_modal.
2. На cleanup-этапе удалить handler, если повторный grep по repo по-прежнему не показывает caller-а.
3. Перед удалением прогнать focused tests по живому ELO flow и полный npm test.
4. Если когда-либо понадобится modal submit снова, вернуть его как новый явно поддерживаемый surface с отдельным продуктовым решением, а не как resurrected legacy tail.

### Remediation 2. Зафиксировать единый owner для source normalization

Сейчас welcome-bot.js держит локальный duplicate normalizeSubmitSource, хотя канонический enum и нормализация уже живут в src/onboard/helper-intake.js.

Цель:

- убрать лишнюю дубликацию правил;
- не допустить drift между welcome/runtime и intake-store seam.

Порядок работ:

1. Использовать normalizeSubmitIntakeSource из src/onboard/helper-intake.js как единственный normalizer.
2. Удалить локальную функцию normalizeSubmitSource из welcome-bot.js.
3. Прогнать focused grep/check на отсутствие локальных дубликатов нормализации source.
4. Прогнать intake smoke и полный npm test.

### Remediation 3. Выравнять TTL policy для source carrier и armed intake session

Сейчас profileSurfaceContexts живёт дольше, чем helper intake session. Это не ломает поведение, но размывает семантику: source carrier продолжает жить после смерти самой armed session.

Рекомендуемый контракт:

- carrier не должен жить дольше окна, в котором ещё допустимо продолжать intake flow.

Порядок работ:

1. Принять одно из двух явных решений:
   - либо profile source carrier живёт столько же, сколько intake session;
   - либо более длинный TTL сохраняется сознательно и документируется как separate resume hint, а не как active intake state.
2. Если специальной product-причины нет, выровнять TTL до одного значения.
3. Добавить один focused test на expiry semantics, чтобы следующий рефактор не разъехал policy снова.

### Remediation 4. Убрать misleading naming вокруг clearAllHelperSubmitSessions

Имя clearAllHelperSubmitSessions обещает зачистку нескольких stores, но фактически чистит только helper intake session. Это не runtime bug, но это прямой источник ложных предположений при следующем refactor-е.

Порядок работ:

1. Ввести каноническое имя clearSubmitIntakeSession или clearSubmitIntakeSessions.
2. Оставить старое имя только как compat alias на переходный период, если usages слишком размазаны.
3. Перевести call sites на новое имя малыми патчами.
4. Удалить alias только после пустого grep и зелёных тестов.

### Remediation 5. Формализовать invariant: resolve source before clear

Аудит показал не столько ценность dead handler-а, сколько важный invariant: launch source надо считывать до любого session clear. Иначе следующий legacy tail повторит ту же ошибку уже в живом коде.

Порядок работ:

1. Явно зафиксировать invariant в ближайшем owner seam или в helper-функции.
2. По возможности свести шаблон к одной операции вида capture source -> clear -> re-arm, чтобы не держать его размазанным по нескольким handlers.
3. Добавить focused test именно на этот порядок действий для живого ELO open path или общего re-arm helper-а.
4. Не размазывать правило комментариями по всему файлу; лучше один локальный seam, который делает ошибочный порядок неудобным.

### Remediation 6. Решить, нужен ли source в persisted submission record

Сейчас source живёт как runtime attribution, но не доходит до самой submission record. Для текущего поведения этого хватает. Для аналитики, moderation audit trail и будущего product reasoning этого может оказаться мало.

Нужно принять явное решение:

1. Если source нужен только для текущего routing, оставить его runtime-only и зафиксировать это в документе.
2. Если source нужен для аналитики, moderator context или downstream automation, добавить поле launchSource в persisted submission shape.
3. Делать это только через owner создания submission, без размазывания writes по surface-слоям.
4. Если поле добавляется, сразу закрыть compat shape tests и snapshot/state tests.

### Remediation 7. Зафиксировать product boundary для onboard_quick_mains

Сейчас onboard_quick_mains безопасно хардкодит source=welcome только потому, что кнопка живёт на welcome panel. Это допустимо как product boundary, но опасно как неявная архитектурная зависимость.

Порядок работ:

1. Явно задокументировать, что onboard_quick_mains является welcome-only action.
2. Если кнопка когда-либо переиспользуется вне welcome surface, перевести её на тот же source carrier contract, что и остальные shared actions.
3. Не лечить это заранее абстракцией, пока нет второго surface consumer-а.

### Рекомендуемый порядок выполнения remediation после cutover

1. Удаление dead-path elo_submit_modal вместо его ремонта.
2. Единый normalizer для source.
3. Явный invariant capture-before-clear.
4. Выравнивание TTL policy.
5. Naming cleanup через aliases.
6. Решение по persisted launchSource.
7. Документация product boundary для onboard_quick_mains.

### Stop-line для remediation

Работа должна останавливаться, если нарушается хотя бы одно из условий:

- живой ELO flow начинает зависеть от удаляемого legacy modal path;
- tests показывают, что source влияет не только на routing, но и на persisted state, который не был учтён в migration shape;
- TTL alignment меняет наблюдаемое user-facing поведение resume-path без отдельного продуктового решения.