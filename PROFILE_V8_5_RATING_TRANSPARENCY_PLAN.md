# Profile V8.5 Rating Transparency Implementation Plan

## 0. Instruction For The Next LLM

This file is the handoff plan. Before changing code:

1. Read `AGENTS.md`.
2. Read this file completely.
3. Run `git status --short`.
4. Confirm current profile code still matches the V8.4 architecture described below.
5. Implement only this plan unless the user gives a newer instruction.

If this file is missing in the working tree, create it first from the handoff text before doing code edits. The user wants a durable plan file that can be passed to another LLM and executed later.

## 1. Current Context

The repository is in:

```text
C:\Users\ASUS\Documents\1\Moderator
```

The last completed profile milestone was V8.4:

- Commit pushed: `15d1b98 Implement profile V8.4 rating details`
- Full validation at that point: `npm test` passed, `770/770`
- Focused profile validation passed:

```text
node --test tests/profile-model.test.js tests/profile-view.test.js tests/profile-operator.test.js tests/profile-synergy.test.js
```

V8.4 already has:

- Three profile rating leagues only:
  - Activity
  - Kills
  - JJS
- No visible profile levels.
- No visible XP system.
- No visible word `Буквы`.
- No social rating axis.
- ELO removed from the Progress tab UI.
- Detail buttons for rating axes:
  - `profile_rating_detail:<requesterId>:<targetId>:<axis>`
- Detail replies are ephemeral and separate from the main profile.
- Overview is cleaner and compact.
- `🎭 Мейны и места` as a separate block should be gone from overview.

The newest user request is V8.5:

- Keep the profile clean.
- Do not bloat the overview.
- Make every rating card easier to understand.
- Show what peak or target the player is judged against.
- Move real math, formulas, source windows, top/peak values, pluses and minuses into detail buttons.
- Fix Kills growth transparency: old proof jumps/windows must be usable when recent kill changes are missing.
- Let the user see exactly how the three ratings are calculated so they can give better balancing feedback later.

## 2. Main Problem To Fix

The biggest confirmed backend issue is Kills growth input.

Current V8.4 Kills rating mainly uses:

```js
normalizeRecentKillChanges(options.recentKillChanges, recentKillChange, 3)
```

That means Kills rating can ignore older proof windows that already exist in the profile archive.

But `src/profile/synergy.js` already has logic that combines:

- `profile.domains.progress.proofWindows`
- `recentKillChanges`

in `buildGrowthWindows`.

So the system is inconsistent:

- Synergy/progress can know about historical proof windows.
- The main Kills rating card can still say there are too few valid kill days.

V8.5 must make Kills rating use the same kind of proof-window fallback, without inventing fake data.

## 3. Non-Goals

Do not do these in this pass:

- Do not add new collectors.
- Do not rewrite the whole profile.
- Do not add back levels.
- Do not add back XP.
- Do not add social rating.
- Do not touch ELO systems except preserving that ELO stays out of Progress UI.
- Do not generate images.
- Do not change existing button custom ids except if tests explicitly confirm compatibility.
- Do not make the overview long again.
- Do not show huge formula dumps in the main overview.

## 4. Relevant Files And Current Architecture

### `src/profile/entry.js`

Current responsibilities:

- Defines profile action ids.
- Defines rating detail button prefix.
- Builds/parses rating detail custom ids.

Important symbols:

```js
PROFILE_RATING_DETAIL_BUTTON_PREFIX
buildProfileRatingDetailCustomId
parseProfileRatingDetailCustomId
```

Expected V8.5 change:

- Probably no change needed unless the detail axis payload contract needs small extension.
- Keep custom id format stable.

### `src/profile/operator.js`

Current responsibilities:

- Builds private profile read model.
- Builds private profile payload.
- Handles profile nav/action/detail interactions.
- Rating detail handler:
  - Parses `profile_rating_detail`.
  - Defers ephemeral reply.
  - Builds read model.
  - Calls `buildProfileRatingDetailPayload({ readModel, axis })`.

