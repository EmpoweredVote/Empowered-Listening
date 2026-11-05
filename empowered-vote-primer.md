# Empowered Vote primer — moved, 2026-11-05

**This file is no longer the primer.** It is a pointer, left at the path you already know so
that an old link or an old habit lands somewhere useful instead of nowhere.

## Where it lives now

The primer is the **`ev-primer`** plugin in [EmpoweredVote/ev-ui](https://github.com/EmpoweredVote/ev-ui),
in the `empoweredvote` marketplace beside `ev-designer`. It is split in two, by shelf life
rather than by topic:

| | |
| --- | --- |
| [**philosophy.md**](https://github.com/EmpoweredVote/ev-ui/blob/main/plugins/ev-primer/skills/ev-primer/philosophy.md) | Values, the three pillars, account tiers as a product model, reputation, gems, roles, data sourcing. Durable — a conflict with it is a design bug, not a trade-off. |
| [**infrastructure.md**](https://github.com/EmpoweredVote/ev-ui/blob/main/plugins/ev-primer/skills/ev-primer/infrastructure.md) | Supabase schemas with real column names, services, repo conventions, the new-feature checklist. Dated, verified 2026-11-05, with every unconfirmed claim marked `[UNVERIFIED]` or `[OPEN]` and the open questions collected at the end. |

In Claude Code:

```
/plugin marketplace add EmpoweredVote/ev-ui
/plugin install ev-primer@empoweredvote
```

Installed, it loads itself when you start work in an Empowered Vote repo. You can also just
read the two files at the links above.

## Why the copy went away

The primer opens with *"read this document fully before writing any code."* A document that
asks for that cannot be a copy. A copy cannot be corrected everywhere at once, and nothing
tells a reader which copy they are holding.

Four repos carried this file, and all four carried the **same git blob** — `38561960`. Being
identical was not the reassurance it looked like: it meant all four were equally, and
invisibly, out of date.

## If you have a local copy, stop trusting it

Audited against the live Supabase project, the GitHub org and production HTTP responses on
2026-11-05. The philosophy half held up completely. The technical half did not:

| The February text says | Production says |
| --- | --- |
| `public.empowered_profiles` | No such table. It is `empower.empowered_profiles`, and it holds 0 rows. |
| `compass_responses.stance_value` / `.stance_text` | Renamed to `value` / `write_in_text`. No `stance_type`, no `calibrated_at`. |
| `inform.compass_inferred`, populated nightly | No such table. |
| Five schemas | Twenty-six. |
| Empower requires all **20** live topics | **61** are live. The number is written as an enforcement threshold. |
| `main` is production | `master` in 5 of the 14 most active repos — including three of the four that carried this file. |
| A standard `backend/` + `frontend/` layout | Matches none of the six repos checked. |
| Repos are named `empowered-[feature]` | 2 of 28. |
| Point UptimeRobot at `GET /api/health` | On a static site that path returns the SPA fallback: HTTP 200, `text/html`. The monitor is green forever, including while the site is down. |

None of that was written carelessly. It was accurate in February, and then the system moved.
That is the whole reason for the split: the primer now carries a verification date and a
method, and the half that rots is kept away from the half that does not.
