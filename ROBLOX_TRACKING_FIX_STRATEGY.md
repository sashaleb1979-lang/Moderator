# Roblox Tracking Fix Strategy

Дата: 17.05.2026

Основание:

- [ROBLOX_TRACKING_SYSTEM_MAP.md](ROBLOX_TRACKING_SYSTEM_MAP.md)
- [ROBLOX_TRACKING_CHECKLIST_AUDIT.md](ROBLOX_TRACKING_CHECKLIST_AUDIT.md)

Статус: план исправления по current main, без broad rewrite.

## 1. Конспект в одну страницу

Главная мысль после аудита простая:

- Roblox tracking не надо переписывать с нуля;
- ядро уже существует и в целом работает;
- ломается не сама базовая идея, а стыки между слоями;
- поэтому лучший путь не "большой рефакторинг Roblox", а серия узких фаз с жёстким порядком.

Если совсем коротко, то правильная последовательность такая:

1. сначала вернуть живую корректность hot path;
2. затем поднять trackability и health в canonical summary;
3. затем вернуть оператору минимальную, но честную диагностику;
4. затем выровнять consumer-ы на одном helper usable Roblox identity;
5. затем уже трогать flush hardening, refresh policy и cleanup.

Это важно, потому что текущая проблема не в том, что данных мало.
Проблема в том, что:

- часть truth живёт в runtime, но не доходит в UI;
- часть capability живёт в модуле, но не wired в main;
- часть consumer-ов понимает trusted Roblox identity по-разному;
- часть operator signal умерла после упрощения панели.

Правильная цель не "сделать Roblox-систему красивой".
Правильная цель такая:

- live wiring должно совпасть с тем, что обещает модуль;
- summary должно стать каноническим носителем trackability truth;
- panel должна показывать понятный ответ и короткую диагностику;
- consumer-ы должны перестать invent-ить свою Roblox truth.

## 2. Базовые правила исправления

### 2.1. Что не делать

- Не делать broad rewrite [welcome-bot.js](welcome-bot.js).
- Не возвращать старую сложную multi-view панель как основное решение.
- Не переносить canonical truth в panel read-side.
- Не смешивать hotfix live correctness и schema cleanup в один проход.
- Не вычищать compat paths, пока replacement path не green и не проверен на живом runtime.

### 2.2. Что считать owner-ами

- [src/integrations/shared-profile.js](src/integrations/shared-profile.js): canonical Roblox domain и summary.
- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js): verified candidates, repair, presence sync, session accounting, runtime dirty truth.
- [src/integrations/roblox-panel.js](src/integrations/roblox-panel.js): только read-side projection и operator UI.
- [welcome-bot.js](welcome-bot.js): wiring, callbacks, live composition, но не место для новой business-логики.

### 2.3. Критерий хорошего исправления

Исправление считается хорошим, если оно:

- чинит root cause, а не косметику;
- даёт одну новую каноническую truth вместо ещё одной локальной классификации;
- уменьшает число мест, где Roblox состояние трактуется по-разному;
- проходит узкую валидацию сразу после изменения;
- не ухудшает читаемость панели для модератора.

## 3. Умный порядок работ

### Фаза 1. Вернуть живую корректность hot path

Цель:

- устранить главное противоречие: runtime repair есть, но scheduled live path им не пользуется.

Почему это первая фаза:

- пока live wiring не совпадает с модулем, всё остальное будет строиться на ложной картине;
- это самая дешёвая и самая критичная правка по ROI.

Что менять:

- [welcome-bot.js](welcome-bot.js)

Что конкретно делать:

1. В scheduled `syncRobloxPlaytime` прокинуть `fetchUsersByUsernames` в `runRobloxPlaytimeSyncJob()`.
2. Проверить, что в manual path и scheduled path одинаковый набор Roblox API callbacks там, где это нужно.
3. Не трогать panel UX и schema в этой фазе.

Почему это безопасно:

- логика repair уже существует в [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js);
- тесты на неё уже есть;
- нужно только выровнять live wiring.

Что валидировать:

1. `tests/roblox-jobs.test.js`
2. если потребуется, узкий smoke на запуск scheduled sync path
3. затем полный активный suite

Definition of done:

- scheduled sync реально использует username-repair;
- audit finding про dead repair path закрыт;
- live wiring и модульная capability больше не противоречат друг другу.

