# Profile Synergy V2 Implementation Plan

Статус: рабочий файл реализации для следующего большого слоя профильной синергии. На 20.05.2026 live-срез уже включает места букв, antiteam support mirror, proof gap, archive coverage и activity mix.

Этот файл не заменяет:
1. `PROFILE_VISION_PLAN.md`;
2. `PROFILE_SYNERGY_SYSTEM_PLAN.md`;
3. `PROFILE_SYNERGY_CALCULATION_SPEC.md`.

Он фиксирует именно порядок внедрения, архитектуру владельцев, storage-shape, формулы, доверие к цифрам, coverage, relative-places и минимальный UI-surface для нового "backup-ready" слоя. Оформление можно полировать позже; здесь главное, чтобы расчёты были честными, расширяемыми и не развалили уже живой профиль.

---

## 0. Baseline На 20.05.2026

Текущий активный repo: `C:\Users\ASUS\Documents\1\Moderator`.

Внешний путь `C:\Users\ASUS\railway-probe\Moderator-main` не используется как рабочее дерево. В активном repo уже есть нужный `PROFILE_SYNERGY_CALCULATION_SPEC.md`.

Уже live:
1. `src/profile/operator.js` владеет profile entry flow, buttons, slash/message handling, compact-card path.
2. `src/profile/model.js` собирает read-model и раскладывает готовые blocks по sections.
3. `src/profile/view.js` рендерит Components V2.
4. `src/profile/synergy.js` уже является derived owner для progress, viewer hero, Main Core, social blocks, voice summary, prime time, best periods, season story и war readiness.
5. `src/profile/synergy-snapshots.js` уже владеет proof-window snapshots и daily season archive snapshots.
6. `src/integrations/shared-profile.js` нормализует canonical profile domains и зеркалит voice/social summary.
7. `src/runtime/roblox-jobs.js` уже собирает JJS playtime, hourly MSK buckets, co-play и server friends.
8. `src/activity/operator.js` / `src/activity/runtime.js` уже считают Discord activity, chat sessions/messages и smart voice scoring.
9. `src/news/voice.js` уже пишет raw voice transitions, open/finalized sessions.
10. `src/antiteam/state.js` уже хранит helper stats, где `confirmedArrived` = базовая antiteam support metric.

Главный вывод: V2 надо делать как расширение существующих owner seams, а не как новый параллельный профиль.

---

## 1. Цель V2

Сделать профиль не просто набором строк, а честной расчётной системой:
1. по каждой буквенной оси есть место игрока среди людей на сервере;
2. каждая цифра имеет confidence/trust state;
3. каждая история имеет coverage, а не притворяется полной;
4. stale proof снижает влияние kill-backed метрик вплоть до `-90%`, но не скрывает сами факты;
5. Discord vs Roblox balance выводится отдельно;
6. antiteam-очки входят в relative/composite слой;
7. social map показывает кого человек реально знает на сервере: strong, medium, inferred ties;
8. voice + game overlap появляется только после честного voice-contact layer;
9. weekly rollups и persisted population snapshots дают долгую калибровку, а не on-demand впечатление;
10. лучший день/strongest week считаются по full letter-composite: Discord, JJS, voice, antiteam, growth, social, coverage.

---

## 2. Жёсткие Правила Архитектуры

1. `welcome-bot.js` не получает новые formulas. Только routing, wiring и вызов уже готовых helpers.
2. `src/profile/view.js` не получает business logic. Только layout, section order, truncation и components.
3. `src/profile/model.js` не считает процентили, debuffs, places или social graph. Только передаёт inputs и вставляет готовые blocks.
4. `src/profile/synergy.js` остаётся главным read-side derived owner. Если он станет слишком большим, можно вынести pure helpers в `src/profile/synergy/*.js`, но public owner остаётся один.
5. `src/profile/synergy-snapshots.js` расширяется для write-side snapshots, weekly rollups и persisted population baselines.
6. `src/integrations/shared-profile.js` нормализует domains/mirrors, но не пишет narrative и не решает кто "сильный".
7. Raw collectors остаются у своих владельцев: Roblox в `src/runtime/roblox-jobs.js`, activity в `src/activity/*`, voice в `src/news/voice.js`, antiteam в `src/antiteam/*`.
8. Любой новый сильный claim обязан иметь source path, confidence state и fallback copy.
9. Если source неполный, UI пишет `данные копятся`, `частично`, `устарело`, `эвристика`, а не превращает неизвестность в плохую оценку.
10. Compatibility layers legacy/SoT не удалять вслепую. Сначала понять canonical owner и bridge.

---

## 3. Целевые Storage Контракты

### 3.1. Support / Antiteam Mirror

