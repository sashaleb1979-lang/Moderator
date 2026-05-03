# План аудита и фиксов: тирлист коэффициенты, мейны по ролям, ELO Edit / Approve UI

> Файл теперь служит handoff-заметкой для следующего агента. Часть правок уже реализована в working tree, но ещё не коммичена и не деплоена. Перед продолжением опирайся на блок `Статус реализации`, а не на старые формулировки ниже, если они расходятся с кодом.

Состояние исходного аудита: коммит `e9dc90e` (после удаления pin/unpin). Текущее состояние working tree уже содержит локальную реализацию основных фиксов.

## Статус реализации на 03.05.2026

### Уже реализовано локально
1. `main`-голоса больше **не удаляются** из `draftVotes/finalVotes`. Пользователь может оценивать своего мейна.
2. Исключение по мейну перенесено в `src/integrations/tierlist-live.js`: current `mainIds` пользователя исключаются **только при глобальном агрегировании**. Если пользователь меняет мейна, старые голоса снова начинают учитываться автоматически.
3. Wizard / point-rate flow снова включает мейнов в очередь оценки. В preview они остаются помечены как `MAIN`, но это только визуальная отметка.
4. Startup backfill и `guildMemberUpdate` теперь синкают `mainIds` из прямых character roles, а не только influence.
5. `resolveLegacyTierlistInfluenceFromMember()` теперь использует реальные managed T1..T5 role ids через `getTierRoleId(...)`, так что коэффициенты больше не привязаны только к config/env.
6. ELO review flow исправлен: `Edit ELO` и `Reject` обновляют исходное review-сообщение в канале, а `Approve/Edit/Reject/Expired` оставляют в публичном канале компактную карточку без лишних `Review channel / Review message / Статус` полей.

### Что уже проверено
1. `node --test` → `76/76` pass.
2. `node --check welcome-bot.js` → clean.
3. diagnostics для `welcome-bot.js`, `src/integrations/tierlist-live.js`, `tests/tierlist-live.test.js` → без ошибок.

### Что осталось сделать вручную
1. Discord smoke check для tierlist coefficients: в модалке коэффициентов убедиться, что ответ больше не даёт ложное `0/N` там, где у голосовавших есть T1..T5 роли.
2. Discord smoke check для direct character roles: выдать/снять роль персонажа напрямую и проверить, что `mainIds` в legacy tierlist state обновились без открытия wizard-а.
3. Discord smoke check для ELO review: `Edit ELO` должен менять исходное сообщение in-place, `Reject` должен снимать кнопки, `Approve` должен оставлять компактную approved-card.
4. После ручной проверки: коммит в `main`, `git push origin main`, `railway up -c`.

### Важное уточнение по Bug B
Старое описание ниже местами устарело. Новая целевая семантика такая:
1. Роль персонажа определяет текущий `mainIds`.
2. Голос по текущему мейну хранится, но не влияет на общий тирлист.
3. При смене мейна старый голос автоматически возвращается в расчёт, а новый текущий мейн перестаёт влиять.

---

## Bug A — Коэффициенты «без роли / T1..T5» не пересчитываются (картинка 1: «0/39»)

### Симптом
В мод-панели тирлиста меняем коэффициенты, бот отвечает:
`Коэффициенты сохранены: ... Пересчитано влияний: 0/39.`
0 из 39 — пересчёт ни для кого не сработал, хотя в гильдии у людей есть T1..T5 роли.

### Диагноз
`resolveLegacyTierlistInfluenceFromMember()` (welcome-bot.js, строка ~5502) ищет ID тирных ролей **только** в `appConfig.roles.killTierRoleIds[tierKey]`:

```js
const roleId = String(appConfig?.roles?.killTierRoleIds?.[tierKey] || "").trim();
```

В этом боте роли T1..T5 **создаются автоматически** (`generatedRoles.tiers[tierKey]`) и хранятся в `db.generatedRoles`, а не в `bot.config.json`/env. Соответствующая корректная функция уже есть рядом — `getKillTierRoleId(tierKey)` (строка ~2454):

```js
return String(appConfig.roles.killTierRoleIds?.[tierKey] || generatedRoles.tiers?.[tierKey] || "").trim();
```

