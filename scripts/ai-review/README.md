# AI Code Review (`scripts/ai-review`)

Automated PR review that posts a single consolidated comment on every pull request. Driven by
`.github/workflows/ai-code-review.yml` → `run-review.mjs`, using DeepSeek-V4.1-Flash at max reasoning effort via `opencode`.

The posted comment is branded **OpenObserve Code Reviewer**. Branding is *cosmetic + identity
only* — it does not change what the reviewer finds or decides.

The posted comment never names the model or provider behind the review — the heading carries no
model label, the comment marker is provider-neutral, and `redactProviderIdentity` in
`run-review.mjs` strips the provider/model ids out of anything on its way to the PR (a model
naming itself, or an upstream error echoing the slug). Naming the model in this repo and in the
Actions logs is fine; naming it in the comment is not.

## How it works (one paragraph)

On each PR the workflow fetches the diff, filters noise, picks a risk tier (`trivial` / `lite` /
`full`), runs the tier's specialist agents (security, correctness, code-quality, performance,
documentation) in parallel — plus any *conditional* agent whose domain the diff touches (frontend,
qa, and release for migrations, `Cargo.toml`/`package.json`, `src/config/src/config.rs`, `.github/`,
`deploy/` and Docker files) — and a coordinator consolidates their findings into one comment with
a decision. Correctness owns the PR's behaviour end to end (callers, sibling
paths, state, the tests that prove the change); every tier runs it. Before the agents start, the
runner greps the PR tree for where each symbol the diff changes is used outside the diff, and for
other definitions of the same name (`src/impact.mjs`), and gives that map to every reviewer.
Security and correctness also get `openobserve-checklist.md`, the defect classes that recur in
this repo's fix history, each with a check to run against the diff. The comment PATCHes itself in place on re-review. If a reviewer
fails or times out, the runner (not the model) adds a line to the comment saying which area went
unreviewed.

The coordinator also lists the findings it kept in a hidden JSON block, which the runner strips
from the comment. Kept P0, P1 and P2 findings whose `file:line` is an added or context line of the
diff are posted as one `COMMENT` review with inline threads (at most 10, never approve or request
changes). Each thread carries a hidden fingerprint of file and title, so a re-run skips findings
already posted by `REVIEW_BOT_LOGIN`. A failed inline post only logs a warning. The threads are
off by default; set the variable `AI_REVIEW_INLINE` to `true` to turn them on.

Findings are graded `p0` to `p3`. P0 and P1 are blockers and give the decision `blocked`; P2 and P3
do not block, and only those give `approved_with_comments`; no findings gives `approved`. A review
keeps at most 3 P2 and 2 P3 findings. Legacy severity words from a reviewer are mapped in
`src/severity.mjs`. The review stays advisory: the check does not go red on a blocker.

Every new commit gets one review and the same commit is never reviewed twice. A finished review
records what it covered in a hidden `o2-review-sha` tag (the head SHA, plus the paired head in a
paired review, so a new commit on either side is new) and shows it in a visible `Reviewed commit`
line with the review number. A run whose head matches the tag skips before any model call, which
covers a queued run, a re-label and a plain dispatch, including the paired dispatch from
openobserve. The tag is only written when it is true: the diff the reviewers read is rebuilt locally
from `MERGE_BASE_SHA` and `HEAD_SHA` (both sides of a paired review), because the API serves the
branch as it is now. If that cannot be done, or no reviewer finished (each one failed or returned
nothing parseable), the run writes no tag and names no commit, so that commit can be reviewed again.
A run where no reviewer finished also reports `Not reviewed` and fails the check.