Source of truth:
1. `db.sot.antiteam.stats.helpers[userId].confirmedArrived`;
2. `responded`, `linkGranted`, `lastHelpedAt` как дополнительные объяснители.

Целевой profile mirror:
```json
profile.domains.support = {
  "antiteam": {
    "confirmedArrived": 0,
    "responded": 0,
    "linkGranted": 0,
    "lastHelpedAt": null,
    "source": "sot.antiteam.stats.helpers",
    "syncedAt": "2026-05-20T00:00:00.000Z"
  }
}
```

Owner:
1. raw/source: `src/antiteam/state.js`;
2. mirror normalization: `src/integrations/shared-profile.js`;
3. derived relative score: `src/profile/synergy.js`.

Правило: если mirror отсутствует, antiteam axis = `N/A`, а не ноль. Ноль показывать только если source точно есть и confirmedArrived реально `0`.

### 3.2. Persisted Population Snapshots

Не хранить population baseline внутри одного профиля. Это cross-user analytics.

Целевой путь:
```json
db.analytics.profilePopulationSnapshots[] = {
  "dayKey": "2026-05-20",
  "capturedAt": "2026-05-20T21:00:00.000Z",
  "profileCount": 42,
  "eligibleProfileCount": 30,
  "axes": {
    "jjs_time_30d": { "sampleSize": 26, "values": [0, 120, 300] },
    "discord_messages_30d": { "sampleSize": 30, "values": [1, 50, 220] },
    "discord_sessions_30d": { "sampleSize": 30, "values": [1, 8, 21] },
    "voice_hours_30d": { "sampleSize": 18, "values": [0.5, 4.2, 15.0] },
    "active_voice_share_30d": { "sampleSize": 15, "values": [0.2, 0.7, 0.95] },
    "kills_per_covered_day": { "sampleSize": 14, "values": [0.1, 6.0, 20.0] },
    "antiteam_support_points": { "sampleSize": 12, "values": [0, 2, 8] }
  }
}
```

Retention: 120 daily population snapshots for V1. Later can compress older data to weekly.

Privacy rule: this local bot DB can hold raw values, but UI only needs ranks/places. Do not expose another user's hidden details unless profile access already permits it.

### 3.3. Weekly Rollups

Целевой path внутри профиля:
```json
profile.domains.seasonArchive.weeklyRollups[] = {
  "weekKey": "2026-W21",
  "startDayKey": "2026-05-18",
  "endDayKey": "2026-05-24",
  "capturedAt": "2026-05-24T23:59:00.000Z",
  "coverage": {
    "expectedDays": 7,
    "coveredDays": 6,
    "missingDays": 1,
    "coveragePercent": 85.7,
    "completePercent": 70,
    "fragmentedPercent": 15.7
  },
  "totals": {
    "jjsMinutes": 900,
    "messages": 120,
    "sessions": 12,
    "voiceSeconds": 5400,
    "activeVoiceSeconds": 4200,
    "antiteamPointsDelta": 1,
    "approvedKillsDelta": 400
  },
  "composite": {
    "score": 81,
    "grade": "A",
    "confidenceState": "partial",
    "influenceDebuffPercent": 15
  }
}
```

Owner:
1. daily source: existing `profile.domains.seasonArchive.snapshots[]`;
2. weekly builder: `src/profile/synergy-snapshots.js`;
3. weekly read-side: `src/profile/synergy.js`;
4. scheduler: `src/runtime/client-ready-core.js` + `welcome-bot.js`.

### 3.4. Voice Contact Mirror

Live canonical path для `Voice + game overlap` и voice summary.

Canonical path:
```json
profile.domains.voice.contacts[] = {
  "peerUserId": "123",
  "sharedVoiceSeconds30d": 7200,
  "sharedVoiceSessionCount30d": 5,
  "sharedVoiceDays30d": 3,
  "lastSharedVoiceAt": "2026-05-20T18:00:00.000Z",
  "confidenceState": "inferred",
  "source": "news.voice.sessions"
}
```

Важно: текущие voice sessions не являются идеальным per-contact truth. Текущий contact layer допустим как canonical mirror только с честной маркировкой `inferred` для overlap-derived контактов. Сильное утверждение `часто сидят вместе в voice` допустимо только после более плотного contact aggregation, где known channel/time overlap уже достаточно точный.

### 3.5. Social Map Read-Side Shape

Можно хранить как derived cache позже, но первая версия может быть read-side.

```json
socialMap = {
  "strongTies": [],
  "mediumTies": [],
  "inferredTies": [],
  "mutualFriends": [],
  "coverage": {},
  "confidenceState": "partial"
}
```

Strong tie:
1. peer has verified Roblox;
2. peer is already Roblox friend;
3. frequent JJS overlap exists;
4. optional voice overlap increases score but is not required for V1.

