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
Planned for Phase 4.

### Что Это Такое
Derived metric `jjsHoursSinceLastApprovedKillsUpdate`.

### Источник
1. последний proof-window snapshot
2. текущее `profile.domains.roblox.playtime.totalJjsMinutes`

### Формула
`(currentTotalJjsMinutes - snapshotTotalJjsMinutes) / 60`

### Ненадёжно Когда
1. нет ни одного proof-window snapshot;
2. playtime tracking стартовал после последнего approve;
3. Roblox binding был потерян или подтверждён заново между окнами.

### UI Copy Правило
Если snapshot отсутствует, использовать честный текст вроде `после последнего апрува история Roblox-часов ещё не накоплена`.

---

## 6. Reminder `ОБНОВИ`

### Статус
Planned for Phase 4.

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

---

## 7. Co-Play И Social Suggestions

### Статус
Top co-play peers уже существуют как source facts.
Suggestions cache planned for Phase 2 and Phase 6.

### Owner
1. Raw source facts: [src/runtime/roblox-jobs.js](src/runtime/roblox-jobs.js)
2. Canonical normalized profile source: [src/integrations/shared-profile.js](src/integrations/shared-profile.js)
3. Future derived read-side owner: `src/profile/synergy.js`

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

---

## 8. Voice Summary

### Статус
Raw capture уже существует. Profile-facing mirror planned for Phase 2 and Phase 7.

### Owner
1. Raw owner: [src/news/voice.js](src/news/voice.js)
2. Future canonical mirror: [src/integrations/shared-profile.js](src/integrations/shared-profile.js)
3. Future read-side blocks: `src/profile/synergy.js`

### Ненадёжно Когда
1. бот был оффлайн во время voice activity;
2. остались incomplete/recovered sessions;
3. данные ещё не зеркалированы в profile domain.

### UI Copy Правило
Если voice summary stale или incomplete, блок обязан маркироваться как неполный.

---

## 9. Text-Tierlist Grades И `Кто Ты Сейчас`

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