Она с fallback. Но resolver её не использует, поэтому `roleId` всегда пуст → ветка `if (!roleId || !multiplier) continue;` пропускает все 5 тиров → `best` остаётся равен `default` → у всех 39 голосовавших мультипликатор всегда совпадает с дефолтом (последним сохранённым), `prev !== influence.mult` ложно, `changed = 0`.

То есть **коэффициенты тиров никогда не применялись**, всё это время реально работал только `default`. Значит и сама тирлист-картинка считалась с учётом только дефолтного веса. Это не бутафория — `getStoredInfluenceMultiplier()` в `src/integrations/tierlist-live.js` действительно использует `influenceMultiplier` при свёртке голосов (строки 496–525), просто почти всегда там сохранён `default`.

### Фикс
В `resolveLegacyTierlistInfluenceFromMember` заменить локальное чтение конфигурации на готовый helper:

```js
function resolveLegacyTierlistInfluenceFromMember(member, rawState = null) {
  try {
    const roles = member?.roles?.cache;
    const influenceConfig = getLegacyTierlistInfluenceConfig(rawState);
    if (!roles) return { mult: influenceConfig.default, roleId: null };

    let best = influenceConfig.default;
    let bestRole = null;
    for (const tierKey of [1, 2, 3, 4, 5]) {
      const roleId = getKillTierRoleId(tierKey); // ← главное изменение
      const multiplier = influenceConfig[tierKey];
      if (!roleId || !multiplier) continue;
      if (roles.has(roleId) && multiplier > best) {
        best = multiplier;
        bestRole = roleId;
      }
    }
    return { mult: best, roleId: bestRole };
  } catch {
    return { mult: getLegacyTierlistInfluenceConfig(rawState).default, roleId: null };
  }
}
```

После фикса первое сохранение коэффициентов даст `Пересчитано влияний: N/39`, где N — количество голосовавших, у кого есть T1..T5 роли. Дальше `refreshLegacyTierlistPublicViews` пересоберёт картинку с правильными весами.

### Проверка после деплоя
1. Меняем «без роли x0.50, T1 x100». В логе должно быть `[legacy-tierlist][influence] startup backfill: changed >0/39` (или сразу в ответе модалки).
2. Глядим, что у 1–2 пользователей с T1 ролью реально голос имеет вес `100`, и тирлист сместился.

---

## Bug B — Мейны по ролям не закрепляются глобально (главный приоритет)

### Симптом
У пользователя есть роль персонажа (например «Юджи»), но в общем тирлисте этот персонаж не зафиксирован как его мейн (не вычеркнут из его голосов и не помечен «Мейн»). Закрепление работает только когда сам пользователь открывает панель тирлиста — вот тогда вызывается `syncLegacyTierlistMainsForInteraction`. Без открытия — мейны живут в профиле, но в `legacy-tierlist-state.json.users[id].mainIds` не появляются.

### Диагноз
1. **Нет startup-бэкфилла**. На старте бот делает `backfillLegacyTierlistInfluenceForExistingVoters`, но аналогичной функции для мейнов нет.
2. **`guildMemberUpdate`** (welcome-bot.js, строка ~7215) синкает только influence:
   ```js
   client.on("guildMemberUpdate", async (_oldMember, newMember) => {
     if (newMember.guild.id !== GUILD_ID) return;
     try {
       await syncLegacyTierlistInfluenceForMember(client, newMember);
     } catch (error) { ... }
   });
   ```
   Когда модератор выдаёт пользователю роль персонажа — мейны в тирлисте не обновляются.

### Фикс
Добавить две вещи.

#### B.1 Startup-бэкфилл мейнов из ролей
Рядом с `backfillLegacyTierlistInfluenceForExistingVoters` (строка ~5833) добавить:

```js
async function backfillLegacyTierlistMainsFromRoles(client, { refresh = true } = {}) {
  const liveState = getLiveLegacyTierlistState();
  if (!liveState.ok) return { total: 0, changed: 0, skipped: true, error: liveState.error };

  const guild = await client.guilds.fetch(GUILD_ID);
  // Все участники, у которых есть хотя бы одна управляемая роль персонажа
  const charRoleIds = new Set(getCharacterEntries().map(e => e.roleId).filter(Boolean));
  if (charRoleIds.size === 0) return { total: 0, changed: 0 };

  const members = await guild.members.fetch().catch(() => null);
  if (!members) return { total: 0, changed: 0 };

  let total = 0;
  let changed = 0;
  for (const member of members.values()) {
    if (member.user.bot) continue;
    if (![...charRoleIds].some(id => member.roles.cache.has(id))) continue;
    total += 1;
    const result = syncLegacyTierlistMainsForMember(
      liveState,
      member.id,
      member,
      db.profiles?.[member.id]
    );
    if (result.changed) changed += 1;
  }

  if (changed > 0) {
    saveLiveLegacyTierlistStateAndResync(liveState);
    if (refresh) {
      await refreshLegacyTierlistPublicViews(client, { liveState }).catch(() => {});
    }
  }
  return { total, changed };
}
```

