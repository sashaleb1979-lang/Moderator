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

---

## 2. Hourly Roblox Buckets По Москве

### Статус
Phase 1 foundation: реализовано.

### Что Это Такое
Rolling hour-level buckets по JJS playtime, собранные в московском времени.

### Зачем Нужны
Это foundation-слой для:
1. future prime time lines;
2. growth by time-of-day;
3. personal readiness по времени суток;
4. Season Story и best-period summaries.

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
Пока derived user-facing features поверх hourly buckets не выведены в профиль, эти buckets не показываются напрямую.
Когда появится prime time:
1. если накоплено меньше 7 дней history, copy должен говорить `пока по неполной истории`;
2. если capture stale, copy должен говорить `по последним доступным данным`.

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

---

## 8. Co-Play И Social Suggestions

### Статус
Top co-play peers уже существуют как source facts.
Base suggestions cache implemented for Phase 2. Richer narrative/read-side blocks remain for Phase 6.

### Owner
1. Raw source facts: [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js)
2. Canonical normalized profile source: [src/integrations/shared-profile.js](src/integrations/shared-profile.js)
3. Future derived read-side owner: `src/profile/synergy.js`

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

### Ненадёжно Когда
1. `inferred`: вся co-play логика основана на совпадении tracked JJS gameId;
2. `partial`: бот был оффлайн и часть пересечений пропущена;
3. `stale`: computedAt старый;
4. не все peers обязаны быть Roblox friends или verified Discord mappings.
5. текущий cache ещё не доказывает social closeness вне JJS overlap.

---

## 9. Voice Summary

### Статус
Raw capture уже существует. Base profile-facing mirror implemented for Phase 2.

### Owner
1. Raw owner: [src/news/voice.js](src/news/voice.js)
2. Canonical mirror: [src/integrations/shared-profile.js](src/integrations/shared-profile.js)
3. Future read-side blocks: `src/profile/synergy.js`

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

### Ненадёжно Когда
1. бот был оффлайн во время voice activity;
2. остались incomplete/recovered sessions;
3. `topChannels` пока считаются по появлениям channelId в tracked sessions, а не по точным секундам на канал;
4. контакты по людям пока не зеркалированы в profile domain.

### UI Copy Правило
Если voice summary stale или incomplete, блок обязан маркироваться как неполный.

---

## 10. Text-Tierlist Grades И `Кто Ты Сейчас`

### Статус
Planned for Phase 5.

### Planned Owner
`src/profile/synergy.js`

### Источники
1. Roblox playtime
2. activity domain
3. proof windows
4. co-play and friend overlap

### Главная Ненадёжность
1. relative grading зависит от population baseline;
2. без регулярных population snapshots grade может быть only best-effort;
3. при недостатке данных отдельные axes обязаны становиться `N/A`, а не слабой буквой.

### UI Copy Правило
Не выдавать narrative как hard truth психотипа. Это должен быть мягкий observational summary.
