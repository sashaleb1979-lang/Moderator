# Спецификация Расчётов Профильной Синергии

Статус: обязательный companion-файл для всех phase-работ по synergy-системе профиля.

Правило ведения:
1. Если новая synergy-метрика или derived block появились в коде, но не описаны здесь, работа не считается завершённой.
2. Для каждой метрики нужно фиксировать не только формулу, но и owner, source path, persisted shape и честные условия ненадёжности.
3. UI не должен притворяться точным там, где источник неполный или свежесть данных сомнительна.

---

## 1. Система Маркировки Надёжности

### `reliable`
Метрика может показываться как обычный факт без специального warning copy.

### `partial`
Метрика основана на неполной истории или на истории, которая начала копиться только после релиза новой телеметрии.

### `stale`
Метрика построена из старых данных, которые могли устареть по freshness window.

### `inferred`
Метрика не наблюдается напрямую и строится через эвристику или косвенный сигнал.

### `unavailable`
Для метрики сейчас нет достаточного источника или накопленного объёма данных.

### `debuffed`
Метрика всё ещё видна пользователю, но её вклад в composite-оценку ослаблен из-за устаревания, дыр в coverage или слабой базы.

### Обязательный Контракт Для Relative-Метрик
1. Каждая server-relative метрика должна иметь не только raw value, но и confidence-state.
2. Для composite-сводок нужно хранить ещё и `influenceDebuff`, чтобы было видно, насколько сигнал ослаблен.
3. Если stale/partial сигнал показывается в буквах или seasonal-comparison блоках, UI обязан объяснять не только состояние, но и debuff к влиянию.
4. Для proof-backed kill-сигналов допустим debuff до `-90%`, если coverage плохой или approved proof сильно устарел.

### Coverage Contract
1. Для метрик, которые зависят от истории, нужно считать не только значение, но и покрытие.
2. Минимальный набор coverage-полей:
  - сколько дней покрыто реальными данными,
  - сколько дней потеряно,
  - какой процент истории полный,
  - какой процент истории собран кусками.
3. Coverage обязан влиять и на copy, и на relative debuff.

---

## 2. Hourly Roblox Buckets По Москве

### Статус
Phase 1 foundation: реализовано.

### Что Это Такое
Rolling hour-level buckets по JJS playtime, собранные в московском времени.

### Зачем Нужны
Это foundation-слой для:
1. future prime time lines;
2. personal readiness по времени суток;
3. Season Story и best-period summaries.

### Owner
1. Raw collection owner: [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js)
2. Canonical normalization owner: [src/integrations/shared-profile.js](src/integrations/shared-profile.js)

### Источник Данных
1. Roblox verified account binding в `profile.domains.roblox`
2. Presence polling из Roblox runtime
3. JJS-match logic из `runRobloxPlaytimeSyncJob(...)`
4. Delta minutes между `activeSession.lastSeenAt` и текущим `nowIso`

### Когда Пишется
Только когда runtime уже признал сессию продолжением или валидным tracked JJS interval и `deltaMinutes > 0`.

### Persisted Shape
Путь:
1. `db.profiles[userId].domains.roblox.playtime.hourlyBucketsMsk`

Формат ключей:
1. `YYYY-MM-DDTHH`

Пример:
```json
{
  "2026-05-09T15": 12,
  "2026-05-09T16": 7
}
```

Смысл ключа:
1. это московский локальный час, но записанный как plain key, а не как timezone-aware ISO timestamp;
2. для будущих derived reads ключ должен трактоваться именно как MSK hour bucket.

### Формула Записи
1. Берётся `nowIso` в UTC.
2. К timestamp добавляется смещение `+03:00`.
3. Из сдвинутого времени берётся hour key `YYYY-MM-DDTHH`.
4. В bucket добавляется `deltaMinutes`.

### Retention
1. Хранится rolling окно по часовым бакетам.
2. Текущий лимит: `40 * 24` buckets.
3. Старые buckets выталкиваются по сортировке ключей.

### Ненадёжно Когда
1. `partial`: история начала копиться только после релиза этого слоя.
2. `stale`: бот не работал и runtime polling прерывался.
3. `inferred`: bucket не является прямым Roblox session log, а derived accumulation по polling intervals.
4. возможна грубость на границе часа, потому что все минуты текущего delta кладутся в hour bucket, соответствующий `nowIso`.

### UI Copy Правило
Базовый derived block `Prime time МСК` уже выведен в profile activity section через `src/profile/synergy.js`.
Текущая V1-подача:
1. best 4-hour MSK window по сумме минут из `hourlyBucketsMsk`;
2. peak single hour внутри aggregated hour-of-day totals;
3. freshness line по последнему bucket key;
4. если buckets ещё короткие, block должен честно говорить `Hourly buckets пока ещё короткие`.

Block `Prime time confidence` is now live in the activity section:
1. groups hourly buckets by ISO week;
2. computes each week's best 4-hour MSK window;
3. compares weekly windows against the global best window using 3/4 hour overlap;
4. labels stability as `stable`, `mixed` or `volatile`;
5. returns `partial` when fewer than 2 valid weeks exist.

### Ограничения Prime Time V1
1. окно пока считается по всем удержанным hourly buckets, а не по строго отдельному 7d/30d окну;
2. best window сейчас = 4 consecutive hours, это read-side heuristic, а не канонический gameplay session boundary;
3. freshness считается из plain MSK hour key через допущение UTC+03:00;
4. stale copy всё ещё обязательна, если latest bucket старый.
5. `Prime time confidence` показывает устойчивость weekly windows, а не гарантию будущего онлайна.

---

## 3. Daily Roblox Buckets

### Статус
Уже существовало до начала synergy implementation.

### Owner
1. Raw collection owner: [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js)
2. Canonical normalization owner: [src/integrations/shared-profile.js](src/integrations/shared-profile.js)

### Путь
1. `db.profiles[userId].domains.roblox.playtime.dailyBuckets`

### Формат
1. ключ `YYYY-MM-DD`
2. значение — накопленные tracked JJS minutes за UTC-day bucket

### Ненадёжно Когда
1. не было verified Roblox binding;
2. playtime tracking был выключен;
3. бот был оффлайн;
4. polling не совпал с фактическими короткими сессиями.

---

## 4. Proof-Window Snapshots

### Статус
Phase 1 foundation: write-path implemented.

### Что Это Такое
Snapshot cumulative progress facts в момент approved kills update.

### Планируемый Owner
1. Write seam рядом с approve flow в [welcome-bot.js](welcome-bot.js)
2. Выделенный helper owner: `src/profile/synergy-snapshots.js`