И вызвать на старте сразу после influence-бэкфилла (строка ~7192):

```js
try {
  const mainsResult = await backfillLegacyTierlistMainsFromRoles(client, { refresh: true });
  if (mainsResult.total > 0) {
    console.log(`[legacy-tierlist][mains] startup backfill: changed ${mainsResult.changed}/${mainsResult.total}`);
  }
} catch (error) {
  console.error("Legacy Tierlist mains backfill failed:", error?.message || error);
}
```

#### B.2 Реактивный sync на смене ролей
В обработчике `guildMemberUpdate` (строка ~7215) добавить второй вызов:

```js
client.on("guildMemberUpdate", async (_oldMember, newMember) => {
  if (newMember.guild.id !== GUILD_ID) return;
  try {
    await syncLegacyTierlistInfluenceForMember(client, newMember);
  } catch (error) {
    console.error("Legacy Tierlist influence sync failed:", error?.message || error);
  }
  try {
    const liveState = getLiveLegacyTierlistState();
    if (liveState.ok) {
      const result = syncLegacyTierlistMainsForMember(
        liveState,
        newMember.id,
        newMember,
        db.profiles?.[newMember.id]
      );
      if (result.changed) {
        saveLiveLegacyTierlistStateAndResync(liveState);
        await refreshLegacyTierlistPublicViews(client, { liveState }).catch(() => {});
      }
    }
  } catch (error) {
    console.error("Legacy Tierlist mains sync failed:", error?.message || error);
  }
});
```

`syncLegacyTierlistMainsForMember` уже делает «если у юзера есть char-роли — берём их в `mainIds`, иначе берём `profile.mainCharacterIds`», и через `setLegacyTierlistMainIds` удаляет эти id из `draftVotes`/`finalVotes` — то есть мейны автоматически вырезаются из голосования и закрепляются как мейны.

### Проверка
1. Выдаём кому-то роль «Юджи» — в `/data/legacy-tierlist-state.json` пользователь получает `mainIds: ["yuji"]`, его голос за Юджи (если был) исчезает.
2. На старте бот логирует `[legacy-tierlist][mains] startup backfill: changed N/M` для всех уже носящих char-роли.

---

## Bug C — ELO Edit / Reject отвечают эфемеркой вместо обновления исходной заявки (картинки 2 и 3)

### Симптом
Картинка 2 — заявка в review-канале (pending, ELO 140). Жмём «Edit ELO», вводим 139, отправляем — бот присылает картинку 3 как **новое эфемерное сообщение** для модератора. Исходное сообщение в review-канале (картинка 2) при этом не меняется: там всё ещё ELO 140 и кнопки. Это рассинхрон.

### Диагноз
В `welcome-bot.js`, обработчики `elo_review_edit_modal:` (строка ~12595) и `elo_review_reject_modal:` (строка ~12643) делают:

```js
await interaction.reply(buildLegacyEloReviewPayload(submissionId, "...", true)); // ephemeral
```

`buildLegacyEloReviewPayload(_, _, includeFlags=true)` оборачивает payload в `ephemeralPayload` → новое личное сообщение, не апдейт исходного.

Сравните с welcome-flow: после edit/reject он берёт `fetchReviewMessage(client, submission)` (строка ~3549) и делает `reviewMessage.edit(...)`. Для ELO такой функции нет.

### Фикс

#### C.1 Helper по аналогии с welcome
Рядом с `postLegacyEloReviewRecord` (строка ~5957) добавить:

```js
async function fetchLegacyEloReviewMessage(client, submission) {
  if (!submission?.reviewChannelId || !submission?.reviewMessageId) return null;
  const channel = await client.channels.fetch(submission.reviewChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return null;
  return channel.messages.fetch(submission.reviewMessageId).catch(() => null);
}
```