Medium tie:
1. verified friend without recent JJS;
2. frequent JJS overlap without Roblox friendship;
3. repeated Discord/voice contact after voice contact layer exists.

Inferred tie:
1. hidden-circle suggestion;
2. shared JJS session overlap;
3. mutual friend signal, if implemented.

No exact party/duo/clan claim until a direct source exists.

---

## 4. Единый Контракт Метрики

Каждая новая цифра и каждая буквенная ось возвращает:

```json
{
  "id": "voice_hours_30d",
  "label": "Voice time 30d",
  "rawValue": 12.5,
  "rawUnit": "hours",
  "rawScore": 72,
  "relativeScore": 83,
  "percentileScore": 83,
  "grade": "A",
  "place": {
    "rank": 4,
    "total": 21,
    "tieCount": 1,
    "direction": "desc",
    "basis": "population_snapshot"
  },
  "populationSize": 21,
  "sampleSource": "persisted_population_snapshot",
  "confidenceState": "reliable",
  "freshnessState": "fresh",
  "coverage": {
    "expectedDays": 30,
    "coveredDays": 27,
    "missingDays": 3,
    "coveragePercent": 90,
    "completePercent": 80,
    "fragmentedPercent": 10
  },
  "influenceDebuffPercent": 10,
  "sourcePaths": [
    "profile.domains.voice.summary.voiceDurationSeconds30d"
  ],
  "notes": []
}
```

Минимальные `confidenceState`:
1. `reliable`;
2. `partial`;
3. `stale`;
4. `inferred`;
5. `unavailable`;
6. `debuffed`.

UI rule: если `confidenceState !== reliable`, рядом с блоком должна быть короткая причина. Не надо длинных оправданий; достаточно `coverage 70%`, `proof stale`, `voice inferred`.

---

## 5. Debuff Engine

Debuff снижает влияние в composite, но не скрывает raw value.

### 5.1. Proof Freshness Debuff

Для kill-backed axes:
1. `<= 7d` после approved proof: `0%`;
2. `8-14d`: `20%`;
3. `15-30d`: `45%`;
4. `31-60d`: `70%`;
5. `> 60d`: `90%`.

Если есть `jjsHoursSinceLastApprovedKillsUpdate >= 10`, copy должен говорить не просто "обнови kills", а объяснять proof gap:
1. сколько JJS часов прошло после последнего proof;
2. сколько дней прошло;
3. какой debuff получил kill-layer;
4. насколько это может искажать итоговую букву.

### 5.2. Coverage Debuff

Для history axes:
1. coverage `>= 90%`: `0-5%`;
2. `75-89%`: `10-20%`;
3. `50-74%`: `25-45%`;
4. `< 50%`: `50-75%`;
5. no source: `100%` and axis = `N/A`.

### 5.3. Source Debuff

1. direct source: `0%`;
2. mirrored source fresh: `5%`;
3. rolling snapshot approximation: `10-25%`;
4. inferred overlap: `25-50%`;
5. stale inferred overlap: `50-90%`.

Final debuff:
```text
finalDebuff = max(proofDebuff, coverageDebuff, sourceDebuff)
```

Composite effective weight:
```text
effectiveWeight = baseWeight * (1 - finalDebuff / 100)
```

---

## 6. Letter Axes V2

Existing V1 axes:
1. `form`;
2. `chat`;
3. `kills`;
4. `stability`;
5. `growth`;
6. `social`.

V2 не обязан ломать названия в UI. Внутри нужен axis registry, где каждая буква знает свои relative components и place.

### 6.1. `form`

Purpose: общая текущая форма.

Components:
1. JJS 7d/30d;
2. Discord activityScore;
3. proof freshness;
4. recent JJS presence;
5. voice time as secondary boost;
6. coverage debuff.

Place: rank by final effective form score.

### 6.2. `chat`

Components:
1. messages7d/30d;
2. sessions7d/30d;
3. activeDays7d/30d;
4. weightedMessages30d if available;
5. channel diversity.

Required separate relative subplaces:
1. place by messages;
2. place by sessions;
3. place by active days.

### 6.3. `voice`

New explicit axis or visible sub-axis inside `form/activity`.

Components:
1. voiceDurationSeconds30d;
2. sessionCount30d;
3. effectiveVoiceHours30d;
4. activeVoice share.

Active voice share:
```text
activeVoiceShare = effectiveActiveVoiceSignalHours30d / effectiveVoiceHours30d
```

Boost rule:
1. below `0.20`: low engagement, debuff/inferred low quality;
2. `0.20-0.55`: normal;
3. `0.55-0.85`: good active voice;
4. `> 0.85`: strong active voice boost, capped so AFK prevention remains meaningful.

Required separate relative subplaces:
1. place by voice hours;
2. place by active voice share;
3. place by voice session count.

