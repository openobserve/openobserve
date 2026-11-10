# OpenObserve — project rules

## Engineering guidelines

- [.agents/engineering-guidelines.md](.agents/engineering-guidelines.md) governs judgment: task
  tiers, what counts as a hack / over-engineering / over-complication, TDD and the review loop.
  Read it before any change bigger than a one-cause patch; reviewers apply its §2 tests. On
  anything mechanical (ordering, comments, lint thresholds, schema, PR rules) this file wins.

## Build & workflow

- Build with `cargo build` (debug). Never use `--release` unless explicitly asked.
- Skip UI build steps (`npm run build`) when working on backend tasks.
- `.env` in the project root overrides process env; check it before running the server.
- Before finishing a task: run `cargo fmt --all` and make the CI clippy command
  pass: `cargo clippy --workspace --all-targets -- -W clippy::too_many_lines
  -W clippy::cognitive_complexity -W clippy::excessive_nesting -D warnings`.
- At the end of every task, after verification, run `cargo clean` in the task's
  Rust workspace to remove compilation artifacts. Do not interrupt active builds
  or clean a shared target directory still used by another task.
- Remove temporary worktrees when the task is complete and their results are
  preserved. Archive app-managed worktrees with `archive_worktree`; preserve any
  needed ignored files first. Keep primary checkouts and worktrees still in use.

## Frontend (web/)

- After every change under `web/`, run `npm run format:check` from `web/`
  before considering the task done. If it flags a file, fix it with
  `npx prettier --write <file>` (not a full-repo `--write`) and re-run
  `format:check` to confirm it's clean.
- New UI features fetch search results over the HTTP streaming endpoints, not
  the one-shot ones. Logs and other SQL searches use
  `POST /api/{org}/_search_stream`, or `_search_multi_stream` for several
  streams. Traces use `GET /api/{org}/{stream}/traces/latest_stream`. Call them
  through `useHttpStreaming` in `web/src/composables/useStreamingSearch.ts`,
  which handles chunking, cancellation and the `trace_id`. Do not add new UI
  callers of `_search`, `_search_multi` or `traces/latest`. Wherever a
  streaming endpoint is supported for a call, the UI uses it, in existing code
  as well as new code. The one-shot endpoints are for the public API and for
  the few UI calls that have no streaming equivalent yet.

## Rust code organization

