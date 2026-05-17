# План Синергетических Систем Профиля

> Этот файл фиксирует отдельный source of truth по динамическим и кросс-системным фичам профиля.
> Он не заменяет PROFILE_VISION_PLAN.md, а дополняет его именно по части синергии между kills, Roblox, Discord activity, voice, ELO, tierlist, mains и social graph.
> Обязательный companion-файл для расчётов и зон ненадёжности: PROFILE_SYNERGY_CALCULATION_SPEC.md.

## 1. Реакция На Последние Уточнения

1. Связка `kills + Roblox hours за тот же период` — это не факультативная идея, а P0-ось всего блока прогресса.
   Сейчас база уже частично есть: approved growth history по kills есть, Roblox playtime и daily buckets есть.
   Но для честного окна `между двумя последними апдейтами kills` нужна отдельная телеметрия proof-window snapshots, иначе часть аналитики будет только приблизительной.

2. Строка вида `твои зарегистрированные kills + сколько часов прошло с последнего рега + ОБНОВИ после 10ч+` — обязательна.
   Это должен быть один из самых полезных практических блоков self-profile, а не декоративная аналитика.

3. Требование `слежка должна начаться до первого из двух последних заливов kills` — правильное.
   Это значит, что playtime и сессионная телеметрия должны идти непрерывно, а при каждом approved update kills нужно сохранять snapshot cumulative metrics.
   Без этого нельзя честно сравнивать последние окна роста.

4. Friend Overlap и social suggestions — сильная база и уже почти опираются на реальные данные.
   У нас уже есть verified Roblox binding, server-friends-on-server и JJS co-play.
   Значит можно делать и overlap, и рекомендации `часто пересекаешься, но ещё не в друзьях`.

5. Идея с `активность знает, с кем ты часто контачишь, и предлагает Roblox-акки, если ещё не друзья` — годная.
   Но её надо формулировать честно: сначала как `часто пересекаетесь в JJS` и отдельно как `часто контачите в Discord/voice`, если эти источники реально есть.

6. По коопу нужно говорить аккуратно.
   Текущее Roblox runtime уже умеет ловить не просто факт `оба в JJS`, а группы пользователей с одинаковым JJS gameId и вести sessions/minutes together.
   Это сильнее, чем просто simultaneous online, но это всё ещё не гарантированный `пати-кооп` и не точный матчмейкинг-отряд.
   Каноническая формулировка на сейчас: `часто пересекаетесь в одной JJS-сессии`.

7. `Гайды переделать на активные ссылки в профили персов на JJS wiki` — правильно, но этого источника сейчас нет в каноническом каталоге.
   Сегодня у системы есть Discord combo-guide threads.
   Для внешней JJS wiki нужен новый canonical field `wikiUrl` на персонажа.

8. `Кто ты сейчас`, `персональный текст-тирлист формы` и похожие наблюдательные статусы должны быть первыми для чужих viewers.
   Это не вторичный garnish.
   Это должен быть самый верхний смысловой блок для просмотра чужого профиля.

9. `War Readiness` для кланов — сильная идея, но сейчас она только частично реализуема.
   Hours/last seen/prime time можно собрать.
   K/D и клановые принадлежности сейчас в системе канонически не живут.

10. Voice нужно вести отдельно и затем подмешивать в профиль.
    Collector уже есть, но он живёт в news-domain и не зеркалится в shared profile/profile read-model.

11. `Season Story` — хорошая фича, но это уже уровень после накопления richer archives.
    Без исторических snapshots по playtime/hourly peaks/kill windows это будет не story, а просто набор случайных строк.

12. `Начальные лимиты для отслежки = 10` принимаются как стартовое правило.
    По умолчанию: top-10 peers, top-10 overlaps, top-10 suggestions, top-10 kill windows, top-10 voice ties.