There is no cap on reviews per PR unless the variable `AI_REVIEW_MAX_PASSES` is a positive integer;
unset, empty, `0` or an invalid value means no cap. Reviews are counted either way, in a hidden
`o2-review-pass` tag written before the reviewers start, so a run stopped by removing the label or
by a draft conversion still counts. A run in which no reviewer finished gives its pass back. The
paired pointer and the "key not set" notice keep the tag. When a cap is set and reached, later
pushes skip before any model call and the limit note on the comment names the commit that was
reviewed and the one that was not. If the bot's comments cannot be read (no reviewer app token, or
the list call fails) the run fails instead of reviewing, since neither the reviewed commit nor the
count can be checked.

A push does not cancel a review in progress: the paid run finishes and only the newest push waits
in the concurrency queue. To review a commit again, dispatch the workflow with `ignore_pass_limit`
(it bypasses both the dedupe and the cap, and is forwarded to a paired o2-enterprise review) or with
`force_full` (it bypasses the dedupe only), or delete the review comment to reset the count.

The comment marker is matched as a pattern, so a retired provider leg's comment is adopted and
rewritten in place, including older comments whose marker was redacted to
`<!-- ai-code-review-[redacted] -->`. The marker is added after redaction, so it survives verbatim
even when it names the provider.

## Merge confidence

The comment carries one line right after the decision callout, for example
`**Merge confidence: 🟢 High** — no blockers; all reviewers finished; tests changed`. The runner
computes it from facts in `src/confidence.mjs`; the model cannot write it, and any such line in its
output is stripped. It is advisory evidence, not a guarantee: reviewers sample the code.

| Level | When (the lowest that applies wins, every cause is listed) |
|-------|---------------------------------------------------------------|
| 🔴 Low | Any P0 or P1; the kept findings could not be counted; the Security or Correctness reviewer did not finish; no reviewer finished or ran |
| 🟡 Medium | Any other reviewer did not finish; the coordinator failed, so findings are un-judged; any P2; production code changed with no test changed |
| 🟢 High | Otherwise. P3 findings alone do not lower it |

Production means `src/`, `web/src/` and the enterprise `o2_*/src/` trees, outside test paths. Tests
mean `tests/`, `test/`, `__tests__/`, `*.spec.*`, `*.test.*`, and Rust files that add `#[test]`,
`#[tokio::test]` or `#[cfg(test)]`. A paired review counts both repos. When a cap is set and a push
is skipped at it, the line turns to 🔴 Low and names the unreviewed commit, until a full review
replaces it.
While a run reviews a new commit, the line reads `**Merge confidence: 🟡 Reviewing**` and names that
commit, so an earlier level never stands for it; the final review replaces the line, and a cancelled
run leaves it in place. The level is the trace attribute `review.merge_confidence` and `merge_confidence` in the findings
artifact.

## Auto-approve for small PRs

Small, low-risk PRs can skip the human reviewer. The PR title, body, diff and file names are
untrusted input to a model that can be prompt-injected, so the model's verdict alone can never
approve: `src/auto-approve.mjs` checks every condition in code, and any failure, or any fact it could
not read, means a human reviews. The bot never merges; it has no Contents write.

All of these are required:

1. The reviewers ran under the read-only `default` config. Under `ci-full` they have a shell while
   the parent process holds the app token, so `approve` is ineligible with "reviewers can run
   commands". `shadow` records that reason too, plus `eligible_ignoring_config`, so the data stays
   useful while the workflow sets `ci-full`.
2. The raw diff has at most 100 changed lines and 5 files, with no binary file, mode change, symlink,
   submodule or file path that cannot be read. The diff is rebuilt locally from `MERGE_BASE_SHA` and
   `HEAD_SHA` in `./pr` before any reviewer starts, and the reviewers and every size condition use
   that pinned diff. If it cannot be built the review carries on with the API diff and the run is
   ineligible.
3. Every raw file was reviewed: no filtered file, no truncation, and the diff agrees with the PR's
   `changed_files`, `additions` and `deletions`.
4. No path, old or new, matches `SENSITIVE_PATHS`.
5. Merge confidence is High, no reviewer reported a finding and none was kept, the findings were
   counted (one inline block, every entry with a title and a known severity), the coordinator did not fall back, and the review's decision callout is an approval.
