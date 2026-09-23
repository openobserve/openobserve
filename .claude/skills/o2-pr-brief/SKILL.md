---
name: o2-pr-brief
description: Morning brief of your open PR workload across the openobserve GitHub org — PRs you opened, PRs waiting for your review, PRs assigned to you, PRs you commented on that wait for the author, and PRs you approved that still are not merged — with the next step for each and a close reminder for anything idle over a week. Read-only. Use when the user says "o2-pr-brief", "PR brief", "my PRs", "what needs my attention on GitHub", or from a daily scheduled task.
---

# o2-pr-brief

A read-only status report built fresh from GitHub on every run. It keeps no state and never writes to GitHub: no comments, labels, reviews, approvals, merges, closes, or pushes. If the user asks for one of those after reading the brief, confirm that single action first.

## Set up the daily run (once per person)

1. `gh auth status` must show you logged in with access to the openobserve org, and `python3` must be on PATH.
2. Open a Claude Code session in your openobserve checkout, so the scheduled task starts there and finds this skill, and say: "Every weekday at 9:00, run /o2-pr-brief". This creates a local scheduled task that runs as your own `gh` login. It runs while the Claude app is open and the machine is awake.
3. `git pull` on main now and then to pick up changes to this skill.

## Run

1. Run `python3 <this skill's directory>/scripts/pr_brief.py`. Options: `--stale-days N` (default 7), `--scope 'repo:openobserve/openobserve'` (default `org:openobserve`), `--user LOGIN` (only when the user asks for someone else's brief). It prints JSON. If `gh` is not logged in, say so and stop.
2. Write the brief from that JSON as described below. Query GitHub again only to settle something the JSON leaves ambiguous.

## What the JSON holds

Each PR appears once, in the first bucket that matches: `authored`, `review_requested`, `engaged` (you reviewed or commented on it), `assigned`.

Every item has `repo`, `number`, `title`, `url`, `author`, `fork`, `draft`, `size`, `age_days`, `idle_days` (days since the last human comment, review or push), `labels`, `ci` (`state`, `failing` check names, `pending` count excluding the `ci-gate` check, `awaiting_approval` workflow runs on a fork PR), `review_decision`, `reviews` (latest approve/changes-requested per reviewer), `pending_reviewers`, `mergeable`, `auto_merge`, `blockers` (why it is not merged yet), and `merge_ready` (true when nothing but the merge click is missing).

- `authored`: `unanswered` holds comments and reviews by others after your last activity, each with an `excerpt`.
- `review_requested`: `via` (`you` or `team:<slug>`), `requested_at`, `waiting_days`, and `engagement` when you already commented.
- `engaged` (and `review_requested`/`assigned` when you took part): `engagement.ball` tells who moves next:
  - `you:re-review-after-approval`: you approved and the author pushed code since. Merges of main do not count.
  - `you:author-responded`: the author pushed or replied after your last comment or review.
  - `you:re-requested`: your review was requested again after your last activity.
  - `merge`: you approved, nothing changed since, and it is still open. See `approved_not_merged_days` and `blockers`.
  - `author`: you spoke last and the author has not updated. See `waiting_on_author_days`; `my_last.excerpt` is what you said.
- `assigned`: `assigned_at` and `assigned_days`.

## Sorting PRs into the brief

Put each PR in exactly one section.

1. **🔴 Needs you**: the next move is yours.
   - Review requests unless `engagement.ball` is `author`. Show how long it has waited; flag it when `waiting_days` ≥ stale days. When `via` is a team, say which team, because someone else may have picked it up. When another reviewer already approved, say so. A draft can wait.
   - `engaged` PRs with a `you:*` ball: "re-review: new commits since your approval" or "author replied to your comments".
   - Your own PRs that need you: `unanswered` comments (who, one-line gist), changes requested, merge conflicts, failing checks (name them), no `ready-for-ci` label while you want CI, or `merge_ready` with `auto_merge` off ("click Merge when ready").
   - Assigned PRs whose next step is yours.
2. **🟡 Your PRs in progress**: your PRs waiting on someone else. Say who: the named pending reviewers, running CI, or the merge queue.
3. **✅ Approved, not merged**: `engaged` PRs with ball `merge`. Give `approved_not_merged_days` and the blockers in plain words, and say who has to act, usually the author. With no blockers: "approved and green, nobody has merged it". When `approved_not_merged_days` ≥ stale days, add the same close reminder as section 4; at 30 days or more, recommend closing it.
4. **⏳ Waiting on the author**: ball `author`, plus assigned PRs whose next step is the author's (a draft, changes requested). No action is needed; list them so nothing is forgotten. Read `my_last.excerpt`: if your last word asked for nothing ("LGTM", "thanks"), nothing is pending, so move the PR to the section that fits or leave it out. When `waiting_on_author_days` ≥ stale days, add "⚠️ no update from the author for N days — consider closing it (or one last ping)".
5. **🧊 Stale — decide**: your own PRs, and assigned PRs, with `idle_days` ≥ stale days. Recommend exactly one of: continue (rebase or merge main, then ping the reviewers by name), convert to draft (still wanted, not now), or close (superseded, idea dropped, or idle for months). Give the reason in one clause. Idle 30 days or more with no reviewer interest means recommend close.

## Repository facts that change the advice

- In `openobserve/openobserve` and `openobserve/o2-enterprise`, CI runs only while the PR has the `ready-for-ci` label and is not a draft. Missing label means CI never ran, which is not the same as a failure.
- On a fork PR (`fork: true`) every push needs a maintainer to approve the workflow runs ("Approve and run" on the PR's Checks tab) before CI starts; `ci.awaiting_approval` counts the waiting runs. A fork PR whose only checks are the gate and title checks is not green, CI simply has not started.
- The `review (deepseek)` check always fails on PRs from forks. Ignore it.
- `check-design-comment` / "Feature Design Comment Checker" fails when a `feat:` PR's description does not start with `Design at: #<issue>`.
- `BEHIND` on its own is not a blocker: the merge queue brings the branch up to date.
- A paired OSS and enterprise change uses the same branch name in both repos. When the user has PRs with the same `branch` in both, mention them together.

## Output

- Title: `PR brief — <login> — <date>`, then one line of counts: needs you / in progress / approved-not-merged / waiting on author / stale.
- Sections in the order above. Leave out empty sections.
- One line per PR: `[repo#N](url) short title — state → next step`. Drop the `openobserve/` prefix from repo names. Add at most one sub-line when the reason needs it, for example the failing check names or an unanswered reviewer's gist.
- No preamble and no closing summary. Write in the language the user uses with you, English by default.
