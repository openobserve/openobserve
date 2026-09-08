---
name: claude-codex-loop
description: Two-AI review loop for a change Claude has just implemented. Claude runs fmt, clippy, tests and its own /code-review, then Codex (OpenAI CLI) reviews the branch, Claude fixes or disputes each finding, Codex verifies, up to 5 rounds. Ends when Codex approves and Claude has no open items; if the cap is hit with items still open, asks the user whether to continue. Then notifies the user for final review. Makes one local WIP commit per round and never pushes. Use when the user says "start the review loop", "let codex review", "claude-codex-loop", or after an implementation is done and they want it reviewed before they look at it.
---

# claude-codex-loop

Claude writes, Codex reviews, Claude fixes, Codex verifies. The loop ends when both sides have nothing open. After 5 rounds without agreement it pauses and asks the user whether to keep going. The user does the final review after the loop, so the loop must leave a complete, honest ledger behind. Each round is frozen as a local WIP commit that Codex reviews; nothing is ever pushed.

## Preconditions

- The plan was discussed with the user and confirmed. The implementation is done in the working tree of the current branch.
- A reviewer backend is reachable. The script picks one itself (`--backend auto`, the default): the Codex CLI (`codex` on PATH, or the copy bundled in `/Applications/ChatGPT.app/Contents/Resources/codex`) when present, otherwise a fresh `claude -p` process. Pass `--backend claude` only when the user asks for the Claude reviewer explicitly. If neither backend exists, stop and tell the user; do not review alone in this session and call it the loop.
- The ledger lives outside the repo at `~/.claude/codex-loop/<repo>/<branch-slug>/` (the script derives this by default); nothing from it is ever committed.
- The script runs `git add -A` before committing, so check `git status` first and remove stray files you did not mean to include.

## Ledger layout

```
~/.claude/codex-loop/<repo>/<branch-slug>/
  round-N/evidence.md              written by Claude before each Codex run
  round-N/commit                   sha of the WIP commit the reviewer saw (written by the script)
  round-N/backend                  which backend reviewed this round (codex or claude)
  round-N/codex.json               written by the script (structured Codex verdict)
  round-N/claude-response.json     written by Claude after reading codex.json
  round-N/progress.log             one line per reviewer action, written live by the script
  round-N/prompt.md, diff.patch, delta.patch, candidates.md, events.jsonl, codex.err   written by the script
  report.md                        written by Claude when the loop ends
```

`<repo>` is the main checkout's directory name (shared by all its worktrees) and `<branch-slug>` is the branch name with `/` replaced by `-`. Run `codex-review.sh --help` to see the exact default.

## Round procedure

Repeat for `N = 1, 2, 3, 4, 5`, and beyond only with the user's explicit go-ahead (see step 6):

1. **Gate the code yourself.** Run the repo's formatter, linter, and the tests that cover the changed code, in that order, and stop to fix on any failure. Use the commands the repo's `CLAUDE.md` prescribes; for openobserve that is:
   ```bash
   cargo fmt --all
   cargo clippy --workspace --all-targets -- -W clippy::too_many_lines -W clippy::cognitive_complexity -W clippy::excessive_nesting -D warnings
   ```
   Name the tests explicitly (name them explicitly, not the whole suite unless the change is cross-cutting). On round 1 only, also run the `code-review` skill at medium effort on the current diff and fix what it confirms. If the change touches `#[cfg(feature = "enterprise")]` code, follow `CLAUDE.md`: verify with the o2-enterprise `Cargo.toml.openobserve` swap if available, otherwise say in the evidence that it was not checked.

2. **Write `round-N/evidence.md`.** Plain facts only: the exact commands run, pass or fail, the test names, the tail of any failure output, and what the round-1 self-review found and fixed. On rounds 2 and later, also list which findings were fixed in this round. Do not argue with Codex here; arguments go in the response file.