6. The Security and Correctness reviewers ran and finished, as did every other selected reviewer,
   and each one that ran saw the whole filtered diff. Finished means the output parsed into findings
   or held a complete `<no-issues>` element; empty, free-form or cut-off text does not count and also
   keeps confidence below High. A PR within the size limit is forced to the `full` tier with `fileFocus` bypassed whenever
   the mode is not `off`; agents that require focus may still opt out when no file is in their domain.
7. It is not a paired review, and the workflow proved that: only its "no open PR on this branch"
   path sets `REVIEW_PAIR_CLEAR`. A failed lookup, a missing token, a failed dispatch or
   `ignore_paired` leaves it unset, which is ineligible.
8. The author is not a bot and is an `OWNER`, `MEMBER` or `COLLABORATOR`.
9. The title, body, file paths and added lines hit no injection tripwire (phrases aimed at the
   reviewers, review markers, invisible Unicode), matched after NFKC, lowercasing and whitespace
   folding, with a letters-only pass for spaced-out phrases. Added lines and file paths must be
   printable ASCII or tab; the title and body may carry emoji but no Cyrillic or Greek letters. A hit
   disqualifies without proving intent, and the reason never echoes the text. The title and body
   checked are the exact ones given to the reviewers, and the PR re-read at the end must still match
   them: an edit after the review started is ineligible, even one that removes a hit.
10. There is no `no-auto-approve` label and no outstanding `CHANGES_REQUESTED` review.
11. Re-read right before deciding, the PR head still equals the reviewed commit, the PR is open and
    not a draft, and its base branch is `main`.

The mode comes from `AI_REVIEW_AUTO_APPROVE`, passed as `REVIEW_AUTO_APPROVE`:

| Mode | Effect |
|------|--------|
| `off` | The engine default, and what any unknown value means. No reads, no writes. |
| `shadow` | The workflow default. Decides and records `auto_approve` in the findings artifact and `review.auto_approve.*` on the trace. Nothing shows on the PR and nothing is written. |
| `approve` | Submits an `APPROVE` review pinned to the head commit, and adds `**Auto-approved**` or `**Needs human review** — <reasons>` under the confidence line. Never requests changes. |

In `approve` mode every run for a new commit first dismisses the bot's earlier approvals, before any
reviewer starts, so an approval never survives a later push. A failed dismissal is a warning and
makes the run ineligible. A failed approval is a warning and never fails the job.

### Before turning on approve

0. Restrict the `ai-review` environment to `main` in both repos. It has no branch policy today, so a
   workflow added on any branch can read its secrets.
1. Run the reviewers on the read-only config: set `REVIEW_OPENCODE_CONFIG` to `default` in the
   workflow. Until then every run is ineligible, whatever the variable says.
2. Turn on "dismiss stale approvals on push" in `main`'s ruleset. The engine dismisses its own
   approvals only when it runs, and no engine run happens on a paired deferral, a disabled workflow
   or a setup failure.
3. Confirm an approval from the app satisfies the required review on `main`; that depends on the
   ruleset. CI must still pass either way.
4. Leave `shadow` on and grade the artifact's decisions against what humans did. Use
   `eligible_ignoring_config` while the workflow is still on `ci-full`.

Usage of failed and retried attempts is added to the call's span, so a timed-out agent still shows
what it was billed. Every reviewer's parsed findings and the
coordinator's kept list are also uploaded as the `ai-review-findings-*` artifact (7 days,
scrubbed like the comment). Full engine details live in the code;
the rest of this README covers **trusted execution, setup, activation, and rollback**.

The v2 redesign (inline findings, a verifier, a human gate) is specified in
`openobserve/designs` → `meta/process-improvements/ai-code-review-v2/DESIGN.md`; this directory
currently holds its P0 hardening.

## Trusted execution

A PR must never be able to run code next to the review secrets or weaken its own review.