### Фаза 2. Поднять trackability в canonical summary

Цель:

- перестать вычислять ключевую truth о trackability только в panel read-side.

Почему это вторая фаза:

- пока canonical summary не умеет говорить "verified, но не trackable, потому что ...", panel, antiteam и другие consumer-ы будут продолжать собирать свою правду локально.

Что менять:

- [src/integrations/shared-profile.js](src/integrations/shared-profile.js)
- минимально затронуть consumer-ы только после появления новых summary-полей

Лучший практический дизайн для этой фазы:

- не вводить сразу новый огромный модуль;
- добавить в `summary.roblox` компактный derived object, например `tracking` или `trackingState`.

Что должно появиться в summary:

1. `isTrackableForPlaytime`
2. `trackingState`
3. `trackingBlocker`
4. `hasEverSeenInJjs`
5. `refreshHealth`
6. `playtimeHealth`

Минимально полезная форма:

- `trackingState`: `trackable | repairable | manual_only | pending | failed | unverified`
- `trackingBlocker`: `none | invalid_user_id | missing_username | refresh_error | never_refreshed | jjs_not_configured | zero_minutes`

Почему это лучший ход:

- panel станет тоньше;
- consumer-ы начнут читать одну и ту же truth;
- исчезнет часть разъезда между summary, runtime и operator UI.

Что не делать в этой фазе:

- не распиливать весь Roblox domain на четыре новых вложенных объекта сразу;
- не тащить runtime-only поля в persisted schema без необходимости.

Что валидировать:

1. `tests/shared-profile.test.js`
2. `tests/profile-model.test.js`
3. `tests/profile-synergy.test.js`
4. любые panel tests, которые зависят от нового summary contract

Definition of done:

- canonical summary сам отвечает, trackable ли verified-профиль;
- panel больше не обязана быть владельцем этих определений.

### Фаза 3. Вернуть оператору честную диагностику без возврата к старой перегрузке

Цель:

- сохранить понятный основной экран, но вернуть минимальный debug/health слой.

Почему это третья фаза:

- после фазы 2 уже будет каноническая truth;
- тогда можно строить компактную диагностику без дублирования логики.

Что менять:

- [src/integrations/roblox-panel.js](src/integrations/roblox-panel.js)

Какой UX лучше всего подходит:

- не возвращать старую multi-view навигацию;
- оставить основной экран простым списком verified-профилей;
- добавить один компактный secondary diagnostics path.

Лучшие UX-идеи здесь:

#### Идея A. Двухэкранная модель

- Экран 1: основной список verified пользователей с `✓/—`
- Экран 2: краткая диагностика

Плюсы:

- сохраняет читаемость;
- не раздувает main view;
- даёт оператору доступ к health truth.

Это лучший баланс для текущего запроса пользователя.

#### Идея B. Один экран + один diagnostics field

- основной список остаётся;
- снизу короткий field с 4-6 ключевыми проблемами.

Плюсы:

- ещё проще в routing;
- меньше кнопок.

Минусы:

- мало места для repairable/manual-only/dirty cases.

Практический выбор:

- если нужен абсолютный минимум риска, сначала делать Идею B;
- если нужен операторский контроль, но без старого монстра, делать Идею A.

Что именно должно вернуться в operator truth:

1. JJS config выключен или не настроен
2. failed batches
3. refresh errors
4. repairable count
5. manual-only count
6. dirty runtime count
7. last flush status

Что важно:

- эти данные уже считаются;
- нужно вернуть не ещё одну математику, а короткий UI к уже существующему snapshot.

Definition of done:

- модератор видит не только список verified, но и короткий честный health state;
- при этом панель не превращается обратно в лабиринт из 5 рядов кнопок.

### Фаза 4. Свести consumer-ов к одному helper usable Roblox identity

Цель:

- убрать локальные версии trust logic в antiteam/onboarding/profile consumers.

Почему это только четвёртая фаза:

- сначала нужен канонический summary contract;
- потом уже можно заставлять consumer-ы читать его одинаково.

Что менять:

- [src/integrations/shared-profile.js](src/integrations/shared-profile.js) или тонкий helper рядом с ним
- [src/antiteam/operator.js](src/antiteam/operator.js)
- [src/onboard/roblox-identity.js](src/onboard/roblox-identity.js)
- при необходимости profile/other consumer-ы

