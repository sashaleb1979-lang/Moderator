# Daily News Architecture And Execution Plan

## Purpose Of This File

Этот документ является каноническим execution-планом для всей дальнейшей разработки Daily News системы.

Он нужен не для фиксации продуктового желания и не для краткого статуса, а для того, чтобы:

- заранее определить архитектуру;
- жёстко зафиксировать владельцев поведения;
- определить безопасный порядок внедрения;
- заранее описать validation gates;
- уменьшить риск случайного слома уже работающих систем;
- не скатываться в хаотичную реализацию через локальные временные костыли.

Если в процессе разработки появится соблазн сделать что-то быстрее, но архитектурно хуже, приоритет у этого документа выше локального удобства.

## Document Role Hierarchy

У Daily News теперь должно быть три уровня документации:

1. [DAILY_NEWS_PRODUCT_INTENT.md](DAILY_NEWS_PRODUCT_INTENT.md)
   Фиксирует, чего хочет владелец продукта и каким должен ощущаться итоговый выпуск.

2. [DAILY_NEWS_CHRONICLE_PLAN.md](DAILY_NEWS_CHRONICLE_PLAN.md)
   Фиксирует текущий технический status, scope и ближайшие slices.

3. Этот файл.
   Фиксирует полную архитектуру, implementation order, guardrails, phase gates и правила внесения изменений.

Если между документами возникает конфликт:

- product intent определяет, каким должен быть итоговый результат;
- architecture execution plan определяет, как именно безопасно и последовательно к нему идти;
- chronicle plan отражает текущее состояние реализации и ближайший ход работ.

## Primary Goal

Построить отдельную Daily News систему, которая:

- каждый день после 21:00 по Москве выпускает один узнаваемый публичный daily issue;
- параллельно собирает staff-only audit digest;
- не теряет важные результаты молча;
- умеет честно маркировать partial и ambiguous coverage;
- не ломает существующий startup/runtime и не размывает ownership уже работающих систем.

## Non-Negotiable Engineering Principles

### 1. One owner per behavior

Каждое важное поведение должно иметь одного владельца.

Нельзя держать одну и ту же business-логику одновременно:

- в welcome-bot.js;
- в runtime helper;
- в отдельном news module;
- в тестовой утилите;
- в ручной Discord-команде.

Если появляется новое поведение, сразу определяется его владелец.

### 2. Runtime wiring is not business logic

[welcome-bot.js](welcome-bot.js) имеет право:

- подписывать Discord events;
- запускать serialized tasks;
- подключать periodic jobs;
- делегировать в owners.

Он не должен:

- компилировать digest;
- решать coverage policy;
- строить public/staff selection;
- строить payloads;
- хранить доменную логику news в себе.

### 3. Compile before render, render before publish

Daily News pipeline всегда идёт в таком порядке:

1. raw capture;
2. normalized compiler input;
3. day digest compilation;
4. public/staff selection;
5. visual/payload rendering;
6. Discord publish;
7. post-publish audit marking.

Нельзя смешивать эти слои.

### 4. Public and staff outputs must derive from one compiled truth

Нельзя делать отдельно:

- “публичный текст из одного места”;
- “staff digest из другого места”;
- “audit bucket разметку где-то ещё”.

И public edition, и staff digest должны строиться из одного compiled daily digest.

### 5. Honest coverage beats pretty output

Если данных не хватает, система обязана быть честной.

Нельзя:

- выдумывать leave vs kick;
- делать вид, что voice full list полный, когда coverage была потеряна;
- публиковать “точные” выводы при ambiguous source;
- скрывать rejected or dropped candidates без staff trail.

### 6. Fixed-time wall-clock scheduling only

Публикация и compile cadence должны подчиняться Moscow wall clock, а не uptime процесса.

То есть:

- publish once per Moscow dayKey;
- scheduler ориентируется на 21:00 МСК;
- рестарт процесса не должен смещать логику на “через 24 часа после запуска”.

### 7. Incremental slices only

Разработка идёт малыми slices.

Запрещено:

- делать большой переписанный news subsystem за один проход;
- одновременно внедрять compile, render, publish и operator UI без промежуточных validation gates;
- расширять область правок, пока не подтверждён предыдущий slice.

## Canonical Architecture