#### C.2 Edit-modal: апдейт исходного сообщения + краткий ack модератору
В обработчике `elo_review_edit_modal:` после `saveLegacyEloDbFile(...)` заменить финальный `interaction.reply(...)` на:

```js
const reviewMessage = await fetchLegacyEloReviewMessage(client, edited.submission);
if (reviewMessage) {
  await reviewMessage.edit({
    embeds: [buildLegacyEloReviewEmbed(edited.submission, "pending")],
    components: [buildLegacyEloReviewButtons(edited.submission.id)],
  }).catch(() => {});
}
await interaction.reply(ephemeralPayload({
  content: `ELO обновлено: ${edited.submission.elo} (тир ${edited.submission.tier}).${syncWarning}`,
}));
```

#### C.3 Reject-modal: тот же паттерн, но без кнопок и со статусом «rejected»
В обработчике `elo_review_reject_modal:` после `saveLegacyEloDbFile(...)`:

```js
const reviewMessage = await fetchLegacyEloReviewMessage(client, rejected.submission);
if (reviewMessage) {
  await reviewMessage.edit({
    embeds: [buildLegacyEloReviewEmbed(rejected.submission, "rejected")],
    components: [],
  }).catch(() => {});
}
await interaction.reply(ephemeralPayload({ content: `Отклонено.${syncWarning}` }));
```

> Approve-кнопка уже работает корректно (`interaction.update(...)` потому что её жмут прямо на review-сообщении). После Bug D её тоже надо тронуть — см. ниже.

### Проверка
1. Создаём pending заявку, жмём Edit, меняем число — исходное сообщение в review-канале меняется на новое ELO/тир, кнопки остаются. Эфемерка модератору — короткая «ELO обновлено».
2. Reject — исходное сообщение становится «ELO заявка (rejected)» без кнопок. Юзер получает DM (как и раньше).

---

## Bug D — Карточка одобренной/отклонённой ELO-заявки распухшая (картинка 4 vs 5)

### Симптом
Картинка 4 (как сейчас): после Approve в review-канале остаётся embed с полями `Создано / Проверено / Review channel / Review message / Пруф / Статус`. Громоздко.
Картинка 5 (как должно быть, как у welcome): минимальный embed — только title `Welcome-заявка (approved)`, описание (игрок/мейны/kills/tier/ID/Создано) и `setImage`. Никаких extraFields.

### Диагноз
В обработчике `elo_review_approve` (строка ~10324) финальный шаг:

```js
await interaction.update(buildLegacyEloReviewPayload(eloReviewSubmissionId, `Одобрено.${syncWarning}`, false));
```

`buildLegacyEloReviewPayload` всегда добавляет `extraFields` (`Создано`, `Проверено`, `Review channel`, `Review message`, `Пруф`, `Статус`). Этот payload подходит для эфемерного просмотра модератора, но не для финального состояния заявки в публичном review-канале.

`buildLegacyEloReviewEmbed(submission, statusLabel)` (без extraFields) уже даёт ровно тот стиль, что у welcome (`buildReviewEmbed`): title + description + setImage.

### Фикс

#### D.1 Approve: писать минимальный embed
В обработчике `elo_review_approve` (строка ~10351) заменить финальный `interaction.update(...)` на:

```js
await interaction.update({
  embeds: [buildLegacyEloReviewEmbed(approved.submission, "approved")],
  components: [],
});
```

(Без `ephemeralPayload`, без `extraFields`.) Эфемерные подтверждения модератору, если нужны, отдельным `interaction.followUp(ephemeralPayload({...}))`. Для соответствия welcome-стилю одного только update достаточно.

#### D.2 Edit/Reject: уже исправлены в Bug C
После C.2/C.3 их финальные embed-ы тоже без лишних полей.

#### D.3 Истёкшие (expired) — оставить как есть или подравнять
В Bug C/D трогать ветку `if (isLegacyEloSubmissionExpired(...))` не обязательно. Но если хочется единообразия: тоже использовать `buildLegacyEloReviewEmbed(submission, "expired")` без extraFields.

#### D.4 Эфемерный «обзор» модератора (`/legacy_elo` или кнопка для просмотра) — оставить
`buildLegacyEloReviewPayload` с полями по-прежнему нужен для эфемерного просмотра модератором — он там уместен. Менять только то, что попадает в публичный канал.