### 6.4. `kills`

Components:
1. approvedKills;
2. killTier;
3. rank by approvedKills;
4. average approved kills per covered day;
5. proof freshness debuff.

Required:
1. raw kills rank remains visible;
2. kills/day relative place is separate;
3. stale proof can debuff influence up to `90%`.

### 6.5. `growth`

Components:
1. all proof windows, not only last two;
2. latest reliable growth window;
3. lifetime reliable pace;
4. comeback/slowdown trend once weekly rollups exist.

Required:
1. full growth feed;
2. comparison line remains;
3. trend over at least 3 windows before saying "slowing third window".

### 6.6. `social`

Components:
1. verified circle;
2. server friends;
3. frequent co-play;
4. hidden circle suggestions;
5. future voice+game overlap;
6. mutual friends/inferred ties.

Required blocks:
1. `Проверенный круг`;
2. `Voice + game overlap`;
3. `Социальная карта`.

### 6.7. `antiteam_support`

New required axis/component.

Raw value:
```text
confirmedArrived
```

Secondary values:
1. responded;
2. linkGranted;
3. lastHelpedAt;
4. recent weekly support delta after weekly rollups.

Place:
1. rank by confirmedArrived;
2. tie-break by lastHelpedAt desc;
3. tie-break by responded/linkGranted if needed.

UI copy:
1. `Antiteam support: #N из M по подтверждённым приходам`;
2. if no source: `antiteam stats ещё не заведены`;
3. do not call it combat strength.

---

## 7. Relative Components Обязательного Слоя

Каждый profile V2 state должен иметь `relativeComponents[]`:

1. `voice_hours_30d`;
2. `active_voice_share_30d`;
3. `voice_sessions_30d`;
4. `discord_sessions_30d`;
5. `discord_messages_30d`;
6. `jjs_time_30d`;
7. `jjs_session_count`;
8. `kills_per_covered_day`;
9. `antiteam_support_points`;
10. `server_friend_count`;
11. `frequent_coplay_peer_count`;
12. `verified_circle_count`.

Для каждого component показывать:
1. raw value;
2. place `#N из M`;
3. confidence;
4. debuff if any.

Минимальный UI можно сделать одной строкой:
```text
Места: voice #4/21 • msg #8/30 • JJS #3/26 • kills/day #6/14 • antiteam #2/12
```

Если строка длинная, разбить по blocks, оформление потом.

---

## 8. Discord Vs Roblox Balance

Это отдельная honest metric, не часть одной буквы.

Discord score:
1. chat score from messages/sessions/active days;
2. voice score from voice hours/active voice;
3. activityScore as stabilizer.

Roblox score:
1. JJS minutes 30d;
2. JJS session count;
3. lastSeenInJjsAt freshness.

Formula:
```text
discordScore = weighted(chatScore 0.55, voiceScore 0.35, activityScore 0.10)
robloxScore = weighted(jjsTimeScore 0.70, jjsSessionScore 0.20, jjsFreshnessScore 0.10)
balanceIndex = (robloxScore - discordScore) / max(1, robloxScore + discordScore)
```

Statuses:
1. `живёт больше в JJS`, if `balanceIndex >= 0.25`;
2. `живёт больше в Discord`, if `balanceIndex <= -0.25`;
3. `держится ровно в обоих`, otherwise.

Confidence:
1. reliable only when both Discord and Roblox coverage are acceptable;
2. partial when one side exists but the other side has short history;
3. unavailable if neither side has enough data.

---

## 9. Proof Gap Detector

Target block:
```text
Proof gap: с последнего proof прошло 13 ч JJS и 5.2 дн. Kill-layer сейчас debuffed на 20%; growth/kills буквы могут быть ниже реальной формы.
```

Inputs:
1. latest proof window;
2. current totalJjsMinutes;
3. hours/days since reviewedAt;
4. latest reliable kills/JJS pace if available;
5. coverage from proof windows.

Severity:
1. `none`: no gap or no reliable JJS after proof;
2. `mild`: `5-10h JJS`;
3. `actionable`: `10-25h JJS`;
4. `large`: `25h+ JJS` or `14d+`;
5. `stale`: `30d+`.

Do not estimate exact unregistered kills unless there is reliable pace. If estimated, label it as estimate.

---

## 10. Coverage Metrics

Coverage is mandatory and more important than prettier text.

For every time-window metric:
```json
coverage = {
  "windowDays": 30,
  "expectedDays": 30,
  "coveredDays": 22,
  "missingDays": 8,
  "coveragePercent": 73.3,
  "completePercent": 60,
  "fragmentedPercent": 13.3,
  "gapRanges": [
    { "fromDayKey": "2026-05-04", "toDayKey": "2026-05-06" }
  ],
  "confidenceState": "partial"
}
```

