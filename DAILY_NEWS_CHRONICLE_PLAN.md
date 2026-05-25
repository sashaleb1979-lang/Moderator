# Daily News Chronicle Plan

## Goal

Сделать отдельную ежедневную систему новостей, которая каждый день в 21:00 по Москве публикует один сильный публичный выпуск в формате edition-level Discord post и параллельно ведёт staff-only аудит покрытия, чтобы никакой важный результат не потерялся и не был молча отфильтрован.

## Public Output Contract

- Один публичный выпуск в день.
- Формат выпуска: cover PNG + curated main message/embed + supporting ranked embeds + auto-thread с длинными списками.
- Визуальный стандарт: edition-level quality, а не обычный embed-отчёт.
- Выпуск должен ощущаться как номер/issue: masthead, дата выпуска, hero metrics, секционные блоки, контрастные карточки, аватары, сильная иерархия.

## Staff Output Contract

- Отдельный audit digest для staff/log/report channel.
- В нём фиксируются suppressed items, orphaned items, rejected items, backlog, partial coverage, ambiguous moderation cases и runtime failures.

## Data Modules For V1

- Approved kill jumps.
- Top JJS playtime.
- Activity movers up/down.
- Top messages.
- Newcomers and newly verified users.
- Full voice recap.
- Moderation recap.
- Tierlist shifts.
- Interesting extras and watchlist.

## Voice Contract

- Нужен полный список всех, кто заходил в voice за день.
- Этот список должен публиковаться по никам в одну строку.
- Ники берутся как snapshot server nickname/displayName на момент события, с fallback на username.
- Нужен top 5 по суммарному времени в voice за день.
- В main edition показываются voice highlights и top 5.
- Полный список всех voice visitors уходит в auto-thread.
- Если coverage неполная, блок обязан маркироваться как partial/ambiguous.

## Moderation Contract

- V1 должен покрывать: left server, kick, ban, unban, timeout apply/remove.
- Пока audit-log reconciliation не доведён, raw member removals считаются ambiguous leave-or-kick.
- Public layer показывает только безопасные и понятные moderation highlights.
- Staff layer хранит resolution quality, ambiguous cases и более чувствительные детали.

## Delivery Rules

- Публикация один раз на Moscow dayKey после 21:00.
- Не каждые 24 часа от старта процесса, а fixed-time publish by wall clock.
- Нужны preview today, publish now, rerun last day и shadow mode.
- Нужен duplicate-publish guard.

## Coverage Rules

Каждый raw candidate event за день должен заканчиваться ровно в одном bucket:

- published_public
- published_staff
- suppressed_by_threshold
- pending_review
- rejected
- expired
- superseded
- ambiguous_source
- invalid_source
- orphaned

## State Ownership

- News state: [src/news/state.js](src/news/state.js)
- Daily compile owner: [src/news/compiler.js](src/news/compiler.js)
- Daily render owner: [src/news/render.js](src/news/render.js)
- Preview payload owner: [src/news/preview.js](src/news/preview.js)
- Publisher owner: [src/news/publisher.js](src/news/publisher.js)
- Operator owner: [src/news/operator.js](src/news/operator.js)
- Shadow scheduler owner: [src/news/scheduler.js](src/news/scheduler.js)
- Voice capture owner: [src/news/voice.js](src/news/voice.js)
- Moderation capture owner: [src/news/moderation.js](src/news/moderation.js)
- SoT normalization seam: [src/sot/schema.js](src/sot/schema.js)
- Runtime event wiring seam: [welcome-bot.js](welcome-bot.js)
- Future schedule seam: [src/runtime/client-ready-core.js](src/runtime/client-ready-core.js)

## Current Implementation Status

Implemented now:

- Canonical news domain in SoT.
- Edition-first news config defaults.
- Raw voice capture via voiceStateUpdate.
- Voice session open/move/leave tracking.
- Recovered incomplete voice leaves when the bot missed the open session.
- Raw moderation capture for member removal, ban add/remove and timeout apply/remove.
- Best-effort immediate kick audit lookup during member removal capture, with explicit fallback to ambiguous leave-or-kick when no recent audit match exists.
- Moscow day-window compiler for voice and moderation daily digests.
- Shadow daily scheduler tick in the shared client-ready periodic job seam.
- Fixed Moscow publish cutoff semantics for shadow compile even when the first successful tick is later than 21:00.
- Canonical per-candidate audit bucket trail for current voice and moderation slices.
- Compile-only kills collector for approved kill jumps, rejected/pending/expired/superseded submission audit, and public/staff selection.
- Compile-only activity collector for top message authors from persisted activity daily rows, with imprecise-row coverage marking.
- Compile-only newcomers collector for guild joins, Roblox verified events and access grants from shared profiles.
- Compile-only JJS gameplay collector for precise session/hourly playtime, with daily buckets kept staff/audit-only as ambiguous when cutoff precision is missing.
- Compile-only tierlist update collector for submitted main updates, while real up/down shifts remain unavailable until shift history exists.
- Compiler publicEdition/staffDigest sections now include kills, activity message leaders, newcomers, JJS gameplay and tierlist updates.
- Audit counts now include kill submissions, activity rows, newcomer events, gameplay players and tierlist updates in the canonical bucket trail.
- Public/staff payload renderer now turns compiled digest into edition-style Discord-ready message/embed/thread payloads with masthead, date, hero metrics, section blocks, accents, separators, emojis and coverage markers.
- Cover PNG renderer now builds a graphical Daily News attachment from `coverSpec`, and publisher attaches it to the public issue message.
- Preview helper now compiles and renders a digest without publish side effects by default, records last preview metadata in news runtime, and only writes the current-day history baseline when manual publish explicitly opts into capture mode.
- Publisher owner now sends public issue, continuation thread and staff digest with duplicate-publish guard and failure recording, and can also deliver a staff-only smoke issue without marking the day as publicly published.
- Operator owner now supports status, preview, rerun-style preview, publish-now and staff-only smoke orchestration without owning compile/render rules.
- Moderator panel now has live Daily News button/modal routing for overview, preview today, preview exact day, rerun day, public manual publish and staff-only smoke publish.
- Compile runtime status is separated from publish runtime status.
- Persisted daily digest snapshots in `db.sot.news.dailyDigests`.
- Focused tests for news state, voice capture, moderation capture, kills, activity, newcomers, gameplay, tierlist, render/preview, publisher/operator and SoT integration.

Not implemented yet:

- Global tierlist vote/rank history beyond the current day-over-day main/influence shift seam.
- Broader dropped-result audit beyond the current kills submission buckets.
- Automatic scheduler-to-publisher mode and live Discord smoke before enabling public auto-publish.

## Validation Status

- Focused tests for the new news slices are green.
- Active test tree under [tests](tests) is green with `node --test "tests/**/*.test.js"`.
- Full `node --test` currently also traverses archive tests under [backups/quarantine-20260510-213529](backups/quarantine-20260510-213529), so archive-only failures must be separated from the live workspace signal.

## Recommended Next Slice

1. Run live smoke and shadow review using the new staff-only smoke path to confirm the current cross-module audit watchlist plus history-backed movers/shifts are enough on real channels.
2. Keep auto-publish disabled until live smoke confirms publish/operator flow on real channels.
3. Only then decide whether any remaining audit blind spot needs a new owner/source instead of another render-only expansion.