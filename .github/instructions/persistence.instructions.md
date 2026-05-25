---
description: "Use when editing SoT loading, persistence shape normalization, db storage, compat bridges, or persistence-focused tests."
applyTo: "src/sot/**, src/db/**, tests/sot-*.test.js, tests/db-*.test.js, tests/snapshot-db.test.js"
---
# Persistence Rules

- `src/sot/loader.js` is the persistence boundary owner.
- Do not rewrite persisted shapes, migration rules, or dual-write behavior blindly. Normalize incrementally and preserve established contracts.
- Do not remove compat bridges until canonical ownership is confirmed. Legacy and SoT paths can intentionally shadow each other.
- When persistence drift appears, confirm whether the owner is `loader.js`, `legacy-bridge/*`, `native-*`, or a resolver before patching.
- Validate shape-sensitive changes with narrow persistence tests first, then `npm test`.