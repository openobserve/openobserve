---
name: o2-loop
description: Plan, implement, and review a change with separated roles. The main session discusses the plan with the user and writes a spec; an o2-coder subagent implements it and runs the gates; an independent reviewer process (Codex CLI, or a sandboxed claude -p when Codex is unavailable) reviews each round's WIP commit; the coder fixes or disputes every finding; up to 5 rounds, then the user is asked. The main session only orchestrates, watches, and relays progress. Use when the user says "start the loop", "o2-loop", "start the review loop", or when a confirmed plan is ready to be implemented and reviewed before the user looks at it. Makes local WIP commits, never pushes.
---

# o2-loop

Four roles, kept apart on purpose:

| role | who | does |
|---|---|---|
| orchestrator | this session | discusses the plan with the user, writes `spec.md`, spawns the coder, runs the reviewer, follows `loop-state.py`, relays progress and verdicts, writes the report |
| coder | `o2-coder` subagent (`.claude/agents/o2-coder.md`) | implements the spec, runs the gates, answers findings; continued across rounds with `SendMessage` so it keeps its context |
| reviewer | a fresh process per round: Codex CLI, or `claude -p` in a sandbox | reviews the frozen WIP commit, verifies earlier findings, returns `verdict.json` |
| user | you | confirms the plan, watches the progress stream, rules on deferred or disputed items, does the final review |

The orchestrator does not edit code and does not review code. If it finds itself doing either, it is breaking the loop.

## Preconditions

- The plan was discussed with the user and confirmed.
- A reviewer backend is reachable. `review.sh` picks one (`--backend auto`, the default): Codex when its CLI is present (`codex` on PATH or bundled in ChatGPT.app), otherwise a sandboxed `claude -p` with a loud warning. Pass `--backend claude` only when the user asks. `--backend both` runs Codex and Claude on the same commit in parallel and merges their verdicts: request_changes if either says so, findings numbered `CX<round>-<n>` and `CL<round>-<n>` (near-duplicates merged and marked with both sources), and every finding goes to both reviewers in the next round so each verifies the other's. Use it when the user asks for a cross-check or when the change is risky enough to pay for two reviews (roughly the cost of a Claude round plus a Codex round, wall time of the slower one). The Claude backend needs macOS `sandbox-exec`; `--unsandboxed` overrides only when the user says so. If no backend exists, stop and tell the user.
- The ledger lives outside the repo at `~/.claude/o2-loop/<repo>/<branch-slug>/`; the scripts derive it. Nothing from it is ever committed.
- One loop per checkout and branch at a time. Two sessions working on the same repository each use their own `git worktree`; the loop does not lock anything.

## Ledger layout

```
~/.claude/o2-loop/<repo>/<branch-slug>/
  spec.md                        orchestrator: the confirmed plan the coder implements and the reviewer checks against
  round-N/evidence.md            coder: gates run, results, what was fixed this round
  round-N/coder.log              coder: one line per step, written live
  round-N/commit, backend        review.sh: the WIP commit reviewed and by which backend
  round-N/progress.log           review.sh: one line per reviewer action, written live
  round-N/verdict.json           review.sh: the reviewer's structured verdict
  round-N/coder-response.json    coder: fix / dispute / partial / defer per finding
  round-N/also/<repo name>/      review.sh and that repository's coder: commit, path, diff.patch, delta.patch, evidence.md, coder.log, coder-response.json
  round-N/prompt.md, diff.patch, delta.patch, candidates.md, events.jsonl, reviewer.err   review.sh
  round-N/codex/, round-N/claude/  review.sh (--backend both): each reviewer's own prompt, events, verdict and stderr; round-N/verdict.json is the merge
  report.md                      orchestrator: written when the loop ends
```