Expected V8.5 change:

- Usually no behavior change.
- Tests should confirm detail replies are still ephemeral and still render richer V8.5 content.

### `src/profile/view.js`

Current responsibilities:

- Discord Components V2 payload composition.
- Renders overview/activity/progress/social/compact surfaces.
- Builds rating detail payload.
- Renders rating detail buttons.

Important symbols:

```js
buildProfileRatingDetailRows
buildProfileRatingDetailPayload
```

Expected V8.5 change:

- Detail payload should render richer blocks:
  - `🧮 Как считается`
  - `📌 Входные данные`
  - `🏔️ Пик / планка`
  - `📉 Модификаторы`
  - `🧾 Источники`
  - `💡 До апа`
- Main overview remains compact.
- Rating cards still max about 5 visible lines each.

### `src/profile/model.js`

Main implementation target.

Current important symbols/functions:

```js
PROFILE_RATING_AXES = ["activity", "kills", "jjs"]
PROFILE_KILLS_DAY_OUTLIER_LIMIT = 400
buildActivityLeagueMetrics
buildActivityRatingAxis
buildRecentKillPaceState
buildKillsRatingAxis
buildJjsRatingAxis
buildRatingDetailBlocks
normalizeRecentKillChanges
buildProfileReadModel
```

Known current behavior:

- Activity uses Discord only:
  - voice 45%
  - chat sessions 35%
  - message count 20%
  - pure chat / pure voice cap 84
- Kills ignores growth windows over `400 kills/day`.
- Kills needs valid growth days for growth modifier.
- JJS uses population top `* 70%` for S+ target, fallback `6h/7d`, floor `1h/7d`.
- Detail blocks exist, but are still too shallow.

Expected V8.5 changes:

- Add proof-window fallback to Kills rating.
- Add peak/target lines to each rating axis.
- Add detailed math/source metadata to axis extras.
- Improve `buildRatingDetailBlocks`.

### `src/profile/synergy.js`

Current relevant behavior:

```js
buildGrowthWindows
buildProgressSynergyState
```

`buildGrowthWindows` already combines `proofWindows` and `recentKillChanges`.

Expected V8.5 change:

- Prefer reusing or mirroring this logic in `model.js`.
- Do not create a second incompatible interpretation if a helper can be shared safely.
- If sharing would be risky, implement a local model helper with the same source rules and add tests.

## 5. UX Target

The overview must stay compact.

Each rating card should become clearer, not larger.

Target shape:

```text
🔥 Рейтинг A- · 78/100 · #12/227
★ Пик: Kills A+ · +26%
```

Open league card, max 5 lines:

```text
🟣 Активность B+ · 68/100 · #31/227
Voice 4,6ч · chat-сессии 11 · msg 420
учёт 100% · ±0% ▰▰▰▱▱
💡 до A: +1,2ч voice или +4 chat-сессии
↳ пик: voice 2ч / 5 сесс. / 150 msg · cap off
```

Kills:

```text
⚔️ Kills A · 81/100 · #41/168
Approved 7 200 · 30/день · 6,1 kills/ч
учёт 100% · +26% ▰▰▰▰▱
💡 до A+: +380 kills или держи 34/день
↳ окна: 6/6 дней из proof · рост +20%
```

JJS:

```text
🎮 JJS C+ · 55/100 · #58/94
7,4ч/7д · S+ от 14,2ч · покрытие 86%
учёт 86% · -14% ▰▰▱▱▱
💡 до B: +1,6ч JJS
↳ пик: top 20,3ч ×70% · coverage 86%
```

Closed league:

```text
🔒 Kills закрыт · рейтинг -40%
Нужен свежий proof: последние данные старше 2 недель
💡 обнови kills — окна заполнятся задним числом
```

## 6. Detail Button Target

Each rating detail button should explain the system well enough that the user can debug balancing.

