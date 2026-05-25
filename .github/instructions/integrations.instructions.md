---
description: "Use when editing Roblox, tierlist, ELO, graphic rendering, or external integration bridges and their tests."
applyTo: "src/integrations/**, graphic-tierlist.js, tests/roblox-*.test.js, tests/elo-*.test.js, tests/tierlist-*.test.js, tests/graphic-tierlist.test.js, tests/native-integrations.test.js"
---
# Integration Rules

- Preserve boundaries around Roblox, tierlist, ELO, and rendering integrations. Keep integration behavior in `src/integrations/*` or `graphic-tierlist.js` instead of leaking it into unrelated owners.
- Treat `graphic-tierlist.js` as a rendering owner, not a sink for domain logic.
- When integration behavior overlaps runtime or SoT state, patch the nearest seam instead of duplicating normalization across owners.
- Validate with the specific Roblox, ELO, or tierlist tests first; startup fallout belongs back in runtime owners.