## A. Source Of Truth Layer

### Canonical state owner

- [src/news/state.js](src/news/state.js)

Responsibilities:

- структура news domain в db.sot.news;
- config defaults;
- runtime fields;
- dailyDigests storage;
- state normalization and memoization.

Non-responsibilities:

- raw event capture;
- compile decisions;
- rendering;
- publishing.

### Canonical persisted state model

Daily News state делится на пять частей:

1. config
   Включение системы, каналы, cadence, voice display policy, moderation display policy, presentation defaults.

2. raw capture state
   Voice openSessions/finalizedSessions, moderation.events и будущие raw stores для other collectors.

3. compiled state
   dailyDigests keyed by Moscow dayKey.

4. runtime state
   lastCompileStartedAt, lastCompileFinishedAt, lastCompiledDayKey, publish markers, audit counts, last failure, preview requests.

5. diagnostics state
   errors, coverage summary, degraded notes, dropped-result evidence.

### State invariants

Следующие инварианты обязательны:

- db.sot.news всегда нормализован через ensureNewsState;
- dailyDigests индексируются только по Moscow dayKey;
- runtime.lastCompiledDayKey не является доказательством publish, а только compile;
- runtime.lastPublishedDayKey меняется только publish layer;
- raw capture состояние не должно подменяться итоговым render output;
- compiled digest должен быть воспроизводимым из raw state и deterministic rules.

## B. Raw Capture Layer

### Voice owner

- [src/news/voice.js](src/news/voice.js)

Responsibilities:

- захват join/move/leave;
- сопровождение openSessions;
- финализация completed voice sessions;
- marking incomplete recovered sessions;
- displayName snapshot policy;
- runtime lastVoiceCaptureAt update.

Non-responsibilities:

- топы за день;
- thread full list rendering;
- public/staff selection;
- scheduler logic.

### Moderation owner

- [src/news/moderation.js](src/news/moderation.js)

Responsibilities:

- raw member removal capture;
- raw ban add/remove capture;
- future timeout add/remove capture;
- resolution field assignment at current certainty level;
- runtime lastModerationCaptureAt update.

Non-responsibilities:

- public moderation formatting;
- audit-log reconciliation scheduling;
- deciding digest story importance.

### Future raw capture owners

Следующие зоны не должны врастать в compiler напрямую. Для них планируются отдельные owners:

- kills collector owner;
- activity collector owner;
- newcomers collector owner;
- Roblox/JJS collector owner;
- tierlist shifts collector owner;
- dropped-result audit owner.

Даже если часть данных временно читается напрямую из существующих систем, итоговая цель всё равно: один owner на один data module.

## C. Compile Layer

### Compiler owner

- [src/news/compiler.js](src/news/compiler.js)

Responsibilities:

- Moscow day window calculation;
- сбор raw state за один dayKey;
- normalization into compiled digest;
- voice aggregation;
- moderation aggregation;
- coverage summary;
- audit counters;
- public/staff structural split at data level;
- запись compiled digest в dailyDigests.

Non-responsibilities:

- actual Discord publish;
- image rendering;
- operator button handling;
- Discord channel fetching;
- periodic tick cadence decisions.

### Compiler input contract

Compiler работает только с:

- db.sot.news raw state;
- canonical config;
- now / targetDayKey;
- deterministic read helpers из других domain owners.

Compiler не должен зависеть от:

- live Discord message state;
- component interaction state;
- текущего канала вызова;
- текстового UI.

### Compiler output contract

Compiled daily digest обязан содержать:

1. identity
   dayKey, compiledAt, coverageWindow.

2. source summaries
   voice, moderation, kills, activity, newcomers, JJS/Roblox, tierlist, extras.

3. coverage truth
   partial, ambiguous, reasons.

4. audit truth
   raw candidate counts, emitted counts, ambiguous counts, dropped counts.

5. public edition input
   уже отобранные блоки и секции для публичного выпуска.

6. staff digest input
   полный staff-safe набор coverage, omissions и ambiguous/rejected items.

### Compiler invariants

- compile must be deterministic for the same state snapshot;
- compiler may degrade, but must not silently omit failures;
- any partial/ambiguous module must leave a trace in compiled coverage;
- no publish side effect is allowed inside compiler;
- compiler must be idempotent for the same dayKey and state snapshot.