Do not dump a giant wall. Use compact separated blocks.

General detail shape:

```text
# ⚔️ Kills · разбор оценки

Итог: A · 81/100 · #41/168

🧮 Как считается
место по kills + рост/день + kills/ч JJS - покрытие - старость proof
рост выше 400/день не даёт очки

📌 Входные данные
Approved 7 200 · #41/168
Рост 30/день · 6 валидных дней
JJS 34,4ч · 6,1 kills/ч

🏔️ Пик / планка
S+ считается от верхней планки популяции
Текущий рост: 30/день · цель A+: 34/день

📉 Модификаторы
+20% за рост
+6% за эффективность
0% за покрытие

🧾 Источники
proof windows: 3 · recent changes: 0
7 000 → 7 180 · +180 · 6д · 30/день · учтено
6 500 → 6 980 · +480 · 1д · не учтено: выше 400/день

💡 До апа
A+ откроется от +380 kills или 34/день
```

### Activity Detail Must Explain

Activity formula:

```text
voice score * 45% + chat sessions score * 35% + messages score * 20%
```

Important user-facing explanation:

- Pure chat cannot reach the very top.
- Pure voice cannot reach the very top.
- Voice matters most, but not so hard that chat becomes useless.
- JJS is not part of Activity anymore.

Example:

```text
🧮 Как считается
voice 45% + chat-сессии 35% + msg 20%
чисто chat/voice ограничены cap 84/100

📌 Входные данные
Voice 4,6ч · clean 3,1ч · raw extra 1,5ч
Chat-сессии 11 · msg 420

🏔️ Пик / планка
Цели: voice 6,0ч · 14 сессий · 900 msg
Пик берётся от top игрока ×70%, но не ниже fallback

📉 Модификаторы
voice: 4,6/6,0 = 77% ×45
sessions: 11/14 = 79% ×35
msg: 420/900 = 47% ×20
cap не сработал

🧾 Источники
voice из canonical activity summary
сообщения из chat activity windows

💡 До апа
до A: +1,2ч voice или +4 chat-сессии
```

### Kills Detail Must Explain

Kills formula:

```text
approved kills rank + growth/day modifier + kills/hour modifier - coverage/staleness
```

Critical rules:

- Growth above `400 kills/day` is ignored everywhere:
  - not in score
  - not in modifier
  - not in hint
- Need at least 4 valid kill-days for growth to count.
- If fewer than 6 valid days, show coverage penalty.
- If no approved kills, Kills is closed and gives `-40%` to overall rating.
- If latest proof is older than 2 weeks, Kills block closes/hides according to existing V8.4 rule.
- Proof windows must be used to fill missing recent changes.

Detail should show used and ignored windows.

Example source lines:

```text
🧾 Источники
proof windows: 3 · recent changes: 0
7 000 → 7 180 · +180 · 6д · 30/день · учтено
6 500 → 6 980 · +480 · 1д · не учтено: выше 400/день
```

### JJS Detail Must Explain

JJS formula:

```text
weekly JJS hours vs S+ target, multiplied by coverage
```

Important user-facing explanation:

- S+ target is top observed JJS weekly hours `* 70%`.
- If population data is too small, fallback target is `6h/7d`.
- Floor is `1h/7d`.
- Coverage reduces trust/score.
- If Roblox is not trackable, JJS is closed with a clear blocker.

Example:

```text
🧮 Как считается
JJS часы недели сравниваются с S+ планкой
после этого результат умножается на покрытие периода

📌 Входные данные
7,4ч/7д · покрытие 86%
Roblox готов · sync свежий

🏔️ Пик / планка
top недели: 20,3ч
S+ планка: 20,3ч ×70% = 14,2ч
fallback минимум: 6ч

📉 Модификаторы
raw score 62/100
coverage 86% → итог 53/100

🧾 Источники
domains.roblox.playtime
weekly rollup coverage

💡 До апа
до B: +1,6ч JJS
```

## 7. Backend Design

