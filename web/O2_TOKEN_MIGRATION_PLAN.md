# O2 Token Removal & CSS-Token Consolidation — Fail-Safe Implementation Plan

> Goal: eliminate the legacy `--o2-*` token vocabulary, fix all undefined-token bugs,
> align the theme switcher so it stops emitting legacy tokens, and add lint/CI that
> **fails the build** on any banned usage — executed safely in a single day with a
> working, shippable app after every stage.

---

## 1. Why (the debt, in numbers)

Measured on `web/src` (`.vue` + `.css` + `.ts`):

| Fact | Value |
|---|---|
| `--o2-*` unique token names | **239** |
| `--o2-*` `var()` references | **1673** across **197 files** |
| `--o2-*` definitions | 367 (light in `semantic.css`, dark in `dark.css`) |
| `--o2-*` set at **runtime** by `utils/theme.ts` | **20** |
| Undefined tokens referenced (no fallback) | ~30 (see §3) |
| Tailwind **arbitrary-value** `var()` usages `[var(--x)]` / `(--x)` | ~2539 |
| `var()` inside `<style>` blocks (legit) | ~2897 |
| `.body--dark` / `.body--light` CSS selectors | **197** |
| JS `classList.contains('body--dark')` checks | **128** |

**Root problem:** two parallel token vocabularies — the modern `--color-*` / semantic /
component set (registered in `@theme inline`, drives Tailwind utilities, has proper
dark overrides) **and** the legacy `--o2-*` set (Quasar-era, `var()`-only, its own
`.body--dark` dark values that can drift). Nothing enforces which to use, which is how
the undefined-token bugs appeared.

---

## 2. Goals / Non-Goals

**Goals**
1. Fix every undefined-token bug (source files + components).
2. Remove `--o2-*` as a vocabulary developers can use or add to.
3. Make `utils/theme.ts` drive **only** the modern token set (no new `--o2-*` emitted).
4. Lint + CI that **fails** on: new `--o2-*` usage, undefined tokens, and (soft) arbitrary-value `var()` where a utility exists.
5. App is visually identical and fully working after **every** committed stage.

**Non-Goals (explicitly out of scope for the day — do NOT attempt)**
- Removing the `.body--dark` / `.body--light` class. It backs 197 CSS selectors + 128 JS
  checks. It stays as a compat class that `theme.ts` keeps toggling. Migrating those
  `.body--dark { … }` scoped overrides to `.dark` is a **separate** future effort.