### Планируемый Путь
1. `db.profiles[userId].domains.progress.proofWindows`

### Планируемые Поля
1. `approvedKills`
2. `killTier`
3. `reviewedAt`
4. `reviewedBy`
5. `playtimeTracked`
6. `totalJjsMinutes`
7. `jjsMinutes7d`
8. `jjsMinutes30d`
9. `dailyBucketsSnapshot`
10. `hourlyBucketsMskSnapshot`

### Основная Ненадёжность
1. snapshot отражает то, что успел накопить Roblox runtime к моменту approve;
2. если moderation approves proof раньше, чем runtime успел добрать playtime, окно будет частично занижено.
3. если на момент approve не было verified Roblox tracking context, snapshot обязан помечаться `playtimeTracked = false` и не использоваться как надёжная Roblox-база для growth-rate метрик.

### UI Copy Правило
Если proof windows меньше двух, любые growth speed lines обязаны говорить, что история ещё недостаточна.

---

## 5. Часы С Последнего Approved Update

### Статус
Base derived metrics implemented in Phase 3 read-side seam.
Base self-progress block presentation implemented in Phase 4.

### Что Это Такое
Derived metrics `hoursSinceLastApprovedKillsUpdate` и `jjsHoursSinceLastApprovedKillsUpdate`, которые теперь входят в practical self-progress block.

### Owner
1. Derived owner: [src/profile/synergy.js](src/profile/synergy.js)
2. Read-model composition: [src/profile/model.js](src/profile/model.js)

### Источник
1. последний proof-window snapshot
2. текущее `profile.domains.roblox.playtime.totalJjsMinutes`
3. текущее время render/read-model

### Формула
`hoursSinceLastApprovedKillsUpdate = now - snapshot.reviewedAt`

`(currentTotalJjsMinutes - snapshotTotalJjsMinutes) / 60`

Для JJS-часов считать метрику только когда snapshot помечен `playtimeTracked = true`, текущая Roblox-связка всё ещё verified и current total minutes не меньше snapshot baseline.

### Ненадёжно Когда
1. нет ни одного proof-window snapshot;
2. playtime tracking стартовал после последнего approve;
3. Roblox binding был потерян или подтверждён заново между окнами.

### UI Copy Правило
Если snapshot отсутствует, использовать честный текст вроде `первый approved update ещё не зафиксирован`.

Если wall-clock metric есть, а JJS metric ненадёжен, показывать только elapsed-time line и честный fallback про Roblox-часы.

### Текущая V1-Подача
Self-progress block использует строку формата:
1. `С последнего рега: X ч по времени • Y ч JJS`
2. если JJS metric ненадёжен: `С последнего рега: X ч по времени • Roblox-часы пока ненадёжны`

---

## 6. Reminder `ОБНОВИ`

### Статус
Soft self reminder implemented in base form внутри practical self-progress block.

### Решение Для V1
Триггер: `10 JJS часов после последнего approved update`.

### Источник
Derived from `jjsHoursSinceLastApprovedKillsUpdate`.

### Ненадёжно Когда
1. нет proof-window snapshots;
2. tracking history partial;
3. verified Roblox binding неактуален.

### UI Copy Правило
1. Не писать `ты точно уже должен обновить kills`.
2. Писать мягко и честно: `Есть смысл обновить kills`.
3. Показывать только в self-view.
4. Если reminder threshold ещё не достигнут, допустим мягкий `Фокус` line без императива, завязанный на текущий pace и distance до next tier.

---

## 7. Self-Progress Block И Countdown До Целей

### Статус
Base Phase 4 implementation completed.

### Что Это Такое
Практический верхний block self-view, который собирает в одном месте:
1. зарегистрированные kills и текущий tier;
2. часы с последнего approved update;
3. последнее окно роста;
4. сравнение двух последних окон роста;
5. средний kills/JJS pace за отслеженный proof-window период;
6. countdown до следующего tier;
7. countdown до следующего milestone 20k/30k;
8. soft reminder `Есть смысл обновить kills`, если порог достигнут.

### Owner
1. Derived block owner: [src/profile/synergy.js](src/profile/synergy.js)
2. Section composition owner: [src/profile/model.js](src/profile/model.js)

### Источники
1. `profile.approvedKills`
2. `profile.killTier`
3. `profile.domains.progress.proofWindows`
4. `profile.summary.roblox.totalJjsMinutes`
5. fallback history из `recentKillChanges`, если для окна роста ещё нет двух proof-window snapshots

### Канонические Thresholds
Kill tiers:
1. Tier 2: `1000`
2. Tier 3: `3000`
3. Tier 4: `7000`
4. Tier 5: `11000`

Kill milestones:
1. `20000`
2. `30000`

### Формулы
`nextTierTarget = first threshold > approvedKills`

`nextMilestoneTarget = first milestone > approvedKills`

`growthWindows[] = latest-first series из adjacent proof windows, а при короткой proof history — с честным fallback на recentKillChanges без Roblox pace`

`latestReliableWindow = last two proof windows, только если оба playtimeTracked и cumulative totalJjsMinutes монотонны`

`windowDeltaKills = latest.approvedKills - previous.approvedKills`

`windowDeltaJjsHours = (latest.totalJjsMinutes - previous.totalJjsMinutes) / 60`

`killsPerJjsHour = windowDeltaKills / windowDeltaJjsHours`

`windowComparison = growthWindows[0] vs growthWindows[1]`

Если у обоих окон есть надёжный `killsPerJjsHour`, block пишет `последний ап X kills/ч • прошлый Y kills/ч` и короткий verdict:
1. `выше прошлого окна`, если latest pace как минимум на 15% выше previous pace;
2. `ниже прошлого окна`, если latest pace как минимум на 15% ниже previous pace;
3. `держится близко к прошлому окну`, если разница остаётся внутри этого коридора.

Если одно из двух окон ещё без надёжных Roblox-часов, comparison line обязана сказать это прямо, а не притворяться точным сравнением.

`lifetimeReliableWindows = growthWindows.filter(reliableJjs === true && jjsHours > 0)`

`lifetimePaceKillsPerJjsHour = sum(deltaKills) / sum(jjsHours)` по всем `lifetimeReliableWindows`

`estimatedJjsHoursToTarget = remainingKills / killsPerJjsHour`

Если надёжной proof-window пары ещё нет, block всё равно показывает countdown по remaining kills, но без притворной оценки по времени.

Если reliable proof windows ещё нет, lifetime pace line обязана говорить, что надёжных Roblox-часов пока мало.