3. **Run the reviewer, and let the user watch.** Tell the user in one line that round N is starting and which backend it uses. Then start a `Monitor` on the progress log before launching the script, so every reviewer action lands in the chat as it happens:
   ```bash
   touch <ledger>/round-N/progress.log && tail -n 0 -f <ledger>/round-N/progress.log | while IFS= read -r line; do echo "$line"; case "$line" in *" done: "*|*" error: "*) break ;; esac; done
   ```
   and run the script in the background:
   ```bash
   <skill dir>/scripts/codex-review.sh --round N
   ```
   `<skill dir>` is the directory holding this SKILL.md (`~/.claude/skills/claude-codex-loop` when installed per user, `.claude/skills/claude-codex-loop` when checked into a repo). The script locates its own prompts and schema relative to itself.
   The script first commits the working tree as `wip(codex-loop): round N` (skipped if the tree is already clean) and records the sha in `round-N/commit`; the reviewer sees that commit. Exit 0 means the reviewer approved, 10 means it requested changes, 1 means the run itself failed. On exit 1, read `progress.log` and `codex.err`, fix the cause if it is on our side (missing evidence file, no changes vs base, auth expired), rerun once, and if it still fails stop and report to the user. Pass `--base <branch>` when the PR does not target `main`.

4. **Report the verdict to the user before touching anything.** As soon as the script returns, post in the chat: the backend, the verdict, and every finding as one line each (id, severity, file:line, title), plus each prior finding's status. The user must see what the reviewer said before seeing what Claude did about it.

5. **Read `round-N/codex.json` and handle every finding.** For each entry in `findings`, and each `still_open` entry in `prior_findings`, go to the cited file and line and decide:
   - **fix**: the finding is real. Change the code, and note the fix.
   - **dispute**: the finding is wrong. Write the concrete reason, citing code, an invariant, or a test that proves it. A dispute without a specific reason is not allowed; if the only reason is "it seems fine", fix it instead.
   - **partial**: real but the full fix is out of scope for this change. Say what was done and what remains, so the user can decide.
   - **defer**: only for a low finding on an `approve` verdict. The code stays as Codex approved it, and the item goes to the report for the user. This is the only action that does not change the working tree, and the only one allowed if you intend to stop this round.
   Never drop a finding silently, and never edit `codex.json`.

6. **Write `round-N/claude-response.json`,** and post the same decisions in the chat as one line per finding (id, action, a few words of reason), so the user sees the disposition of each finding at the end of the round:
   ```json
   {
     "round": N,
     "responses": [
       {"id": "F1", "action": "fix", "note": "what changed and why", "files": ["src/..."]},
       {"id": "F2", "action": "dispute", "note": "why the finding is wrong, with file:line evidence", "files": []}
     ],
     "open_items": ["anything Claude itself is still unsure about, or empty"]
   }
   ```
   `action` is one of `fix`, `dispute`, `partial`, `defer`.

