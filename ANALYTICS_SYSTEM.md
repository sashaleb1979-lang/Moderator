# Analytics System

## Purpose

This bot keeps operator-facing usage analytics in a separate JSON state file:

- default path: `DATA_ROOT/analytics-db.json`
- override: `ANALYTICS_DB_PATH`
- detailed event retention: 90 days
- older detailed events are compacted into daily archive buckets

Analytics failures are non-fatal. If an event cannot be written, the bot logs a warning and continues the Discord flow.

## Panel

Open the panel with either:

- `/analytics panel`
- `Analytics` from the main onboarding moderator panel

Views:

- `Overview`: total events, unique Discord users, link clicks, top features/users
- `Features`: per-feature totals, top actions, top users
- `Users`: per-user totals and top feature/action usage
- `Links`: redirect records and click counts
- `Recent`: latest detailed events

## Event Shape

Each detailed event uses this shape:

```json
{
  "id": "event id",
  "at": "ISO timestamp",
  "feature": "profile",
  "action": "open_card",
  "actorUserId": "Discord user id when Discord exposes it",
  "targetUserId": "target Discord user id when known",
  "guildId": "Discord guild id",
  "channelId": "Discord channel id",
  "messageId": "Discord message id",
  "interactionType": "command | button | select | modal | message | link",
  "outcome": "received | redirected",
  "metadata": {}
}
```

## What Is Collected

Discord interactions are recorded at the top-level `interactionCreate` router, before feature-specific owners handle the click.

Covered feature groups:

- `profile`: profile open, profile tabs, rating detail cards, Roblox bind, compact ELO/profile card
- `antiteam`: start panel, leaders, progress, guide, draft controls, ticket buttons, stats controls
- `onboarding`: welcome begin, quick mains, character picker, non-JJS captcha, Roblox modal, review approve/edit/reject, kills submit messages
- `tierlist`: text tierlist pagination, graphic panel, legacy tierlist dashboard/rating controls
- `elo`: ELO submit messages, ELO panel, ELO review controls
- `combo_guide`: slash commands, editor panel, selects/modals, tracked navigation and tech links
- `role_panel`: role grant buttons and moderator role-panel controls
- `verification`: verification entry/panel/report controls
- `activity_panel`: activity operator panel controls
- `daily_news`: Daily News operator controls
- `analytics`: analytics panel usage itself

## Redirect Tracking

Set `ANALYTICS_PUBLIC_BASE_URL` to enable redirect links.

Example:

```env
ANALYTICS_PUBLIC_BASE_URL=https://your-railway-app.up.railway.app
```

The bot then creates URLs like:

```text
https://your-railway-app.up.railway.app/a/r/<token>
```

The route records a click and returns `302` to the real target URL.

Current redirect-tracked public links:

- graphic tierlist button that opens the text tierlist
- combo guide navigation links
- combo guide injected tech links

Existing published combo/tierlist messages must be refreshed or republished before their links become tracked.

## Link Identity Limitation

Discord does not tell the bot which user clicked a normal public message link.

That means:

- buttons, selects, modals, slash commands, and submit-flow messages record exact `actorUserId`
- public redirect links record total/context clicks but keep `actorUserId` empty
- exact user identity for public link clicks would require Discord OAuth or replacing public links with Discord buttons/selects

This implementation intentionally uses anonymous redirects for public links.