### Ненадёжно Когда
1. меньше двух proof-window snapshots;
2. хотя бы один snapshot в последнем окне имеет `playtimeTracked = false`;
3. cumulative JJS baseline сломан или обнулился;
4. последнее окно собрано только из fallback approved history без Roblox-часов.

### UI Copy Правило
1. Показывать countdown по времени только если `killsPerJjsHour` надёжен и положителен.
2. Иначе писать честно: `темп ещё не накоплен`.
3. Для окна роста при отсутствии надёжных Roblox-часов писать `Roblox-часы пока ненадёжны`.
4. Для comparison line не сравнивать pace числа, если одно из окон без надёжных Roblox-часов.
5. Lifetime pace line писать как `Средний темп за отслеженный период`, но считать только по reliable proof-window окнам.
6. Между comparison и countdown допустима narrative line про стабильность/ускорение, но только если она опирается на тот же `windowComparison` state, а не на отдельную скрытую эвристику.
7. Финальная self-view line может быть либо мягким `CTA`, если reminder threshold достигнут, либо `Фокус`, если threshold ещё не достигнут.

---

## 8. Co-Play И Social Suggestions

### Статус
Top co-play peers уже существуют как source facts.
Base suggestions cache implemented for Phase 2.
Base Phase 6 read-side blocks `Roblox-друзья на сервере`, `Кто из друзей уже здесь`, `Скрытый круг`, `Проверенный круг` и `Социальная карта` are live via `src/profile/synergy.js`.

### Owner
1. Raw source facts: [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js)
2. Canonical normalized profile source: [src/integrations/shared-profile.js](src/integrations/shared-profile.js)
3. Derived read-side owner: `src/profile/synergy.js`

### Текущие Cache-Поля
1. `profile.domains.social.suggestions[].peerUserId`
2. `profile.domains.social.suggestions[].peerDisplayName`
3. `profile.domains.social.suggestions[].peerRobloxUserId`
4. `profile.domains.social.suggestions[].peerRobloxUsername`
5. `profile.domains.social.suggestions[].peerHasVerifiedRoblox`
6. `profile.domains.social.suggestions[].minutesTogether`
7. `profile.domains.social.suggestions[].sessionsTogether`
8. `profile.domains.social.suggestions[].daysTogether`
9. `profile.domains.social.suggestions[].sharedJjsSessionCount`
10. `profile.domains.social.suggestions[].lastSeenTogetherAt`
11. `profile.domains.social.suggestions[].sourceComputedAt`

### Текущий Отбор
1. только `frequent non-friend` peers;
2. Roblox-friend peers исключаются;
3. сортировка идёт по minutesTogether, затем по sharedJjsSessionCount.

### Источник
1. `profile.domains.roblox.coPlay.peers`
2. `profile.domains.roblox.serverFriends.userIds`

### Чего Нельзя Утверждать
Нельзя говорить `точный кооп`, `точная пати`, `точный отряд`.

### Разрешённая Формулировка
`часто пересекаетесь в одной JJS-сессии`

### Текущая V1-Подача
Profile social section теперь может показывать пять social derived blocks:
1. `Roblox-друзья на сервере`:
  - summary line по `serverFriendsCount`;
  - visible-overlap count через матч `summary.roblox.userId` из injected `populationProfiles` против `serverFriendsUserIds`;
  - verified / active7d / JJS7d counters;
  - freshness line по `serverFriendsComputedAt`, если она есть.
2. `Кто из друзей уже здесь`:
  - до 3 resolved overlaps;
  - Discord mention, display/Roblox label, verified marker;
  - JJS 7d minutes или activity hint, если он есть.
3. `Скрытый круг`:
  - summary line по числу frequent non-friend candidates;
  - до 3 peer lines с Discord mention, display/Roblox label, minutesTogether и shared sessions;
  - freshness line по `sourceComputedAt`, если она есть.
4. `Проверенный круг`:
  - count `verified+friend+JJS`;
  - verified friend / active 7d / JJS 7d counters;
  - top verified ties with Roblox friend marker, co-play minutes/sessions and JJS 7d minutes when available;
  - trust line with explicit `no exact party claim`.
5. `Социальная карта`:
  - strong / medium / friends here / inferred counters;
  - strong ties from Roblox friend + JJS/co-play or verified friend JJS activity;
  - medium ties from frequent non-friend co-play or active friend overlap;
  - inferred ties from `profile.domains.social.suggestions`;
  - trust line with sources `Roblox friends/co-play/social suggestions`.

Friend-overlap blocks используют уже существующие `serverFriends*` fields плюс read-side injected `populationProfiles` и не требуют нового runtime collection layer.
`Скрытый круг` использует уже существующий derived cache и тоже не требует нового runtime collection layer.

### Ненадёжно Когда
1. `inferred`: вся co-play логика основана на совпадении tracked JJS gameId;
2. `partial`: бот был оффлайн и часть пересечений пропущена;
3. `stale`: computedAt старый;
4. не все peers обязаны быть Roblox friends или verified Discord mappings.
5. текущий cache ещё не доказывает social closeness вне JJS overlap.
6. `Социальная карта` не является полным графом сервера: mutual-friend source пока не отдельный persisted источник.

### UI Copy Правило
1. Не писать `кооп`, `пати` или `точный отряд`.
2. Если suggestions пусты, допустим честный empty-state block вместо исчезновения раздела.
3. Если есть `serverFriendsCount`, empty state может говорить, что друзья на сервере уже есть, но явный hidden-circle сигнал пока не накопился.
4. Если `sourceComputedAt` старый, block должен прямо говорить, что social-sрез мог устареть.
5. Если `visible profiles < serverFriendsCount`, friend-overlap block должен явно оставаться observational: часть Roblox-друзей может быть без видимого server profile match.
6. `Проверенный круг` должен требовать verified Roblox + friend + JJS/co-play signal, иначе показывать честное отсутствие подтверждённой связки.
7. `Социальная карта` обязана разделять strong, medium и inferred ties и не называть это точной party-картой.

---

## 9. Voice Summary

### Статус
Raw capture уже существует. Base profile-facing mirror implemented for Phase 2.
Base read-side block `Voice-срез` is now live via `src/profile/synergy.js` and consumes `profile.summary.voice` without нового runtime collection layer.

### Owner
1. Raw owner: [src/news/voice.js](src/news/voice.js)
2. Canonical mirror: [src/integrations/shared-profile.js](src/integrations/shared-profile.js)
3. Read-side owner: `src/profile/synergy.js`

