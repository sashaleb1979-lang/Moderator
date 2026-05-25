# AGENTS

## Repo Summary

- This repo is a Node.js Discord onboarding and moderation bot.
- Runtime baseline: Node >= 18.17.0, discord.js 14, JSON-backed bot state, Railway deployment.
- Main entrypoint: welcome-bot.js.
- index.js is only a thin wrapper over welcome-bot.js; do not treat old entrypoint snapshots as recovery sources.
- Legacy and SoT state are intentionally bridged here. Do not remove compat paths unless the canonical owner and migration boundary are confirmed first.

## Default Agent Playbook

1. Work only in the tree the user is actually using. Do not mix a VFS snapshot and a local clone.
2. Refresh the baseline before new implementation work: what is already landed, what is intentional compat, and which backlog items are stale.
3. Route the task to one controlling owner before editing. Prefer the module that directly computes or mutates behavior over a wiring layer.
4. Form one local hypothesis and one cheap disconfirming check.
5. Make the smallest grounded edit that tests that hypothesis.
6. Immediately run the narrowest focused validation for the touched slice.
7. After the focused check passes, run the full test suite with npm test.
8. For runtime-only issues, do not stop at green local tests. Confirm with logs or a manual smoke after restart.
9. If root cause is still uncertain, do not widen scope. One failure mode, one patch, one validation loop.
10. If the task changes from rollout to incident recovery, freeze feature work and keep a separate recovery plan.

## Ownership Map

- Startup, event wiring, and top-level routing: welcome-bot.js
- Client-ready startup flow and periodic jobs: src/runtime/client-ready-core.js
- Activity moderator controls and activity user detail flows: src/activity/operator.js
- SoT load/save and persistence boundary: src/sot/loader.js
- Verification moderator modal/report flows: src/verification/operator.js
- Onboarding domain logic and helpers: src/onboard/*
- Roblox, tierlist, and external bridges: src/integrations/*
- Graphic tierlist rendering: graphic-tierlist.js
- Presentation defaults and state shaping: presentation.js and src/onboard/presentation.js

## Task Routing Rules

- If the symptom is "bot offline", "nothing responds", or slash commands are missing, start with startup logs, env/config, welcome-bot.js imports, and the ready path before feature work.
- If the issue is command registration, startup health, or periodic jobs, route first to welcome-bot.js and src/runtime/client-ready-core.js.
- If the issue is activity panels, watched-channel edits, manual overrides, or moderation audit behavior, route first to src/activity/operator.js.
- If the issue is onboarding submit flow, captcha, profile/tier assignment, or presentation refresh, route first to welcome-bot.js and src/onboard/*.
- If the issue is SoT drift, persistence, or state import/export shape, route first to src/sot/loader.js and the nearest SoT helper.
- If the issue is runtime verification panels or verification modals, route first to src/verification/operator.js.

## Config And Startup Rules

- Runtime config is built from bot.config.json plus env vars; env overrides file config.
- Treat DISCORD_TOKEN, GUILD_ID, unreadable DB/config, and invalid character catalog as fatal boot blockers.
- Treat optional role ids, optional channel ids, and other degraded-mode configuration as warnings unless the product explicitly requires offline-over-degraded behavior.
- Do not present a startup hypothesis as fact without a stack trace, a log line, or a confirmed controlling code path.
- For production outages, log-first recovery is mandatory before architecture cleanup.

## Editing Rules

- Do not restore code from local history, old snapshots, or pre-SoT fragments without diffing against current main.
- Keep one owner per behavior. Do not re-expand extracted logic back into welcome-bot.js unless the owning seam is clearly wrong.
- In welcome-bot.js, work in narrow slices only. No broad rewrites of the hot path without a local hypothesis and a nearby validation target.
- Do not treat the legacy/SoT compat layer as garbage by default. First identify what is canonical owner and what is shadow or bridge.
- When you add a new owner seam, record it in repo notes or plan state so the next agent does not write around it.

## Validation Rules

- Narrow checks first: run node --test with only the touched tests whenever a focused test exists.
- Full suite before calling the change safe: npm test.
- If startup, imports, or ready-path wiring changed, also run tests/welcome-bot-startup-smoke.test.js and tests/client-ready-core.test.js.
- Do not trust narrow green tests alone after touching welcome-bot.js imports or startup wiring; this repo has had production ReferenceErrors that slice tests missed.
- For runtime-only or Railway-only issues, confirm with restart logs or manual smoke after code validation.

## Quick Commands

- Install deps: npm install
- Start bot locally: npm start
- Run full tests: npm test
- Run a narrow slice directly: node --test tests/<target>.test.js

## Repo-Specific Reminders

- Startup validation should fail hard only on real boot blockers, not on optional degraded-mode config.
- registerGuildCommands is a critical startup step; if it fails, treat the boot as failed.
- refreshWelcomePanel, refreshAllTierlists, tier sync, and activity resume are non-critical startup steps; prefer degraded reporting over taking the whole bot offline.