### 7.1 Extend Rating Axis Presentation Contract

In `src/profile/model.js`, each axis should expose enough data for both:

- compact overview card
- rich detail modal

Suggested fields:

```js
{
  key,
  label,
  icon,
  grade,
  score,
  rank,
  total,
  modifierPercent,
  weightPercent,
  cardLines,
  primaryHintLine,
  detailLine,
  peakLine,
  detailItems,
  detailBlocks,
  extras: {
    formulaLines,
    inputLines,
    peakLines,
    modifierLines,
    sourceLines,
    upgradeLines
  }
}
```

Do not expose XP fields.

Do not expose level fields.

### 7.2 Compact Card Rule

For every open axis:

- line 1: headline
- line 2: values
- line 3: weight/modifier/bar
- line 4: hint
- line 5: peak/detail line

For every closed axis:

- max 3 lines
- no fake zero score
- clear reason
- clear action

### 7.3 Kills Window Recovery

Add a new helper in `src/profile/model.js`.

Possible names:

```js
buildRatingKillChanges
buildKillChangesFromProofWindows
normalizeRatingKillWindows
```

Inputs:

- `profile.domains.progress.proofWindows`
- `options.recentKillChanges`
- `recentKillChange`
- `now`

Process:

1. Normalize explicit recent changes.
2. Normalize fallback single `recentKillChange`.
3. Convert adjacent proof windows into kill-change windows.
4. Deduplicate.
5. Sort newest first.
6. Keep enough candidates to cover 6 valid days after filtering.

Proof window conversion:

```js
previous.approvedKills -> current.approvedKills
previous.reviewedAt/proofAt -> current.reviewedAt/proofAt
delta = current.approvedKills - previous.approvedKills
dayCount = date diff in days, minimum 1 if timestamps are same/missing but order is known
source = "proofWindow"
```

Important validation:

- `delta <= 0`: not useful for growth score, but can be shown as neutral/ignored if helpful.
- `averagePerDay > 400`: ignored outlier.
- missing date: include only if safe; otherwise show as source gap, not as scored growth.

Aggregation:

- Use latest valid windows until `coveredDays >= 6`.
- Growth contributes only if `coveredDays >= 4`.
- If `coveredDays < 6`, apply the existing `-20%` style coverage penalty.
- If latest usable proof is older than 2 weeks, keep existing closed/stale behavior.

The user specifically wants old proof jumps to count when there was no other way for the bot to know daily progress. That means proof windows should be accepted as legitimate historical windows, not ignored because they are not in `recentKillChanges`.

### 7.4 Kills Outlier Rule

Keep and strengthen:

```text
>400 kills/day is ignored
```

Ignored means:

- does not increase score
- does not add growth buff
- does not appear as progress toward hint
- does appear in detail as ignored transparency

Example:

```text
480/день не учтено: выше лимита 400
```

### 7.5 Activity Math Transparency

Store per-component math in `buildActivityRatingAxis`.

Useful extras:

```js
extras: {
  voiceScore,
  sessionScore,
  messageScore,
  voiceContribution,
  sessionContribution,
  messageContribution,
  targetValues,
  pureModeCapApplied,
  rawVoiceHours,
  cleanVoiceHours,
  rawExtraVoiceHours,
  formulaLines,
  peakLines,
  modifierLines
}
```

The main overview should only show one compact peak line.

Detail should show the full math.

### 7.6 JJS Math Transparency

Store:

```js
extras: {
  topObservedHours,
  targetMultiplierPercent: 70,
  fallbackTargetHours: 6,
  floorHours: 1,
  targetHours,
  rawScore,
  coveragePercent,
  finalScore,
  formulaLines,
  peakLines,
  modifierLines,
  sourceLines
}
```

Detail should explicitly show:

```text
S+ = top observed ×70%, fallback 6h
raw score × coverage = final
```

## 8. Suggested Implementation Order

### Step 1: Safety Check

Run:

```text
git status --short
```

If dirty, inspect before editing. Do not revert user changes.

### Step 2: Add Kills Window Normalizer

In `src/profile/model.js`:

- Add proof-window to kill-change conversion.
- Combine explicit recent changes and proof windows.
- Dedupe.
- Sort newest first.
- Feed combined windows into `buildRecentKillPaceState`.

Expected result:

- If `recentKillChanges` is empty but `profile.domains.progress.proofWindows` has enough adjacent proof windows, Kills growth can still calculate valid days.

### Step 3: Add Axis Explanation Metadata

In:

- `buildActivityRatingAxis`
- `buildKillsRatingAxis`
- `buildJjsRatingAxis`

Add:

- `peakLine`
- `formulaLines`
- `inputLines`
- `peakLines`
- `modifierLines`
- `sourceLines`
- `upgradeLines`

Keep current score formulas unless the user gave a direct formula correction.

### Step 4: Upgrade Overview Card Copy

In `buildRatingCardAxis` or the equivalent card composer:

- Keep max 5 lines.
- Replace vague detail line with a specific peak/source line.
- Make wording clearer:
  - `пик: ...`
  - `окна: ...`
  - `coverage ...`
  - `cap сработал/не сработал`

### Step 5: Upgrade Detail Blocks

In `buildRatingDetailBlocks`:

Render the same block titles for all three axes:

```text
🧮 Как считается
📌 Входные данные
🏔️ Пик / планка
📉 Модификаторы
🧾 Источники
💡 До апа
```

Each block should have 1-3 lines.

Do not make a giant text wall.

### Step 6: Tests

Add tests before or immediately after implementation.

Run focused:

```text
node --test tests/profile-model.test.js tests/profile-view.test.js tests/profile-operator.test.js tests/profile-synergy.test.js
```

Run full:

```text
npm test
```

## 9. Test Cases To Add Or Update

### `tests/profile-model.test.js`

Add/verify:

1. Overview rating card remains compact.
   - open axis max 5 visible lines
   - closed axis max 3 visible lines

2. Overview axis card contains useful peak/source line:
   - Activity includes target/peak/cap wording.
   - Kills includes windows/source/growth wording.
   - JJS includes S+ target/coverage wording.

3. Kills can use proof windows when recent changes are empty.

Example fixture:

```js
profile.domains.progress.proofWindows = [
  { approvedKills: 6500, reviewedAt: "2026-05-01T00:00:00.000Z" },
  { approvedKills: 6620, reviewedAt: "2026-05-04T00:00:00.000Z" },
  { approvedKills: 6800, reviewedAt: "2026-05-10T00:00:00.000Z" }
]
```

Expected:

- Kills detail says proof windows are used.
- Growth does not claim too few valid days if combined windows cover enough days.

4. Kills outlier over 400/day is ignored.

Expected:

- Score/modifier does not include it.
- Detail includes line like:

```text
не учтено: выше 400/день
```

5. Activity detail contains:

```text
voice 45%
chat-сессии 35%
msg 20%
cap
```

or equivalent lines with `×45`, `×35`, `×20`.

6. JJS detail contains:

```text
×70%
fallback 6ч
coverage
```

7. No forbidden UX regressions:

- no `XP`
- no `Ур.`
- no `level`
- no separate `🎭 Мейны и места`
- no ELO in Progress

### `tests/profile-view.test.js`

Add/verify:

- Detail payload has the new headings:

```text
🧮 Как считается
📌 Входные данные
🏔️ Пик / планка
📉 Модификаторы
🧾 Источники
💡 До апа
```

- Detail button labels stay:

```text
🟣 Активность
⚔️ Kills
🎮 JJS
```

- Main overview stays within component budget.

### `tests/profile-operator.test.js`

Add/verify:

- Rating detail interaction still replies ephemeral.
- The detail payload includes richer explanation blocks.
- Existing custom ids still parse correctly.

### `tests/profile-synergy.test.js`

