# План улучшения панели активности Roblox

Дата: 16.05.2026

Статус: план на реализацию, без текущего code rollout.

Назначение этого документа:
1. зафиксировать, что именно должна отвечать Roblox activity panel для модератора;
2. разделить текущие проблемы панели на data-model, UX и runtime-слои;
3. определить owner seams, чтобы не расползтись по welcome-bot.js без необходимости;
4. задать порядок реализации и проверки.

---

## 1. Что должна отвечать панель

Панель должна за один просмотр отвечать на пять вопросов:
1. сколько людей вообще имеют Roblox footprint в базе;
2. сколько из них реально trackable для playtime прямо сейчас;
3. сколько не trackable и по какой именно причине;
4. у кого конкретно сейчас ошибка, blocker или manual-rebind кейс;
5. что делает runtime: жив ли sync, сколько людей реально обработано, сколько потеряно, сколько осталось dirty.

Практический смысл:
1. модератору не должно быть нужно лезть в Railway DB-археологию, чтобы понять, почему у людей не идёт счёт;
2. панель должна показывать не только job health, но и coverage funnel по людям;
3. список проблем должен быть адресным: не только количество, но и кого именно смотреть первым.

---

## 2. Текущий baseline

### 2.1. Owner seams

Сейчас основная панель живёт здесь:
1. src/integrations/roblox-panel.js
   - getRobloxStatsPanelSnapshot
   - buildRobloxStatsPanelPayload
   - handleRobloxStatsPanelButtonInteraction
2. src/runtime/roblox-jobs.js
   - владеет verified candidate selection
   - владеет repair invalid bindings
   - владеет playtime/profile/flush job summaries
3. welcome-bot.js
   - только wiring и panel action callbacks
   - не должен становиться местом, где вручную собирается panel summary

### 2.2. Что панель уже умеет

По текущему коду панель уже показывает:
1. linkedUsers
2. verifiedUsers
3. pendingUsers
4. failedUsers
5. refreshErrorUsers
6. neverRefreshedVerifiedUsers
7. activeJjsUsers
8. dirtyRuntimeUsers
9. activeCoPlayPairs
10. статусы трёх фоновых задач
11. один смешанный top-list “Кого проверить первым”
12. один компактный блок “Ошибки и блокеры”

### 2.3. Чего не хватает

Сейчас панель не отвечает на главные production-вопросы:
1. сколько verified-профилей реально имеют валидный Roblox userId и реально могут войти в playtime sync;
2. сколько verified-профилей сломаны, но repairable по username;
3. сколько verified-профилей сломаны настолько, что нужен manual rebind;
4. кто именно попал в эти bucket-ы;
5. сколько valid verified users вообще никогда не были замечены в JJS;
6. сколько людей “есть в Roblox”, но “нет в trackable pool”;
7. у каких пользователей ошибка именно refresh, а у каких проблема именно binding-а;
8. у кого проблема уже починима автоматически, а у кого нет.

Текущий top-list слишком смешивает разные типы проблем:
1. refresh errors;
2. pending/failed verification;
3. runtime dirty;
4. active JJS users;
5. missing refresh.

Из-за этого панель не даёт чистого operator answer вроде:
1. verified: 136;
2. trackable: 13;
3. repairable: 111;
4. unrecoverable/manual: 12.

Именно такой разрез и нужен, чтобы панель объясняла production truth без отдельного live audit.

---

## 3. Целевая информационная модель панели

### 3.1. Coverage funnel

В overview должен появиться явный funnel по привязкам:
1. Roblox footprint total
2. verified total
3. verified trackable
   - verified + валидный safe positive userId
4. verified broken but repairable
   - verified + нет валидного userId + есть username
5. verified broken and manual-only
   - verified + нет валидного userId + нет username
6. pending
7. failed

Это главный блок, который отвечает на “сколько людей есть, сколько нет”.

### 3.2. Activity funnel

Отдельный блок должен показывать состояние playtime coverage:
1. active in JJS now
2. valid verified but never seen in JJS
3. valid verified with totalJjsMinutes > 0
4. valid verified with 0 minutes
5. users currently in opaque fallback mode
6. dirty runtime users

### 3.3. Error and blocker buckets

Панель должна различать типы проблем, а не складывать всё в один note:
1. binding broken but repairable
2. binding broken and manual-only
3. refresh errors
4. profile never refreshed
5. last playtime sync had failed batches
6. runtime flush error
7. stale session marker cases

### 3.4. Named operator lists

Нужны адресные списки, а не только counters:
1. “Починится автоматически”
   - username + displayName
2. “Нужен manual rebind”
   - username/displayName + why
3. “Ошибки обновления”
   - username + truncated refreshError
4. “Не были замечены в JJS”
   - valid verified users with zero lastSeenInJjsAt
5. “Активны сейчас”
   - current live JJS users

У каждого списка должно быть:
1. лимит первого экрана;
2. хвост вида “+N ещё”;
3. единый reason text, а не свободные notes разного формата.

---

## 4. Предлагаемая UX-структура

### 4.1. Разделение на view modes

Один embed уже перегружен. Вместо этого панель стоит разложить минимум на 4 view:
1. Обзор
   - high-level funnel + job health + top blockers
2. Coverage
   - verified trackable / repairable / manual-only / pending / failed
3. Activity
   - active now / seen before / never seen / zero minutes / dirty runtime
4. Errors
   - refresh errors / failed batches / stale markers / manual rebind list

### 4.2. Кнопки

Текущие action buttons по управлению runtime лучше сохранить, но добавить отдельный ряд view navigation:
1. Обзор
2. Покрытие
3. Активность
4. Ошибки
5. Назад