### Текущие Mirror-Поля
1. `profile.domains.voice.summary.lifetimeSessionCount`
2. `profile.domains.voice.summary.lifetimeVoiceDurationSeconds`
3. `profile.domains.voice.summary.sessionCount7d`
4. `profile.domains.voice.summary.sessionCount30d`
5. `profile.domains.voice.summary.incompleteSessionCount30d`
6. `profile.domains.voice.summary.voiceDurationSeconds7d`
7. `profile.domains.voice.summary.voiceDurationSeconds30d`
8. `profile.domains.voice.summary.lastSessionEndedAt`
9. `profile.domains.voice.summary.lastVoiceSeenAt`
10. `profile.domains.voice.summary.lastCapturedAt`
11. `profile.domains.voice.summary.isInVoiceNow`
12. `profile.domains.voice.summary.currentChannelId`
13. `profile.domains.voice.summary.currentSessionStartedAt`
14. `profile.domains.voice.summary.topChannels`

### Что Пока Не Реализовано В Mirror
1. frequent voice contacts;
2. voice overlap с другими игроками;
3. совместные voice+JJS ties.

### Текущая V1-Подача
Profile activity section теперь может показывать отдельный block `Voice-срез`:
1. aggregated line по `voiceDurationSeconds7d/30d`, `sessionCount7d/30d`, `lifetimeSessionCount` и `incompleteSessionCount30d`;
2. статусная line `сейчас в voice` или `последний voice`;
3. top channels line по `topChannels`;
4. freshness line по `lastCapturedAt`, если она есть.

### Ненадёжно Когда
1. бот был оффлайн во время voice activity;
2. остались incomplete/recovered sessions;
3. `topChannels` пока считаются по появлениям channelId в tracked sessions, а не по точным секундам на канал;
4. контакты по людям пока не зеркалированы в profile domain.

### UI Copy Правило
Если voice summary stale или incomplete, блок обязан маркироваться как неполный.
В shipped v1 неполнота сейчас маркируется через `неполных 30д: N` и stale-copy по `lastCapturedAt`; per-contact overlap claims пока запрещены.

Следующий закреплённый шаг:
1. mirrored per-contact voice ties;
2. отдельный block voice + JJS overlap;
3. без такого mirror profile surface не должен выдумывать person-level overlap по voice.

### Текущий Voice+JJS Read-Side Guard
Profile social section теперь может показывать block `Voice + game overlap`.
Если `profile.domains.voice.contacts[]` отсутствует, block остаётся gated:
1. показывает, есть ли JJS overlap и общий voice summary;
2. пишет `source gap: profile.domains.voice.contacts[]`;
3. прямо запрещает person-level voice ties.

Если future mirror `profile.domains.voice.contacts[]` появится, тот же read-side block уже умеет пересечь contacts с `summary.roblox.topCoPlayPeers` и показать:
1. count совпадений;
2. top overlap ties;
3. confidence по freshness contacts/co-play;
4. `no exact party claim`.

---

## 10. Personal War Readiness Basic

### Статус
Base read-side block `War Readiness` is live via `src/profile/synergy.js`.
Он не требует clan source, K/D или нового runtime collection layer.

### Owner
1. Derived owner: [src/profile/synergy.js](src/profile/synergy.js)
2. Read-model composition: [src/profile/model.js](src/profile/model.js)

### Источники
1. `profile.summary.roblox.jjsMinutes7d`
2. `profile.summary.activity.lastSeenAt`
3. `progress.hoursSinceLastApprovedKillsUpdate`
4. derived prime-time state from `profile.domains.roblox.playtime.hourlyBucketsMsk`

### Формула V1
Внутренний readiness score пользователю не показывается напрямую, но уровень строится из четырёх сигналов:
1. Roblox 7д: `+35 / +25 / +15 / +8 / +0` для `>=600 / >=300 / >=120 / >0 / 0` минут;
2. Discord last seen: `+25 / +18 / +10 / +0` для `<=2д / <=7д / <=14д / старше`;
3. proof freshness: `+25 / +15 / +6 / +0` для `<=72ч / <=7д / <=14д / старше или отсутствует`;
4. prime-time signal: `+15`, если hourly window уже читается, и `+8`, если buckets есть, но ещё короткие.

Уровень:
1. `высокая` при score `>= 70`
2. `средняя` при score `>= 45`
3. `слабая` иначе

### Текущая V1-Подача
Overview section теперь может показывать block `War Readiness`:
1. уровень `высокая / средняя / слабая`;
2. строку с Roblox 7д, Discord last seen и proof freshness;
3. строку с prime time или честным fallback про короткие buckets.

### Ненадёжно Когда
1. readiness здесь описывает operational readiness по свежести активности, а не боевой skill;
2. без clan source block не умеет делать clan-aware выводы;
3. без K/D и combat stats block не должен притворяться оценкой силы в бою;
4. prime-time часть наследует все ограничения `hourlyBucketsMsk`.

### UI Copy Правило
1. не показывать raw numeric score пользователю;
2. если proof history нет, copy должна говорить `нет approved history`;
3. если prime-time buckets короткие, copy должна говорить `hourly buckets пока ещё короткие`.

---

## 11. Character Wiki Layer

### Статус
Phase 8 character wiki layer is live.

### Owner
1. Canonical character metadata owner: [src/sot/schema.js](src/sot/schema.js), [src/sot/resolver/characters.js](src/sot/resolver/characters.js), [src/sot/native-characters.js](src/sot/native-characters.js)
2. Runtime catalog export: [welcome-bot.js](welcome-bot.js)
3. Read-model enrichment: [src/profile/model.js](src/profile/model.js)
4. Main Core wording: [src/profile/synergy.js](src/profile/synergy.js)
5. Renderer seam unchanged: [src/profile/view.js](src/profile/view.js)

### Источники
1. `appConfig.characters[].wikiUrl` как canonical configured source;
2. persisted SoT character record `characters[id].wikiUrl`, если manual/native path уже обогатил character metadata;
3. `profile.mainCharacterIds[]` и `profile.mainCharacterLabels[]` для сопоставления main -> character catalog entry;
4. existing combo-guide links для соседнего guide layer.

### Текущая V1-Подача
1. quick-link row теперь может показывать external buttons `JJS Wiki: <main>` рядом с combo guides и Roblox profile;
2. `Main Core` line `Гайд-контур` теперь честно показывает не только guide coverage, но и wiki coverage по мейнам;
3. social section `Мейны и гайды` теперь отдельно отмечает `JJS wiki по мейнам` и наличие wiki по каждому main.