7. **Decide whether to continue.** Agreement means Codex approved the exact code that is in the working tree now. Check that with:
   ```bash
   test "$(git rev-parse HEAD)" = "$(cat ~/.claude/codex-loop/<repo>/<branch-slug>/round-N/commit)" && test -z "$(git status --porcelain)" && echo unchanged
   ```
   - Stop with **agreement** when the verdict is `approve`, no prior finding with an original severity of critical, high, or medium is `still_open`, every `still_open` low finding has been answered with `defer` (in this round's response file), `open_items` is empty, and the check above prints `unchanged`. Deferred low findings stay in the report for the user. Low findings on an `approve` are answered with `defer`, never fixed in the same round.
   - Any edit after an `approve` invalidates it: the next round must run so Codex sees the edit. If the cap has been reached and the user has not extended it, do not edit; `defer` instead.
   - At the **round cap** (round 5, or the last round the user granted) with anything still `still_open` or disputed on both sides, or with HEAD or the working tree no longer matching the last reviewed commit: do not start another round on your own. Write an interim `report.md` (same format as below, outcome `paused after N rounds with K open items`), then ask the user with `AskUserQuestion`: continue for up to 3 more rounds, or stop here and hand over. Show them the open items in the question. On "continue", the cap moves to N+3 and the loop resumes with round N+1. On "stop", finish with outcome `stopped after N rounds with K open items`; every edit made after the last Codex verdict is listed in the report as unverified.
   - Otherwise go to the next round. A round that only fixes things and writes evidence is still a full round: Codex must see the fix.

## Ending the loop

Write `report.md` in the ledger root with these sections, in this order:

1. **Outcome**: `agreed after N rounds`, `paused after N rounds with K open items` (interim, awaiting the user's decision), or `stopped after N rounds with K open items`.
2. **Change summary**: what the change does, from the user's confirmed plan, in a few sentences.
3. **Rounds**: one line per round with backend, verdict, findings count, and what was fixed.
4. **Fixed**: each finding fixed, with file and a one-line description.
5. **Disputed, partial, or deferred**: each item both sides still disagree on, or that was left for the user, with Codex's last note and Claude's last note side by side. This section must be present even when empty. The user rules on these.
6. **Unverified edits**: output of `git status --short` plus `git log --oneline <last reviewed commit>..HEAD`, or `none`. If this is not `none`, the outcome line must not say `agreed`.
7. **Residual risk**: what Claude thinks is still not covered by tests or review, and anything skipped (enterprise check, slow tests).
8. **Files changed**: output of `git diff --stat <merge-base> HEAD`, and the list of WIP commits from `git log --oneline <merge-base>..HEAD`.

Then notify the user. Load `PushNotification` via `ToolSearch` and send the outcome line plus the number of disputed items. In the chat message, lead with the outcome line, list the disputed items if any, link `report.md`, say that the branch carries N WIP commits, and stop. Do not push or open a PR. Squash the WIP commits into one properly worded commit only when the user, after their review, tells you to:
```bash
git reset --soft <merge-base> && git commit
```

## Rules that override convenience

- The reviewer runs read-only and cannot build, whichever backend it is. For the Claude backend the containment is the disposable checkout plus the seatbelt; the flags only remove MCP servers, Write/Edit, and web access, and pre-approve read-only commands (git, head, tail, cat, ls, wc, nl) so the reviewer is not blocked. Claude owns compiling and testing; the evidence file is how the reviewer learns the results, so it must be accurate.
- Every reviewer process works inside a disposable `git worktree` of the reviewed commit that the script creates and removes. The Claude processes are additionally wrapped in a macOS seatbelt (`sandbox-exec`) that denies every file write except the worktree's git metadata, temp directories, and claude's own session state, so neither the checkouts, the ledger, nor `~/.claude` settings, skills, agents and hooks can be written; the script verifies the worktree is unchanged after each process and discards the verdict otherwise. Without `sandbox-exec` the Claude backend refuses to run; `--unsandboxed` overrides that only when the user says so. If a run dies mid-way, `git worktree prune` cleans the stale entry.
- A round that already has a `codex.json` cannot be rerun; a redo needs the next round number. This keeps every verdict bound to the commit it was given.
- The Claude backend is a separate process that only sees the ledger. Never paste this session's reasoning or conversation into evidence or responses to steer it; the reviewer's value is that it has not seen them. Pass `--model` so the reviewer is not the model writing the code in this session (the script defaults to opus); say in the report which model reviewed.
- The Claude backend gets candidate findings from a separate `code-review` pre-run on the same commit (typed findings when the skill submits them through ReportFindings, otherwise its prose); the reviewer must confirm each before adopting it, so a candidate is never a finding by itself.
- Say which backend reviewed each round in the report (from `round-N/backend`). Codex is preferred because it is a different vendor's model; the Claude backend uses opus so the reviewer is at least a different model than the one writing.
- Each Codex round is a fresh session on purpose. Do not try to resume the previous Codex thread; the ledger carries the context.
- Never lower the reviewer's reasoning effort or budget to make it approve faster. The script defaults to `high` effort for Codex and a 15 dollar cap for Claude; the flags exist for debugging the script, not for the loop.
- Never write to the ledger from the code change itself, and never let it appear in a commit.
- Never amend, reset, or rebase a WIP commit while the loop is running; the ledger's `commit` files must stay reachable so later rounds can diff against them.
- If the user interrupts mid-loop, leave the ledger as is and tell them which round it stopped in.
- Never edit the skill's own script while a round is running: bash reads the file by offset and executes garbage after `main` returns if the file changed. Edit between rounds.
