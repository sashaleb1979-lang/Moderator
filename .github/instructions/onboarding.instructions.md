---
description: "Use when editing onboarding submit flow, access gating, captcha, character selection, presentation refresh, or onboarding tests. Keeps onboarding logic inside src/onboard."
applyTo: "src/onboard/**, presentation.js, tests/onboard-*.test.js, tests/access-companion.test.js, tests/bot-helper-panel.test.js, tests/channel-owner.test.js, tests/non-jjs-captcha.test.js, tests/text-tierlist-pagination.test.js"
---
# Onboarding Rules

- Keep onboarding domain logic in `src/onboard/*`. `welcome-bot.js` should stay a wiring seam, not the home for new onboarding decisions.
- Do not push extracted onboarding helpers back into the monolith unless the owning seam is clearly wrong.
- Preserve presentation and refresh boundaries: `presentation.js` and `src/onboard/presentation.js` shape copy/state, while refresh/channel helpers stay orchestration seams.
- When fixing onboarding behavior, route to the specific owner first: submit flow, access mode, captcha, character picker, refresh runner, or Roblox identity helper.