### Ненадёжно Когда
1. `wikiUrl` считается trustworthy только как canonical character metadata; profile snapshots сами по себе не владеют wiki links;
2. если `profile.mainCharacterIds[]`/labels не совпадают с canonical character catalog, wiki button не должен фабриковаться;
3. текущий слой не проверяет live-доступность fandom page и не валидирует slug по сети на runtime;
4. прямые fandom URLs в `bot.config.json` нужно обновлять вручную, если внешний wiki меняет slug или структуру.

### UI Copy Правило
1. не притворяться, что wiki есть, если canonical match не найден;
2. не смешивать wiki availability с combo-guide truth: это два разных внешних источника;
3. в Main Core и `Мейны и гайды` говорить именно про `wiki coverage`, а не про gameplay mastery.

---

## 12. Season Archive Storage

### Статус
Phase 9 storage foundation is live and already feeds the first story-layer blocks.

### Owner
1. Snapshot shaping + append owner: [src/profile/synergy-snapshots.js](src/profile/synergy-snapshots.js)
2. Canonical normalization owner: [src/integrations/shared-profile.js](src/integrations/shared-profile.js)
3. Daily scheduler descriptor owner: [src/runtime/client-ready-core.js](src/runtime/client-ready-core.js)
4. Runtime job execution + persistence: [welcome-bot.js](welcome-bot.js)

### Persisted Shape
1. Canonical path: `profile.domains.seasonArchive.snapshots[]`
2. Each snapshot stores at least `dayKey`, `capturedAt`, approved-kill state, access/main/tierlist state, activity summary, Roblox playtime/social rollups, proof-window counters, voice summary counters and social suggestion peer ids.
3. Snapshots are deduped by `dayKey` and capped to 120 retained days.
4. Re-running the daily job on the same day replaces that day snapshot instead of appending duplicates.

### Источники
1. onboarding/access fields from the shared profile root;
2. `profile.domains.activity`;
3. `profile.domains.roblox.playtime`, `serverFriends`, `coPlay`;
4. `profile.domains.progress.proofWindows`;
5. `profile.domains.voice.summary`;
6. `profile.domains.social.suggestions`;
7. `profile.domains.tierlist`.

### Ненадёжно Когда
1. archive describes only the days when the bot successfully ran and current mirrors were available;
2. long downtime or stale mirrors create honest gaps, not silent interpolation;
3. until 30+ daily snapshots accumulate, Season Story / Best Period copy must say that history is still short;
4. archive stores rollups, not per-session causality, so future copy must not invent exact reasons why a day was strong or weak.

### UI Copy Правило
1. archive остаётся storage-слоем: user-facing story blocks должны честно говорить, что они собраны по daily rollups, а не по полным session logs;
2. если история короче нужного окна, говорить `Данные сезона ещё копятся.`;
3. не называть `лучший период` или `сильнейшую форму`, если окно собрано из неполной истории.

---

## 13. Best-Period Summaries

### Статус
Phase 9 best-period read-side is live.

### Owner
1. Derived owner: [src/profile/synergy.js](src/profile/synergy.js)
2. Read-model composition: [src/profile/model.js](src/profile/model.js)
3. Renderer surface: [src/profile/view.js](src/profile/view.js)

### Источники
1. `profile.domains.seasonArchive.snapshots[].jjsMinutes7d`
2. `profile.domains.seasonArchive.snapshots[].jjsMinutes30d`
3. `profile.domains.seasonArchive.snapshots[].activityScore`
4. `profile.domains.seasonArchive.snapshots[].voiceDurationSeconds7d/30d`
5. `profile.domains.seasonArchive.snapshots[].topCoPlayPeerUserIds`
6. `profile.domains.seasonArchive.snapshots[].serverFriendsCount`
7. `profile.domains.seasonArchive.snapshots[].socialSuggestionCount`

### Формула
1. snapshots сортируются по `dayKey`.
2. Для `7д` выбирается snapshot с максимальным `jjsMinutes7d`.
3. Для `30д` выбирается snapshot с максимальным `jjsMinutes30d`.
4. При tie сначала выигрывает больший `activityScore`, затем более поздний `dayKey`.
5. Range label строится как `[dayKey - (windowDays - 1), dayKey]`.
6. `7д` block честно включается только после `>= 7` daily snapshots, `30д` — только после `>= 30`.

### Ненадёжно Когда
1. peak строится по rolling field snapshot'а, а не по полному per-day session journal;
2. gaps в archive означают, что лучший период может быть недонаблюдён;
3. social/voice contour у peak window зависит только от того, что попало в тот же daily snapshot.

### UI Copy Правило
1. при недостатке истории писать `данные сезона ещё копятся`;
2. не называть `лучший день`, если источник — rolling 7d/30d snapshot;
3. peak copy должна говорить именно про `пик 7д` / `пик 30д`, а не про абсолютную истину сезона.

---

## 14. Social Evolution

### Статус
Phase 9 social-evolution read-side is live.

### Owner
1. Derived owner: [src/profile/synergy.js](src/profile/synergy.js)
2. Read-model composition: [src/profile/model.js](src/profile/model.js)
3. Renderer surface: [src/profile/view.js](src/profile/view.js)

### Источники
1. `profile.domains.seasonArchive.snapshots[].topCoPlayPeerUserIds`
2. `profile.domains.seasonArchive.snapshots[].serverFriendsCount`
3. `profile.domains.seasonArchive.snapshots[].socialSuggestionCount`

### Формула
1. block сравнивает первый и последний daily snapshot в archive.
2. `Игровой круг` = `topCoPlayPeerUserIds.length` first -> latest.
3. `Roblox-друзей` = `serverFriendsCount` first -> latest.
4. `Скрытый круг` = `socialSuggestionCount` first -> latest.
5. `Смена ядра` считает `retained/new/dropped` только по пересечению `topCoPlayPeerUserIds` в первом и последнем snapshot.
6. `Пик круга` выбирается по score `peerCount * 100 + friendCount * 10 + suggestionCount`; при tie выигрывает более поздний `dayKey`.
7. Block честно включается только после `>= 7` daily snapshots.

### Ненадёжно Когда
1. это не весь social graph, а только archive top peers + aggregate counts;
2. friend layer хранит count, а не friend identity timeline;
3. retained/new/dropped считаются только по top peer archive, поэтому нельзя выдавать это за полную карту связей сервера.

### UI Copy Правило
1. прямо говорить, что `ядро` считается только по top peer archive;
2. не обещать точный co-op, party или полный social graph;
3. при короткой истории писать `история ещё короткая`.

---

## 15. Season Story

### Статус
Phase 9 season-story read-side is live.

### Owner
1. Derived owner: [src/profile/synergy.js](src/profile/synergy.js)
2. Read-model composition: [src/profile/model.js](src/profile/model.js)
3. Renderer surface: [src/profile/view.js](src/profile/view.js)