## D. Scheduler Layer

### Scheduler owner

- [src/news/scheduler.js](src/news/scheduler.js)

Responsibilities:

- wall-clock eligibility check;
- dayKey resolution by Moscow time;
- skip reasons;
- once-per-day compile gate;
- current shadow mode entrypoint;
- future publish trigger eligibility.

Non-responsibilities:

- compile internals;
- render internals;
- channel posting;
- coverage interpretation.

### Scheduler operating modes

Система должна поддерживать четыре режима:

1. Shadow mode
   Компилирует digest без публикации. Уже введён и должен оставаться безопасным режимом по умолчанию до готовности renderer/publisher.

2. Preview mode
   Собирает digest и payloads по запросу оператора без публичной публикации.

3. Publish mode
   Публикует выпуск once-per-day после прохождения compile/render checks.

4. Rerun mode
   Даёт пересобрать конкретный dayKey вручную для диагностики или републикации.

### Scheduler invariants

- scheduler never invents dayKey outside Moscow wall clock;
- scheduler does not publish twice for the same dayKey;
- scheduler skip reasons are explicit and testable;
- scheduler only orchestrates and delegates.

## E. Rendering Layer

### Future renderer owner

Планируемый owner:

- src/news/render.js или src/news/presentation.js

Responsibilities:

- cover PNG composition;
- hero metrics layout;
- public embed/message payloads;
- staff digest payloads;
- continuation thread payloads;
- per-section formatting.

Non-responsibilities:

- collector logic;
- compile logic;
- publish transport;
- runtime scheduling.

### Rendering rules

- renderer consumes compiled digest only;
- renderer must not reopen data-source decisions;
- renderer must preserve honesty markers from coverage;
- thread content is derived from compiled long-form blocks, not rebuilt ad hoc.

## F. Delivery Layer

### Future publisher owner

Планируемый owner:

- src/news/publisher.js

Responsibilities:

- resolve channels;
- duplicate publish guard;
- send cover + issue payload;
- create continuation thread;
- send staff digest;
- write publish results into runtime/digest metadata.

Non-responsibilities:

- deciding what to publish;
- generating the visual assets;
- raw state access beyond compiled digest usage.

### Publish invariants

- one public issue per dayKey;
- staff digest may be separate, but linked to same dayKey;
- publish failure must be recorded;
- partial Discord delivery must never silently mark the issue as successful.

## G. Operator Layer

### Future operator owner

Планируемый owner:

- src/news/operator.js

Responsibilities:

- preview today;
- publish now;
- rerun last day;
- rerun arbitrary dayKey;
- status view;
- compile/publish diagnostics surface.

Non-responsibilities:

- compile rules;
- render rules;
- raw capture.

## Daily News End-To-End Pipeline

Полный pipeline должен выглядеть так:

1. Discord/runtime events попадают в owners raw capture.
2. Raw data сохраняются в db.sot.news через serialized mutations.
3. Scheduler по Moscow wall clock решает, пора ли запускать compile.
4. Compiler читает raw state и формирует digest for one dayKey.
5. Coverage and audit logic маркирует partial, ambiguous, dropped, suppressed и staff-only items.
6. Renderer строит public issue payload, thread payload и staff digest payload.
7. Publisher публикует issue.
8. Runtime фиксирует publish status, message ids, thread ids, failures и audit result.
9. Operator surfaces позволяют превью, rerun и диагностику.

Ни один шаг не должен быть скрытым или смешанным с соседним.

## Ownership Matrix

### Already existing owners

- state owner: [src/news/state.js](src/news/state.js)
- voice owner: [src/news/voice.js](src/news/voice.js)
- moderation owner: [src/news/moderation.js](src/news/moderation.js)
- compiler owner: [src/news/compiler.js](src/news/compiler.js)
- scheduler owner: [src/news/scheduler.js](src/news/scheduler.js)

### Planned owners to add next

- kills collector owner
- activity collector owner
- newcomers collector owner
- Roblox/JJS collector owner
- tierlist collector owner
- dropped-result audit owner
- renderer owner
- publisher owner
- operator owner

### Forbidden ownership drift

Запрещено:

- тащить compile логику в welcome-bot.js;
- строить renderer прямо в scheduler;
- писать publish logic inside compiler;
- дублировать coverage decisions внутри operator handlers;
- держать parallel truth for the same dayKey outside db.sot.news.dailyDigests.

## Effective Implementation Strategy

Ниже фиксируется порядок, которому нужно следовать дальше. Он выбран для максимальной эффективности и минимального риска регрессий.

## Phase 0. Freeze The Rules Before More Code

Goal:

- зафиксировать архитектуру;
- не допустить расползания поведения по нескольким местам;
- заранее определить owners и acceptance gates.

Status:

- выполнено этим документом.

Exit criteria:

- есть единый execution-plan файл;
- дальнейшая работа ссылается на него как на SoT.

## Phase 1. Canonical Raw News Foundation

Goal:

- получить честную и устойчивую capture-основу.

Scope:

- news state in SoT;
- voice raw capture;
- moderation raw capture;
- startup/runtime event wiring;
- raw coverage tests.

Status:

- уже реализовано.

What must stay true:

- capture logic не переносится в event handlers;
- raw events не пропадают при последующих refactors;
- every capture path has a focused test.

## Phase 2. Shadow Compile Foundation

Goal:

- научить систему собирать daily digest без publish side effects.

Scope:

- Moscow day window;
- compile by dayKey;
- voice digest;
- moderation digest;
- coverage summary;
- audit counts;
- shadow scheduler tick.

Status:

- частично реализовано и уже работает как foundation.

Remaining gaps inside the phase:

- расширить compile beyond voice/moderation;
- стабилизировать digest schema before renderer.

## Phase 3. Data Module Expansion

Goal:

- закрыть все обязательные content blocks для V1.

Subphase 3.1. Kills collector

Must deliver:

- approved kill jumps за day window;
- delta amount;
- strongest movers;
- staff visibility for rejected/suppressed/dropped candidate paths.

Constraints:

- не вмешиваться в существующий review flow;
- не дублировать canonical submission ownership;
- читать только подтверждённые источники или явно маркировать uncertainty.

Subphase 3.2. Activity collector

Must deliver:

- top messages;
- activity movers up/down;
- role shifts where material.

Constraints:

- не переопределять existing activity ownership;
- использовать existing activity domain as source, not ad hoc recomputation from random logs.

Subphase 3.3. Newcomers collector

Must deliver:

- newcomers;
- newly verified users;
- recently joined users who already influenced the day.

Constraints:

- respect onboarding ownership;
- distinguish “joined”, “verified”, “became active”, “became visible”.

Subphase 3.4. Roblox/JJS collector

Must deliver:

- top JJS playtime;
- standout grinders;
- meaningful gaming highlights.

Constraints:

- only use trustworthy canonical Roblox/JJS signals;
- avoid overclaiming game activity when source confidence is weak.

Subphase 3.5. Tierlist shifts collector

Must deliver:

- meaningful up/down shifts;
- story-worthy tierlist changes.

Constraints:

- avoid noise;
- only surface changes that matter to the daily story.

Subphase 3.6. Dropped-result audit collector

Must deliver:

- explicit trace for rejected, superseded, expired, orphaned and silently lost candidates;
- staff digest evidence that a result was seen and why it was not published.

Constraints:

- cannot rely on public-facing data only;
- must leave a bucket trail for every candidate event.

Phase 3 exit criteria:

- all required V1 data modules exist;
- each module produces compile-ready structured output;
- each module has focused tests;
- staff audit can explain omissions instead of hiding them.

## Phase 4. Moderation Truth Upgrade

Goal:

- убрать ложную точность и одновременно сузить ambiguity там, где это возможно.

Must deliver:

- audit-log reconciliation for leave vs kick;
- timeout apply/remove tracking;
- better resolution quality in moderation digest.

Constraints:

- if reconciliation fails, ambiguity remains explicit;
- public layer only surfaces safe confirmed highlights.

Exit criteria:

- member removal no longer stays permanently ambiguous when audit evidence exists;
- timeouts become first-class moderation events;
- staff digest captures resolution quality cleanly.

## Phase 5. Digest Schema Freeze

Goal:

- остановить churn структуры compiled digest до renderer implementation.

Must deliver:

- stable digest section contract;
- stable publicEdition input contract;
- stable staffDigest input contract;
- stable coverage and audit contracts.