### Проверка
После Approve в review-канале embed выглядит как картинка 5: title `ELO заявка (approved)`, описание + image, без `Review channel/Review message/Создано/Проверено/Пруф/Статус`.

---

## Дополнительно (попутные находки)

1. **`refreshLegacyTierlistPublicViews` дублируется** на горячем пути backfill: `if (!backfillResult.changed) { await refreshLegacyTierlistPublicViews(...) }` запускается даже когда внутри `backfillLegacyTierlistInfluenceForExistingVoters` уже был refresh. После Bug A фикс сразу будет `changed > 0`, поэтому сейчас не критично, но лишний `if` лучше упростить:
   ```js
   const backfillResult = await backfillLegacyTierlistInfluenceForExistingVoters(client, { refresh: true });
   if (backfillResult.total === 0) {
     await refreshLegacyTierlistPublicViews(client, { liveState }).catch(() => {});
   }
   ```

2. **`getLegacyTierlistInfluenceConfig` дефолт `default = 1`**, в то время как UI показывает `без роли x0.50`. Значит `default=0.5` уже сохранён в state из предыдущей правки. Норм, просто иметь в виду: если кто-то удалит ключ `default` из state, поведение откатится на 1, а не на 0.5. Если хочется, поставить более «нейтральный» дефолт (например `LEGACY_TIERLIST_ROLE_INFLUENCE.default ?? 1`).

3. **Тирлист-картинка реально учитывает `influenceMultiplier`** — это проверено в `src/integrations/tierlist-live.js#computeLegacyTierlistCharacterAvgOffset` (строки 503–525). Так что после Bug A фикса коэффициенты сразу заработают на картинке. Бутафории нет, был баг с identification роли.

4. **Нет тестов на резолвер** влияния и на синк мейнов из ролей. После фиксов добавить юнит-тесты в `tests/`:
   - `resolveLegacyTierlistInfluenceFromMember` с разными комбинациями `appConfig.killTierRoleIds` / `generatedRoles.tiers` / member.roles.cache.
   - `backfillLegacyTierlistMainsFromRoles` с моками `guild.members.fetch()`.

---

## Порядок работ

1. Применить фикс Bug A (один helper-вызов) — самый дешёвый.
2. Применить фикс Bug C (helper + два места). Без этого Bug D частично остаётся.
3. Применить фикс Bug D (Approve update — минимальный embed).
4. Применить фикс Bug B (новая функция backfill + расширение `guildMemberUpdate`).
5. `node --test` (74 теста должны пройти; затем добавить новые).
6. Коммит в `main` с сообщением вроде «Fix tierlist influence resolver, mains-from-roles backfill and ELO review UX».
7. `git push origin main` → `railway up -c -m "..."`.
8. Smoke: меняем коэффициенты в моде-панели тирлиста, выдаём кому-то char-роль, прогоняем одну ELO-заявку с Edit + Approve. Сверяемся с этим документом по «Проверкам» из каждого блока.

---

## Контекст репозитория (для нового агента)

- Single-file Discord bot: `welcome-bot.js` (~12k строк).
- Runtime data: `/data/legacy-tierlist-state.json` (legacy tierlist), `/data/legacy-elo-db.json` (ELO).
- Live state hot-reload: `getLiveLegacyTierlistState()`, `getLiveLegacyEloState()`, `saveLiveLegacyTierlistStateAndResync()`, `saveLegacyEloDbFile()`.
- Helpers ролей: `getCharacterEntries()` (с `roleId` после `ensureManagedRoles`), `getKillTierRoleId(tier)`.
- Welcome-flow review UI: `buildReviewEmbed`, `fetchReviewMessage`, `postReviewRecord` — эталон поведения.
- ELO review UI: `buildLegacyEloReviewEmbed`, `buildLegacyEloReviewButtons`, `buildLegacyEloReviewPayload`, `postLegacyEloReviewRecord`.
- Tierlist live math (учёт `influenceMultiplier`): `src/integrations/tierlist-live.js`.
- Деплой: `git push origin main` + `railway up -c -m "..."` (проект `spectacular-creation`, env `production`, сервис `Moderator`).
- Не создавать feature-ветки. Работать прямо в `main`.