Coverage sources:
1. Roblox dailyBuckets for JJS;
2. activity user snapshots / daily stats for Discord;
3. voice finalized sessions and mirror lastCapturedAt;
4. seasonArchive daily snapshots;
5. weekly rollups.

UI copy:
1. `coverage 22/30 дней`;
2. `история с пробелами`;
3. `часть окна собрана кусками`.

---

## 11. Season V2

### 11.1. Best Day

Не считать лучший день только по kills или JJS time.

Target daily composite:
```text
dayScore =
  JJS activity score * 0.25 +
  Discord chat score * 0.20 +
  voice score * 0.15 +
  antiteam delta score * 0.10 +
  social activity score * 0.10 +
  growth/proof score * 0.10 +
  coverage score * 0.10
```

V1 limitation: existing daily archive stores several rolling fields, not all true per-day deltas. Until daily deltas exist, copy must say `strongest daily snapshot`, not `точный лучший день`.

### 11.2. Strongest Week

Use weekly rollups and full composite:
1. JJS minutes and sessions;
2. Discord messages/sessions/active days;
3. voice hours/active voice;
4. antiteam support delta;
5. proof/growth delta;
6. social growth;
7. coverage.

Tie-breakers:
1. higher coverage;
2. higher composite;
3. later week.

### 11.3. Season Consistency

Metrics:
1. best day;
2. worst day;
3. average day;
4. standard deviation of daily composite;
5. best week;
6. worst week;
7. stable/volatile label.

Copy:
1. `сезон ровный`;
2. `сезон вспышками`;
3. `сильный пик, но много дыр`;
4. `данные пока короткие`.

---

## 12. Comeback Metrics

Comeback runs on weekly rollups or at least 3 comparable windows.

States:
1. `returned_after_drop`: previous window low, current window recovered by threshold;
2. `active_streak`: 3+ windows above active threshold;
3. `slowing_down`: 3 windows falling in a row;
4. `recovered_after_pause`: gap/pause then current active;
5. `cooling_off`: still active but score lower for 2 windows.

Do not show comeback claims with fewer than 3 windows.

---

## 13. Farm Profile

Question: long even sessions or short bursts?

Needed telemetry:
1. per-session JJS duration histogram;
2. daily session count;
3. median session length;
4. p75/p90 session length;
5. burst days vs steady days.

Current limitation: profile summary mostly has cumulative session count and buckets. That is enough for rough hints, not strong farm profile.

V1 after telemetry:
1. `stable_grinder`: many covered days, medium/long sessions, low variance;
2. `burst_grinder`: fewer days, high peak sessions;
3. `short_bursts`: many sessions, short median;
4. `low_signal`: not enough sessions.

---

## 14. Prime Time Confidence

Current prime time block finds best MSK window.

V2 confidence:
1. split hourly buckets by week;
2. compute best window per week;
3. compare overlap between week windows;
4. confidence grows when same 3-4h band repeats.

States:
1. `stable`: same/overlapping window in 3+ weeks;
2. `moderate`: 2 weeks agree;
3. `volatile`: windows jump;
4. `short_history`: fewer than 2 weeks.

Copy:
```text
Prime time confidence: stable, 19:00-23:00 повторяется 3 недели.
```

---

## 15. Activity Mix

Separate metric: где человек живёт сильнее.

Inputs:
1. chat relative score;
2. JJS relative score;
3. voice relative score;
4. antiteam support score.

Output statuses:
1. `chat-heavy`;
2. `JJS-heavy`;
3. `voice-heavy`;
4. `support-heavy`;
5. `mixed`;
6. `low-signal`.

UI labels:
1. `живёт в чате`;
2. `живёт в JJS`;
3. `живёт в voice`;
4. `часто помогает в antiteam`;
5. `смешанный режим`.

---

## 16. Minimal UI Blocks

Оформление позже. Сейчас нужны рабочие blocks.

### 16.1. `Буквы и места`

Lines:
1. `Форма A (#4/30) • Чат B+ (#8/30) • Килы A- (#6/24)`;
2. `Voice B (#5/18) • JJS A (#3/26) • Antiteam S (#2/12)`;
3. `Confidence: coverage 27/30д • kill-layer debuff 20%`.

### 16.2. `Баланс активности`

Lines:
1. `Discord vs Roblox: живёт больше в JJS`;
2. `Activity mix: JJS + voice`;
3. `Coverage: Discord 28/30д • JJS 24/30д • voice inferred`.

### 16.3. `Proof gap`

Lines:
1. `С последнего proof: 13 ч JJS • 5.2 дн.`;
2. `Kill-layer debuff: 20%`;
3. `Рекомендация: обновить kills, чтобы буквы роста снова были полными`.