13. `S+ равняется по высшему балу, низший — по низшим показателям` — да, но только через динамическую нормализацию по живой популяции, а не по жёстко прибитым порогам.
    Иначе система быстро станет лживой при изменении общего уровня сервера.

## 2. Что Уже Реально Собирается Сейчас

### 2.1. Kills И Approved History
1. approvedKills и killTier уже есть в профиле.
2. История нескольких последних approved growth windows уже собирается из submissions.
3. Есть last reviewed / latest submission контекст.
4. Канонические kill tier thresholds уже существуют:
   - Tier 2: 1000
   - Tier 3: 3000
   - Tier 4: 7000
   - Tier 5: 11000
5. Канонические kill milestones тоже уже есть:
   - 20k
   - 30k

### 2.2. Roblox Identity И Runtime
1. verified/unverified/pending Roblox binding уже хранится в canonical roblox domain.
2. Есть username, displayName, userId, avatar, profileUrl, verified badge, refresh status и rename history.
3. Есть Roblox friends overlap на уровне `serverFriends.userIds` и `serverFriendsCount`.
4. Есть JJS playtime totals:
   - totalJjsMinutes
   - jjsMinutes7d
   - jjsMinutes30d
   - sessionCount
   - currentSessionStartedAt
   - lastSeenInJjsAt
5. Есть dailyBuckets по дням.

### 2.3. JJS Co-Play
1. Runtime уже ведёт co-play peers.
2. Для peer хранятся:
   - minutesTogether
   - sessionsTogether
   - daysTogether
   - sharedJjsSessionCount
   - lastSeenTogetherAt
   - isRobloxFriend
3. Текущая логика сильнее, чем `оба были в игре`:
   pair засчитывается, когда пользователи попали в одну JJS runtime group с одинаковым gameId.
4. Но это всё ещё не гарантированный party/duo/coop API-level truth.

### 2.4. Discord Activity
1. Есть activityScore, baseActivityScore, multiplier и trust-like signals.
2. Есть messages/sessions/active days на 7/30/90 дней.
3. Есть active watched channels 30d.
4. Есть lastSeenAt, daysAbsent, daysSinceGuildJoin.
5. Есть desiredActivityRoleKey / appliedActivityRoleKey / eligibility status / manualOverride / autoRoleFrozen.

### 2.5. Ranking И Character Layer
1. Есть current ELO, ELO tier, last submission status.
2. Есть tierlist main, influenceMultiplier, lockUntil, hasSubmission.
3. Есть mains и combo-guide links в Discord threads.
4. Внешних JJS wiki URLs на персонажей пока нет.

### 2.6. Voice
1. Уже есть отдельный collector voice transitions.
2. Он умеет хранить:
   - openSessions
   - finalizedSessions
   - durationSeconds
   - enteredChannelIds
   - finalChannelId
   - moveCount
   - lastVoiceCaptureAt
3. Но voice пока живёт в news-domain, а не в profile domain.

## 3. Чего Сейчас Не Хватает Для Чёткой Синергии

1. Нет полноценного hourly слоя по Москве в старом baseline.
   До нового foundation playtime вёлся по дням, а не по часам.
   Без этого prime time, `играет вечером`, `онлайн с 19:00 до 23:00` и heatmap по МСК будут только грубыми.

2. Нет proof-window snapshots как отдельного persisted слоя.
   Для честных строк `между двумя апдейтами kills` нужно хранить cumulative playtime snapshots в момент approved review.

3. Нет точного party/duo/co-op identifier.
   Сегодня co-play = совпадение в одном JJS gameId.
   Это хорошо для `часто пересекаетесь`, но недостаточно для claims вроде `всегда играете в одном отряде`.

4. Нет кланового canonical source.
   Для War Readiness по кланам, friend overlap по кланам и enemy/allied analysis нужен отдельный clan domain.

5. Нет K/D и других боевых combat stats.
   Пока это неоткуда честно взять.