Текущие operational buttons оставить:
1. Обновить
2. Синк сейчас
3. Сохранить runtime
4. Обновить профили
5. Очистить старые ошибки обновления

### 4.3. Что не надо делать

Не стоит в первой итерации:
1. переносить panel summary в welcome-bot.js;
2. добавлять тяжёлые live DB scans вне текущего snapshot path;
3. прятать ручные runtime actions за modal flow;
4. делать сложную фильтрацию через текстовый ввод;
5. делать stateful pagination без явной нужды.

Сначала нужно сделать panel truth понятной, а потом уже расширять drilldown.

---

## 5. Какие данные нужно добавить в snapshot

### 5.1. В getRobloxStatsPanelSnapshot

Нужно добавить явные totals:
1. footprintUsers
2. verifiedTrackableUsers
3. verifiedRepairableUsers
4. verifiedManualOnlyUsers
5. verifiedSeenInJjsUsers
6. verifiedNeverSeenInJjsUsers
7. verifiedZeroMinuteUsers
8. refreshErrorUsers
9. neverRefreshedVerifiedUsers
10. activeJjsUsers
11. dirtyRuntimeUsers
12. activeCoPlayPairs

### 5.2. На уровне entry

Для каждого entry стоит вычислять не только note, но и нормализованные поля:
1. trackingState
   - trackable
   - repairable
   - manual_only
   - pending
   - failed
2. trackingBlocker
   - invalid_user_id
   - missing_username
   - refresh_error
   - never_refreshed
   - zero_minutes
   - none
3. activityState
   - active_now
   - seen_before
   - never_seen
   - stale_session_marker
4. displayReason
   - короткий готовый текст для UI

### 5.3. На уровне job summaries

Есть смысл расширить playtime summary так, чтобы панель видела не только batches, но и repair outcome:
1. repairedBindingCount
2. unresolvedBindingCount
3. failedRepairBatchCount
4. sanitizedBindingCount

Это позволит панели не просто говорить “нет кандидатов”, а объяснять:
1. сколько verified починились автоматически;
2. сколько остались без repair;
3. сколько ушли в manual-only bucket.

---

## 6. Порядок реализации

### Этап 1. Snapshot refactor без смены UI

Что сделать:
1. расширить collectRobloxPanelEntries / getRobloxStatsPanelSnapshot;
2. ввести явные coverage bucket-ы;
3. добавить entry-level trackingState / trackingBlocker / activityState;
4. не менять пока кнопки и общий layout.

Результат:
1. панель уже сможет считать нужные bucket-ы;
2. тесты смогут закрепить новую truth-model отдельно от визуала.

### Этап 2. Расширить runtime summary для repair truth

Что сделать:
1. вернуть из runRobloxPlaytimeSyncJob агрегаты repair/sanitize;
2. прокинуть их в panel telemetry summary;
3. добавить тесты в tests/roblox-jobs.test.js и tests/roblox-panel.test.js.

Результат:
1. panel сможет честно показывать, сколько binding-ов самоисправилось;
2. исчезнет blind spot между runtime repair и panel UX.

### Этап 3. Пересобрать panel payload на view modes

Что сделать:
1. разделить panel payload на Overview / Coverage / Activity / Errors;
2. сохранить текущие manual action buttons;
3. заменить общий “Кого проверить первым” на bucket-specific lists;
4. добавить overflow counters вида “+N ещё”.

Результат:
1. модератор за один экран видит либо coverage, либо activity, либо errors без каши;
2. top lists перестают смешивать активных пользователей и поломанные binding-и.

### Этап 4. Добавить operator-friendly error drilldown

Что сделать:
1. указывать usernames/displayNames для repairable и manual-only bucket-ов;
2. указывать конкретных людей с refreshError;
3. отдельно показывать users with valid verified binding but no seen-in-JJS history.

Результат:
1. панель отвечает не только “ошибка есть”, но и “с кем именно”.

### Этап 5. Production smoke and data verification

Что проверить после rollout:
1. панель на живом боте показывает trackable / repairable / manual-only bucket-ы;
2. цифры в панели совпадают с live DB выборкой;
3. ручной playtime sync меняет panel truth ожидаемым образом;
4. refresh/flush buttons не ломают view navigation;
5. known broken profiles попадают в правильный bucket.

---

## 7. Acceptance criteria

План можно считать реализованным, когда панель отвечает на эти вопросы без внешней DB-диагностики:
1. сколько verified Roblox-профилей реально trackable прямо сейчас;
2. сколько verified сломаны, но repairable по username;
3. сколько verified требуют manual rebind;
4. кто именно входит в эти группы;
5. сколько valid verified пользователей уже были замечены в JJS, а сколько ещё ни разу нет;
6. есть ли сейчас runtime/refresh/playtime blocker, и какой он именно.

Если хотя бы один из этих вопросов всё ещё требует отдельно лезть в Railway DB, задача не доведена.

---

## 8. Рекомендуемый первый implementation slice

Если делать это без широкого расползания, первый самый выгодный slice такой:
1. расширить snapshot totals в src/integrations/roblox-panel.js;
2. добавить verifiedTrackable / verifiedRepairable / verifiedManualOnly;
3. заменить текущий блок “Профили” на coverage funnel;
4. заменить текущий top-list на две явные короткие секции:
   - auto-repair candidates
   - manual-rebind required
5. покрыть это tests/roblox-panel.test.js.

Это уже даст модератору ответ на главный production вопрос: “кто вообще считается, кто не считается и почему”.