### Источники
1. `profile.domains.seasonArchive.snapshots[].approvedKills`
2. `profile.domains.seasonArchive.snapshots[].activityScore`
3. `profile.domains.seasonArchive.snapshots[].topCoPlayPeerUserIds`
4. `profile.domains.seasonArchive.snapshots[].mainCharacterLabels`
5. `profile.domains.seasonArchive.snapshots[].tierlistMainName`
6. `profile.domains.seasonArchive.snapshots[].jjsMinutes7d`
7. `profile.domains.seasonArchive.snapshots[].voiceDurationSeconds7d`

### Формула
1. block сравнивает первый и последний daily snapshot в archive.
2. `Траектория` строится из `approvedKills`, `activityScore` и `topCoPlayPeerUserIds.length` first -> latest.
3. `Нарратив` выбирается rule-based:
  - kills up + activity up + peer count up => сезон разогнался;
  - kills up + activity down => kills росли, но живая активность тише;
  - kills flat/down + activity up => activity ожила без явного kill-progress;
  - peer count up alone => круг стал шире;
  - иначе сезон идёт ровно.
4. `Фокус сезона` сравнивает ранний и поздний main label / tierlist main.
5. `Сильнейший срез` берёт snapshot с максимальным `jjsMinutes7d` по тем же tie-break rules, что и best-period block.
6. Block честно включается только после `>= 7` daily snapshots.

### Ненадёжно Когда
1. narrative rule-based и работает только на daily rollups;
2. `Сильнейший срез` — это strongest rolling snapshot, а не точный single-day truth;
3. если archive sparse или bot downtime длинный, story не должна притворяться цельной сезонной хроникой.

### UI Copy Правило
1. narrative phrasing должна быть мягкой, observational, не как hard lore о человеке;
2. при короткой истории писать `данные ещё копятся`;
3. не приписывать точные причины роста или спада без session-level causality.

---

## 16. Season Consistency

### Статус
Season consistency read-side block is live.

### Owner
1. Derived owner: [src/profile/synergy.js](src/profile/synergy.js)
2. Read-model composition: [src/profile/model.js](src/profile/model.js)
3. Renderer surface: [src/profile/view.js](src/profile/view.js)

### Источники
1. `profile.domains.seasonArchive.snapshots[].messages7d`
2. `profile.domains.seasonArchive.snapshots[].sessions7d`
3. `profile.domains.seasonArchive.snapshots[].jjsMinutes7d`
4. `profile.domains.seasonArchive.snapshots[].voiceDurationSeconds7d`
5. `profile.domains.seasonArchive.snapshots[].activityScore`
6. `profile.domains.seasonArchive.snapshots[].topCoPlayPeerUserIds`
7. `profile.domains.seasonArchive.snapshots[].serverFriendsCount`
8. `profile.domains.seasonArchive.snapshots[].socialSuggestionCount`
9. `profile.domains.seasonArchive.snapshots[].antiteamSupportPoints`

### Формула
1. Каждый daily snapshot получает composite score из chat, sessions, JJS, voice, activity, social и antiteam signals.
2. Block считает average score, spread и стандартное отклонение по snapshots.
3. Label:
  - `ровный сезон`, если spread <= 15 и std <= 7;
  - `умеренно ровный`, если spread <= 28 и std <= 12;
  - `вспышками` иначе.
4. `Best snapshot day` и `Weakest snapshot day` выбираются по composite score; это rolling snapshot, не точный single-day delta.
5. Block честно включается только после `>= 7` daily snapshots; до этого показывает short-history copy.

### Ненадёжно Когда
1. snapshot fields являются rolling 7d summary, а не per-day ledger;
2. season archive sparse или содержит long downtime gaps;
3. antiteam/social/voice могли быть unavailable в части дней.

### UI Copy Правило
1. Всегда писать `rolling snapshots, not exact single-day deltas`.
2. Использовать `Best snapshot day`, а не `лучший день`, пока нет true per-day delta layer.
3. Показывать coverage рядом с trust.

---

## 17. Comeback Metrics

### Статус
Comeback metrics read-side block is live.

### Owner
1. Derived owner: [src/profile/synergy.js](src/profile/synergy.js)
2. Read-model composition: [src/profile/model.js](src/profile/model.js)
3. Renderer surface: [src/profile/view.js](src/profile/view.js)

### Источники
1. `profile.domains.seasonArchive.weeklyRollups[].composite.score`
2. `profile.domains.seasonArchive.weeklyRollups[].composite.grade`
3. `profile.domains.seasonArchive.weeklyRollups[].coverage.coveragePercent`
4. `profile.domains.seasonArchive.weeklyRollups[].totals.jjsMinutes`
5. `profile.domains.seasonArchive.weeklyRollups[].totals.messages`
6. `profile.domains.seasonArchive.weeklyRollups[].totals.sessions`
7. `profile.domains.seasonArchive.weeklyRollups[].totals.voiceSeconds`
8. `profile.domains.seasonArchive.weeklyRollups[].totals.approvedKillsDelta`
9. `profile.domains.seasonArchive.weeklyRollups[].totals.antiteamPointsDelta`

### Формула
1. Comparable weekly windows сортируются по `weekKey`.
2. Block не делает comeback claims, пока окон меньше 3.
3. `active` week = composite score >= 55 и coverage >= 50%, если coverage есть.
4. `returned_after_drop` = недавнее low window -> active window с приростом score >= 18.
5. `recovered_after_pause` = pause-like low window -> active window с приростом score >= 18.
6. `active_streak` = 3+ trailing active windows.
7. `slowing_down` = последние 3 окна падают минимум на 5 score каждое и суммарно минимум на 12.
8. `cooling_off` = последние 3 окна падают, но latest всё ещё active.

### Ненадёжно Когда
1. Weekly rollups sparse или имеют low coverage.
2. Composite score является агрегатом Discord/JJS/voice/kills/antiteam/coverage, а не одной прямой метрикой.
3. Pause-like state выводится по низким weekly totals, а не по точному runtime “человек отсутствовал”.

### UI Copy Правило
1. При `<3` weekly windows писать `no comeback claim`.
2. Показывать последние windows как trend line.
3. Показывать latest signals, чтобы label можно было проверить глазами.
4. Trust обязан включать min coverage и число comparable windows.

---

## 18. Farm Profile

### Статус
Farm profile read-side proxy block is live.

### Owner
1. Derived owner: [src/profile/synergy.js](src/profile/synergy.js)
2. Read-model composition: [src/profile/model.js](src/profile/model.js)
3. Renderer surface: [src/profile/view.js](src/profile/view.js)