Лучший дизайн:

- не копировать trust logic по модулям;
- сделать один helper вроде `isUsableVerifiedRobloxIdentity(summary.roblox)` или `resolveRobloxIdentityUsability(summary.roblox)`.

Почему это лучше всего:

- antiteam сейчас всё ещё имеет свою trust/fallback логику;
- onboarding имеет свою lock logic;
- profile и summary уже знают `hasVerifiedAccount`.

Все они должны опираться на один derived contract, а не на три версии правды.

Definition of done:

- antiteam, onboarding и другие consumer-ы используют один helper usable/trusted Roblox identity;
- больше нет скрытого разъезда в трактовке trusted account.

### Фаза 5. Укрепить runtime dirty/flush story

Цель:

- сделать flush truth не только существующей, но и объяснимой.

Почему это пятая фаза:

- это уже не самый быстрый ROI;
- но без этого сложно честно отвечать, что именно уже в памяти, а что ещё не в DB.

Что менять:

- [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js)
- возможно [welcome-bot.js](welcome-bot.js) только на уровне wiring
- [src/integrations/roblox-panel.js](src/integrations/roblox-panel.js) только read-side

Лучшие идеи здесь:

#### Идея A. Dirty reasons в runtime state

Добавить к dirty truth не только Set userIds, но и причины:

- `binding_repaired`
- `playtime_updated`
- `session_closed`
- `coplay_updated`
- `refresh_updated`

Плюсы:

- оператор и отладка сразу понимают, что именно pending;
- проще строить flush diagnostics.

#### Идея B. Serialized flush seam

Сейчас flush опирается на plain `saveDb()`.
Лучший вариант:

- либо провести Roblox flush через общий serialized DB task/seam;
- либо хотя бы сделать отдельный documented guarantee, что Roblox flush запускается только под coordinator и поэтому считается безопасным best-effort path.

Практически лучший ход:

- сначала ввести dirty reasons;
- потом решить, нужен ли полный serialized flush rewrite.

Почему не надо сразу делать большой rewrite:

- flush уже работает;
- главный дефицит сейчас не столько correctness, сколько объяснимость и гарантия границ.

Definition of done:

- оператор может понять, какие Roblox-профили dirty и почему;
- flush truth больше не выглядит как чёрный ящик.

### Фаза 6. Принять продуктовые решения по refresh policy и matching semantics

Цель:

- убрать подвешенные архитектурные полуправды.

Сюда входят:

1. решить, metadata refresh по умолчанию должен быть реально включён или он optional enrichment;
2. зафиксировать JJS matching precedence;
3. зафиксировать роль opaque fallback;
4. добавить drift guards для proof snapshots.

Почему это не надо делать раньше:

- это важные решения, но они не блокируют немедленное выравнивание live correctness.

Definition of done:

- больше нет размытых обещаний вроде "refresh как бы есть", если он фактически выключен;
- matching semantics можно объяснить без чтения исходников.

### Фаза 7. Cleanup только после стабилизации

Цель:

- убрать мёртвые compat promises и лишнюю сложность после того, как replacement path стабилен.

Что сюда входит:

1. удалить старые legacy/scoped panel paths, которые больше не нужны;
2. вычистить скрытые локальные trust rules в consumer-ах;
3. при необходимости аккуратно распилить Roblox domain на более явные sub-sections.

Что важно:

- cleanup не должен идти до фаз 1-4;
- иначе можно убрать старую страховку раньше, чем новая truth реально закрепилась.

## 4. Лучшие идеи, которые реально дают максимум пользы

### Идея 1. Не новый монолит, а `summary.roblox.tracking`

Это лучший следующий шаг по архитектуре.

Почему:

- не требует нового большого owner seam;
- сразу уменьшает дублирование логики;
- делает panel и consumer-ы тоньше.

Что туда стоит положить:

- `isTrackableForPlaytime`
- `trackingState`
- `trackingBlocker`
- `hasEverSeenInJjs`
- `refreshHealth`
- `playtimeHealth`

### Идея 2. Суперпростая панель + отдельная диагностика

Это лучший UX-компромисс.

Почему:

- пользователь уже сказал, что сложный UI не нужен;
- но полный отказ от health truth тоже делает систему слепой;
- значит нужен не "богатый пульт", а "простой список + один debug вход".