### 16.4. `Проверенный круг`

Lines:
1. `Проверенный круг: verified+friend+JJS 4 • verified friends 6 • active 7д 5 • JJS 7д 4`;
2. `Топ verified ties: <@id> • verified Roblox • Roblox-друг • 210 мин вместе • 5 общ. сесс.`;
3. `Trust: reliable • sources verified Roblox + server friends + JJS overlap • no exact party claim`.

### 16.5. `Социальная карта`

Lines:
1. `Социальная карта: strong 4 • medium 6 • friends here 7 • inferred 3`;
2. `Strong ties: <@id> • verified Roblox • Roblox-друг • 210 мин вместе`;
3. `Trust: partial • sources Roblox friends/co-play/social suggestions • no exact party claim`.

### 16.6. `Сезон V2`

Lines:
1. `Strongest week: 2026-W21 • composite A • coverage 6/7д`;
2. `Best snapshot day: 20.05.2026 • JJS + chat + voice + antiteam`;
3. `Consistency: ровный / вспышками / короткая история`.

---

## 17. Implementation Phases

### Phase A. Contract And Test Harness

Deliverables:
1. add pure metric contract helpers in/under `src/profile/synergy.js`;
2. add axis placement helper;
3. add confidence/debuff helper;
4. add focused unit tests for rank ties, sample size, N/A and stale proof debuff.

Validation:
1. `node --test tests/profile-synergy.test.js`;
2. `node --test tests/profile-model.test.js`.

### Phase B. Antiteam Support Mirror

Status: live in first read-side slice.

Deliverables:
1. extend shared profile support domain normalization;
2. build support mirror index from `db.sot.antiteam.stats.helpers`;
3. pass support summary into profile read-model through existing `profile.summary`;
4. add relative axis `antiteam_support_points`;
5. show minimal line in profile.

Tests:
1. `tests/shared-profile.test.js`;
2. `tests/profile-synergy.test.js`;
3. `tests/profile-model.test.js`.

Implemented:
1. `src/integrations/shared-profile.js` normalizes `domains.support.antiteam` and mirrors `db.sot.antiteam.stats.helpers`;
2. `src/profile/synergy.js` builds `Antiteam support` with confirmed arrivals/responded/link grants, population place, confidence and debuff;
3. `src/profile/model.js` inserts the block into overview only when the source is available.

### Phase C. Relative Places For Every Letter

Deliverables:
1. extend existing population calibrated axis state with `place`, `confidenceState`, `influenceDebuffPercent`;
2. compute place for each visible letter;
3. include place in `Кто ты сейчас` or a new compact `Буквы и места` block;
4. keep current hero regex-compatible text where possible.

Tests:
1. population ties;
2. sample size `< 5`;
3. target absent from sample;
4. axis N/A.

### Phase D. Separate Relative Components

Status: live for core read-side components.

Deliverables:
1. voice hours place;
2. active voice share place;
3. Discord sessions place;
4. messages place;
5. JJS time place;
6. kills/day place;
7. antiteam place.

Tests:
1. all components return source/confidence/debuff;
2. stale proof debuffs kills/day but not messages/voice.

Implemented:
1. `src/profile/synergy.js` builds `Места по метрикам`;
2. live components: voice hours, active voice share, voice sessions, Discord messages, Discord sessions, JJS time, JJS sessions, kills/day and antiteam support;
3. each component has raw display value, place/baseline, confidence and debuff.

### Phase E. Proof Gap Detector Strong Mode

Status: first strong read-side slice live.

Deliverables:
1. severity state;
2. proof freshness debuff;
3. gap explanation line;
4. self-view CTA integration;
5. viewer-safe copy without shaming.

Implemented:
1. `buildProgressSynergyState` now returns `proofGap`;
2. stale proof applies kill-backed `influenceDebuffPercent` up to `90%` to `kills`, `stability` and `growth` letters;
3. progress section gets a `Proof gap` block with elapsed proof age, JJS gap when reliable, freshness/confidence and source.

Tests:
1. no proof;
2. fresh proof;
3. 10h JJS threshold;
4. stale 30d+ proof;
5. repairable Roblox does not fake JJS gap.

### Phase F. Coverage Engine

Status: season archive coverage line live; generic coverage/debuff engine remains future work.

Deliverables:
1. coverage helpers for daily buckets and season archive;
2. coverage output on every history-dependent axis;
3. copy line in activity/progress blocks;
4. debuff connection.

Implemented:
1. `Лучшие периоды`, `Социальная эволюция` and `История сезона` inherit the enhanced archive coverage line;
2. coverage shows covered/expected days, complete percent, fragmented percent and hole count.

Tests:
1. perfect 30d;
2. sparse 30d;
3. contiguous gap;
4. no source.

