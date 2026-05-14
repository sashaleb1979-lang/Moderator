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
- Raw moderation capture for member removal, ban add, ban remove.
- Focused tests for news state, voice capture, moderation capture and SoT integration.

Not implemented yet:

- Daily compile pipeline.
- Fixed-time scheduler.
- Moscow day-window compiler.
- Audit-log reconciliation for kick vs leave.
- Timeout tracking.
- Public digest rendering.
- Cover PNG renderer for daily edition.
- Staff digest compiler.
- Preview/publish operator surface.

## Validation Status

- Focused tests for the new news slices are green.
- Active test tree under [tests](tests) is green with `node --test tests/*.test.js`.
- Full `node --test` currently also traverses archive tests under [backups/quarantine-20260510-213529](backups/quarantine-20260510-213529), so archive-only failures must be separated from the live workspace signal.

## Recommended Next Slice

1. Add fixed-time daily news scheduler and shadow compile loop.
2. Add Moscow day-window compiler with voice and moderation collectors.
3. Add timeout tracking and audit-log reconciliation for kick vs leave.
4. Build the edition renderer and public/staff payload builders.