### Идея 3. Один helper usable identity для всех consumer-ов

Это лучший способ прибить класс багов, где один модуль считает аккаунт usable, а другой нет.

Почему:

- это маленькая правка с большим системным эффектом;
- она сразу уменьшает разъезд между antiteam, onboarding и profile logic.

### Идея 4. Dirty reasons вместо абстрактного dirty count

Это лучший next step для observability.

Почему:

- счётчик dirty users уже есть, но он почти бесполезен без причины;
- dirty reasons дадут и operator пользу, и debug пользу, и future panel value.

### Идея 5. Repair report как operator tool, а не как скрытая магия

Лучший recovery UX:

- не просто silently repair;
- а уметь показать:
- кого починили;
- кто остался repairable;
- кто manual-only;
- почему.

Это особенно важно после того, как hot path снова начнёт реально использовать username-repair.

## 5. File-by-file конспект правок

### [welcome-bot.js](welcome-bot.js)

Исправлять здесь только:

- live wiring для scheduled playtime sync;
- при необходимости wiring для flush guarantees.

Не тащить сюда:

- новую trackability математику;
- panel-derived classification;
- consumer trust rules.

### [src/integrations/shared-profile.js](src/integrations/shared-profile.js)

Здесь должен появиться канонический derived слой для trackability и usable identity.

Это лучший кандидат для:

- `summary.roblox.tracking`
- helper usable identity
- future refresh/playtime health fields

### [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js)

Здесь остаётся owner для:

- candidate selection
- repair
- presence sync
- session accounting
- dirty reasons
- runtime telemetry

Не стоит переносить это в panel или в welcome-bot.

### [src/integrations/roblox-panel.js](src/integrations/roblox-panel.js)

Исправлять здесь только:

- компактный diagnostics read-side;
- отображение canonical summary truth;
- recovery/debug presentation.

Не делать здесь новым owner-ом trackability.

### [src/antiteam/operator.js](src/antiteam/operator.js)

Перевести на один helper usable identity после появления canonical contract.

### [src/onboard/roblox-identity.js](src/onboard/roblox-identity.js)

Оставить owner-ом lock behavior, но основание для trust брать из общего helper, а не из локальной версии truth.

## 6. В каком порядке это лучше реально делать

Самый умный practical order:

1. hot path repair wiring
2. canonical trackability summary
3. compact operator diagnostics
4. shared usable identity helper
5. dirty reasons + flush story
6. refresh policy / matching semantics
7. cleanup

Почему именно так:

- каждая следующая фаза зависит от правды, закреплённой в предыдущей;
- это минимизирует локальные откаты и спор между слоями;
- это не требует влезать в слишком много файлов сразу.

## 7. Лучший минимальный набор задач на ближайший цикл

Если брать только самый правильный короткий цикл, то он должен быть таким:

### Срез 1

- починить live username-repair wiring

### Срез 2

- добавить `isTrackableForPlaytime` и `trackingBlocker` в `summary.roblox`

### Срез 3

- вернуть в панель компактный diagnostics block или diagnostics screen

### Срез 4

- свести antiteam/onboarding на один usable identity helper

Это даст максимальный системный эффект без нового архитектурного взрыва.

## 8. Что будет признаком, что система реально стала лучше

Система считается реально поправленной, когда:

1. verified user с битым userId может auto-repair-нуться без ручного шаманства;
2. любой consumer отвечает одинаково на вопрос "этот Roblox account usable или нет";
3. panel честно показывает не только список verified, но и почему tracking может не идти;
4. canonical summary сам несёт trackability truth;
5. dirty/runtime/flush story объяснима оператору;
6. выключенный refresh больше не выглядит как "как будто всё ок";
7. удалить старые compat paths можно без страха, потому что новый path реально green.

## 9. Финальный приговор по стратегии

Лучший способ исправить Roblox tracking сейчас — не строить новую большую систему, а сделать пять точных совпадений:

- wiring должно совпасть с модульной capability;
- summary должно совпасть с runtime truth;
- panel должно совпасть с тем, что реально нужно оператору;
- consumer-ы должны совпасть по критерию usable identity;
- flush/dirty story должна совпасть с тем, что реально происходит в памяти и в DB.

Когда эти совпадения появятся, вся система станет не просто "менее кривой", а предсказуемой.

Именно предсказуемость здесь важнее любой косметики.