6. Нет external JJS wiki catalog.
   Нужен canonical character metadata source с wikiUrl/slug/aliases.
   Целевой внешний источник для v1: страницы персонажей из https://jujutsu-shenanigans.fandom.com/wiki/Characters.

7. Нет profile-side mirror для voice summary.
   Нужно либо отдельное domains.voice, либо derived voice summary при построении read-model.

8. Нет исторической ленты social graph changes.
   Для Season Story и `социальный круг расширился на 4 игроков` нужны snapshots friend overlap/co-play growth по времени.

9. Нет per-character gameplay attribution.
   Значит вещи вида `именно на Megumi ты чаще всего делал рост` пока нереализуемы.

10. Нет отдельного player-facing synergy owner.
    Если всё это пихать прямо в model.js, профиль быстро станет неуправляемым.

## 4. Архитектурный Каркас Для Нового Слоя

### 4.1. Новый Owner Seam
Нужен отдельный pure owner, например `src/profile/synergy.js`.

Он должен владеть:
1. кросс-системными derived metrics,
2. proof-window analytics,
3. текст-тирлистом формы,
4. archetype/status block,
5. рекомендациями по overlap/suggestions,
6. countdowns до tier/milestone,
7. War Readiness summary.

### 4.2. Что Остаётся У Текущих Владельцев
1. `src/runtime/roblox-jobs.js`
   - playtime,
   - daily/hourly buckets,
   - co-play,
   - friend overlap runtime facts.
2. `src/integrations/shared-profile.js`
   - canonical normalized storage,
   - summary projection.
3. `src/news/voice.js`
   - raw voice session capture.
4. `src/profile/model.js`
   - только компоновка готовых synergy blocks в read-model.
5. `src/profile/view.js`
   - rendering и layout.

### 4.3. Стартовые Лимиты
1. top peers: 10
2. friend overlap profiles: 10
3. friend suggestions: 10
4. recent proof windows in synergy calculations: 10
5. notable season events: 10
6. voice contacts/channels: 10

### 4.4. Что Где Живёт По Слоям

#### Raw Collection
1. Roblox runtime raw facts живут в `src/runtime/roblox-jobs.js`.
   Сюда относятся:
   - JJS session start/continuation,
   - daily buckets,
   - будущие hourly buckets,
   - co-play pair facts,
   - Roblox friends overlap runtime facts.

2. Voice raw capture живёт в `src/news/voice.js`.
   Здесь должны оставаться только voice join/leave/move/session facts, без profile-specific narrative.

3. Kill proof-window snapshots не должны собираться в `src/profile/model.js`.
   Их нужно коммитить в момент approved review из review flow, но через отдельный helper seam, а не прямой разрозненной логикой в hot path.
   Рекомендуемый новый owner: `src/profile/synergy-snapshots.js`.

4. Character external links не должны жить во view.
   Канонический дом для `wikiUrl` и связанных character metadata — SoT character catalog.
   Для первой версии там должен храниться прямой link на страницу персонажа в Jujutsu Shenanigans Fandom.

#### Canonical Storage
1. Roblox raw canonical truth продолжает жить в shared-profile Roblox domain.
   То есть owner записи: `src/integrations/shared-profile.js`.

2. Proof windows нужно добавлять как новый canonical progress domain.
   Рекомендуемое место: `profile.domains.progress.proofWindows`.

3. Voice profile-facing truth не должен читаться напрямую из news raw sessions при каждом render.
   Нужен mirrored summary domain, например `profile.domains.voice.summary`.

4. Social suggestion candidates допускаются как derived cache, но не как первичный truth.
   Рекомендуемое место: `profile.domains.social.suggestions`.
   Источник истины для них всё равно остаётся в co-play/friend overlap/activity facts.

5. Character wiki links должны жить в SoT character records, а не в profile snapshots.

6. Clan truth пока некуда класть честно.
   До появления отдельного clan domain его нельзя притворно размазывать по profile blocks.