### Phase G. Persisted Population Snapshots

Status: storage + capture helper + read-side preference live; welcome-bot runtime wiring remains a separate narrow step.

Deliverables:
1. new analytics state normalization;
2. `captureProfilePopulationSnapshot(db, options)`;
3. scheduler descriptor in `client-ready-core`;
4. read-side prefers persisted snapshot, falls back to runtime population;
5. docs/spec update.

Tests:
1. idempotent daily snapshot;
2. retention cap;
3. fallback when missing;
4. rank consistency with persisted baseline.

Implemented:
1. `captureProfilePopulationSnapshot(db, options)` writes `db.analytics.profilePopulationSnapshots[]`;
2. retained baseline is capped and deduped by `dayKey`;
3. axes include JJS time, JJS sessions, Discord messages/sessions, voice hours/sessions, active voice share, kills/day and antiteam points;
4. relative components prefer `populationSnapshot` and fall back to runtime `populationProfiles`;
5. `client-ready-core` has an optional `runProfilePopulationSnapshot` periodic job descriptor.

### Phase H. Weekly Rollups

Status: storage builder + normalization + read-side strongest week block live.

Deliverables:
1. weekly rollup builder from daily archive;
2. full composite fields;
3. coverage per week;
4. strongest week block;
5. short-history fallback.

Tests:
1. 7/7 week;
2. 5/7 partial week;
3. tie-break by coverage;
4. no fake strongest week when history short.

Implemented:
1. `buildSeasonArchiveWeeklyRollups()` groups daily archive snapshots by ISO week;
2. `appendSeasonArchiveSnapshot()` rebuilds weekly rollups after daily append;
3. shared-profile normalization preserves `seasonArchive.weeklyRollups`;
4. profile read-side shows `Strongest week` from persisted weekly rollups.

### Phase I. Season V2, Comeback, Consistency

Status: season consistency and comeback read-side slices live.

Deliverables:
1. best snapshot day by full composite;
2. strongest week by full composite;
3. season consistency;
4. comeback states over 3+ windows;
5. copy gates.

Implemented:
1. `src/profile/synergy.js` builds `Season consistency` from daily archive rolling snapshots;
2. composite includes chat, sessions, JJS, voice, activity, social and antiteam support;
3. block shows average day, spread, best snapshot day, weakest snapshot day and coverage trust;
4. copy explicitly says `rolling snapshots, not exact single-day deltas`;
5. `src/profile/synergy.js` builds `Comeback metrics` from persisted weekly rollups;
6. comeback states include recovered after pause, returned after drop, active streak, slowing down and cooling off;
7. block refuses comeback claims with fewer than 3 comparable weekly windows.

Tests:
1. recovered after pause;
2. slowing 3 windows;
3. active streak;
4. volatile season.

### Phase J. Verified Circle And Social Map

Status: first read-side slice live.

Deliverables:
1. verified circle block;
2. social map edge scoring;
3. strong/medium/inferred blocks;
4. no exact party claims;
5. future mutual friend source placeholder.

Implemented:
1. `src/profile/synergy.js` builds `Проверенный круг` from verified Roblox friend overlap plus JJS/co-play signal;
2. `src/profile/synergy.js` builds `Социальная карта` with strong, medium and inferred ties;
3. `src/profile/model.js` appends both blocks to the social section without moving the legacy Roblox/social blocks;
4. trust copy explicitly says `no exact party claim`.

Tests:
1. verified friend + frequent co-play = strong;
2. frequent non-friend = medium/inferred depending source;
3. stale co-play lowers confidence;
4. self profile and viewer profile both behave.

### Phase K. Voice Contact Layer And Voice + Game Overlap

Status: voice contact mirror and gated read-side block live.

Deliverables:
1. canonical voice contact mirror or derived contact aggregator;
2. overlap with JJS co-play peers;
3. block `Voice + game overlap`;
4. confidence labels for inferred contact.

Implemented:
1. `src/integrations/shared-profile.js` normalizes canonical `profile.domains.voice.contacts[]` entries for the profile mirror;
2. `src/profile/synergy.js` exposes `Voice + game overlap` and voice summary from that canonical mirror;
3. when `profile.domains.voice.contacts[]` is absent, block reports the source gap and does not claim person-level voice ties;
4. when contacts are present, the block intersects them with JJS co-play peers and labels confidence honestly.

Tests:
1. same channel/time overlap;
2. old voice overlap stale;
3. JJS-only contact does not appear in voice+game;
4. voice-only contact appears as voice tie, not game overlap.

### Phase L. Activity Mix, Farm Profile, Prime Confidence

Status: Discord vs Roblox / activity mix, farm profile proxy and prime-time confidence blocks live.