Why this phase exists:

- без schema freeze renderer будет постоянно ломаться от moving target;
- без schema freeze publish/operator code станет дублировать mapping rules.

Exit criteria:

- digest schema documented and covered by tests;
- renderer can be built without revisiting collector internals.

## Phase 6. Renderer And Payload Builders

Goal:

- превратить compiled digest в edition-level output.

Subphase 6.1. Public edition builder

Must deliver:

- hero block;
- story of the day;
- section blocks;
- top tables/highlights;
- thread long-form support.

Subphase 6.2. Staff digest builder

Must deliver:

- coverage diagnostics;
- omissions;
- ambiguous cases;
- dropped/rejected evidence;
- runtime failures.

Subphase 6.3. Cover renderer

Must deliver:

- reusable visual composition;
- issue identity;
- strong masthead and date treatment;
- compatibility with Discord attachment flow.

Renderer constraints:

- no direct source reads;
- consume compiled digest only;
- no hidden business logic forks.

Exit criteria:

- render layer can build final payloads for preview without publish;
- visual output is structurally stable;
- staff digest and public edition stay consistent with the same digest.

## Phase 7. Publish Layer

Goal:

- безопасно и один раз в день публиковать итоговый выпуск.

Must deliver:

- public channel publish;
- staff channel publish;
- continuation thread creation;
- duplicate-publish guard;
- publish result persistence;
- partial delivery failure handling.

Constraints:

- publish cannot happen before renderer success;
- publish cannot happen twice for one dayKey;
- failed publish must not silently mutate runtime into success state.

Exit criteria:

- fully automated publish possible;
- rerun and retry semantics are explicit;
- published issue and digest metadata are persisted.

## Phase 8. Operator Surface

Goal:

- дать controllable operations layer без внедрения бизнес-логики в handlers.

Must deliver:

- preview today;
- publish now;
- rerun last day;
- rerun exact dayKey;
- status / health / last failure views.

Constraints:

- operator layer only orchestrates;
- operator actions call owners;
- no hidden side-channel state.

Exit criteria:

- оператор может проверить, превьюнуть, пересобрать и опубликовать выпуск без ручного кода в runtime.

## Phase 9. Hardening And Production Rollout

Goal:

- перейти от “works locally” к “safe in live runtime”.

Must deliver:

- shadow period with real daily compiles;
- digest review against expected server activity;
- missing-source detection fixes;
- failure telemetry;
- confidence thresholds for go-live.

Recommended rollout order:

1. shadow compile only;
2. preview-only operator mode;
3. staff-only publish;
4. public publish with duplicate guard enabled.

Exit criteria:

- no silent dropped critical events across observed days;
- public edition quality acceptable;
- staff digest meaningfully explains omissions;
- operator rerun path works.

## Validation Strategy

## A. Validation philosophy

Каждый slice проходит три уровня проверки:

1. focused tests for the exact owner;
2. adjacent seam validation;
3. active workspace test suite.

Нельзя пропускать шаг 1 и сразу идти в общий прогон.

## B. Required validation after each change type

### For raw capture changes

Required:

- focused owner tests;
- startup wiring test if event path changed.

### For compiler changes

Required:

- focused compiler tests;
- regression tests for coverage markers;
- active test tree if digest schema changed.

### For scheduler changes

Required:

- scheduler owner tests;
- client-ready-core seam tests;
- welcome-bot wiring test if startup path changed.

### For renderer changes

Required:

- payload shape tests;
- asset generation tests if image output added;
- preview flow tests if operator path exists.

### For publish changes

Required:

- duplicate guard tests;
- publish success/failure tests;
- rerun safety tests.

## C. Test layering rules

- owner tests assert domain behavior;
- wiring tests assert integration placement;
- smoke tests catch missing imports and startup regressions;
- full active suite confirms no collateral damage.

## D. Validation gates before go-live

Public publish must stay disabled until all of the following are true:

- all mandatory V1 collectors implemented;
- dropped-result audit exists;
- moderation truth is acceptable;
- renderer quality is usable;
- duplicate publish guard tested;
- several shadow days reviewed manually.

## Anti-Breakage Guardrails

### 1. Do not broaden welcome-bot hot path

Любое изменение в [welcome-bot.js](welcome-bot.js) должно быть минимальным.

