---
description: "Use when editing activity moderator controls, watched-channel behavior, activity state/runtime, or activity tests. Covers the activity operator seam."
applyTo: "src/activity/**, tests/activity-*.test.js"
---
# Activity Owner Rules

- Activity moderator controls and activity user detail flows belong in `src/activity/operator.js`.
- Preserve the existing seams between `operator.js`, `runtime.js`, `state.js`, `user-state.js`, and `role-apply.js`; do not collapse them back into `welcome-bot.js` unless there is no nearer owner.
- Preserve audit-log semantics and operator intent. Prefer exact watched-channel/manual-override behavior over convenience shortcuts.
- Keep patches local to the controlling activity owner. If persistence or startup behavior is involved, step one boundary over instead of widening the whole activity slice.