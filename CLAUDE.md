# OpenObserve — project rules

## Build & workflow

- Build with `cargo build` (debug). Never use `--release` unless explicitly asked.
- Skip UI build steps (`npm run build`) when working on backend tasks.
- `.env` in the project root overrides process env; check it before running the server.
- Before finishing a task: run `cargo fmt --all` and make
  `cargo clippy --all-targets -- -D warnings` pass — that is exactly what CI runs.
- Personal Claude Code settings go in `.claude/settings.local.json` (gitignored);
  `.claude/settings.json` is shared and checked in.

## Rust code organization

Item order inside a file/module, top to bottom (clippy's default grouping):
`mod`/`pub mod` declarations → `use` imports → macros → `const`/`static` → types (`struct`/`enum`/`trait`/`type`) → `impl` blocks → functions.

- Never insert a function above the file's constants or type definitions.
- Keep `pub` and private functions grouped. Do not drop a private helper into the
  middle of the pub API block, or a pub fn into a run of private helpers. Place
  new functions next to related functions within the correct group.
- `#[cfg(test)] mod tests` is always the LAST item in a file. CI enforces this
  (clippy `items_after_test_module` runs under `--all-targets -- -D warnings`).
- The module-level order above matches clippy's `arbitrary_source_item_ordering`
  lint with the `source-item-ordering = ["module"]` config in clippy.toml. The
  lint is opt-in (too much pre-existing debt to enable repo-wide); a PostToolUse
  hook (`.claude/hooks/rust_style_check.py`) checks newly added lines instead.

## Comments

- Default is no comment. Write one only for a non-obvious constraint the code
  itself cannot express.
- One line is the norm. Do not write multi-line comment essays, narration of
  what the code does, or notes about the change itself ("now we correctly...").
- `///` doc comments on public APIs: one summary sentence; add more only for
  real caveats, never to restate the signature.

## PR conventions

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
- When bumping the tantivy fork, update `[patch.crates-io]` in both workspaces.
- The collectors in `src/config/src/tantivy/query/` are API mirrors of
  enterprise fast-path collectors: constructor signatures and Fruit types must
  stay in sync — no shared trait enforces it.