Допускается:

- import owner;
- add event wiring;
- add periodic job wiring;
- delegate.

Не допускается:

- business logic growth;
- compile internals;
- render formatting;
- publish branching.

### 2. Do not mutate foreign domain truth casually

News system должна читать существующие домены, а не переписывать их под себя.

Особенно это относится к:

- activity;
- onboarding;
- Roblox/JJS;
- tierlist;
- moderation review data.

### 3. Do not mix audit and public story logic

Если модуль не прошёл public threshold, это не значит, что он исчезает.

Правильный путь:

- либо published_public;
- либо уходит в staff/audit bucket;
- либо помечается как suppressed/rejected/orphaned/ambiguous.

Неправильный путь:

- “не подошло для main issue, значит просто забыли”.

### 4. No hidden heuristics without tests

Любая эвристика вроде:

- что считать notable jump;
- что считать important tierlist shift;
- что считать highlight-worthy voice event;
- что считать story-worthy comeback;

обязана иметь:

- явное правило;
- тест;
- место в compiler contract.

### 5. No schema churn without freeze note

Если меняется compiled digest shape, это должно сопровождаться:

- обновлением этого документа;
- обновлением Chronicle plan при необходимости;
- обновлением тестов.

## Operational Safety Rules

### Duplicate publish safety

Система обязана защищаться от:

- рестарта процесса;
- повторного scheduler tick;
- ручного rerun without operator intent;
- частично успешной публикации.

### Failure recording

Любая критичная ошибка должна оставлять trace в runtime:

- stage;
- time;
- short message;
- preferably related dayKey.

### Rerun semantics

Ручной rerun допустим, но должен быть явно отделён от автоматического publish path.

### Shadow mode safety

Shadow mode остаётся базовым безопасным режимом, пока публичная доставка не пройдёт все gates.

## Planned File Topology

### Existing

- [src/news/state.js](src/news/state.js)
- [src/news/voice.js](src/news/voice.js)
- [src/news/moderation.js](src/news/moderation.js)
- [src/news/compiler.js](src/news/compiler.js)
- [src/news/scheduler.js](src/news/scheduler.js)

### Expected next additions

- src/news/kills.js
- src/news/activity.js
- src/news/newcomers.js
- src/news/gameplay.js
- src/news/tierlist.js
- src/news/audit.js
- src/news/render.js
- src/news/publisher.js
- src/news/operator.js

Имена могут уточняться, но ownership boundaries менять нельзя без отдельного обоснования.

## Execution Order That Must Be Followed

Ниже жёсткий рекомендуемый порядок работ.

1. Finish remaining collectors before any public visual polish.
2. Upgrade moderation truth before claiming full moderation recap.
3. Freeze digest schema before serious renderer work.
4. Build preview-capable renderer before publish path.
5. Build publisher only after renderer is stable.
6. Build operator controls only after compile/render/publish owners already exist.
7. Do shadow runtime review before enabling real public delivery.

## Explicitly Deferred Until Later

Чтобы не расползаться, пока не трогать:

- broad redesign of unrelated welcome-bot startup;
- invasive refactor of activity/Roblox/tierlist owners only ради news;
- public auto-publish before payload and audit readiness;
- ambitious visual experiments before stable compiled schema;
- automatic “AI summary tone” generation without deterministic facts underneath.

## Working Definition Of Done

Daily News считается действительно готовой системой только когда одновременно выполнены все условия:

- raw capture покрывает обязательные источники;
- compiler собирает все обязательные daily modules;
- staff digest объясняет omissions and ambiguity;
- public edition собирается из stable digest;
- cover and payloads выглядят как issue, а не как обычный log;
- publish layer безопасен и идемпотентен;
- operator layer позволяет preview and rerun;
- несколько shadow days подтвердили, что важные события не теряются молча.

## Immediate Next Work According To This Plan

Следующий этап разработки по этому документу:

1. Довести collector layer до полного V1 scope.
2. Отдельно закрыть timeout tracking и leave-vs-kick reconciliation.
3. После этого зафиксировать digest schema.
4. Только затем строить renderer и publish layer.

Это и есть тот порядок, которому дальше нужно следовать, если цель — сделать систему эффективно и без лесного слома соседних частей репозитория.