#### Derived / Read-Side Logic
1. Весь cross-system synthesis должен жить в отдельном owner-файле `src/profile/synergy.js`.
2. Именно он должен считать:
   - text-tierlist grades,
   - `кто ты сейчас`,
   - kills/hour windows,
   - countdown до next tier/milestone,
   - overlap suggestions,
   - War Readiness summary,
   - Season Story summary.
3. `src/profile/synergy.js` должен читать только canonical sources, а не raw Discord/Roblox/news events напрямую.

#### Read-Model Composition
1. `src/profile/model.js` не должен сам заново считать сложную синергию.
2. Его задача:
   - запросить готовые blocks у `src/profile/synergy.js`,
   - разложить их по секциям профиля,
   - разделить self-view и other-view ordering.

#### Rendering
1. `src/profile/view.js` должен отвечать только за layout и Components V2 rendering.
2. Во view не должны жить percentile rules, reminder thresholds, proof-window analytics или ranking formulas.

### 4.5. Какие Блоки В Какую Часть Профиля Идут
1. Верх чужого профиля:
   - персональный текст-тирлист формы,
   - `кто ты сейчас`,
   - короткий Main Core.

2. Верх self-profile:
   - зарегистрированные kills,
   - часы с последнего approved reg,
   - reminder `ОБНОВИ`,
   - последнее окно роста.

3. Social section:
   - Friend Overlap,
   - кто из друзей уже здесь,
   - скрытый круг,
   - top co-play peers,
   - later voice+game overlap.
   В v1 social map допускает не только strong ties, но и medium inferred ties.

4. Character section:
   - mains,
   - tierlist main,
   - combo-guide thread links,
   - будущие JJS wiki links.

5. Progress section:
   - последние growth windows,
   - average kills/hour,
   - countdown до next tier,
   - countdown до milestone,
   - stability line.

6. Later systems section:
   - War Readiness,
   - voice summary,
   - Season Story,
   - social map `кого ты знаешь на сервере`.

## 5. Динамическая Система Оценок И Текст-Тирлиста

### 5.1. Это Должно Быть Первым Для Чужих
Первый блок чужого профиля должен быть не `Игрок: @user`, а смысловое summary уровня:

Форма: A-
Чат: B+
Килы: A
Стабильность: B
Развитие: A-
Социальная связность: C+

И ниже сразу живой human-summary:

тип профиля: активный игрок, локальный в чате, Megumi-main, боевой стабильный

### 5.2. Как Нормализовать Буквы
1. Буквы должны быть динамическими, а не прибитыми навсегда.
2. Нормализация должна идти по живой популяции tracked users.
3. Рекомендуемая схема:
   - S+: top 3%
   - S: 90-97 percentile
   - A-range: 70-90 percentile
   - B-range: 40-70 percentile
   - C-range: 15-40 percentile
   - D: bottom 15%
4. Для осей с недостатком данных надо показывать `N/A`, а не фальшиво плохую букву.

### 5.3. Оси Текст-Тирлиста
1. Форма
   - current Roblox playtime,
   - current Discord activity,
   - freshness of last proof,
   - recency of JJS presence.
2. Чат
   - messages/sessions/active days.
3. Килы
   - current approved kills,
   - current tier,
   - standing vs tracked population.
4. Стабильность
   - равномерность активности,
   - days absent,
   - continuity across windows.
5. Развитие
   - last two or more approved windows,
   - kills/hour,
   - acceleration/deceleration.
6. Социальная связность
   - friend overlap,
   - co-play density,
   - verified ties,
   - later voice overlap.

## 6. Базовые Телеметрические Апгрейды До Больших Фич

1. Persist proof-window snapshots при каждом approved update kills.
   Нужно хранить cumulative JJS minutes, session count, overlap snapshot и timestamp на момент review.
   Foundation уже заведён: owner `src/profile/synergy-snapshots.js`, canonical path `profile.domains.progress.proofWindows`, snapshot flag `playtimeTracked`.