- Converting the ~2897 `<style>`-block `var()` usages (they're legitimate).
- Any redesign of colors/values. This is a **rename/consolidation**, visually a no-op.

---

## 3. Pre-work — fix the confirmed bugs (do first, ~20 min)

These are wrong at the source and independent of the migration.

| # | File:line | Problem | Fix |
|---|---|---|---|
| 1 | `lib/styles/tokens/component.css:191` | `--color-field-list-label-text: var(--color-grey-text-primary)` — token doesn't exist | → `var(--color-text-primary)` |
| 2 | `lib/styles/tokens/semantic.css:171-172` | `color-mix(…, var(--o2-theme-elements) 0%, white)` — undefined var voids the declaration | → `white` (intent) |
| 3 | `lib/styles/tokens/dark.css:520-521` | same as #2 | → `white` |

These land in their own commit, verified, before touching anything else.

---

## 4. The fail-safe principle: **Alias Bridge, never big-bang**

The entire migration hinges on one keystone step that is **non-breaking**:

> **Rewrite every `--o2-*` *definition* to be a thin alias of its modern equivalent**,
> instead of holding its own hardcoded value.

```css
/* BEFORE (semantic.css light + dark.css dark — two independent values) */
--o2-text-secondary: #5A5D6B;        /* light */
--o2-text-secondary: #B4B8BF;        /* dark, in .body--dark */

/* AFTER (one source of truth; dark handled by the modern token it points to) */
--o2-text-secondary: var(--color-text-secondary);
```

After this step:
- `--o2-*` still resolves everywhere → **zero reference edits needed to be safe**.
- Drift is eliminated — `--o2-*` now *is* the modern token.
- The theme switcher's effect flows through automatically.
- Every later step (codemod refs, retarget theme.ts, delete) becomes a **visual no-op**,
  because the alias already made `--o2-x` === its target.

This is what makes a 197-file change safe in a day: **the visual convergence happens
once, in one reviewable commit**, not spread across hundreds of risky edits.

---

## 5. Canonical mapping (`--o2-*` → modern token)

Full machine-readable map lives in `web/scripts/o2-token-map.json` (created in Stage 1).
Families and rules:

### Bucket A — 1:1 semantic equivalents (alias, then codemod refs)
| Legacy | Modern |
|---|---|
| `--o2-text-heading` | `--color-text-heading` |
| `--o2-text-primary` / `--o2-text-4` | `--color-text-primary` |
| `--o2-text-body` | `--color-text-body` |
| `--o2-text-secondary` / `--o2-text-2` | `--color-text-secondary` |
| `--o2-text-caption` / `--o2-text-1` | `--color-text-caption` |
| `--o2-text-label` / `--o2-text-3` | `--color-text-label` |
| `--o2-text-muted` | `--color-text-muted` |
| `--o2-text-placeholder` | `--color-text-placeholder` |
| `--o2-text-link` / `--o2-text-link-hover` | `--color-text-link` / `-hover` |
| `--o2-text-code` | `--color-text-code` |
| `--o2-text-inverse` | `--color-text-inverse` |
| `--o2-input-label-text-color` | `--color-input-label` |
| `--o2-border` / `--o2-border-color` | `--color-border-default` |
| `--o2-border-2` | `--color-border-subtle` |
| `--o2-border-input` | `--color-input-border` |
| `--o2-primary-background` | `--color-surface-base` |
| `--o2-secondary-background` | `--color-surface-panel` |
| `--o2-muted-background` | `--color-surface-subtle` |
| `--o2-card-bg` / `--o2-card-bg-solid` / `--o2-card-background` | `--color-surface-base` ⚠️ (see notes) |
| `--o2-card-text` | `--color-card-text` |
| `--o2-popover-background` | `--color-surface-overlay` |
| `--o2-popover-text` | `--color-text-primary` |
| `--o2-code-bg` | `--color-code-bg` |
| `--o2-primary-btn-bg` | `--color-button-primary` |
| `--o2-primary-btn-text` / `--o2-primary-foreground` | `--color-button-primary-foreground` |
| `--o2-secondary-btn-bg/text/border` | `--color-button-secondary` / `-foreground` / `-border` |
| `--o2-hover-accent` / `--o2-interactive-hover` | `--color-interactive-hover-bg` |

### Bucket B — runtime-computed by `theme.ts` (handled in §6, not aliasable to a static token)
`--o2-theme-color`, `--o2-dark-theme-color`, `--o2-table-header-bg`, `--o2-tab-bg`,
`--o2-inactive-tab-bg`, `--o2-menu-color`, `--o2-menu-gradient-start/end`,
`--o2-body-primary-bg`, `--o2-body-secondary-bg`, `--o2-header-menu-bg`.
→ Some already have modern equivalents (`--color-table-header-bg`,
`--color-surface-chrome`). Retarget in `theme.ts`; keep computing the genuinely-derived
ones under a modern name (see §6).

### Bucket C — per-theme semantic set (runtime, from `semanticColors`)
`--o2-negative`, `--o2-positive`, `--o2-status-error-text/bg`,
`--o2-status-success-text/bg`. `theme.ts` already dual-writes some to
`--color-button-outline-*`. Introduce **modern status tokens** and set those instead:
`--color-status-error-text/-bg`, `--color-status-success-text/-bg`,
`--color-status-negative`, `--color-status-positive`. (These are consolidation, not new
concepts — they replace the o2 originals 1:1.)

### Bucket D — domain data-viz palettes (~90 tokens: NO generic equivalent)
`--o2-label-chip-*` (32), `--o2-span-kind-*` (10), `--o2-field-type-*` (10),
`--o2-status-*` (13), `--o2-wildcard-*` (15), `--o2-trace-*` (6), `--o2-json-*` (6),
`--o2-service-health-*` (4), `--o2-latency-*` (2), `--o2-severity-*` (2).
These are legitimate domain colors, already have light+dark values. **Renamespace** them
into the component-token layer under `--color-*` (e.g. `--o2-label-chip-ip-bg` →
`--color-chip-ip-bg`, `--o2-span-kind-client-text` → `--color-span-client-text`,
`--o2-trace-*` → `--color-trace-*`, `--o2-json-*` → `--color-code-json-*`). Pure rename,
same values, so visually a no-op. This is the largest chunk — **time-box it**; if the day
runs out, these stay aliased (Stage 1) and keep working, and the lint allowlists the
`--color-*`-renamed names only.

### ⚠️ Needs a design call before mapping (do NOT auto-codemod — ~6 tokens)
- `--o2-primary-color` — light `--color-primary-600`, **dark `--color-primary-400`**. No
  single static modern token flips like this. Options: (a) map to `--color-text-link`
  (already 600→400), or (b) add one thin semantic token `--color-accent`. Pick per-usage.
- `--o2-card-bg` — light value is `rgba(255,255,255,0.8)` (**semi-transparent**); mapping
  to opaque `--color-surface-base` changes translucency over gradients. Visual-check the
  95 usages; keep a translucent variant if any rely on it.
- `--o2-theme-color` used directly in `color-mix()` in scoped styles — ensure the modern
  replacement is a real color, not an rgba tint, where mixed.

---

## 6. Theme switcher alignment (`utils/theme.ts`) — the critical file

Current behaviour (see `applyThemeColors`):
1. Toggles `.dark` (modern) **and** `.body--dark`/`.body--light` (legacy). — **KEEP BOTH.**
2. Generates `--color-primary-50…900` from the theme color and sets inline. — **KEEP.**
   This is the correct, modern mechanism; nothing to change.
3. `setProperty('--o2-…')` for 20 tokens. — **THIS is the switcher "creating legacy tokens".**

**Changes:**
- Replace each `setProperty('--o2-X', …)` with the modern target from Bucket B/C
  (e.g. `--o2-table-header-bg` → `--color-table-header-bg`, `--o2-status-error-text` →
  `--color-status-error-text`).
- For genuinely-derived values with no modern name (menu gradient, body bg tint), set
  them under a modern name (`--color-chrome-menu-*`, `--color-app-bg`).
- Keep toggling `.body--dark`/`.body--light` (out-of-scope compat — §2).
- **Order of operations matters:** because Stage 1 aliases `--o2-X: var(--modern)`, you
  may retarget `theme.ts` to set `--modern` directly while the alias still exists — the
  alias then reads the freshly-set modern value. This lets §6 land **before** the ref
  codemod with zero breakage.
- Update the `semanticTokenNames` cleanup array to the modern names.
- `utils/theme.spec.ts` and `themeManager.spec.ts` assert on token names → update them in
  the same commit.

**Verification is mandatory here** because it's runtime logic: exercise all 6 predefined
themes × {light, dark} + one custom color + live preview (see §9 matrix).

---

## 7. Linting & CI guards (must **fail** the build)

Three layers. Add these **early** (Stage 0) so the freeze is enforced while migrating.

### 7a. Stylelint — bans `--o2-*` in CSS + `<style>` + arbitrary values
No stylelint today (only ESLint). Add `stylelint` + `postcss-html` (parses `<style>` in
`.vue`). `web/.stylelintrc.json`:
```json
{
  "overrides": [{ "files": ["**/*.vue"], "customSyntax": "postcss-html" }],
  "rules": {
    "declaration-property-value-disallowed-list": [
      { "/.*/": ["/var\\(\\s*--o2-/"] },
      { "message": "Legacy --o2-* tokens are banned. Use the modern --color-* token or a Tailwind utility." }
    ]
  }
}
```

### 7b. ESLint — bans `--o2-*` inside `.vue` templates (Tailwind arbitrary values)
Stylelint won't see class strings in templates. Add a `no-restricted-syntax` /
regex rule (via `eslint-plugin-vue` template AST or a simple `no-restricted-syntax` on
`Literal`/`VLiteral` matching `--o2-`). Fails on `class="bg-[var(--o2-card-bg)]"`.

### 7c. CI script — undefined-token guard (root cause) `web/scripts/check-css-tokens.mjs`
Fails if any referenced `var(--x)` (minus a small runtime/library allowlist:
`reka|tw|vf|q`, and the JS-`:style` set `o2-tree-*|node-color|chip-color|
o2-row-status-color|o2-table-row-height`) is undefined **and** has no fallback.
Validated core:
```sh
grep -rhoE '\-\-[A-Za-z0-9_-]+[[:space:]]*:' --include=*.css --include=*.vue --include=*.ts src \
  | grep -oE '\-\-[A-Za-z0-9_-]+' | sort -u > defined.txt
grep -rhoE 'var\([[:space:]]*--[A-Za-z0-9_-]+' --include=*.css --include=*.vue --include=*.ts src \
  | sed -E 's/var\([[:space:]]*//' | sort -u > referenced.txt
comm -23 referenced.txt defined.txt   # → allowlist-filter → nonempty = fail
```
Wire all three into `package.json` scripts + the CI lint job.

---

## 8. Execution stages (each independently green + revertible)

| Stage | Action | Breaking? | Gate before merge |
|---|---|---|---|
| **0** | Add lint 7a/7b/7c (allowlist current `--o2-*` as WARN, not error yet). Capture visual baseline screenshots (6 themes × L/D). | No | CI runs, screenshots archived |
| **1** | **Alias bridge**: generate `--o2-* : var(--modern)` for Buckets A/C from `o2-token-map.json`; replace the hardcoded light block (`semantic.css:131-322`) and dark block (`dark.css:479-656`) with alias blocks. Fix the 3 §3 bugs. | No (visual convergence — review here) | Visual diff vs baseline; theme matrix §9 |
| **2** | Retarget `theme.ts` runtime `setProperty` to modern names + update specs (§6). | No | Unit specs green + theme matrix §9 |
| **3** | Codemod Bucket A refs: `var(--o2-x)`→`var(--color-x)`; `[var(--o2-x)]`/`(--o2-x)`→registered utility if one exists, else `[var(--color-x)]`. Run in **directory batches** (`lib/`, `components/`, `plugins/`, `enterprise/`, `views/`). Build + guard after each batch. | No (alias makes it no-op) | Build passes, guard 0 undefined, spot visual check per batch |
| **4** | Renamespace Bucket D family-by-family (def + refs in one commit per family). | No (pure rename) | Build + guard per family |
| **5** | Delete now-unused `--o2-*` alias defs. Flip lint 7a/7b from WARN → **ERROR**. Delete `assets/main.css` + `assets/base.css` (unused scaffolding). | No | `grep -r 'var(--o2-' src` returns 0; full theme matrix §9 |

**If time runs out:** stop after any stage. Stages 0–2 alone (½ day) already: fix all
bugs, kill drift, stop the switcher emitting legacy tokens, and freeze new `--o2-*` via
lint. Everything still works because the alias bridge stands. Stages 3–5 are mechanical
cleanup that can continue another day without risk.

---

## 9. Verification matrix (run at gates 1, 2, 5)

Theme switching is the highest-risk surface. For **each** predefined theme
(O2 Signature, O2 Pulse, O2 Horizon, O2 Beacon, O2 Lens, O2 Crimson Ink) in **both**
light and dark, plus **one custom color** and **live preview**, sanity-check:

- App chrome (top bar, side rail, content card float) — surfaces correct.
- Buttons (primary/secondary/outline/ghost/destructive/warning) — colors + hover.
- Inputs / selects / switches / checkboxes / radios — borders, focus rings, disabled.
- Tables (header, row hover, selected, zebra, dividers).
- Badges/toasts/banners (all variants).
- **Domain viz**: logs severity spines, trace span-kind chips, field-type chips,
  label chips, JSON syntax colors, service-health, latency (the Bucket D surfaces).
- Crimson Ink specifically exercises the `semanticColors` runtime path (§6).

Automate what's cheap: run the existing Cypress/unit suites; the token guard (§7c) is the
programmatic backstop for "did we break a reference".

---

## 10. Rollback

- Every stage is one commit (or one commit per batch/family) → `git revert` is clean.
- The alias bridge (Stage 1) is the safety floor: if a Stage 3/4 codemod misfires, revert
  that batch; the aliases still resolve `--o2-*`, so the app is never broken.
- Keep Stages 0–2 and 3–5 as **separate PRs** so the freeze+bugfix half can ship even if
  the cleanup half needs more time.

---

## 11. Time budget (one day)

| Block | Stages | ~Time |
|---|---|---|
| Morning | 0 (lint+baseline), 3 §-bugs, 1 (alias bridge) | 3h |
| Midday | 2 (theme.ts + specs) + theme matrix | 2h |
| Afternoon | 3 (ref codemod, batched) | 2h |
| Late | 4 (Bucket D, time-boxed) + 5 (delete, flip lint to error) | 2h |

Buckets A/B/C + lint + theme.ts is the committed "must-land" (≈ through Stage 3).
Bucket D is "land if green, else defer aliased".

---

## 12. Deliverables checklist

- [ ] `web/scripts/o2-token-map.json` — the canonical mapping (source of truth for codemod + alias gen)
- [ ] `web/scripts/gen-o2-aliases.mjs` — emits the alias block from the map
- [ ] `web/scripts/codemod-o2-refs.mjs` — ref rewriter (var + arbitrary-value → utility)
- [ ] `web/scripts/check-css-tokens.mjs` — undefined-token CI guard
- [ ] `web/.stylelintrc.json` + deps + `package.json` script + CI wiring
- [ ] ESLint template rule for `--o2-` in `.vue`
- [ ] `utils/theme.ts` retargeted + specs updated
- [ ] 3 source-bug fixes (§3)
- [ ] `grep -r 'var(--o2-' web/src` → **0**
- [ ] Lint 7a/7b flipped to ERROR
- [ ] Unused `assets/main.css` + `assets/base.css` removed