Item order inside a file/module, top to bottom (clippy's default grouping):
`mod`/`pub mod` declarations → `use` imports → macros → `const`/`static` → types (`struct`/`enum`/`trait`/`type`), each immediately followed by its own `impl` blocks (inherent impl first, then trait impls) → functions.

- A type and its `impl` blocks stay together. Do not collect all types at the top and all
  `impl` blocks below them; a reader must see a struct's methods right under its fields.
  Types that only serve another type (private helper structs/enums) go after the type that
  uses them, again followed by their own impls. No lint enforces adjacency, review does.

- Function length, cognitive complexity, and nesting depth are capped by the
  thresholds in clippy.toml (set just above the worst existing code). They only
  ratchet down — if CI flags your function, split it instead of raising the
  threshold.
- Never insert a function above the file's constants or type definitions.
- Keep `pub` and private functions grouped. Do not drop a private helper into the
  middle of the pub API block, or a pub fn into a run of private helpers. Place
  new functions next to related functions within the correct group.
- `#[cfg(test)] mod tests` is always the LAST item in a file. CI enforces this
  (clippy `items_after_test_module` runs under `--all-targets -- -D warnings`).
- The module-level order above matches clippy's `arbitrary_source_item_ordering`
  lint with the `source-item-ordering = ["module"]` config in clippy.toml. The
  lint is opt-in (too much pre-existing debt to enable repo-wide); hold the code
  you add to this order even though nothing enforces it yet.

## Comments

STRICT, and enforced in review — a comment that breaks these is deleted, not
reworded:

- **One line, or none.** A comment is at most a single line. No multi-line
  comment blocks in code (the license header is the only exception). If the
  point needs more than one line, it does not belong in a comment.
- **Only logical comments — explain WHY.** The single allowed reason to write a
  comment is to state a non-obvious constraint, invariant, or gotcha the code
  itself cannot express. If a comment is not explaining logic, do not write it;
  no comment is better than a filler one.
- **Banned outright** (remove on sight): styling/visual narration (layout,
  spacing, `px`, "matches the header height"), change/modification notes ("now
  we...", "changed to...", "was X"), and narration that restates what the code
  plainly does.
- `///` / JSDoc doc comments on public APIs: one summary sentence, and only when
  the behaviour is non-obvious; never to restate the signature.

## Database schema (migrations / SeaORM entities)

Applies to every NEW table and column (SQLite and PostgreSQL alike):

- MySQL is not a supported meta store. Support was removed in #10522
  (`src/infra/src/db/mysql.rs` is gone). Do not add MySQL branches, MySQL-only
  migrations, MySQL feature flags or MySQL test matrices. Remaining `mysql`
  mentions in the tree belong to the database monitoring feature, which watches
  customers' MySQL servers, not to the meta store.

- No `json` / `jsonb` columns (sea-orm `.json()` / `.json_binary()`). JSON is
  stored in a `.text()` column holding the serialized string; Rust
  (`serde_json`) parses it. Never push JSON operators or extraction into SQL.
- No `timestamp` / `datetime` / `date` columns (sea-orm `.timestamp()`,
  `.date_time()`, `.date()`). A time field is a Unix timestamp in MICROSECONDS
  stored as `.big_integer()` (Rust `i64`), the same unit `_timestamp` uses
  everywhere else.
- Existing columns that break these rules are legacy; do not add new ones next
  to them, and do not migrate them as part of an unrelated change.

## Feature-owned internal streams

- Any new feature that uses OpenObserve itself to ingest and query its own
  operational or result data must name its feature-owned streams with the
  `_o2_` prefix. Existing examples: `_o2_dbm_server` (`DBM_SERVER_STREAM` in
  `src/config/src/meta/db_monitoring.rs`), `_o2_ai_chat_events`
  (`AI_CHAT_EVENTS_STREAM` in `src/config/src/meta/self_reporting/ai_chat.rs`)
  and `_o2_alert_calibration_digests` (`DIGEST_STREAM` in
  `src/core/src/alerts/alert_calibration/sink.rs`). Apply this to every stream
  the feature creates, including execution-level and step-level results.
- Reuse shared stream-name constants within each code layer. Keep writers,
  readers, runner configuration, ingestion grants and internal-stream
  classification consistent. Verify that the actual ingestion path accepts
  authorized writes to the reserved prefix.
- Writers into feature-owned streams must authenticate with an org-based
  ingestion token from the `org_ingestion_tokens` table. Do not use a user
  passcode, a RUM token, a service-account login or a root credential. Create or
  look up the token per org when the feature is enabled, and scope it to that
  org. Rotate and revoke it together with the other ingestion tokens of the org.
- Before renaming an existing stream, assess existing customers, saved queries,
  dashboards, alerts, historical analytics, in-flight jobs and older runners.
  State the history and rollout impact explicitly and choose a compatibility
  plan. When continuous history is required, read legacy and new streams during
  the transition and retain legacy write permissions until old writers drain.
  Preserve existing data under its retention policy unless deletion or migration
  is explicitly requested.
- This convention applies to feature-owned internal data, not customer-chosen
  stream names or externally standardized names such as
  `traces_service_graph_*`. Do not rename shared streams as an incidental change.
  Internal-stream naming/classification is not an access-control or billing rule.

## PR conventions

- CI runs on a PR only while it carries the `ready-for-ci` label and is not a draft
  (no label or draft = nothing runs except `ci-gate`, and no red checks). Add the
  label when you want the run, not when you open the PR; clicking "Merge when
  ready" adds it automatically if it is missing. Which suites run is decided by
  path detection, never by a label. The merge queue only compiles and unit-tests the merged code, so the
  labelled PR run is the one that has to be green.
- PR titles starting with `feat:` require `Design at: #xxx` as the FIRST line
  of the description (enforced by `.github/workflows/feat-design-checker.yml`);
  `fix:`/`chore:`/`test:` PRs skip the check.

## Enterprise-gated code

- Default features do NOT compile `#[cfg(feature = "enterprise")]` code, so a
  green local check proves nothing about it, and `--features enterprise` does
  not work in this repo (the local `src/enterprise/*` stubs don't provide it).
  With access to the o2-enterprise repo, verify by swapping in its
  `Cargo.toml.openobserve` and running `cargo check --all-targets`, then
  restore `Cargo.toml` (never commit the swap). Without access, say so in the PR.
- A change needing paired PRs in openobserve and o2-enterprise must use the
  SAME branch name in both repos — CI checks out the paired side by branch name.
- When changing this repo's root `Cargo.toml`, mirror the change into
  `Cargo.toml.openobserve` in the o2-enterprise repo.