Scripts, all under `<skill dir>/scripts/` (this SKILL.md's directory):

- `review.sh --round N [--backend auto|codex|claude|both] [--also <checkout> ...]`: freezes the tree (and every `--also` checkout) as `wip(o2-loop): round N`, runs one reviewer round in disposable worktrees (two reviewers in parallel with `both`), writes `verdict.json`. Exit 0 approve, 10 request_changes, 1 failure. `--help` lists every flag.
- `loop-state.py [--cap 5]`: reads the ledger and prints `ACTION:` with the single next step. Run it after every step; do not decide the next step yourself.
- `selftest.py`: regression cases for the state machine and the verdict merge; run it after editing either script.

## Procedure

**0. Spec.** Write `<ledger>/spec.md`: what the change does, what it must not do, the files or areas it touches, the tests that should cover it, and any constraints from the discussion. One page at most. For a change that spans repositories (openobserve plus o2-enterprise, say), the spec opens with a **Contract** section, the part every repository must agree on: function and type signatures, feature gates, wire formats, the shared branch name (paired PRs need the same branch name in both repos). Then one section per repository with its own checkout path. Tell the user the loop is starting and which backend `review.sh --help` would pick.

**1. Spawn the coder.** `Agent` with `subagent_type: o2-coder`, `run_in_background: true`. The brief is only: the ledger path, "round 1", and "read spec.md". Agent definitions load at session start, so if the harness answers that `o2-coder` is not found, spawn `general-purpose` instead with the body of `.claude/agents/o2-coder.md` prepended to the same brief; the rules are identical, only the packaging differs. Do not paste the discussion; the spec is the contract. Before spawning, start a `Monitor` on `<ledger>/round-1/coder.log` (create it with `touch` first) so the coder's steps land in the chat:
```bash
while IFS= read -r line; do echo "$line"; case "$line" in *" question: "*|*" done"*) break ;; esac; done < <(tail -n 0 -f <ledger>/round-N/coder.log); pkill -f "^tail -n 0 -f <ledger>/round-N/coder.log"
```
When the coder reports back, post its summary to the user in one short paragraph. If it wrote a `question:` line, take the question to the user, answer it via `SendMessage` to the coder, and continue.

**1b. Paired repositories.** One coder per repository, spawned the same way with its own checkout path in the brief, each writing to its own ledger slot (`round-N/evidence.md` and `coder.log` for the primary repository; `round-N/also/<repo name>/evidence.md`, `coder.log`, `coder-response.json` for a paired one, where `<repo name>` is the checkout directory's name as `review.sh` derives it). Run them in parallel only when the contract in the spec is settled; when one side depends on an interface the other side has not written yet, run that side first and the dependent side after it reports. Coders never spawn agents themselves: splitting work is the orchestrator's job. Use real sibling checkouts for the paired repositories, not `.claude/worktrees/` paths, which other sessions may overwrite. One `Monitor` per `coder.log`.

**2. Review.** Run `loop-state.py`; it should say `review`. Start a `Monitor` on `<ledger>/round-N/progress.log` (touch it first):
```bash
while IFS= read -r line; do echo "$line"; case "$line" in *" done: "*|*" error: "*) break ;; esac; done < <(tail -n 0 -f <ledger>/round-N/progress.log); pkill -f "^tail -n 0 -f <ledger>/round-N/progress.log"
```
then run `review.sh --round N` in the background. The watcher's shape matters: reading through a process substitution lets the loop return after the final line, and the anchored `pkill` then ends the `tail`, which would otherwise stay alive until the Monitor times out; a plain `tail | while` never returns at all. Add `--also <checkout>` for every paired repository so one reviewer sees all sides and can report contract mismatches (the schema's `repo` field on each finding says which side it belongs to). Tell the user round N started and which backend. Relay the monitor lines as they come, in the user's language. On exit 1, read `progress.log` and `reviewer.err`, fix the cause if it is ours (missing evidence, no changes vs base, auth), rerun once, else stop and report.

**3. Relay the verdict before anything else.** As soon as `review.sh` returns, post: backend, verdict, every finding as one line (id, severity, file:line, title, and with `both` which reviewers reported it), and each prior finding's status. With `both`, say when the two reviewers disagreed on a prior finding; the merge keeps it open if either did. The user sees what the reviewer said before seeing what the coder does about it.

**4. Hand the findings to the coder.** Run `loop-state.py`; it says `respond`, or `cap` when the round cap is already reached with a non-approving verdict, in which case go to step 5 before the coder does any more work. `SendMessage` to the same coder agent: the path of `round-N/verdict.json`, "round N+1", and, only if the verdict is `approve` and the remaining findings are low, "defer the lows". With paired repositories, message every coder; each answers the findings whose `repo` is its own and ignores the rest, and `loop-state.py` merges the responses. Start a `Monitor` on `round-(N+1)/coder.log` first. When the coder reports, post its per-finding decisions to the user (id, action, reason).

**5. Decide by the state machine.** Run `loop-state.py` and do exactly what `ACTION` says:
- `agreed`: go to Ending the loop.
- `next`: go to step 2 with round N+1.
- `cap`: write an interim `report.md` (outcome `paused after N rounds with K open items`), then `AskUserQuestion`: continue for up to 3 more rounds, or stop and hand over. Show the open items. On continue, rerun `loop-state.py --cap N+3` and go on; on stop, finish with outcome `stopped after N rounds with K open items`.
- `respond`, `evidence`, `review`: something is missing; do that step.

`loop-state.py` judges the last round that has a verdict, so a prepared next round (its `coder.log` or `evidence.md`) never hides `agreed` or `cap`. Agreement, as it computes it: the last verdict is `approve`, no finding with original severity critical, high, or medium is open, every open low is answered with `defer`, the coder's `open_items` is empty, and HEAD equals the reviewed commit with a clean tree. Any edit after an approve invalidates it and needs another round.

## Ending the loop

Write `<ledger>/report.md` with, in this order:

1. **Outcome**: `agreed after N rounds`, `paused after N rounds with K open items`, or `stopped after N rounds with K open items`.
2. **Change summary**: from `spec.md`, a few sentences.
3. **Rounds**: one line per round: backend, verdict, new findings, what was fixed.
4. **Fixed**: each finding fixed, with file and a one-line description.
5. **Disputed, partial, or deferred**: each item the user has to rule on, with the reviewer's last note and the coder's last note side by side. Present even when empty.
6. **Unverified edits**: `git status --short` plus `git log --oneline <last reviewed commit>..HEAD`, or `none`. If not `none`, the outcome must not say `agreed`.
7. **Residual risk**: what is not covered by tests or review, anything skipped.
8. **Files changed**: `git diff --stat <merge-base> HEAD` and the WIP commits from `git log --oneline <merge-base>..HEAD`.

Then `PushNotification` with the outcome line and the number of items for the user, and in the chat: the outcome line, the items to rule on, a link to `report.md`, the number of WIP commits, and stop. Do not push or open a PR. Squash the WIP commits into one properly worded commit only when the user, after their review, says so:
```bash
git reset --soft <merge-base> && git commit
```

## Rules that override convenience

- The orchestrator never edits the change and never reviews it; the coder never commits; the reviewer never writes. Each role's value comes from not doing the others' work.
- The reviewer sees only the ledger and the frozen commit. Never paste the discussion or this session's reasoning into evidence, spec, or responses to steer it.
- The Claude backend runs inside a disposable worktree under a deny-by-default seatbelt (no MCP servers, no Write/Edit, no web tools), with candidates from a separate `code-review` pre-run that the reviewer must confirm before adopting. Its pre-approved Bash commands include git, grep, sed, awk, find, python3 and bash; the seatbelt, not the allow list, is what keeps writes inside temp directories. On a host without `sandbox-exec`, `--unsandboxed` lets the loop run in a reduced mode: the reviewer gets no Bash, no ledger access and no pre-run, so the harness's working-directory confinement of Read/Grep/Glob is the wall; patches are inlined in the prompt (capped at 200 KB each) and paired worktrees stay readable. On macOS with `sandbox-exec` the flag changes nothing. Codex is preferred because it is a different vendor's model; when the Claude backend reviews, say so in the report and pass `--model` so the reviewer differs from the coder's model.
- Never lower the reviewer's effort or budget to get an approve. The defaults (Codex `high`, Claude 15 dollars per round) are the loop; the flags exist for debugging.
- A round that already has a `verdict.json` cannot be rerun; a redo takes the next round number.
- Never amend, reset, or rebase a WIP commit while the loop runs; later rounds diff against them.
- Never edit the skill's own scripts while a round is running.
- If the user interrupts, leave the ledger as is and say which round it stopped in.