### Источники
1. `profile.domains.roblox.playtime.dailyBuckets`
2. `profile.domains.roblox.playtime.hourlyBucketsMsk`
3. `profile.summary.roblox.jjsMinutes30d`
4. `profile.summary.roblox.totalJjsMinutes`
5. `profile.summary.roblox.sessionCount`

### Формула
1. `dailyBuckets` дают active days, span, average active day, top day share и top3 share.
2. `hourlyBucketsMsk` дают average active hour как дополнительный shape signal.
3. `totalJjsMinutes / sessionCount` даёт только lifetime session proxy, не true session histogram.
4. Cadence label:
  - `стабильный гриндер`, если active days >= 8 и top3 share <= 50%;
  - `вспышками`, если active days <= 4 и top3 share >= 70%;
  - `одна сильная вспышка`, если top day share >= 45%;
  - иначе `смешанный темп`.
5. Session shape label:
  - `длинные сессии (proxy)` при average session >= 60 min;
  - `короткие рывки (proxy)` при average session <= 25 min;
  - иначе `средние сессии (proxy)`;
  - если session proxy отсутствует, fallback идёт по average active hour.

### Ненадёжно Когда
1. Нет per-session JJS duration histogram.
2. `sessionCount` сейчас lifetime counter, а не strict 30d counter.
3. Hourly buckets являются polling-derived, а не session boundary source.

### UI Copy Правило
1. Всегда писать `proxy`.
2. Всегда писать `no strong farm claim without session histograms`.
3. Не утверждать точную длину сессий; говорить `session proxy` или `hourly-окна`.

---

## 19. Text-Tierlist Grades И `Кто Ты Сейчас`

### Статус
Phase 5 viewer-first hero, separate Main Core block и population-calibrated grading are live.
V2 first slice is live: каждая текущая буквенная ось теперь возвращает `place`, `confidenceState`, `freshnessState` и `influenceDebuffPercent`, а overview показывает отдельный block `Буквы и места`.
V2 second slice is live: `Antiteam support`, `Proof gap`, season archive coverage line и `Activity mix` добавлены в read-model без новых collectors.
V2 third slice is live: separate relative components, persisted population snapshots and weekly rollups are implemented in the canonical profile seams.
V2 fourth slice is live: verified social map, gated voice+game overlap, prime-time confidence, season consistency, comeback metrics and farm profile proxy are read-side blocks.
Future work: richer Main Core enrichment поверх voice/social layers.

### Owner
1. Derived owner: [src/profile/synergy.js](src/profile/synergy.js)
2. Read-model composition: [src/profile/model.js](src/profile/model.js)
3. Top renderer surface: [src/profile/view.js](src/profile/view.js)

### Источники
1. Roblox playtime
2. activity domain
3. proof windows
4. co-play and friend overlap
5. approved kills / kill tier / standing
6. current ELO summary
7. runtime population profile snapshot, прокинутый через [src/profile/operator.js](src/profile/operator.js) из [welcome-bot.js](welcome-bot.js)
8. `profile.summary.support.antiteam`, mirrored из `db.sot.antiteam.stats.helpers`
9. `voiceSummary` для voice 30d в activity mix
10. `db.analytics.profilePopulationSnapshots[]` как persisted population baseline для relative components
11. `profile.domains.seasonArchive.weeklyRollups[]` для strongest week

### Текущая V1-Подача
Верх non-self profile сейчас использует viewer hero block `Кто ты сейчас` и отдельный overview block `Main Core`.

Viewer hero даёт:
1. строку `Текст-тирлист: Форма • Чат • Килы • Стабильность • Развитие • Соц`;
2. мягкий human-summary line вида `Сейчас это ...`;
3. anchor line с главными опорами профиля вроде kills rank, tier, Roblox, activity bucket и ELO.

Main Core даёт:
1. краткое ядро main/tierlist identity;
2. server-relative status line с формой, ростом, стабильностью и ranking anchors;
3. top co-play partner line;
4. guide coverage line.

Block `Буквы и места` даёт:
1. две строки по текущим буквенным осям: `Форма`, `Чат`, `Килы`, `Стабильность`, `Развитие`, `Соц`;
2. если population baseline по оси достаточный, рядом с буквой показывается место `#N/M`;
3. если baseline короткий, рядом пишется `baseline X/5`;
4. если ось без валидного места, показывается `место N/A`;
5. отдельная строка суммирует reliable/partial/unavailable axes и max influence debuff.

Block `Antiteam support` даёт:
1. `confirmedArrived` как support points;
2. `responded` и `linkGranted` как объяснители;
3. место среди population baseline по confirmed arrivals;
4. confidence/debuff/source line.

Block `Proof gap` даёт:
1. последний approved proof timestamp;
2. elapsed wall-clock и JJS gap, если Roblox baseline надёжен;
3. `fresh/partial/stale/outdated`;
4. kill-backed debuff до `90%`;
5. source line без шейминга игрока.

Block `Activity mix` даёт:
1. separate `Discord vs Roblox` label;
2. raw 30d JJS/chat/voice values;
3. normalized share mix and confidence.

Block `Места по метрикам` даёт:
1. отдельные места для voice hours, active voice share, voice sessions;
2. отдельные места для Discord messages/sessions;
3. отдельные места для JJS time/sessions;
4. отдельные места для kills/day и antiteam support;
5. confidence/debuff рядом с каждым component.

Block `Strongest week` даёт:
1. лучший persisted weekly rollup по composite score;
2. coverage `covered/expected`;
3. JJS/messages/sessions/voice/kills/antiteam signals;
4. confidence/debuff и date range.

### Текущая V1-Формула
Текущая формула двухслойная: сначала local raw score, потом population calibration, если baseline достаточно плотный.

Raw axis-score layer:
1. `Форма` смотрит на JJS minutes 7d, activity score, freshness last approved update и recent JJS presence.
2. `Чат` смотрит на messages 7d, sessions 7d и active days.
3. `Килы` смотрят на kill tier, approved kills и standing.
4. `Стабильность` смотрит на `windowComparison` и наличие надёжных growth windows.
5. `Развитие` смотрит на latest growth pace, trend vs previous window и relation к lifetime pace.
6. `Соц` смотрит на server friends, peer counts и co-play session density.

