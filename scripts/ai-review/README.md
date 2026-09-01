# AI Code Review (`scripts/ai-review`)

Automated PR review that posts a single consolidated comment on every pull request. Driven by
`.github/workflows/ai-code-review.yml` → `run-review.mjs`, using DeepSeek-V4-Pro via `opencode`.

The posted comment is branded **OpenObserve Code Reviewer**. Branding is *cosmetic + identity
only* — it does not change what the reviewer finds or decides.

## How it works (one paragraph)

On each PR the workflow fetches the diff, filters noise, picks a risk tier (`trivial` / `lite` /
`full`), runs the tier's read-only specialist agents (security, code-quality, performance,
documentation, release) in parallel — plus any *conditional* agent whose domain the diff touches —
and a coordinator consolidates their findings into one comment with an approve/needs-work
decision. The comment PATCHes itself in place on re-review. Full engine details live in the code;
the rest of this README covers **setup, activation, and rollback** of the branded identity.

## The Frontend UI Reviewer

`frontend` is the one **conditional** agent: it is appended to whatever the tier selected whenever
the diff touches `web/src` (excluding specs), so a 6-line UI change still gets reviewed even at the
`trivial` tier. `requiresFocus: true` is the other half of that contract — the generic focus filter
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
  if: ${{ steps.skip.outputs.skip_review == 'false' && vars.OO_REVIEWER_APP_ID != '' }}
  continue-on-error: true          # never breaks CI if minting fails
  uses: actions/create-github-app-token@<pinned-sha>  # v2.2.2
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

Put any of these in the PR body or a comment: `[skip ai review]`, `[skip review]`, `[skip ci]`,
or `break glass`.

## Notes

- `actions/create-github-app-token` is pinned to a full commit SHA (it receives the App's private
  key). Bump the pin deliberately after review — same discipline as the `OPENCODE_VERSION` pin.
- The App installation's granted permissions bound the token; keep the install at the minimum
  above so a mis-scoped install can't hand the reviewer a write-capable credential.
- OSS (`openobserve`) and ENT (`o2-enterprise`) run identical engine files — keep them in sync.