2. Добавить hourlyBucketsMsk в Roblox playtime.
   Реализовано.
   Foundation-формат: rolling MSK day-hour buckets с ключами `YYYY-MM-DDTHH`.

3. Добавить derived `hoursSinceLastApprovedKillsUpdate` и `jjsHoursSinceLastApprovedKillsUpdate`.
   Реализовано в `src/profile/synergy.js` как read-side база для self-progress блока.

4. Добавить social suggestions cache.
   Base cache уже реализован в `profile.domains.social.suggestions` из frequent non-friend co-play peers.
   На каждый verified profile хранить top candidate overlaps, которых нет в Roblox friends.

5. Добавить profile-side voice summary domain.
   Base mirror уже реализован в `profile.domains.voice.summary` через sync shared-profile из `sot.news.voice`.

6. Завести canonical character wiki url catalog.

7. Добавить daily/weekly season snapshot job для richer story blocks.

## 7. 40 Сильных Фич И Системных Расширений

### P0. Реально Полезные И Почти Сразу Нужные

1. Зарегистрированные kills + часы с последней регистрации.
   Формат: `Зарегистрировано: 4 320 kills • с последнего рега прошло 12ч 40м JJS`.
   Если прошло 10ч+ и есть активность — рядом выводится `ОБНОВИ`.

2. Последнее окно роста.
   Формат в одну плотную строку:
   `4 000 -> 4 320 kills • +320 • 14ч 20м JJS • 9д • 22.3 kills/ч`.

3. Сравнение двух последних окон роста.
   Пример:
   `последний ап: 22.3 kills/ч • прошлый: 17.1 kills/ч • форма роста выше обычной`.

4. Средняя скорость за всё время.
   Lifetime metric по всем proof windows:
   `средний темп: 18.4 kills/ч за весь отслеженный период`.

5. До следующего kill tier.
   Показать:
   - сколько kills осталось,
   - текущий средний темп,
   - сколько дней/часов до next tier при текущем pace.

6. До milestone 20k / 30k.
   Аналогично:
   `до 20k: 2 140 kills • ~6д при текущем темпе`.

7. Freshness reminder.
   Если с последнего approved reg прошло 10ч+ JJS, профиль честно пишет:
   `Ты уже наиграл заметно больше обычного после последнего рега. Есть смысл обновить kills.`

8. Friend Overlap.
   Блок:
   - найдено Roblox-друзей на сервере,
   - сколько из них verified,
   - сколько активны 7д,
   - сколько играют в JJS.

9. Кто из друзей уже здесь.
   Не только count, а top list verified overlaps.

10. Социальные рекомендации.
    Если peer часто пересекается с игроком в JJS, но `isRobloxFriend = false`, блок предлагает его как кандидата в друзья.

11. Твой игровой круг.
    Top-10 co-play peers с minutesTogether, sessionsTogether и lastSeenTogetherAt.

12. Проверенный круг.
    Отдельно выделять тех, кто одновременно:
    - verified profile,
    - часто пересекается в JJS,
    - уже находится у тебя в Roblox friends.

13. Скрытый круг.
    Обратный блок:
    verified + часто пересекаетесь + ещё не в друзьях.

14. Кто ты сейчас.
    Narrative block:
    - тихий гриндер,
    - чатовый активист без игры,
    - роблокс-машина, но в Discord почти призрак,
    - ветеран на просадке,
    - новичок, который быстро встроился.

15. Персональный текст-тирлист формы.
    Это должен быть самый верхний block для других viewers.

16. Discord vs Roblox balance.
    Система кратко пишет, где человек живёт сильнее:
    - больше в Discord,
    - больше в JJS,
    - стабильно в обоих мирах.

17. Main Core.
    Один плотный блок:
    - main list,
    - tierlist main,
    - последний рост,
    - частые напарники,
    - active guide/wiki links.

18. JJS wiki links на персонажей.
   Combo-guide threads остаются fallback, но каноническая цель — внешние character-page links из Jujutsu Shenanigans Fandom на mains.