Population calibration layer:
1. `populationProfiles[]` приходит в read-model из runtime seam `getPopulationProfiles()`.
2. Для каждой оси профиль считает тот же raw score по каждому population profile, у кого на этой оси есть валидный сигнал.
3. Если по оси накоплено меньше `5` валидных population samples, ось честно остаётся на local fallback grade.
4. Если sample size `>= 5`, итоговая буква берётся уже не из raw score напрямую, а из percentile score текущего raw score внутри population sample этой оси.
5. Percentile считается average-rank способом: tie cases не превращают всех в top grade, а дают середину общего ранга tied group.
6. После percentile normalization буква снова строится общей grade ladder `S+ ... D-`.
7. `Кто ты сейчас` и `Main Core` читают уже этот calibrated axis state, а не пересчитывают формулы отдельно.

V2 place/confidence layer:
1. `place.rank` считается по raw score оси: количество population samples с лучшим score + 1.
2. `place.total` = число валидных samples этой оси в текущем runtime baseline.
3. При population size `< 5` место не считается, axis получает `confidenceState = partial`, `freshnessState = partial`, `influenceDebuffPercent = 15`.
4. При population size `>= 5` axis получает `confidenceState = reliable`, `freshnessState = fresh`, `influenceDebuffPercent = 0`.
5. Если raw signal недоступен, axis получает `confidenceState = unavailable` и `influenceDebuffPercent = 100`.
6. Proof gap дополнительно накладывает stale-debuff на kill-backed letters `kills`, `stability`, `growth`; итоговый `influenceDebuffPercent` берётся как максимум population/source debuff и proof debuff.
7. Letter axes пока используют runtime population baseline.
8. Separate relative components сначала читают persisted `populationSnapshot`, если он передан, и только потом fallback на runtime `populationProfiles`.

Proof gap formula:
1. `ageDebuff = 0` до 72 часов после proof, затем растёт до `60%` к 30 дням.
2. `jjsDebuff = 0` до 10 JJS hours после proof, затем растёт до `90%` к 60 JJS hours.
3. Если JJS gap ненадёжен, используется heuristic debuff `15%` для свежего proof и `45%` для старого.
4. Final debuff = `max(ageDebuff, jjsDebuff)`, capped to `90%`.
5. Freshness: `fresh = 0%`, `partial <= 30%`, `stale < 90%`, `outdated = 90%`.

Season archive coverage formula:
1. `expectedDays = day span between first and last archive day`.
2. `coveredDays = unique dayKey count`.
3. `coveragePercent = coveredDays / expectedDays`.
4. User-facing line shows `coverage`, `complete`, `fragmented` and missing hole count.

Activity mix formula:
1. `chatScore = min(1.5, messages30d / 300)`.
2. `jjsScore = min(1.5, jjsMinutes30d / 1200)`.
3. `voiceScore = min(1.5, voiceSeconds30d / 20h)`.
4. Shares are normalized by available score sum.
5. Confidence is `reliable` with all three sources, `partial` with two, `heuristic` with one.

Persisted population snapshot formula:
1. `captureProfilePopulationSnapshot(db, options)` пишет `db.analytics.profilePopulationSnapshots[]`.
2. Snapshot dedupes by `dayKey` and caps retention to `120`.
3. Axes: `jjs_time_30d`, `jjs_session_count`, `discord_messages_30d`, `discord_sessions_30d`, `voice_hours_30d`, `voice_sessions_30d`, `active_voice_share_30d`, `kills_per_covered_day`, `antiteam_support_points`.
4. Empty normalized profiles do not contribute zeroes unless there is a real source signal.
5. `client-ready-core` has optional `runProfilePopulationSnapshot` job descriptor; welcome-bot runtime wiring remains a narrow follow-up.

Weekly rollup formula:
1. `buildSeasonArchiveWeeklyRollups()` groups daily archive snapshots by ISO week.
2. Coverage is fixed at `expectedDays = 7`, `coveredDays = unique dayKey count`.
3. JJS uses summed `dayJjsMinutes`; messages/sessions/voice use the latest rolling 7d snapshot in that week.
4. Kills and antiteam use monotonic week delta from first to latest snapshot.
5. Composite includes JJS, Discord messages/sessions, voice, kills, antiteam and coverage, then maps to the shared grade ladder.

### Закреплённый Контракт Следующих Ревизий
1. Каждая буквенная ось должна возвращать:
  - `grade`,
  - `rawScore`,
  - `percentileScore`,
  - `place`,
  - `populationSize`,
  - `confidenceState`,
  - `influenceDebuffPercent`.

  Текущие шесть viewer axes уже выполняют этот минимальный контракт. Separate relative components уже умеют persisted population source; следующие ревизии должны довести persisted baseline до буквенных axes.

2. Relative-grade слой должен отдельно учитывать относительно других:
  - JJS time,
  - Discord messages,
  - Discord sessions,
  - voice hours,
  - active voice share,
  - average approved kills per covered day,
  - antiteam support points по `db.sot.antiteam.stats.helpers[userId].confirmedArrived`.

  Этот слой live в block `Места по метрикам`.

3. `Discord vs Roblox balance` закрепляется как отдельная honest metric рядом с буквами.
  Контракт статусов на сейчас:
  - `больше JJS`,
  - `больше Discord chat`,
  - `больше Discord voice`,
  - `ровно Discord + JJS`,
  - `смешанный режим`.

4. Kill-backed сигналы обязаны не только смотреть на абсолютные kills, но и на average approved kills per covered day.
  Если approved proof stale, kill-layer должен получать явный debuff вплоть до `-90%` влияния на composite.

5. `Strongest week` live на persisted weekly rollups и считает composite по Discord, JJS, voice, kills, antiteam и coverage.
  `Лучший день сезона` по full composite остаётся следующей ревизией.

6. Growth by time-of-day и richer stability taxonomy сейчас закреплённо отменены.
  Причина: в текущем repo нет достаточного trustworthy telemetry layer, чтобы честно это обещать.

### Главная Ненадёжность
1. relative grading зависит от live population snapshot и axis-specific sample size;
2. текущий baseline считается on-demand из канонических profiles в runtime, а не из отдельного persisted history snapshot;
3. если по оси меньше `5` signal profiles, эта ось падает в local fallback и остаётся only best-effort;
4. при недостатке данных отдельные axes обязаны становиться `N/A`, а не слабой буквой;
5. viewer hero и Main Core не должны притворяться абсолютным leaderboard truth: это compact observational read относительно текущей живой популяции;
6. текущий V2-slice уже показывает место, confidence и debuff; archive coverage live для season-story blocks, но coverage ещё не встроен в каждую ось, поэтому место остаётся runtime-relative, а не long-term baseline truth.

### UI Copy Правило
Не выдавать narrative как hard truth психотипа. Это должен быть мягкий observational summary.
