# AGENTS

## Working Rules For This Repo

1. Work only in the tree the user is actually using. Do not mix a VFS snapshot and a local clone.
2. Refresh the baseline before new implementation work: what is already landed, what is intentional compat, and which backlog items are stale.
3. Do not restore code from local history, old snapshots, or pre-SoT fragments without diffing against current main.
4. Keep one owner per behavior. For startup and routing, use welcome-bot.js and src/runtime/client-ready-core.js. For activity controls, use src/activity/operator.js. For SoT load/save, use src/sot/loader.js.
5. Do not treat the legacy/SoT compat layer as garbage by default. First identify what is canonical owner and what is shadow/bridge.
6. If the symptom is "bot offline" or "nothing responds", start with startup logs, env/config, and ready-path triage before feature work.
7. Distinguish fatal boot blockers from degraded config. Token, guild id, unreadable DB/config, and invalid character catalog are startup blockers. Optional role/channel ids should degrade when possible.
8. In welcome-bot.js, work in narrow slices only. No broad rewrites of the hot path without a local hypothesis and a nearby validation target.
9. After the first substantive edit, run the narrowest focused validation for the touched slice immediately.
10. After focused validation, run full node --test before calling the change safe.
11. For runtime-only issues, green local tests are not enough. Confirm with logs or a manual smoke after restart.
12. If the task changes from rollout to incident recovery, freeze feature work and keep a separate recovery plan.
13. When you add a new owner seam, record it in repo notes or plan state so the next agent does not write around it.
14. Do not present a hypothesis as fact without a stack trace, a log, or a confirmed controlling code path.
15. If root cause is still uncertain, do not widen scope. One failure mode, one patch, one validation loop.

## Repo-Specific Notes

- index.js is only a thin wrapper over welcome-bot.js; do not treat old entrypoint snapshots as recovery sources.
- Legacy and SoT state are intentionally bridged in this repo. Removing compat paths blindly is a regression risk.
- Startup validation should fail hard only on real boot blockers, not on optional degraded-mode config.
- For production outages, log-first recovery is mandatory before architecture cleanup.