19. Аккуратная строка истории ростов.
    Как text tierlist feed, но с Roblox часами рядом у каждого окна.

20. Proof gap detector.
    Если часов в JJS много, а proof давно не обновлялся, система не просто ругается, а объясняет разрыв.

### P1. Нужны Умеренные Телеметрические Апгрейды, Но Польза Очень Высокая

21. Prime Time по МСК.
    Показать `играет чаще всего с 19:00 до 23:00 МСК`.
    Для этого нужны hourly buckets.

22. War Readiness basic.
    Блок:
    - готовность к вару: высокая / средняя / слабая,
    - Roblox hours 7д,
    - Discord last seen,
    - proof freshness,
    - prime time.
    Без K/D и clan source это будет базовая версия, но уже полезная.

23. Voice summary.
    Отдельный profile block:
    - voice hours 7д/30д,
    - last voice seen,
    - frequent voice contacts,
    - любимые voice channels.

24. Voice + game overlap.
    Показывать людей, с кем игрок и часто сидит в voice, и часто пересекается в JJS.

25. Growth by time-of-day.
    Если появятся hourly buckets и proof snapshots, можно писать:
    `лучше всего фармишь вечером` или `основной рост приходит ночью`.

26. Season Story.
    Итог сезона:
    - основной персонаж,
    - самый сильный период,
    - лучший день,
    - Roblox форма,
    - Discord форма,
    - social circle growth.

27. Социальная карта `Кого ты знаешь на сервере`.
    Не просто друзья, а:
    - близкие игровые связи,
    - общие друзья,
    - совместные сессии,
   - verified overlaps,
   - medium inferred ties,
    - later clan ties.

28. Динамика развития.
    Сравнивать не только absolute kills, но и ускорение/замедление роста по последним окнам.

29. Stability line.
    Наблюдение уровня:
    `растёшь ровно`, `идёшь рывками`, `активность высокая, но прогресс рваный`.

30. Narrative update CTA.
    Вместо сухого `обнови kills` система пишет человекочитаемый повод:
    `После последнего рега у тебя уже 12ч 40м JJS и 5 новых сессий. Похоже, пора обновить kills.`

### P2. Будущее, Которое Стоит Готовить Уже Сейчас

31. Exact coop / party truth.
    Возможен только если появится источник точного lobby/party/server instance состава.
    До этого не обещать `кооп`, говорить `пересечения в одной JJS-сессии`.

32. Clan-aware War Readiness.
    Станет сильной фичей только после появления canonical clan domain.

33. K/D и боевые перформанс-метрики.
    Сейчас источника нет.

34. Character-specific gameplay attribution.
    Пока невозможно честно говорить `этот рост ты сделал именно на Megumi`.

35. Social circle evolution by season.
    Нужны historical overlap snapshots.

36. Voice squad evolution.
    Нужен profile voice mirror и overlap aggregation.

37. `Лучший день сезона` по JJS + Discord + growth.
    Нужны hourly/day story snapshots.

38. `Самая сильная неделя`.
    Нужны weekly rollups с retention.

39. `Переходный статус игрока`.
    Например: был тихим, стал боевым активным; был соло, стал social-core.

40. Full synergy leaderboard calibration.
    Для по-настоящему честных S+/A/B-grade систем нужны регулярные population snapshots, а не только on-demand computations.

## 8. Уточнённые Развилки И Принятые Решения

1. Верх self-profile остаётся утилитарным.
   Решение: сверху practical progress block.
   Текст-тирлист формы остаётся первым смысловым блоком именно для других viewers.

2. `ОБНОВИ` в v1 триггерится по простому правилу.
   Решение: `10 JJS часов после последнего approved update`.

3. War Readiness в первой версии не ждёт clan source.
   Решение: сначала personal readiness без притворного clan intelligence.