Usually minimal change.

Only add tests here if shared proof-window helper is moved to synergy or if model/synergy behavior changes.

## 10. Acceptance Criteria

The implementation is good when:

1. User can open overview and still see a clean profile.
2. Each rating card has:
   - grade
   - score
   - rank
   - key values
   - weight/modifier/bar
   - hint
   - peak/source line
3. Each detail button explains:
   - formula
   - exact inputs
   - peak/target
   - modifiers
   - sources/windows
   - upgrade hint
4. Kills growth no longer says “too few valid days” when proof windows can honestly fill the period.
5. Kills outliers over `400/day` are transparent and ignored.
6. Activity detail proves JJS is not part of Activity.
7. JJS detail shows the S+ target math.
8. No old clutter returns.
9. Focused and full tests pass.

## 11. Example Final User-Facing Copy

### Overview Rating Card

```text
🟣 Активность B+ · 68/100 · #31/227
Voice 4,6ч · chat-сессии 11 · msg 420
учёт 100% · ±0% ▰▰▰▱▱
💡 до A: +1,2ч voice или +4 chat-сессии
↳ пик: voice 6ч · 14 сесс. · 900 msg · cap off
```

### Activity Detail

```text
# 🟣 Активность · разбор оценки

Итог: B+ · 68/100 · #31/227

🧮 Как считается
voice 45% + chat-сессии 35% + msg 20%
JJS здесь не участвует
чисто chat/voice ограничены cap 84/100

📌 Входные данные
Voice 4,6ч · clean 3,1ч · raw extra 1,5ч
Chat-сессии 11 · msg 420

🏔️ Пик / планка
Цель: voice 6,0ч · 14 сессий · 900 msg
Планка берётся от top игрока ×70%, но не ниже fallback

📉 Модификаторы
voice: 77% ×45
sessions: 79% ×35
msg: 47% ×20

🧾 Источники
voice: canonical activity
chat: message activity windows

💡 До апа
до A: +1,2ч voice или +4 chat-сессии
```

### Kills Detail

```text
# ⚔️ Kills · разбор оценки

Итог: A · 81/100 · #41/168

🧮 Как считается
approved kills rank + рост/день + kills/ч JJS
рост выше 400/день не даёт очки

📌 Входные данные
Approved 7 200 · #41/168
Рост 30/день · 6 валидных дней
JJS 34,4ч · 6,1 kills/ч

🏔️ Пик / планка
Ранг считается среди игроков с approved kills
Для A+: нужно 34/день или +380 kills

📉 Модификаторы
+20% за рост
+6% за эффективность
0% за покрытие

🧾 Источники
proof windows: 3 · recent changes: 0
7 000 → 7 180 · +180 · 6д · 30/день · учтено
6 500 → 6 980 · +480 · 1д · не учтено: выше 400/день

💡 До апа
A+ откроется от +380 kills или 34/день
```

### JJS Detail

```text
# 🎮 JJS · разбор оценки

Итог: C+ · 55/100 · #58/94

🧮 Как считается
JJS часы недели сравниваются с S+ планкой
результат умножается на покрытие периода

📌 Входные данные
7,4ч/7д · покрытие 86%
Roblox готов · sync свежий

🏔️ Пик / планка
top недели: 20,3ч
S+ планка: 20,3ч ×70% = 14,2ч
fallback минимум: 6ч

📉 Модификаторы
raw score 62/100
coverage 86% → итог 53/100

🧾 Источники
domains.roblox.playtime
weekly rollup coverage

💡 До апа
до B: +1,6ч JJS
```

## 12. Final Validation Commands

Run:

```text
node --test tests/profile-model.test.js tests/profile-view.test.js tests/profile-operator.test.js tests/profile-synergy.test.js
```

Then:

```text
npm test
```

If both pass, commit with a message like:

```text
Improve profile rating transparency
```

If the user asks to push, push only after tests are green and `git status` has only intended changes.
