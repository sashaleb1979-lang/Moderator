# Аудит: восстановление канонических ролей персонажей в онбординге

Дата: 03.05.2026

Цель этого файла: зафиксировать в одном месте, с какой болью пользователь пришёл именно по линии онбординга и ролей персонажей, что удалось установить по коду и по production state, какие изменения уже внесены, что реально восстановлено в живом боте, где система всё ещё держится на эвристиках, и что следующему сильному агенту нужно добить дальше.

Этот документ не является changelog-коммитом. Это техническая handoff-записка по конкретной ветке работ: canonical character roles -> onboarding picker -> main selection -> runtime role sync.

Этот документ дополняет CHARACTER_ROLE_TIERLIST_AUDIT.md. Тот файл больше про общую архитектурную аварию вокруг character roles, text tierlist и cluster layer. Этот файл уже узко про то, что делалось по восстановлению канонических ролей в онбординге и в live role mapping.

## 1. С чем пользователь пришёл

Пользователь жаловался не только на пустой picker, а на следующую связку дефектов:

1. Бот перестал использовать старые реально живущие роли персонажей на сервере.
2. Вместо этого role architecture разъехалась с серверной реальностью.
3. Кнопка получения роли приводила либо к ручному modal, либо к пустому сообщению "Нет доступных персонажей".
4. Пользователь уже вручную удалил часть мусорных ролей и хотел, чтобы бот нашёл и вернул именно оставшиеся правильные роли.
5. Отдельно была жёсткая UX-требование: picker должен быть чистым, показывать существующие роли/персонажей сервера и не исчезать из-за дырявого mapping.

Итоговая формулировка задачи по смыслу была такой:

- восстановить canonical Discord roles персонажей как источник правды для onboarding;
- вернуть видимый picker мейнов;
- перестать завязывать всю систему на exact match между английскими label из bot.config.json и текущими именами ролей сервера;
- дать сильному агенту понятный снимок текущего прод-состояния и уже внесённых фиксов.

## 2. Что было установлено по коду до фиксов

### 2.1. Главный провал был не в UI, а в source of truth

До фиксов code-path выглядел так:

1. getManagedCharacterCatalog брал базовые characters из bot.config.json.
2. getCharacterEntries собирал entries через buildManagedCharacterEntries.
3. getCharacterPickerEntries фильтровал entries и оставлял только те, где уже есть непустой roleId.
4. Если roleId не находился, buildMainsPickerPayload не рендерил select и отвечал пустой ошибкой.

То есть фактическая причина исчезновения picker была такой:

- потерялся mapping characterId -> roleId;
- picker был завязан на существование roleId заранее;
- в результате он скрывал сам список персонажей вместо того, чтобы показать его и отдельно сообщить, что конкретная роль ещё не восстановлена.

### 2.2. Exact role-name match был слишком хрупким

Основной reconcile path жил в welcome-bot.js в reconcileCharacterRolesFromGuild.

До расширения recovery он в значительной степени исходил из предположения:

- role.name на сервере должен совпадать с label персонажа.

На реальном сервере это не выполнялось, потому что:

1. В bot.config.json были английские archetype label: Honored One, Vessel, Ten Shadows и т.д.
2. На сервере реальные канонические роли имели живые названия вроде Годжо, Юджи, Мегуми, Хакари, Чосо, Тодо, Махито, Ханами и т.д.
3. Из-за этого exact name lookup системно не находил роль даже тогда, когда правильная роль реально существовала и была массово выдана участникам.

### 2.3. Historical data было недостаточно само по себе

В коде уже существовал слой historical role recovery:

- profile.mainCharacterIds + profile.characterRoleIds
- submission.mainCharacterIds + submission.mainRoleIds

Но на production data оказалось, что этого недостаточно:

1. У большей части персонажей historical evidence вообще отсутствовало.
2. По одному персонажу были ambiguous пересечения.
3. Чистого overlap-based recovery хватало только на малую часть реального канонического набора.

Итог: одного historical recovery недостаточно, если production база уже успела загрязниться или потерять связность.

## 3. Что конкретно было реализовано

### 3.1. Вынесен чистый overlap-based recovery helper

В src/integrations/character-role-catalog.js добавлены:

1. buildHistoricalManagedCharacterUserIds
2. buildManagedCharacterRoleRecoveryPlan

Эти helper-ы делают следующее:

- строят historical набор userId по каждому stable characterId;
- принимают guild role candidates с holder list;
- считают overlap между живыми role holders и historical user evidence;
- выбирают confident mapping;
- отдельно отдают ambiguous и unresolved entries.

Это важно потому, что recovery logic перестала быть размазанной только по welcome-bot.js и получила отдельный testable слой.

### 3.2. Picker перестал исчезать из-за пустого roleId

В welcome-bot.js getCharacterPickerEntries больше не скрывает entries только из-за отсутствия roleId.

