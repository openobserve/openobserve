# OpenObserve — project rules

## Build & workflow

- Build with `cargo build` (debug). Never use `--release` unless explicitly asked.
- Skip UI build steps (`npm run build`) when working on backend tasks.
- `.env` in the project root overrides process env; check it before running the server.
- Before finishing a task: run `cargo fmt --all` and make the CI clippy command
  pass: `cargo clippy --workspace --all-targets -- -W clippy::too_many_lines
  -W clippy::cognitive_complexity -W clippy::excessive_nesting -D warnings`.

## Rust code organization

Item order inside a file/module, top to bottom (clippy's default grouping):
`mod`/`pub mod` declarations → `use` imports → macros → `const`/`static` → types (`struct`/`enum`/`trait`/`type`) → `impl` blocks → functions.

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
- When changing this repo's root `Cargo.toml`, mirror the change into
  `Cargo.toml.openobserve` in the o2-enterprise repo.
