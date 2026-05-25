---
description: "Use when editing verification moderator flows, OAuth callback/runtime behavior, queue/report handling, or verification tests."
applyTo: "src/verification/**, tests/verification-*.test.js"
---
# Verification Rules

- Keep verification moderator modal/report flows in `src/verification/operator.js`.
- Preserve the existing `deferReply` or `deferUpdate` plus `editReply` interaction patterns for modal/report flows; do not switch them casually to plain `reply` or `followUp`.
- Keep runtime/background behavior in `src/verification/runtime.js` and avoid mixing it back into onboarding or generic startup owners.
- Prefer narrow fixes around callback routing, report delivery, and queue/runtime state instead of widening the whole verification slice.