| Layer | What it does |
|-------|--------------|
| `pull_request_target` | The workflow file and the engine always come from `main`. A PR's edits to `scripts/ai-review/**`, `opencode.jsonc`, `opencode.ci.jsonc` or the workflow take effect only after merge. |
| Two checkouts | `./engine` = `main` (sparse: this directory, the opencode configs, the ui-architect and eslint skill references). `./pr` = the PR head SHA, data only: no `npm`, no build, no hooks; `persist-credentials: false`. |
| `src/sanitize.mjs` | Before opencode starts, deletes from `./pr` every symlink and, at any depth, `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, `opencode.json[c]`, `.opencode/`, `.claude/`, `.agents/`, then fails the job if any remain. Copies the base-branch skill references to `./pr/.o2-review-context/skills/`, which the prompts read. The base-branch `AGENTS.md` and `web/AGENTS.md`, or `CLAUDE.md` where a directory has no `AGENTS.md` (listed by the workflow in `REVIEW_RULES_FILES`, one path per line; without it, the engine's `AGENTS.md`) go into every reviewer's system prompt instead, so the repo rules still apply without the PR being able to edit them. |
| `src/opencode.mjs` env allowlist | `opencode serve` runs in `./pr` with only `PATH`, a fresh temp `HOME`/XDG dirs, `OPENCODE_CONFIG` (this repo's `opencode.jsonc` or `opencode.ci.jsonc` from `./engine`), the `OPENCODE_*` disable flags, a random server password and the one provider key. No `GH_*`, `GITHUB_*`, `ACTIONS_*`, `RUNNER_*` or `O2_*` variables. |
| Config selection | `REVIEW_OPENCODE_CONFIG` = `default` (`opencode.jsonc`) or `ci-full` (`opencode.ci.jsonc`); any other value stops the run. The workflow sets `ci-full`, which keeps `approve` ineligible (see Auto-approve). |
| `opencode.jsonc` permissions | Each `ai-review-*` agent: deny `*`, then allow `read`, `glob`, `grep`; `external_directory` denied. A `provider.use` policy allows only `deepseek-review`. LSP, formatters, snapshots and sharing are off. |
| `opencode.ci.jsonc` permissions | Same provider, model and agents, but each agent allows `*`: shell, edit, write and webfetch run with no prompt. The PR checkout is untrusted input to an agent that can run commands, and the provider key is in the opencode process environment, so a shell command can read it. |
| Startup self-check | Refuses to review if any agent is missing, any non-built-in plugin or MCP server loaded, or a granted tool's plugin is not active. Under `default` it also refuses any agent that resolves to allow a tool other than `read`/`glob`/`grep` or any outside directory; under `ci-full` it refuses an agent that does not allow every tool without asking. Permission prompts are rejected under `default` and approved once under `ci-full`. |
| `src/comments.mjs` | The previous review is only ever a marker comment by the reviewer app (`REVIEW_BOT_LOGIN` = `<app-slug>[bot]`), read across every page; anyone else's comment carrying the marker is never fed to the reviewers or edited. When the app token cannot be minted the review posts as `github-actions[bot]`, which any same-repo PR workflow can also post as, so that run uses no previous review and posts a fresh comment. |
| `src/scrub.mjs` | Before posting: redacts values of secret-named env vars and token-shaped strings (inside code too), breaks forged `<!-- o2-review` markers, and neutralises `@mentions` outside code. |

Sanitize is load-bearing, not belt and braces: opencode 1.18.x imported plugins from a project
`.opencode/plugin(s)/` directory at prompt time even with `OPENCODE_DISABLE_PROJECT_CONFIG` set.
2.2.0 no longer does in our tests, but 2.x dropped `OPENCODE_PURE` and the plugin and skill flags,
so nothing pins that. `test/integration/opencode-sandbox.test.mjs` plants every loader and proves
the combination holds.

Fork PRs are skipped (they would need the on-request review of v2). Diffs over the API limit are
rebuilt locally from the merge base, which the workflow fetches into `./pr`; the local diff
ignores the PR's `.gitattributes` (`--no-ext-diff --no-textconv --text`).

### opencode transport and pin

The engine targets the opencode 2.x API under `/api`. It never makes a request that waits for an
agent run: it creates a session bound to the agent, model and variant, puts the system prompt in a
session instruction entry, sends `POST /api/session/:id/prompt` (which returns once the prompt is
admitted), follows `session.execution.succeeded` / `failed` / `interrupted` on `/api/event` (with a
poll for the session's idle record as a safety net), then reads the last assistant message. A
blocking request that waits for the run dies at undici's 300 s `headersTimeout` ("fetch failed").
A timed-out agent is interrupted server-side; transient provider errors are retried at most twice,
each in a fresh session.

The binary is pinned in `opencode-pin.env` and installed by `install-opencode.sh`, which verifies
the release asset's SHA-256. Bump both lines together, to a release at least 14 days old (waived
once, for 2.2.0).

## Setup: the `ai-review` environment (admin, one-time)

The review job runs in the GitHub environment `ai-review` with `deployment: false` (no deployment
records on PRs). Create it under *Settings → Environments* with **Deployment branches: selected
branches → `main`**, in both repos, then:

- Move `OO_REVIEWER_APP_PRIVATE_KEY` into it and delete the repo-level copy (only this workflow
  uses it).
- The model key is the existing organization secret `DEEPSEEK_API_KEY`, shared with the other AI
  workflows. Any same-repo PR can add a workflow that reads it, so a dedicated key in this
  environment is the stronger setup; switching is a one-line change in the workflow.
- Rotate `O2_TRACE_*` to an ingest-only credential; they stay at repo level because other AI
  workflows export to the same stream.
- Give the reviewer app *Actions: write* and *Pull requests: read* on o2-enterprise and
  *Pull requests: write* on openobserve (it already has this), installed on both repos, for paired PRs (below). A new
  permission waits for an org owner to accept it on the installation; until then the token cannot
  be minted and paired OSS PRs are reviewed on their own as well.

Without `DEEPSEEK_API_KEY` the job posts a "not reviewed: key not set" comment. If the `ai-review`
environment does not exist, GitHub creates it on the first run with no branch restriction, so
create it with the `main` policy before merging. Set the **organization** variable `AI_REVIEW_ENABLED` to `false`
to stop every review run in both repos (the job never starts, so no secret is read); unset or any
other value runs. Set it on one repo only and paired OSS PRs still defer to an ENT review that
never runs.

## Paired o2-enterprise PRs

A change that spans both repos uses the same branch name in each. Those changes are reviewed once,
in o2-enterprise:

- **OSS side.** When the PR's branch has an open same-named o2-enterprise PR, this workflow does
  not review. If that PR is out of draft and labelled `ready-for-ci`, it dispatches the
  o2-enterprise review; otherwise it waits for that PR to become ready, so a draft ENT PR never
  gets a paid run through its OSS twin. Either way it replaces this PR's review comment with a
  pointer (`post-paired-pointer.sh`). This uses a reviewer-app token scoped to o2-enterprise
  (Pull requests read, Actions write); if it cannot be minted, or any lookup or dispatch fails,
  the OSS review runs as usual. To force an OSS review anyway, dispatch this workflow with `ignore_paired`.
- **ENT side.** The o2-enterprise workflow checks out this engine pinned by commit SHA, finds the
  open same-named OSS PR, checks it out to `./pr/openobserve`, and reviews both diffs in one run.
  OSS files appear with an `openobserve/` prefix in the review, and the OSS `AGENTS.md` and
  `web/AGENTS.md` at the pinned commit join the rules. After a paired review it updates the OSS
  PR's pointer as the reviewer app, so the pointer is right even when the ENT PR was opened second.
- **Windows.** If the ENT PR closes, the OSS pointer stays until the next OSS push, which reviews
  the OSS PR on its own and replaces the pointer. If a paired ENT run fails, the failure shows on
  the ENT PR, not the OSS one.

## The Frontend UI Reviewer

`frontend` is one of the **conditional** agents (see `qa` below): it is appended to whatever the
tier selected whenever the diff touches `web/src` (excluding specs), so a 6-line UI change still
gets reviewed even at the `trivial` tier. `requiresFocus: true` is the other half of that contract — the generic focus filter
falls back to the *full* diff when an agent matches no files, which would otherwise have the
frontend reviewer opining on Rust; with the flag set it skips the PR entirely instead.

Its remit is deliberately narrow: **only the half of `.claude/skills/ui-architect/` that no lint
rule or check script can see** — structure (`OPageHeader`/`OPageLayout`/`OTable` vs hand-rolled
markup), cross-file consistency (a `sortable` column vs the Rust handler's sort keys; route ↔ nav
entry ↔ rail gate agreement; a token in `:root` but not `dark.css`), values that are well-formed
but wrong (`text-[0.8125rem]`, a `parseInt`-read px converted to rem), and i18n *semantics*
(`raw()` on real copy, a catalogue key for `Kafka`). Everything `local/no-hardcoded-px`,
`lint:design:strict`, stylelint or `type-check:app` already fails the build on is explicitly
out of scope — see the "What NOT to Flag" table in `agents/frontend.md`.

## The QA / Test Reviewer

`qa` is a conditional agent on the same contract as `frontend`, appended whenever the diff touches
the Playwright E2E test code under `tests/ui-testing/` — a spec or helper under `playwright-tests/`,
a page object under `pages/`, a util under `utils/` (`.js`/`.ts`), or a `playwright*.config`. Committed app fixtures
(`fixtures/**`) and the other suites under `tests/` are deliberately excluded, so the agent never
applies POM/selector rules to sample application code. It is
a **static** review of the *tests themselves* — it never runs them, so a green CI run clears none of
its findings. It folds in the Council's Sentinel rules (POM compliance incl. selectors inside
`expect(...)`, `testLogger` not `console.log`, real assertions — no `expect(true).toBe(true)`,
awaited async, no hardcoded creds) plus the Test Inspector's highest-value check: **`data-test` ↔
component selector cross-validation** (grep each added selector across `web/src` and flag any the
test relies on that no component renders — the "19 broken selectors, 14/14 green" failure mode).
Actually executing the suite stays with `playwright.yml`; this agent only reads.

Adding another conditional agent: define it in `AGENTS` (with `requiresFocus` if it is
domain-scoped), add a `{ agent, matches }` entry to `CONDITIONAL_AGENTS`, register
`ai-review-<key>` in `opencode.jsonc` with the same read-only tool policy and in `opencode.ci.jsonc` with the allow-all one, and add its glyph to
`CATEGORY_GLYPH` and to `agents/coordinator.md`.

## Identity: how the comment gets its author

The comment is posted with whatever token `run-review.mjs` sees as `GH_TOKEN`:

- **Branded** — a GitHub App installation token (comment authored by *OpenObserve Code Reviewer*
  with its avatar).
- **Fallback** — `github.token` (comment authored by `github-actions[bot]`).

The workflow mints the App token via `actions/create-github-app-token`, **gated on the
`OO_REVIEWER_APP_ID` repo/org variable**:

```yaml
- id: app_token
  if: env.REVIEW_RUN == 'true' && vars.OO_REVIEWER_APP_ID != ''
  continue-on-error: true          # never breaks CI if minting fails
  uses: actions/create-github-app-token@<pinned-sha>  # v3.2.0
  with:
    app-id: ${{ vars.OO_REVIEWER_APP_ID }}
    private-key: ${{ secrets.OO_REVIEWER_APP_PRIVATE_KEY }}
# ...
  env:
    GH_TOKEN: ${{ steps.app_token.outputs.token || github.token }}
```

This is **fail-safe at every stage**:
| Situation | What happens |
|-----------|--------------|
| Variable unset | Token step skipped → posts as `github-actions[bot]` |
| Variable set, App not installed / key wrong | Mint fails, `continue-on-error` → empty token → `\|\| github.token` → posts as `github-actions[bot]` |
| Variable set, App installed | Mint succeeds → posts as **OpenObserve Code Reviewer** |

## Provisioning the GitHub App (one-time)

1. **Create** a GitHub App (org-owned preferred; personal works but must be set to
   *Any account* to install on org repos). Name: `OpenObserve Code Reviewer`; upload the brand
   logo as the avatar; **uncheck Webhook → Active** (no server, no events).
2. **Permissions (minimum):** Pull requests **Read & write**, Contents **Read-only**, Metadata
   **Read-only**. **Do NOT grant Contents write** — the review agents never see this token, and it
   must not be write-capable.
3. **Install** the App on `openobserve` and `o2-enterprise`.
4. **Generate a private key** (`.pem`) and note the numeric **App ID**.
5. **Set on both repos** (or at org level), under *Settings → Secrets and variables → Actions*:
   - Variable `OO_REVIEWER_APP_ID` = the App ID (this is the on/off gate).
   - Secret `OO_REVIEWER_APP_PRIVATE_KEY` = full contents of the `.pem`.

Via CLI:
```bash
gh variable set OO_REVIEWER_APP_ID --body "<APP_ID>"        --repo openobserve/openobserve
gh secret   set OO_REVIEWER_APP_PRIVATE_KEY < <key.pem>     --repo openobserve/openobserve
gh variable set OO_REVIEWER_APP_ID --body "<APP_ID>"        --repo openobserve/o2-enterprise
gh secret   set OO_REVIEWER_APP_PRIVATE_KEY < <key.pem>     --repo openobserve/o2-enterprise
```

## Rollback

Delete the `OO_REVIEWER_APP_ID` variable on the repo(s). The next review instantly reverts to
`github-actions[bot]`. No code change, no revert needed.

## Skipping a review

There is no text skip marker any more: `[skip ci]`, `[skip review]` and `break glass` used to
disable the review for anyone who could comment, including the model quoting them. The review
runs only on non-draft PRs labelled `ready-for-ci`, and it is advisory. Removing the label or
converting the PR to draft cancels a review in progress. An audited
`/review skip` command arrives with v2 (WP-14).

## Testing

```bash
npm ci --ignore-scripts
npm test                                   # unit tests
OPENCODE_BIN=/path/to/opencode npm run test:integration   # real pinned opencode + stub model
```

`.github/workflows/ai-review-tests.yml` runs both on PRs that touch the engine. Because the
review itself always runs `main`'s copy, a PR cannot exercise its own workflow or engine edits
end to end: validate those in a sandbox repo, or dispatch the workflow from `main` after merge.

## Notes

- `actions/create-github-app-token` is pinned to a full commit SHA (it receives the App's private
  key). Bump the pin deliberately after review — same discipline as the opencode pin.
- The App installation's granted permissions bound the token; keep the install at the minimum
  above so a mis-scoped install can't hand the reviewer a write-capable credential.
- o2-enterprise has no engine copy: its workflow checks out this directory at a pinned commit.

## Trace content and GenAI attributes

The review exports model instructions, input, and output to the configured OpenObserve trace
stream. These values can contain repository source and PR context, so access to that stream must
be restricted accordingly.

Model spans use the OpenTelemetry GenAI content attributes:

- `gen_ai.system_instructions`
- `gen_ai.input.messages`
- `gen_ai.output.messages`

Token counts, cost, model, response ID, and finish reasons come from the Opencode assistant
response. Do not put content-length metadata below `gen_ai.prompt.*`: OpenObserve recognizes that
prefix as legacy TraceLoop prompt content and would tokenize the metadata instead of the prompt.
