# Repo Guidelines

Node.js Discord onboarding/moderation bot for Jujutsu Shinigans.

Commands: `npm start`, `npm test`, `node --test tests/<target>.test.js`.

Owners: startup `welcome-bot.js`; ready/runtime `src/runtime/client-ready-core.js`; activity `src/activity/operator.js`; SoT `src/sot/loader.js`; verification `src/verification/operator.js`; onboarding `src/onboard/*`; integrations `src/integrations/*`, `graphic-tierlist.js`.

Edit the active owner in narrow slices. Do not broadly rewrite `welcome-bot.js`.

Preserve legacy and SoT compatibility paths unless current tests/logs prove they are stale.

Avoid broad cleanup. Fix the active failure mode first.

For implementation, refactoring, debugging, and code-editing tasks: output code only. No explanations, summaries, introductions, reasoning, or extra markdown unless explicitly requested.

Return the smallest correct change. Do not rewrite unrelated code.

Validate with focused tests first, then `npm test`; for runtime-only issues confirm with logs or smoke after restart.