Идея изменения:

1. picker всегда показывает managed characters;
2. при подтверждении выбора бот делает дополнительную попытку ensureManagedRoles;
3. если конкретная выбранная роль всё ещё unresolved, пользователь получает уже явную ошибку на confirm path, а не пустую панель.

Практический эффект:

- пользователь снова видит список персонажей;
- проблема смещена в корректную точку UX: confirm/apply path.

### 3.3. Введён persisted слой живых server labels

В db.config.generatedRoles добавлено поле:

- characterLabels

Теперь после успешного reconcile бот сохраняет не только roleId, но и реальное имя найденной серверной роли.

Это затем используется в getManagedCharacterCatalog.

Практический эффект:

1. picker начинает показывать реальные названия ролей сервера, а не старые английские archetype label.
2. runtime UI выравнивается с тем, что пользователь реально видит в Discord.

### 3.4. Введён явный alias-layer для канонических ролей сервера

Ключевая production-правка была не в overlap alone, а в явной карте alias-имён:

- honored_one -> Годжо
- vessel -> Юджи
- restless_gambler -> Хакари
- ten_shadows -> Мегуми
- perfection -> Махито
- blood_manipulator -> Чосо
- switcher -> Тодо
- defense_attorney -> Хигурума / Хигурама
- cursed_partners -> Юта
- head_of_the_hei -> Наоя / Наобито
- puppet_master -> Мехамару
- salaryman -> Нанами
- locust_guy -> Локуст Гай / Локуст
- star_rage -> Юки
- lucky_coward -> Харута
- disaster_plants -> Ханами
- crow_charmer -> Мэй Мэй / варианты написания
- ryu -> Рю

Это зашито в welcome-bot.js как MANAGED_CHARACTER_ROLE_NAME_ALIASES.

Смысл этой карты:

- если historical data недостаточно,
- но на сервере уже есть живая каноническая роль с известным именем,
- бот может найти её без разрушения existing architecture.

### 3.5. Recovery-candidate pool очищен от очевидного мусора

Дополнительно был введён фильтр non-character role names, чтобы recovery не путал character roles с:

- tier roles типа 0-1к / 1к-3к / 11к+
- клановыми ролями
- админскими ролями
- ивентными ролями
- прочими несвязанными guild roles

Это критично, потому что на production overlap иначе начинал путать персонажа с tier role или посторонней социальной ролью.

### 3.6. Startup и moderator sync теперь реально запускают recovery

ensureManagedRoles теперь:

1. вызывает reconcileCharacterRolesFromGuild;
2. получает recoveryPlan;
3. сохраняет найденные role ids и live labels;
4. отдаёт расширенную статистику: resolved / recovered / ambiguous / unresolved.

Moderator panel button panel_sync_roles теперь запускает уже не только tier sync, но и managed character recovery.

### 3.7. Добавлены тесты

В tests/character-role-catalog.test.js добавлены узкие проверки на:

1. buildHistoricalManagedCharacterUserIds
2. buildManagedCharacterRoleRecoveryPlan
3. recovery success case
4. ambiguity case

Все тесты по проекту на момент последнего прогона были зелёными: 89/89.

## 4. Что реально произошло в production

### 4.1. Git и deploy

Ключевые коммиты по этой линии:

1. c38ba2c — основной recovery layer
2. acecca4 — alias-based mapping по живым server role names
3. f673cfc — фикc опечатки в alias key для crow_charmer

Финальный GitHub main на момент этой записки:

- f673cfc

Финальный Railway deployment на момент этой записки:

- fa0061d9-a41a-4492-bb68-3edc30d440bc

### 4.2. Финальное live состояние после последнего deploy

По latest production DB после последнего запуска:

1. generatedRoles.characters содержит 18 восстановленных маппингов.
2. generatedRoles.characterLabels содержит 18 живых display labels.
3. По bot.config.json остался только один неразрешённый characterId:

- aspiring_mangaka

То есть фактически восстановлено 18 из 19 managed characters.

### 4.3. Startup summary в latest logs

Latest startup logs после финального деплоя дали такую строку:

- Managed roles ready. Characters: 0, resolved: 18, recovered: 17, ambiguous: 0, unresolved: 2, tiers: 0

Здесь есть важная особенность:

1. live DB показывает только один реально отсутствующий mapping: aspiring_mangaka
2. startup summary пишет unresolved: 2

Это означает, что return semantics / counting semantics у ensureManagedRoles и реального persisted state не полностью совпадают.

Сильному агенту нужно перепроверить, почему unresolved counter больше, чем финальный missing set в persisted generatedRoles.characters.

Это не блокирует текущую работоспособность picker, но это диагностический долг.

### 4.4. Что уже должно работать user-facing

После последних правок ожидается такое поведение:

1. picker больше не исчезает только из-за пустого roleId;
2. picker должен показывать реальные названия живых серверных ролей;
3. main selection должен работать для 18 восстановленных персонажей;
4. если пользователь выберет unresolved entry, ошибка должна быть явной и адресной, а не в виде пустого состояния.

## 5. Что всё ещё остаётся рискованным

### 5.1. Один characterId всё ещё unresolved

На момент этой записки unresolved остаётся:

- aspiring_mangaka

С высокой вероятностью это либо:

1. реально отсутствующая каноническая role на сервере,
2. либо роль существует, но её текущее имя не внесено в alias table,
3. либо для неё нет достаточно historical evidence.

### 5.2. Recovery всё ещё partly heuristic

Несмотря на улучшения, система всё ещё не дошла до fully explicit canonical mapping table.

Сейчас она опирается на комбинацию:

1. configured roleId
2. historical roleId
3. generated roleId
4. overlap-based recovery
5. alias-based known role names

Это уже сильно лучше, чем было, но всё ещё не абсолютно строгий source of truth.

### 5.3. Есть счётчик unresolved, который не полностью совпадает с persisted state

Это уже описано выше, но стоит повторить как отдельный риск:

- runtime summary и финальный persisted mapping дают слегка разную картину.

Это диагностический запах, который сильный агент должен проверить до конца.

### 5.4. В логах всё ещё живёт отдельный unrelated дефект

В latest startup logs оставалась строка:

- [characters-ranking] failed to resolve tierlist clusters: Assignment to constant variable.

Это не относится напрямую к моему recovery-треку, но для общего handoff важно: рядом с role recovery в проде всё ещё живёт соседний дефект tierlist/clusters layer.

## 6. Что именно нужно сильному агенту смотреть дальше

### 6.1. Сначала добить последний unresolved character

Первый практический шаг:

1. определить, какая живая Discord role должна соответствовать aspiring_mangaka;
2. если роль существует, добавить её имя в alias table или сделать более надёжный canonical mapping path;
3. если роли реально нет, решить, должен ли этот characterId оставаться в managed onboarding catalog.

### 6.2. Проверить расхождение unresolved counter vs persisted state

Сильному агенту стоит пройти по:

1. reconcileCharacterRolesFromGuild
2. ensureManagedRoles
3. recoveryPlan.unresolved
4. финальному сохранению generatedRoles.characters

Нужно установить, почему runtime log пишет unresolved: 2, хотя в persisted state missing set уже только один.

### 6.3. Решить, нужен ли следующий шаг: explicit canonical mapping table

Сейчас alias-layer работает, но это всё ещё hardcoded knowledge.

Более чистый следующий шаг:

1. хранить отдельную подтверждённую canonical mapping table;
2. не угадывать повторно по overlap/alias после того, как mapping уже подтверждён;
3. дать модератору diagnostic/admin surface, где видно весь список characterId -> live role name -> live role id.

### 6.4. Smoke-check уже не по коду, а по Discord UX

После этого handoff сильному агенту важно сделать не только code inspection, но и live smoke-check:

1. нажать welcome button;
2. убедиться, что select реально показывает серверные role labels;
3. проверить quick mains;
4. проверить confirm path на resolved entry;
5. отдельно проверить поведение unresolved entry.

## 7. Ключевые точки кода

Ниже список центральных символов и якорей, которые стоит открыть первыми:

1. welcome-bot.js
   - MANAGED_CHARACTER_ROLE_NAME_ALIASES
   - getManagedCharacterCatalog
   - getCharacterPickerEntries
   - completeMainSelection
   - buildGuildCharacterRoleCandidates
   - reconcileCharacterRolesFromGuild
   - panel_sync_roles handler
   - startup log around Managed roles ready

2. src/integrations/character-role-catalog.js
   - buildHistoricalManagedCharacterUserIds
   - buildManagedCharacterRoleRecoveryPlan

3. tests/character-role-catalog.test.js
   - recovery success / ambiguity tests

## 8. Краткий вывод

По моей линии работы ситуация уже не в состоянии "бот вообще не знает, какие роли персонажей правильные".

Удалось:

1. вернуть picker как UI-слой;
2. восстановить большую часть канонических ролей по живым серверным данным;
3. перевести picker на реальные server labels;
4. встроить recovery в startup и moderator sync flow;
5. довести production до состояния 18 из 19 восстановленных role mappings.

Главный незакрытый остаток:

1. aspiring_mangaka всё ещё unresolved;
2. unresolved counter в startup summary требует дополнительной перепроверки;
3. alias-layer всё ещё временно выполняет роль canonical mapping table.

Если сильный агент возьмёт этот файл вместе с CHARACTER_ROLE_TIERLIST_AUDIT.md, у него уже будет две раздельные handoff-плоскости:

1. общая архитектурная авария вокруг character roles / tierlist / cluster layer;
2. мой конкретный recovery-трек по onboarding picker и canonical character-role restore.