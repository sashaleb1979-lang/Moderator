---
description: "Use when editing startup, ready-path, command registration, Railway recovery, or runtime wiring. Covers welcome-bot.js, src/runtime, and startup tests."
applyTo: "welcome-bot.js, src/runtime/**, tests/*startup*.test.js, tests/client-ready-core.test.js"
---
# Runtime Startup Rules

- Start with logs, env/config assumptions, and the startup owners: `welcome-bot.js` plus `src/runtime/client-ready-core.js`.
- Separate fatal boot blockers from degraded warnings. `DISCORD_TOKEN`, `GUILD_ID`, unreadable DB/config, and invalid character catalog are fatal; missing optional role/channel ids are degraded unless the product explicitly says otherwise.
- `registerGuildCommands` failure is fatal. Treat it as a failed boot, not a warning.
- Do not trust narrow green tests alone after startup wiring or import changes. Ready-path import mistakes can still crash Railway.
- If startup imports or ready-path wiring changed, review startup smoke explicitly: `tests/welcome-bot-startup-smoke.test.js`, `tests/client-ready-core.test.js`, and any touched `tests/*startup*.test.js` slice.
- Keep `welcome-bot.js` fixes narrow. Do not chase old wrapper snapshots in `index.js` or re-expand owner logic back into the monolith during incident work.