4. Season Story до появления явной сезонности считается по rolling окнам.
   Решение: rolling 30d/90d.

5. `Кого ты знаешь на сервере` в первой версии не ограничивается только strongest ties.
   Решение: включать strong + medium inferred ties.

6. Внешние character wiki links привязываются к конкретному источнику уже сейчас.
   Решение: хранить прямые ссылки на страницы персонажей из Jujutsu Shenanigans Fandom в character catalog.

## 9. Финальная Приоритизация

### Что Должно Делаться Первым
1. Верхний текст-тирлист формы для viewers.
2. `зарегистрированные kills + часы с последнего рега + ОБНОВИ`.
3. Последние growth windows с Roblox hours в той же строке.
4. Friend overlap + social suggestions.
5. `Кто ты сейчас` narrative block.

### Что Должно Делаться Следом
1. proof-window snapshots,
2. hourlyBucketsMsk,
3. prime time,
4. voice summary,
5. season story.

### Что Нельзя Переобещать До Новых Источников
1. точный пати-кооп,
2. clan-aware выводы,
3. K/D,
4. character-specific боевую attribution,
5. внешнюю JJS wiki без канонического каталога ссылок.

## 10. Фазы Выполнения

### Phase 0. Contracts И Calculation Spec
1. Завести и поддерживать PROFILE_SYNERGY_CALCULATION_SPEC.md.
2. Для каждой метрики фиксировать owner, source, persisted path, formula, limits и unreliable copy.

### Phase 1. Telemetry Foundation
1. Hourly MSK buckets в Roblox playtime. Реализовано.
2. Proof-window snapshots на момент approved kills update. Write-path реализован.

### Phase 2. Canonical Mirrors
1. Progress domain для proof windows. Базовый storage mirror реализован.
2. Voice summary mirror. Base mirror реализован.
3. Social suggestions cache как derived cache. Base cache реализован.

### Phase 3. New Profile Owner
1. Ввести `src/profile/synergy.js`. Базовый owner seam реализован.
2. Увести formulas/reminders/grades из model/view. Начато: last-approved window metrics и soft reminder больше не собираются inline в `model.js`.

### Phase 4. Self Progress Block
1. Практический self-progress block сверху self-view. Базовая версия реализована через `src/profile/synergy.js`.
2. Зарегистрированные kills, часы с последнего approved update и `ОБНОВИ`. Реализовано.
3. Последнее окно роста. Реализовано в base form из двух последних proof windows с честным fallback при ненадёжных Roblox-часах.
4. Countdown до next tier/milestone. Реализовано в base form по каноническим thresholds и последнему надёжному kills/JJS pace.
5. Сравнение двух последних окон и lifetime pace. Реализовано в base form внутри того же owner через growth-window series без возврата формул в `model.js`.
6. Следующий шаг фазы: richer CTA copy и более богатые формулировки стабильности/ускорения поверх уже готовых growth metrics.

### Phase 5. Viewer-First Narrative Block
1. Текст-тирлист формы.
2. `Кто ты сейчас`.
3. Short Main Core.

### Phase 6. Social Synergy
1. Friend Overlap.
2. Кто из друзей уже здесь.
3. Скрытый круг.
4. Top co-play peers.
5. Strong + medium inferred ties.

### Phase 7. Voice, Prime Time И Personal Readiness
1. Voice summary.
2. Prime time.
3. Personal War Readiness basic.

### Phase 8. Character Wiki Layer
1. `wikiUrl` в SoT character catalog.
2. Main Core enrichment.

### Phase 9. Story Layers
1. Season Story.
2. Social evolution.
3. Best-period summaries.

### Phase 10. Burn-In И Sync Docs
1. Focused tests.
2. Full `node --test`.
3. Discord smoke.
4. Sync `PROFILE_VISION_PLAN.md`, `PROFILE_SYNERGY_SYSTEM_PLAN.md` и `PROFILE_SYNERGY_CALCULATION_SPEC.md`.
