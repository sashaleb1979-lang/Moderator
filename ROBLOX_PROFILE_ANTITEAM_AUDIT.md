# Roblox Profile / Antiteam Identity Incident Audit

## Scope

Проверен slice, который мог объяснить жалобу: профиль и активность показывают неправильный Roblox account, похожий на Discord username, а antiteam при этом говорит, что usable Roblox нет.

Важно: локальный `welcome-db.json` в этом workspace является шаблоном, а не production snapshot. Поэтому этот документ фиксирует подтверждённые code-path причины и защиты, но не количественный production-аудит реальных пользователей.

## Confirmed Root Cause Class

Главный опасный класс был не в Roblox API, а в смешивании разных identity shapes.

До фикса несколько путей могли читать generic поля `username`, `userId`, `displayName` из слишком широкого объекта. Если callsite передавал whole profile fallback, Discord-level `profile.username` и `profile.userId` могли стать prefill/bootstrap Roblox identity.

Это особенно опасно рядом с legacy/repairable записями: profile UI мог доверять `hasVerifiedAccount` / `verificationStatus: verified`, а antiteam уже требовал usable identity через строгий owner seam. В результате профиль выглядел так, будто Roblox привязан, а antiteam честно видел missing/repairable state.

## Canonical Contract After Fix

Reusable Roblox identity теперь должна проходить один смысловой gate:

- trusted marker: `verificationStatus=verified`, `status=verified`, `hasVerifiedAccount=true` или `verifiedAt`
- real Roblox username
- valid numeric Roblox userId
- failed/unverified/rejected/denied states запрещают reuse

Owner seam для этого контракта находится в `src/integrations/shared-profile.js` через `resolveUsableVerifiedRobloxIdentity()`.

## Fixed Paths

### Profile / onboarding bootstrap

`buildProfileRobloxIdentitySession()` теперь возвращает identity только если source явно похож на Roblox-domain object и проходит usable gate. Whole profile `{ username: DiscordName, userId: DiscordId }` больше не становится Roblox identity.

`welcome-bot.js` больше не передаёт whole profile fallback в onboarding submit bootstrap и helper-panel Roblox prefill. Используются только `summary.roblox` / `domains.roblox`.

### Profile UI

Profile read-model больше не считает raw `hasVerifiedAccount` достаточным для публичного linked state.

Repairable/manual-only Roblox state теперь показывается как needing rebind/repair, а не как подтверждённый аккаунт. Это закрывает mismatch, где UI показывал username/avatar/link, а antiteam не мог использовать эту запись.

### Synergy viewer copy

Viewer hero больше не вставляет `Roblox <username>` без usable/trackable summary. Это важно, потому что hero-текст раньше мог легитимизировать грязную legacy запись.

### Antiteam

Antiteam helper/profile readers теперь проходят через `resolveUsableVerifiedRobloxIdentity()`. Repairable helper username не считается usable helper identity.

Standard antiteam Roblox modal после успешного Roblox API lookup промоутит resolved identity обратно в profile binding через существующий write seam и отмечает antiteam confirmation. Clan-anchor path не ребиндит caller profile, потому что там Roblox identity может принадлежать выбранному anchor user.

## Remaining Production Data Risk

Фикс закрывает новые загрязнения и перестаёт показывать repairable state как linked. Но если в production уже есть грязные записи, им всё равно нужен data repair или ручная перепривязка.

Минимальные категории для Railway/db audit:

- verified-looking Roblox records without valid numeric userId
- records where Roblox username equals Discord username/root profile username
- pending/failed/unverified records with stale username fields
- profiles with usable profile binding but missing antiteam confirmation
- antiteam ticket/draft identities that were never promoted before this fix

## Validation

- Focused Roblox/profile/antiteam suite: 90 pass / 0 fail.
- `node --check welcome-bot.js`: ok.
- VS Code diagnostics on touched files: no errors.
- Full `npm test`: 665 pass / 0 fail.

## Bottom Line

Система теперь разделяет три состояния, которые раньше могли смешиваться:

- есть какой-то Roblox-looking username
- есть verified-looking, но repairable/unusable запись
- есть usable verified Roblox identity with valid Roblox userId

Только третье состояние можно переиспользовать для profile/onboarding/antiteam. Это защищает от случая, когда Discord username случайно превращается в Roblox account, и синхронизирует user-facing профиль с тем, что antiteam реально может использовать.