Deliverables:
1. Discord vs Roblox balance block;
2. activity mix block;
3. prime time confidence;
4. farm profile proxy now, stronger farm profile after session-duration telemetry exists;
5. no strong farm claim without session histograms.

Implemented:
1. `src/profile/synergy.js` derives `Activity mix` from messages 30d, JJS minutes 30d and voice 30d;
2. block labels `больше JJS`, `больше Discord chat`, `больше Discord voice`, `ровно Discord + JJS` or `смешанный режим`;
3. block exposes source confidence as `reliable/partial/heuristic`;
4. `src/profile/synergy.js` derives `Prime time confidence` by comparing best 4-hour MSK windows week to week;
5. `src/profile/synergy.js` derives `Farm profile` from daily buckets, hourly buckets and summary Roblox session proxy;
6. farm copy explicitly says `no strong farm claim without session histograms`.

Tests:
1. JJS-heavy;
2. Discord-heavy;
3. balanced;
4. mixed low signal;
5. prime stable vs volatile.

### Phase M. Burn-In

Status: focused tests, full `npm test`, runtime restart smoke and docs sync complete.

Deliverables:
1. focused tests after every slice;
2. full `npm test`;
3. runtime log smoke after restart for profile open, self profile, other profile, compact-card;
4. docs sync: calculation spec, system plan, this implementation plan.

Implemented:
1. focused read-side and routing slices stay covered by `tests/profile-*.test.js` plus dedicated startup smoke checks;
2. `tests/welcome-bot-startup-smoke.test.js` now covers startup boot, modal wiring, profile helper open, self profile, other profile and compact-card through live `welcome-bot.js` routing;
3. latest full baseline is `npm test` = 747 pass / 0 fail;
4. calculation spec, system plan and this implementation plan are synced to live Phase K/M state.

---

## 18. First Safe Coding Slice

The first implementation slice should be narrow:
1. add metric contract helpers and placement helper;
2. extend existing letter axis state with `place/confidence/debuff`;
3. add tests around population place/rank ties;
4. do not add UI churn yet except maybe hidden state in synergy object.

Why first:
1. every later feature needs places and confidence;
2. it does not require new storage;
3. it can be validated entirely with pure tests;
4. it keeps `welcome-bot.js` untouched.

Second slice:
1. antiteam support mirror;
2. relative component for confirmedArrived;
3. minimal profile line.

Third slice:
1. proof gap detector strong mode;
2. stale proof debuff;
3. self progress copy.

---

## 19. Acceptance Criteria

V2 is considered usable when:
1. each visible letter has `#N/M` place or honest `N/A`;
2. voice, active voice share, Discord sessions, messages, JJS time, kills/day and antiteam points have separate relative places;
3. proof gap block explains stale proof and debuff;
4. confidence/debuff exists on every history or inferred metric;
5. coverage exists for daily/weekly/history-backed metrics;
6. Discord vs Roblox balance appears as a separate metric;
7. verified circle is separate from generic overlap;
8. social map separates strong/medium/inferred ties;
9. voice+game overlap does not appear until voice contact source exists;
10. weekly rollups and persisted population snapshots are stored, capped, idempotent and tested;
11. best day/strongest week use full composite and do not pretend rolling snapshots are exact single-day truth;
12. all new work has focused tests and full `npm test` before calling it safe.

---

## 20. Не Делать

1. Do not rewrite `welcome-bot.js` profile hot path broadly.
2. Do not remove compat/legacy bridges while adding V2 metrics.
3. Do not claim exact party, exact clan truth, K/D or per-character performance without a direct source.
4. Do not call stale proof a bad player score. It is a trust/debuff state.
5. Do not convert missing data into D-grade.
6. Do not hide raw metrics just because influence was debuffed.
7. Do not make visual polish a blocker for calculation correctness.
8. Do not store cross-user population baselines inside a single user's profile domain.
9. Do not add new feature surfaces outside the canonical profile operator/model/view stack.

---

## 21. Living Checklist

- [x] Phase A: metric contract and placement helper.
- [x] Phase B: antiteam support mirror.
- [x] Phase C: visible places for every current viewer letter.
- [x] Phase D: separate relative components.
- [x] Phase E: proof gap detector.
- [x] Phase F: coverage engine first season-archive slice.
- [x] Phase G: persisted population snapshots.
- [x] Phase H: weekly rollups.
- [x] Phase I: season consistency first read-side slice.
- [x] Phase I: comeback/streak/slowdown states.
- [x] Phase J: verified circle/social map first read-side slice.
- [x] Phase K: voice contact mirror.
- [x] Phase K: gated voice/game overlap read-side block.
- [x] Phase L: activity mix first slice.
- [x] Phase L: prime-time confidence.
- [x] Phase L: farm profile proxy.
- [x] Phase M: burn-in and docs sync.
