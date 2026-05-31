# План восстановления: onboarding, approve и canonical Roblox binding

Дата: 30.05.2026

Статус: handoff-план по current main после аудита прод-инцидента.

Основание:

- наблюдаемый прод-сбой с onboarding submit/approve;
- локальный аудит owner-ов в [welcome-bot.js](welcome-bot.js), [src/integrations/shared-profile.js](src/integrations/shared-profile.js), [src/onboard/roblox-identity.js](src/onboard/roblox-identity.js), [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js);
- история ключевых коммитов: `1349b0ca`, `652cfb03`, `fcab27dd`, `f9f4b130`, `f693e172`, `61fa9920`.

---

## 1. Итог без смягчений

Инцидент не одинарный. В текущем main наложились друг на друга минимум три разных класса проблем:

1. canonical Roblox binding смешан с временным onboarding submission state;
2. approve flow остаётся role-first и падает при любой ошибке Discord role mutation;
3. поверх старой approve-хрупкости недавно был добавлен claim/defer guard, который лечит дубликаты и таймауты, но не корневую причину отказа approve.

Практический результат в проде:

1. новая pending/rejected заявка может демотнуть уже подтверждённую Roblox identity до `pending` или `failed`;
2. после этого Roblox tracking и panel consumer-ы перестают считать участника валидным;
3. approve для части заявок может не завершаться из-за tier/access role operations, даже если сама заявка логически валидна;
4. старые участники сервера особенно уязвимы, потому что approve идёт через member fetch и role mutation, а не через сначала durable decision, потом отдельный sync.

Главный вывод:

- сначала надо развести trusted Roblox binding и transient onboarding state;
- затем надо отвязать approve decision от обязательного успеха role operations;
- только после этого имеет смысл чинить оставшиеся поверхностные следствия и переписывать тесты.

---

## 2. Что именно сломано

### 2.1. Критичный root cause: transient onboarding state пишет в canonical Roblox binding

Сейчас onboarding submit, reject и pending Roblox edit используют один и тот же canonical write seam:

- [welcome-bot.js](welcome-bot.js#L10184-L10189)
- [welcome-bot.js](welcome-bot.js#L10477-L10481)
- [welcome-bot.js](welcome-bot.js#L10543-L10548)

Во всех этих местах вызывается `writeCanonicalRobloxBinding(...)` с onboarding-статусами:

1. `verificationStatus: "pending"`
2. `verificationStatus: "failed"`
3. `verifiedAt: null`

Дальше [src/integrations/shared-profile.js](src/integrations/shared-profile.js#L1905-L1957) безусловно переносит эти поля в `profile.domains.roblox`, а затем summary/runtime consumer-ы начинают видеть пользователя как non-verified/non-trackable.

Это и есть главный системный разрыв: trusted Roblox account record используется одновременно и как постоянный verified binding, и как временный state текущей onboarding-заявки.

### 2.2. Approve flow до сих пор role-first

Approve по welcome onboarding сейчас идёт в таком порядке:

1. `ensureSingleTierRole(...)`
2. `maybeGrantAccessRoleAtStage(...)`
3. запись approved state в submission/profile
4. `saveDb()`

Код:

- [welcome-bot.js](welcome-bot.js#L10359-L10408)
- [welcome-bot.js](welcome-bot.js#L8202-L8233)
- [welcome-bot.js](welcome-bot.js#L8344-L8354)

Если Discord role operation падает, approval не считается завершённым вообще. Это значит:

1. moderation decision и Discord side-effect сцеплены в один атомарный шаг;
2. любой `Missing Permissions`, hierarchy drift, fetchMember issue или временный Discord failure блокирует approve целиком;
3. старые участники не проходят approve по той же причине, по которой не проходит role mutation, а не потому, что заявка плохая.

### 2.3. Свежий claim/defer patch не решает старую approve-хрупкость

Недавний патч в [welcome-bot.js](welcome-bot.js#L21372-L21410) добавил:

1. durable approve claim;
2. защиту от duplicate clicks;
3. early defer/editReply;
4. detached heavy processing.

Это хороший guardrail против гонок и interaction timeout, но он не меняет базовый порядок внутри `approveSubmission(...)`. Поэтому после патча approve стал менее хрупким на уровне UI, но остался хрупким на уровне бизнес-потока.

---

## 3. Хронология, откуда это приехало

### Этап 1. Базовый welcome approve flow

Коммит `1349b0ca` ввёл базовый approve flow в текущем owner-е [welcome-bot.js](welcome-bot.js#L10359-L10408).

На этом этапе уже был заложен старый подход:

1. сначала role operations;
2. потом запись approved state;
3. потом `saveDb()`.

### Этап 2. Role orchestration ужесточили

Коммит `652cfb03` усилил owner-ы ролей:

- [welcome-bot.js](welcome-bot.js#L8202-L8233)
- [welcome-bot.js](welcome-bot.js#L8344-L8354)

После этого approve стал ещё сильнее зависеть от успешности role mutations и rollback path.

### Этап 3. Onboarding Roblox state начали писать в canonical binding

Коммит `fcab27dd` добавил onboarding writes с `pending` и `failed` прямо в canonical Roblox seam:

- [welcome-bot.js](welcome-bot.js#L10184-L10189)
- [welcome-bot.js](welcome-bot.js#L10388-L10396)
- [welcome-bot.js](welcome-bot.js#L10477-L10481)

Это был главный архитектурный drift.

### Этап 4. Shared profile закрепил эту семантику как authoritative

Коммиты `f9f4b130` и `f693e172` перенесли Roblox truth в canonical shared-profile owner и закрепили merge-семантику:

- [src/integrations/shared-profile.js](src/integrations/shared-profile.js#L1946-L1947)

С этого момента onboarding `pending/failed` перестал быть локальным состоянием заявки и стал влиять на весь Roblox runtime и panel stack.

### Этап 5. Свежий инцидентный патч вокруг approve

Коммит `61fa9920` добавил durable claim/defer guards:

- [welcome-bot.js](welcome-bot.js#L21372-L21410)

Он полезен, но только как incident mitigation. Root cause он не устраняет.

---

## 4. Что не надо делать

1. Не лечить проблему условием вида "если уже verified, то не затирать status" только внутри [src/integrations/shared-profile.js](src/integrations/shared-profile.js). Это спрячeт часть симптомов, но оставит один объект с двумя разными смыслами.
2. Не возвращать Roblox truth обратно в несколько локальных helper-ов по разным consumer-ам.
3. Не делать broad rewrite [welcome-bot.js](welcome-bot.js).
4. Не смешивать архитектурное разделение Roblox state и redesign approve flow в один гигантский patch без промежуточной валидации.
5. Не считать зелёным покрытие, пока suite всё ещё закрепляет unsafe pending/failed semantics как "правильную".

---

## 5. Целевая архитектура после фикса

Нужно развести два разных класса данных.

### 5.1. Canonical Roblox binding

Хранит только trusted account record участника:

1. `userId`
2. `username`
3. `displayName`
4. `verificationStatus`, но только как состояние доверенной привязки
5. `verifiedAt`
6. trackability/playtime/social/runtime scaffolding

Этот объект читают:

1. Roblox tracking jobs
2. Roblox panel
3. antiteam/profile/onboard identity consumers

### 5.2. Transient onboarding Roblox review state

Хранит состояние текущей onboarding-заявки:

1. какой Roblox account прислали в pending submission;
2. проверен ли он модератором именно для этой заявки;
3. заменялся ли ник модератором;
4. reject/pending status самой заявки.

Этот state должен жить рядом с submission/onboarding domain, а не подменять trusted profile binding.

Практический принцип:

- новая pending заявка не имеет права демотать уже verified profile binding;
- reject новой заявки не имеет права ломать старый verified Roblox account;
- approve новой заявки может обновить canonical binding, если именно эта заявка подтверждает новый trusted account.

---

## 6. Порядок исправления

## Фаза 1. Разделить trusted Roblox binding и onboarding submission state

Цель:

- убрать главный системный root cause, из-за которого verified user внезапно становится `pending/failed` для всей Roblox системы.

Что менять:

1. [welcome-bot.js](welcome-bot.js)
2. при необходимости узко [src/onboard/roblox-identity.js](src/onboard/roblox-identity.js)
3. тесты вокруг shared-profile/onboarding/roblox startup wiring

Что делать:

1. перестать писать onboarding `pending` в canonical binding на submit;
2. перестать писать onboarding `failed` в canonical binding на reject;
3. перестать обновлять canonical binding из pending moderator edit, если это не verified/apply step;
4. сохранить Roblox account fields на submission-слое так, чтобы approve всё ещё мог поднять их в canonical binding при финальном подтверждении;
5. явно описать инвариант: only verified/admin-approved onboarding result may mutate trusted Roblox binding.

Минимальный безопасный вариант:

1. submit/reject/edit обновляют только `submission.roblox*` и onboarding profile fields;
2. `approveSubmission(...)` остаётся единственным onboarding path, который пишет `verificationStatus: "verified"` в canonical binding.

Что валидировать сразу после правки:

1. добавить и прогнать узкие тесты:
   1. verified Roblox survives new pending submission;
   2. verified Roblox survives reject of later onboarding submission;
   3. pending Roblox moderator edit does not demote old verified binding.
2. прогнать:
   1. [tests/shared-profile.test.js](tests/shared-profile.test.js)
   2. [tests/onboard-roblox-identity.test.js](tests/onboard-roblox-identity.test.js)
   3. [tests/roblox-startup-wiring.test.js](tests/roblox-startup-wiring.test.js)

Definition of done:

1. новая заявка больше не может сломать существующий trusted Roblox binding;
2. Roblox panel/runtime продолжают видеть verified user как verified;
3. onboarding всё ещё умеет провести нового пользователя через submit -> approve.

## Фаза 2. Перевести approve на decision-first, side-effects-second

Цель:

- перестать делать успех moderation decision зависимым от синхронного успеха Discord role mutations.

Что менять:

1. [welcome-bot.js](welcome-bot.js)
2. возможно узко helper around approval finalization

Что делать:

1. разделить "approve decision persisted" и "tier/access role sync applied";
2. approval должен сначала durable записать approved state в submission/profile;
3. затем role sync должен идти как follow-up step;
4. при role failure approval не откатывается в pending, а фиксируется как approved-with-role-sync-error;
5. пользователю и модератору нужно отдавать честный degraded result, а не общий `Не удалось одобрить заявку`.

Практически это можно сделать так:

1. внутри `approveSubmission(...)` сначала вычислить и сохранить approved state;
2. после saveDb запустить tier/access apply;
3. если role apply падает, записать repair flag/log/queue, но не отменять approved решение;
4. вынести repair в ручной или startup sync path.

Что не делать:

1. не делать второй giant transaction с полным rollback всего approve при любой role ошибке;
2. не пытаться сразу решить все legacy role inconsistencies.

Что валидировать:

1. approve on happy path;
2. approve when tier role add fails;
3. approve when access role add fails;
4. approve when fetchMember returns null or temporary failure;
5. confirm that duplicate-click protection from [welcome-bot.js](welcome-bot.js#L21372-L21410) still works.

Definition of done:

1. заявка может быть одобрена даже при временном Discord role failure;
2. модератор получает точный degraded ответ;
3. repair path можно выполнить отдельно без повторного approve.

## Фаза 3. Переписать тестовые инварианты под правильную модель

Цель:

- убрать из suite ложную норму, где pending/failed onboarding state считается canonical Roblox truth.

Что менять:

1. [tests/shared-profile.test.js](tests/shared-profile.test.js)
2. onboarding tests around submit/reject/approve
3. при необходимости wiring tests in [tests/roblox-startup-wiring.test.js](tests/roblox-startup-wiring.test.js)

Что делать:

1. заменить тест `applyRobloxAccountSnapshot writes canonical pending Roblox state...` на тест, который фиксирует separation contract;
2. убрать ожидание, что failed onboarding review автоматически превращает trusted verified binding в failed canonical state;
3. добавить integration-like tests around welcome submit/reject/approve flows.

Definition of done:

1. suite проверяет правильный product contract, а не старый архитектурный drift;
2. регрессия может быть поймана локально до деплоя.

## Фаза 4. Добить runtime/test drift вокруг fetchMember и live member refresh

Цель:

- вернуть full suite в стабильное зелёное состояние и не путать новые onboarding fixes с уже существующим structural drift.

Текущее состояние полного прогона:

1. `npm test` -> `929 pass / 3 fail`.
2. Падают:
   1. [tests/fetch-member-runtime.test.js](tests/fetch-member-runtime.test.js#L36)
   2. [tests/fetch-member-runtime.test.js](tests/fetch-member-runtime.test.js#L58)
   3. [tests/tierlist-live-members.test.js](tests/tierlist-live-members.test.js#L39)

Что важно:

- это не главный root cause onboarding incident;
- но перед финальным deploy fix branch надо привести suite в полный green.

Что делать:

1. либо восстановить ожидаемые structural anchors в [welcome-bot.js](welcome-bot.js),
2. либо обновить tests так, чтобы они проверяли текущий owner seam, а не старую текстовую форму extraction.

---

## 7. Порядок рабочего исполнения

Рекомендуемый порядок коммитов:

1. Commit A: separate onboarding transient Roblox state from canonical binding.
2. Commit B: decision-first approve with degraded role-sync handling.
3. Commit C: test contract update for shared-profile/onboarding semantics.
4. Commit D: unrelated structural test drift cleanup for full suite green.

Почему именно так:

1. первый коммит убирает самый опасный product bug;
2. второй закрывает главный moderator pain point;
3. третий закрепляет новый контракт;
4. четвёртый отделяет текущий incident work от уже накопившихся suite drift issues.

---

## 8. Валидация по фазам

### После фазы 1

Запустить минимум:

1. `node --test tests/shared-profile.test.js`
2. `node --test tests/onboard-roblox-identity.test.js`
3. `node --test tests/roblox-startup-wiring.test.js`

Дополнительно нужен ручной сценарий:

1. у пользователя уже есть verified Roblox binding;
2. он создаёт новую pending заявку;
3. Roblox panel/profile/trackability не теряют его binding.

### После фазы 2

Запустить минимум:

1. `node --test tests/onboard-approval-proof-window-wiring.test.js`
2. новые approve failure tests
3. релевантные startup/onboard smoke tests

Ручной сценарий:

1. временно сломать tier/access role apply в harness;
2. approve должен остаться persisted;
3. модератор должен увидеть degraded outcome;
4. repair должен быть повторяем отдельно.

### После фазы 3 и 4

Обязательно:

1. `npm test`

---

## 9. Деплой-последовательность

1. Локально пройти фазу 1 и фазу 2 с узкой валидацией.
2. Прогнать `npm test`.
3. Задеплоить в Railway.
4. После рестарта проверить в логах:
   1. submit нового pending не ломает существующий verified Roblox state;
   2. approve больше не падает целиком при role issue;
   3. Roblox panel не теряет старых verified users после новых заявок.
5. Ручной smoke в Discord:
   1. новый пользователь submit -> approve;
   2. старый verified пользователь submit нового update -> binding survives;
   3. reject новой заявки старого verified пользователя -> binding survives.

---

## 10. Короткий чеклист на реализацию

### Блок A. Canonical binding separation

1. Удалить onboarding `pending` canonical write на submit.
2. Удалить onboarding `failed` canonical write на reject.
3. Удалить pending canonical write из moderator Roblox edit path.
4. Оставить canonical Roblox update только в approve/manual verified paths.

### Блок B. Approve hardening

1. Persist approve decision before Discord side-effects.
2. Сделать role sync degraded follow-up.
3. Сохранить current duplicate-click protection.
4. Добавить repairable logging/state для failed role apply.

### Блок C. Tests

1. Переписать shared-profile pending/failed expectations.
2. Добавить regressions for verified-binding survival.
3. Добавить approve failure-path tests.
4. Затем вернуть full suite в green.

---

## 11. Definition of done для всего инцидента

Инцидент можно считать закрытым только если одновременно верны все пункты:

1. новая pending или rejected onboarding-заявка не ломает старый verified Roblox binding;
2. Roblox tracking/panel после новых заявок не теряют старых verified users;
3. approve не зависит полностью от немедленного успеха role mutations;
4. модератор может одобрить заявку даже при временном role-side сбое;
5. suite больше не закрепляет unsafe canonical pending/failed semantics;
6. `npm test` зелёный;
7. Railway smoke подтверждает поведение после рестарта.