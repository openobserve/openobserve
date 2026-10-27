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
`full`), runs the tier's read-only specialist agents (security, code-quality, performance,
documentation, release) in parallel — plus any *conditional* agent whose domain the diff touches —
and a coordinator consolidates their findings into one comment with an approve/needs-work
decision. The comment PATCHes itself in place on re-review. Full engine details live in the code;
the rest of this README covers **trusted execution, setup, activation, and rollback**.

The v2 redesign (inline findings, a verifier, a human gate) is specified in
`openobserve/designs` → `meta/process-improvements/ai-code-review-v2/DESIGN.md`; this directory
currently holds its P0 hardening.

## Trusted execution

A PR must never be able to run code next to the review secrets or weaken its own review.

| Layer | What it does |
|-------|--------------|
| `pull_request_target` | The workflow file and the engine always come from `main`. A PR's edits to `scripts/ai-review/**`, `opencode.jsonc` or the workflow take effect only after merge. |
| Two checkouts | `./engine` = `main` (sparse: this directory, `opencode.jsonc`, the ui-architect and eslint skill references). `./pr` = the PR head SHA, data only: no `npm`, no build, no hooks; `persist-credentials: false`. |
| `src/sanitize.mjs` | Before opencode starts, deletes from `./pr` every symlink and, at any depth, `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, `opencode.json[c]`, `.opencode/`, `.claude/`, `.agents/`, then fails the job if any remain. Copies the base-branch skill references to `./pr/.o2-review-context/skills/`, which the prompts read. The base-branch `AGENTS.md` and `web/AGENTS.md` (listed by the workflow in `REVIEW_RULES_FILES`, one path per line; without it, the engine's `AGENTS.md`) go into every reviewer's system prompt instead, so the repo rules still apply without the PR being able to edit them. |
| `src/opencode.mjs` env allowlist | `opencode serve` runs in `./pr` with only `PATH`, a fresh temp `HOME`/XDG dirs, `OPENCODE_CONFIG` (this repo's `opencode.jsonc` from `./engine`), the `OPENCODE_DISABLE_*` flags, a random server password and the one provider key. No `GH_*`, `GITHUB_*`, `ACTIONS_*`, `RUNNER_*` or `O2_*` variables. |
| `opencode.jsonc` permissions | Each `ai-review-*` agent: `"*": "deny"`, then allow `read`, `glob`, `grep`; `external_directory` denied. LSP, formatters, snapshots and sharing are off. |
| Startup self-check | Refuses to review if `GET /experimental/tool/ids` lists any non-built-in tool, or any agent resolves to allow for a tool other than `read`/`glob`/`grep`. Permission prompts during a run are rejected. |
| `src/comments.mjs` | The previous review is only ever a marker comment by the reviewer app (`REVIEW_BOT_LOGIN` = `<app-slug>[bot]`), read across every page; anyone else's comment carrying the marker is never fed to the reviewers or edited. When the app token cannot be minted the review posts as `github-actions[bot]`, which any same-repo PR workflow can also post as, so that run uses no previous review and posts a fresh comment. |
| `src/scrub.mjs` | Before posting: redacts values of secret-named env vars and token-shaped strings (inside code too), breaks forged `<!-- o2-review` markers, and neutralises `@mentions` outside code. |

Sanitize is load-bearing, not belt and braces: opencode 1.18.x still imports plugins from a
project `.opencode/plugin(s)/` directory at prompt time even with
`OPENCODE_DISABLE_PROJECT_CONFIG` set, and reads `AGENTS.md`-style files from every ancestor of a
file it reads. `test/integration/opencode-sandbox.test.mjs` plants every loader and proves the
combination holds.

Fork PRs are skipped (they would need the on-request review of v2). Diffs over the API limit are
rebuilt locally from the merge base, which the workflow fetches into `./pr`; the local diff
ignores the PR's `.gitattributes` (`--no-ext-diff --no-textconv --text`).

### opencode transport and pin

The engine never makes a request that waits for an agent run. It sends `prompt_async`, follows
`session.idle` / `session.error` on the `/event` stream (with a status poll as a safety net), then
reads the messages. The old blocking `POST /session/:id/message` died at undici's 300 s
`headersTimeout` on every long run ("fetch failed"). A timed-out agent is aborted server-side;
transient provider errors are retried at most twice, each in a fresh session.

The binary is pinned in `opencode-pin.env` and installed by `install-opencode.sh`, which verifies
the release asset's SHA-256. Bump both lines together, to a 1.x release at least 14 days old.

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
`ai-review-<key>` in `opencode.jsonc` with the same read-only tool policy, and add its glyph to
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
   **Read-only**. **Do NOT grant Contents write** — the review agents are read-only by design and
   the token must not be write-capable.
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
