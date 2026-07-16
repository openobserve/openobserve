# O2 Style Migration — Style Blocks → Tailwind & Token-Layer Class Evacuation

> **Status: POLICY APPROVED 2026-07-16 (§3 ruling). P0 ✅ · PQ ✅ · PQ2 ✅ · W1.a ✅ (2026-07-16). W1.b–e / W2 not started.**
> Execution log, findings that CORRECT this plan, and the remaining queue: **§10**.
> ⚠ §1 counts and some §5/§9 claims are pre-execution estimates — several proved wrong; see §10.2.
>
> Written 2026-07-16 on `fix/token`. Companion to `O2_TOKEN_MIGRATION_PLAN.md` (Part II Phase E —
> this document **supersedes and extends** Phase E), `O2_TOKEN_DECISIONS.md` (D1–D20), and
> `O2_TOKEN_MIGRATION_PENDING.md`.
>
> **Review ruling (2026-07-16):** target **zero CSS to the hardest degree possible**. Keepers are only
> what Tailwind genuinely cannot express (animations/keyframes, external-lib DOM overrides — each with an
> explicit keep-comment saying why, v-html/generated content, print sections). Prefer **extracting
> components** over shared classes; "no classes as far as possible". **Quasar is out of the system** —
> all `.q-*` rules and `q-*` classes are dead: delete them / replace with Tailwind equivalents (verified:
> `quasar` absent from `package.json`, zero `<q-*>` tags in templates). Whatever style blocks survive at
> the end must be `scoped`.
>
> ⚠ **CORRECTION (PQ execution, §10.2.1): "all `q-*` classes are dead" is FALSE for `.q-field`.**
> It is a live runtime contract — `ODialog`/`ODrawer` query it via `querySelectorAll`/`closest`, the
> cipherkeys forms hand-add it, and both specs encode it. It was deliberately kept. All `.q-*` **CSS**
> is gone; dead `.q-*` **JS** remains and needs its own phase (PQ2).
>
> Two workstreams, one end state:
> - **W1 — Token-layer purity:** zero class/element/keyframe definitions inside the 4 token files
>   (`src/lib/styles/tokens/{base,semantic,component,dark}.css`). Tokens only.
> - **W2 — Style-block elimination:** every `<style>` block in `.vue` files migrated to bare Tailwind
>   utilities; CSS survives only where Tailwind genuinely cannot express it (policy in §3), scoped and token-based.
>
> Everything below is measured from the live tree (2026-07-16), not the stale doc counts.

---

## 1. Current state — the inventory

### 1.1 Vue style blocks (W2 surface)

| Metric | Value |
|---|---|
| `.vue` files with a `<style>` block | **231** (238 blocks; 7 files have 2–3 blocks) |
| Unscoped blocks (`<style>` / `<style lang="scss">`) | **199 of 238 (84%)** — global CSS |
| Scoped blocks | 39 |
| Total CSS lines in blocks | **~11,686** |
| "Easy" — own-element rules, directly Tailwind-able | **~6,151 lines / 168 files** |
| "Hard" — needs `:deep()`/global/keyframes/v-html reach | **~5,535 lines / 63 files** (top 10 files ≈ 3,900 of these) |
| Hardcoded colors inside blocks (`styleBlockHex` ratchet) | **632** (57 files) |
| Multi-digit px inside blocks (`stylePxUnit`) | **1,015** (129 files) |
| `!important` occurrences | 390 / 75 files |
| `@keyframes` definitions | 54 files (26 are EmptyState illustrations) |
| `.body--dark` / `.dark` selectors in blocks | 156 across 24 files (O2AIChat 60, TraceDetailsSidebar 25, TraceErrorTab 14) |

Top style-block files (CSS lines): `O2AIChat.vue` **1,518** · `TraceDetailsSidebar.vue` 643 ·
`SetupCardRenderer.vue` 419 · `AlertSettingsHelpDrawer.vue` 365 · `ScoreConfigDialog.vue` 353 ·
`EvalJobDetail.vue` 287 · `ScorerDetail.vue` 281 · `ThreadToolCalls.vue` 245 · `OCodeBlock.vue` 215 ·
`CodeQueryEditor.vue` 213 · `ThreadView.vue` 205.

**Cross-file duplication** (the "same scoped css used at multiple places" problem):

| Pattern | Files | Consolidation target |
|---|---|---|
| EmptyState illustration classes (`.es-static`, `.es-spark*`, `.es-head`, `.es-dot`, `.es-badge`) | **23** | one shared stylesheet/component for `lib/core/EmptyState/illustrations/` |
| Scrollbar styling (`::-webkit-scrollbar*`, near-identical bodies) | **21** | delete — a global themed scrollbar rule already exists (component.css 4121–4159; moves to base layer in W1) |
| `.index-table` / `.index-menu` | 8 / 6 | shared `@utility` or extracted component |
| `.card-container`, `.o-tab*`, `.o-splitter__separator`, `.skeleton-box`, `.sessions_page` | 4–5 each | `@utility` / component |
| Quasar internals (`.q-field__native`, `.q-splitter__separator`) | 5 each | **dead — Quasar removed; delete (phase PQ)** |

### 1.2 Token-layer files (W1 surface)

| File | Lines | Verdict |
|---|---|---|
| `base.css` | 799 | **CLEAN** — 51 `@font-face` (1–496, not classes) + one `:root` (498–799). Zero class rules |
| `semantic.css` | 324 | **CLEAN** — `:root` ×5 + `@theme inline`. Zero class rules |
| `dark.css` | 689 | **CLEAN** — `.dark` token overrides only (one stray `color-scheme: dark;` at L17, which is fine/deliberate) |
| `component.css` | 4,367 | **~2,832 lines (65%) are class/element/keyframe rules** — the entire W1 problem is this one file |

component.css non-token content, by family (full detail in §5):

| # | Family | Lines (~) | Where | Consumers |
|---|---|---|---|---|
| F10 | **Logs page mega-block** (`.logPage_bkcss`, `.logs-search-bar-component`, `.histogram-*`, `.logs-index-menu`, `.context-menu`, sticky thead/tfoot, ~60 more) | **1,155** | 2464–3619 | `plugins/logs/*` (~13 files) |
| F8 | Field/schema explorer (`.field-*`, `.schema-*`, `.badge-int64/...`, `.tile-content-*`) | 295 | 1936–2231 | schema/index views |
| F14 | Resizer/splitter/layout (`.resizer`, `.splitter*`, `.logs-table`, `.table-row/-cell`) | 260 | 3851–4114 | logs/traces layout |
| F9 | RCA report (`.rca-report-content` + `body.body--dark` twin) | 223 | 2235–2458 | **single consumer:** `IncidentDetailDrawer.vue` |
| F6 | AI-assistant buttons (`.ai-hover-btn`, `.ai-floating-button`, … + `body.body--dark` twins) | 180 | 1640–1798 | 12 files |
| F4 | Global element typography/reset (`html, body`, `@layer base` h1–h6/p/a/code/pre, `::placeholder`) | 125 | 1477–1601 | app-wide |
| F11 | Pin tooltip (`.oo-pin-backdrop`, `.oo-pin-tooltip`) | 116 | 3621–3736 | **single consumer:** `plugins/logs/SearchResult.vue` |
| F7 | Form-element rules (`.o-input-label`, `textarea`, `[data-o2-variant=…]`, drag handles) | 110 | 1800–1929 | lib forms |
| F13 | Syntax guide (`.guide-list`, `.syntax-guide-*`, `.bg-highlight`) | 62 | 3785–3847 | logs/metrics/traces SyntaxGuide*.vue |
| F17 | Misc dashboard/alert (`.splitter-icon-*`, `.alert-field-highlight`, `.dashboard-chart-border`, grid placeholder) | 65 | 4161–4225 | dashboards/alerts |
| F12 | **Duplicate re-definitions** of F10 classes (`.expanded-content`, `.copy-btn-*`, …) | 42 | 3740–3781 | dead weight — dedupe |
| F16 | Global scrollbar theming | 39 | 4121–4159 | app-wide |
| F5 | App-shell helpers (`.o2-app-root`, `.o2-custom-bg`, `.card-container`, `.el-border`, `.o2-monospace-font`) | 35 | 1603–1638 | ~13 files |
| F3 | `.o2-table*` row-height/sticky rules | 33 | 1442–1474 | OTable + ~40 list views |
| F18 | `@media print` overrides | 20 | 4227–4246 | app-wide |
| F2 | Field-type badge helpers (`.field-type-container`, `.field-expand-icon`) | 16 | 1388–1404 | **single consumer:** `SearchFieldList.vue` |
| F15 | Tailwind duplicates (`.cursor-pointer`, `.select-none`, `.text-left`, `.full-width/-height`) | 15 | 3887–3897 + scattered | delete → utilities |
| F1 | `@keyframes pulse/glow-pulse/histogram-bar-shimmer` | 11 | 1379–1386, 3056–3059 | logs/AI |

Also relevant: `src/styles/tailwind.css` itself carries a few real rules (text-size re-pins, `.query-editor-placeholder-overlay`, `@keyframes o2-reveal-*`, a base border-color rule **with raw hex `#e5e7eb`** at L85–90, reduced-motion block). It is *not* a token file, so these may legally stay — but the hex should become `var(--color-border-default)` during W1.

### 1.3 What's already in place (do not rebuild)

- CI ratchet `npm run lint:design` (`scripts/check-design-consistency.mjs` + `design-debt-baseline.json`) with `unscopedStyle` (204), `styleBlockHex` (632), `stylePxUnit` (1,015), `darkMechanism` (310) categories — any reduction we land is frozen by re-baselining.
- `npm run lint:tokens` (`check-css-tokens.mjs`) — undefined-token guard.
- Tailwind v4 CSS-first config in `src/styles/tailwind.css`; `dark:` variant bound to app `.dark` class; `@tailwindcss/typography` (`prose`) available; `tw-animate-css` available.
- Design decisions D1–D18 recorded (reuse-first token policy); D19/D20 (dark-mechanism sweep) parked for last.
- **No `@utility` / `@layer components` convention exists yet** — this plan introduces one (§3.2).

---

## 2. Risk analysis

### 2.1 Overall verdict

| Workstream | Risk | Why |
|---|---|---|
| W1 quick wins (F15, F12, F1, F18, F16, single-consumer F2/F9/F11) | **Low** | Value-identical moves/deletes; consumers known; mechanical |
| W1 element/base typography (F4) + form rules (F7) | **Medium** | App-wide reach; cascade position changes; needs output-CSS diff + smoke pass |
| W1 logs mega-block (F10) + schema (F8) + layout (F14) | **Medium-high** | 1,700 lines of global CSS with unknown cross-file reach; logs is the highest-traffic screen |
| W2 easy tier (168 files, own-element rules) | **Low-medium per file, medium in aggregate** | Mechanical utility conversion but 6,100 lines; specificity/cascade changes; needs batch discipline |
| W2 hard tier (63 files: vue-flow/Monaco/v-html/keyframes; Quasar rules are dead and just deleted) | **Medium-high** | Partly not expressible as pure Tailwind; each file needs judgment + visual verification; O2AIChat alone is 1,518 lines |

Nothing here is *high-risk-unbounded*: every step is per-file/per-family, independently shippable, reversible by revert, and frozen by the ratchet. The risk is **visual regression volume**, not architectural breakage — mitigations below make regressions cheap to catch per-PR instead of expensive to hunt later.

### 2.2 Specific risks and mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **Deleting an unscoped block breaks a *different* component** that silently relied on its global classes (84% of blocks are global today) | Medium | High | Before deleting any rule: grep the class name across `src/` (templates, `:class` bindings, JS-built strings, specs). Automated pre-flight script in §7.3. Never delete a selector with consumers outside the file without migrating those too |
| R2 | **Specificity/cascade shifts.** Utilities are one-class specificity; the deleted rule may have been winning (or losing) against Quasar/global CSS via descendant selectors or `!important` (390 uses). Also: moving a component.css class into a scoped block *adds* `[data-v-x]` attribute specificity | Medium | Medium | Per-file visual check light+dark; output-CSS selector diff (§7.2); treat every rule with `!important` as review-tier, never auto-tier |
| R3 | **Teleported content** (menus, dialogs, tooltips render outside the component subtree) loses styling when a block becomes scoped or utilities move to the template | Medium | Medium | Known trap from Phase E: exercise every dialog/menu/tooltip of a touched file; teleport targets need `:global()` or classes on the teleported root |
| R4 | **v-html / JS-built HTML** (markdown chat, JSON printer, tooltip HTML) cannot carry template utilities | Certain (for those files) | High if forced | Policy §3.1: this CSS *stays* as CSS — scoped + `:deep()` + tokens. Don't force Tailwind where it can't reach |
| R5 | **Dynamic class names** built in JS (`` `status-${x}` ``) or bound via `:class` computeds escape template greps | Medium | Medium | Pre-flight script greps `.vue`+`.ts` for the raw string fragments; review-tier for any file with computed class bindings |
| R6 | Unit specs assert on concrete classes/styles (precedent: `HomeViewSkeleton.spec.ts`, `ShortUrl.spec.ts`) | Medium | Low | Update specs in the same commit; `npm run test:unit` per batch |
| R7 | Dark-mode regressions when `.body--dark`/`.light-mode` twins collapse to tokens | Medium | Medium | Every touched surface verified in **both** themes; the collapse usually *fixes* dark mode, but eyes required |
| R8 | Tailwind class-merge conflicts when several CSS rules collapse onto one element (`p-2` from one rule, `px-3` from another) | Low | Low | Conversion is per-element with the computed final style as the source of truth, not per-rule |
| R9 | **Print styles** (F18) and reduced-motion regressions — rarely tested surfaces | Low | Low | Explicit print-preview check on dashboards after F18 moves |
| R10 | Moving F4/F16 (element typography, scrollbars) changes *import order* relative to Tailwind layers → different winner in edge cases | Low-medium | Medium | Keep them in `@layer base` in the same import position (new file imported exactly where component.css sits today); output-CSS diff proves order |
| R11 | Losing styles for elements rendered only in rare states (error/empty/loading branches) — invisible to a happy-path visual check | Medium | Low-medium | Per-file checklist includes forcing empty/error states where the block styles them; grep rules for `.error/.empty/.loading` selectors as a reminder |

### 2.3 What genuinely cannot be Tailwind (and what only *looked* like it)

The "hard" ~5,500 lines shrink considerably under the approved hardest-target policy:

- **Quasar internals (`.q-*`, `:deep(.q-field__*)`, splitter rules)** — *no longer a constraint.* Quasar is out of the dependency tree and no `<q-*>` tags exist, so every one of these rules matches nothing. They are **dead code → delete** (with a per-rule confirmation, §5.7). This also re-opens a P0-class bug: ~25 `var(--q-*)` refs are phantom again (§2.4).
- **Cross-element state selectors** (`.parent:hover .child`) — mostly expressible with Tailwind `group`/`group-hover:`/`peer` and arbitrary variants; treated as *convertible*, not keepers.
- **Scrollbar pseudo-elements** — expressible via one shared definition (global base rule + one `@utility`), not per-file CSS.
- **Genuine keepers** (the only sanctioned residue, always `scoped`, each with a keep-comment):
  1. `@keyframes` / complex animations (`tw-animate-css` + `animate-*` utilities absorb the simple ones first);
  2. **external-lib DOM overrides** (vue-flow, Monaco, hljs output) — kept **with an explicit comment stating which library and why**;
  3. **v-html / JS-generated content** (markdown chat, JSON printer, tooltip HTML) — utilities cannot reach markup that has no template;
  4. **`@media print` sections** — needed (printable dashboards/reports); simple cases use Tailwind's `print:` variant, multi-rule print layouts stay as CSS.

Forcing categories 2–4 into utilities means arbitrary-variant soup or a global stylesheet — both worse. Everything else converges to utilities or extracted components (§3).

### 2.4 Quasar-exit residue (found while verifying the review ruling — currently broken UI)

`quasar` is gone from `package.json` and templates, but the exit left residue:

| Residue | Count | Status |
|---|---|---|
| `.q-*` selectors in style blocks | 54 hits / 15 files (+ `.q-field__native`, `.q-splitter__separator` duplicated across 5 files each) | **Dead rules** — match no DOM. Delete |
| `q-*` classes still in templates (e.g. `q-caption` in `AddAkeylessType.vue:62,138`) | small tail | Dead classes — remove/replace with utilities |
| `var(--q-primary)` refs | 29 | Works — but only via the compat alias `semantic.css:220` / `dark.css:587`. Migrate to `var(--color-theme-accent)` and delete the alias |
| **Phantom `var(--q-*)` refs — undefined at runtime** | ~25: `--q-dark-page` ×8, `--q-secondary` ×7, `--q-background` ×3, `--q-text-secondary` ×2, `--q-negative` ×2, `--q-border-color` ×2, `--q-header-bg` ×1 (files: `TelemetryCorrelationPanel.vue`, `WebinarBanner.vue`, `UploadSourceMaps.vue`, `SourceMaps.vue`, `SourceMapDropzone.vue`, `AnomalySummary.vue` (via --q-primary ok), `TabsSettings.vue`, `AddAkeylessType.vue`, …) | **Silently broken today** (transparent bg / inherited colors) — Quasar used to define these; nothing does now. Hidden because `check-css-tokens.mjs` still allowlists the "10 real Quasar variables" that are no longer real |
| `check-css-tokens.mjs` Quasar allowlist | 10 exact names | **Guard hole — remove** so phantom `--q-*` can never hide again |

This mirrors the Phase 0 `--q-*` bug class from the main plan — it regressed the moment Quasar was removed. It is cheap to fix and jumps the queue (§5.7, phase **PQ**).

---

## 3. Target end-state policy — **RULED 2026-07-16: hardest-possible zero**

> **The ruling:** drive CSS to zero as far as it can go. Only what Tailwind *cannot* express survives
> (animations, external-lib overrides with an explicit reason, generated content, print sections).
> Prefer extracting components over sharing classes; avoid class definitions as far as possible.
> Quasar rules are dead — delete. Whatever blocks remain at the end are `scoped`.

### 3.1 The decision ladder for every rule being migrated (order matters — exhaust each step before falling to the next)

1. **DELETE** — rule is dead (no consumers), targets Quasar DOM that no longer exists (§2.4), or duplicates Tailwind/preflight/another rule (F15, F12).
2. **Template utilities** — rule styles an element the template owns → delete rule, put bare Tailwind utilities (token-backed, rem-based) on the element. Includes the previously-"hard" cases that utilities *can* express: hover/focus chains via `group-hover:`/`peer-*`, simple `@media` via responsive/`print:` variants, simple animations via `tw-animate-css` `animate-*`, `::before`/`::after` via `before:`/`after:`. *This is the default destination — covers well over half of all lines.*
3. **Extract a component** — the pattern is markup+style repeated across files (EmptyState `.es-*` illustrations, card/table chrome, AI buttons) → build/extend an `O*` or shared component whose *template* carries the utilities. **Preferred over any shared class, per the ruling.**
4. **Shared `@utility`** — last resort for a *pure styling concern* that recurs across ≥3 files but has no markup of its own to componentize (realistically: scrollbar treatment; little else should qualify). Defined once in `src/styles/utilities.css`. If in doubt between 3 and 4, choose 3.
5. **Justified scoped CSS (the only sanctioned residue)** — the rule survives **only** if it is one of:
   - `@keyframes` / animation bodies `tw-animate-css` can't express;
   - **external-library DOM overrides** (vue-flow, Monaco, hljs output) — kept because the DOM isn't ours;
   - **v-html / JS-generated content** styling (markdown, JSON printer, built tooltip HTML);
   - **multi-rule `@media print` layouts** (printable sections are a product requirement) where `print:` utilities don't fit.
   Every survivor lives in a **`<style scoped>`** block that **opens with a keep-comment**:
   `/* keep(<reason-tag>): <one line why this cannot be Tailwind> */` with reason-tag ∈ `lib-override:<libname>` | `generated-content` | `keyframes` | `print`. Colors via `var(--color-*)` only, rem units, `.dark &` for dark-only rules, explicit `:deep()`/`:global()`. A block without a keep-comment is a CI failure (§6).

**End state, enforced by CI:**
- Token files: **zero** non-token content (checker in §6.1).
- `.vue` files: **zero unscoped blocks**; **zero hex / zero class-sharing** in blocks; every remaining block is `scoped`, starts with a keep-comment, and contains only step-5 content. Expected residue: a few dozen files, not 231.
- Global CSS lives in exactly three sanctioned places: `tailwind.css` (config + `@layer base` reset), `utilities.css` (deliberately tiny), token files (tokens only).

### 3.2 New conventions this plan introduces

- `src/styles/utilities.css` — Tailwind v4 `@utility` definitions, **kept deliberately minimal** (ladder step 4 is a last resort; component extraction wins ties). Imported from `tailwind.css`.
- `src/styles/base-elements.css` — the app's element reset/typography/scrollbar/print layer (receives F4, F16, F18 from component.css), all `@layer base`, tokens only. Imported from `tailwind.css` in component.css's current position (R10). Element selectors here are resets, not "classes" — this is the one legitimate global layer.
- The **keep-comment contract** (§3.1 step 5) — makes every surviving CSS block self-justifying and greppable (`grep -rn "keep(" src --include='*.vue'`).
- ESLint `vue/enforce-style-attribute` already at warn — flips to error at the end of W2 (§6.3).

---

## 4. Execution overview & ordering

Dependency-ordered; each phase independently shippable; ratchet re-baselined per landed PR.

| Phase | What | Size | Risk | Gate |
|---|---|---|---|---|
| **P0** | Guards & scaffolding: token-purity checker (warn), pre-flight class-usage script, `utilities.css` + `base-elements.css` skeletons, output-CSS diff tooling | small | none | — |
| **PQ** | **Quasar-exit purge (§5.7)** — fix the ~25 phantom `var(--q-*)` refs (broken UI today), remove the `--q-*` allowlist from `check-css-tokens.mjs`, delete dead `.q-*` rules + `q-*` template classes, migrate the 29 `var(--q-primary)` refs → `var(--color-theme-accent)`, delete the alias | small | Low | P0 (pre-flight script) |
| **W1.a** | component.css quick wins: F15 delete, F12 dedupe, F1 keyframes out, F18 print → base-elements, F16 scrollbar → base-elements, F2/F9/F11 colocate to single consumers | ~470 lines | Low | P0 |
| **W1.b** | F4 element typography + F7 form rules + F5 app-shell + F3 `.o2-table*` → `base-elements.css` / lib components / utilities | ~300 lines | Medium | W1.a |
| **W1.c** | F6 AI buttons, F13 syntax guide, F17 misc → utilities/components; kill their `body.body--dark` twins (tokens/`.dark`) | ~310 lines | Medium | W1.a |
| **W1.d** | F8 schema + F14 layout + **F10 logs mega-block** → per-consumer utilities, `@utility`, or colocated scoped CSS | ~1,710 lines | Medium-high | W1.b, pre-flight per class |
| **W1.e** | Flip token-purity checker to **error**. Token files are now pure | — | none | W1.a–d |
| **W2.a** | Easy tier: 168 files own-element rules → utilities, blocks deleted or shrunk; px→rem + hex→token on everything touched. Batched by directory (§5.6) | ~6,150 lines | Low-med | P0 |
| **W2.b** | Dedup consolidation: EmptyState `.es-*` (23 files), per-file scrollbar CSS (21 files — mostly deletable once global scrollbar is confirmed), `.index-table`/`.index-menu` | ~1,200 lines | Medium | W2.a started, utilities.css |
| **W2.c** | Hard tier: 63 files → full ladder (Quasar rules already deleted in PQ; hover-chains → `group-hover:`/`peer`; residue = justified keepers only, scoped + keep-comment). Top-10 files get individual PRs. O2AIChat last (needs D6/D8 token sets — **already decided**, execute per decision register) | ~5,500 lines | Med-high | PQ; D6 bg pick (only open design call) |
| **W2.d** | Enforcement flip: `unscopedStyle`=0 → `vue/enforce-style-attribute` error; `styleBlockHex`=0 → stylelint `color-no-hex` error for `.vue` | — | none | W2.a–c |
| *(parked)* | D19/D20 dark-mechanism sweep — stays parked per decision register; W1/W2 reduce `.body--dark` sites but the final sweep is its own effort | — | — | last |

Parallelism: W1 and W2.a are independent and can run concurrently (different files). Within W2.a, directory batches are independent.

---

## 5. Detailed action plans

### 5.1 P0 — scaffolding (one PR)

1. **Token-purity checker** — new `scripts/check-token-purity.mjs` (wired as `lint:token-purity`, added to CI next to `lint:tokens`):
   - Parses each of the 4 token files' top-level constructs.
   - Allowlist: `:root…{}` blocks containing only `--*` declarations (+ `color-scheme`), `.dark`-prefixed blocks with only `--*` declarations, `[data-variant=…]` blocks with only `--*` declarations, `@theme` blocks, `@font-face`, comments.
   - Anything else (class/element selector, `@keyframes`, `@media`, `@layer`, non-custom-property declaration) → reported. Starts at **warn with a committed baseline count** (like the ratchet); flips to error in W1.e.
2. **Pre-flight class-usage script** — `scripts/find-class-consumers.mjs <className>...`: greps `src/**/*.{vue,ts}` for each name in templates, `:class`/`class` bindings, template-literal fragments, and spec files; prints consumer files. Used before every rule deletion (R1/R5).
3. **Output-CSS diff tooling** — `scripts/css-selector-diff.mjs`: extracts the sorted selector list (and per-selector declaration hash) from a built CSS file; used per §7.2.
4. Create empty `src/styles/utilities.css` + `src/styles/base-elements.css`, import from `tailwind.css` (base-elements imported at component.css's position). Replace the raw `#e5e7eb` at `tailwind.css:85-90` with `var(--color-border-default)`.

### 5.2 W1 — evacuating component.css (family → destination)

| Family | Destination | Method |
|---|---|---|
| F15 utility duplicates | **delete** | Consumers switch to `cursor-pointer`/`select-none`/`text-left`/`w-full`/`h-full` (Tailwind's own). Pre-flight grep each name |
| F12 duplicate definitions | **delete** | Verify byte-equivalent with F10 originals first |
| F1 keyframes | move next to consumers (scoped block or `utilities.css` if multi-file) | `glow-pulse`'s raw rgba → token via `color-mix` |
| F18 print | `base-elements.css` `@media print` | verbatim move |
| F16 scrollbar | `base-elements.css` `@layer base` | replace hardcoded greys with `var(--color-*)` (register a `--color-scrollbar-thumb` pair if none fits — reuse-first per D18) |
| F2 field-type badge | colocate → `SearchFieldList.vue` (ladder step 2 — trivially utilities) | single consumer |
| F9 RCA report | colocate → `IncidentDetailDrawer.vue` **scoped** block (it styles v-html markdown → ladder step 5); hex→tokens; `body.body--dark` twin → `.dark &` collapse | single consumer |
| F11 pin tooltip | colocate → `SearchResult.vue`; tooltip is teleported — verify reach, use `:global()` if needed | single consumer |
| F4 element typography | `base-elements.css` (same `@layer base` wrappers, verbatim first, then px→rem) | app-wide smoke + CSS diff |
| F7 form rules | split: `.o-input-label*` → `OForm*` lib components; generic `textarea`/`input` rules → `base-elements.css`; `[data-o2-variant]` rules → the OButton source | per-rule |
| F5 app-shell helpers | `.o2-app-root`/`.o2-custom-bg` → `MainLayout.vue`; `.card-container` (also duplicated in 5 style blocks) → inline utilities at call sites, or a small shared component if the markup repeats; `.el-border*`/`.o2-monospace-font` → utilities or delete after grep | pre-flight each |
| F3 `.o2-table*` | into `OTable`/sub-component styles (lib-owned, ~40 consumers keep working) | CSS diff + table screens |
| F6 AI buttons | **extract an `AiActionButton`-style component** (components-over-classes ruling); 12 consumers migrate; `body.body--dark` twins collapse to tokens/`.dark` | visual: all AI entry points |
| F13 syntax guide | colocate to the 3 SyntaxGuide components (mostly ladder 2); `.bg-highlight` already token-backed | |
| F17 misc | per-rule: dashboards grid placeholder → dashboard component; `.alert-field-highlight` → consumer; `.no-data-image` → consumer | pre-flight each |
| F8 schema explorer | consumers are a small set of schema/index views → utilities where owned, colocated scoped CSS where `:deep` needed. The `-dark/-light` suffixed class pairs (`.tile-content-dark` etc.) collapse to tokens | |
| F14 resizer/layout | splitter/resizer rules → the owning splitter component(s); `.q-splitter__separator` copies are dead (PQ); `.logs-table` merges with F10 work | |
| F10 logs mega-block | **last, its own PR series.** Per class: pre-flight consumers → (a) single-consumer → colocate/utilities; (b) multi-consumer chrome (`.logs-index-menu`, `.histogram-container`) → the owning component's scoped block (children reached via `:deep`) or `@utility`; (c) dead classes (expect several — the block predates refactors) → delete | logs is the flagship screen: full §7.4 matrix per PR |

Order within W1: **a** (quick wins, ~1 PR) → **b** (base layer, 1 PR + CSS diff) → **c** (2–3 PRs) → **d** (F8/F14 1–2 PRs; F10 as 3–5 PRs by class-group) → **e** (flip checker to error, delete its baseline).

### 5.3 W2.a — easy-tier style blocks (168 files)

Fixed per-file procedure (extends the shipped Phase E procedure):

1. Pre-flight: `node scripts/find-class-consumers.mjs` for every class the block defines. Any external consumer → migrate that too or defer the rule to W2.b/c.
2. For each rule on template-owned elements: convert the *computed* style to utilities on the element (`display:flex; gap:8px` → `flex gap-2`), collapsing duplicate/overridden declarations. Colors → token utilities; px → rem scale; `:hover`/`:focus` one-liners → variants; simple `@media` → responsive prefixes; dark twins → tokens (or `dark:` for non-color).
3. Delete converted rules — `.q-*` rules delete unconditionally (dead, PQ policy). If nothing remains → delete the whole block (**the expected outcome for this tier**). If genuine step-5 residue remains → block becomes `scoped`, opens with the keep-comment, residue tokenized, `:deep()`/`:global()` made explicit.
4. Update any spec asserting old classes; run the batch verify (§7.1).

Batching (aligns with debt distribution; one PR per batch, ~10–20 files each):
`lib/core/EmptyState/illustrations` (26 files — handled as W2.b instead) → `components/alerts` → `components/settings` + `components/iam` → `components/dashboards` → `plugins/logs` (coordinate with W1.d F10) → `plugins/traces` (small files) → `components/rum` + `views/RUM` → `components/pipeline` + `plugins/pipelines` → `views/` → `enterprise/` → `lib/` remainder → stragglers.

### 5.4 W2.b — consolidation of duplicated patterns

1. **EmptyState illustrations (23 files, ~2,000 lines total):** the `.es-*` classes + keyframes are copy-pasted per illustration. Extract one shared stylesheet imported by the illustrations (or a base `EmptyIllustration.vue` wrapper component — preferred per house rules). One PR; verify a sample of empty states animate identically (reduced-motion too).
2. **Scrollbars (21 files):** confirm the global themed scrollbar (F16, now in base-elements.css) covers each case; delete per-file copies; genuinely different treatments (thin overlay scrollbars in dense panels) → one `@utility o2-scrollbar-thin`.
3. **`.index-table` (8) / `.index-menu` (6) / `.card-container` (5):** per the ruling, prefer **extracting a shared component** carrying the utilities in its template; fall back to inline utilities per call site if the markup doesn't actually repeat. Delete all copies. These currently *collide globally* — consolidation also removes a leak class.

### 5.5 W2.c — hard-tier files (63 files, top 10 individually)

Per file: apply the ladder; expected residue is step-5 CSS only (scoped, keep-comment, tokens, rem, `.dark &`). Dead `.q-*` rules are already gone via PQ. Specific notes:

| File | Notes |
|---|---|
| `O2AIChat.vue` (1,518) | Largest. Execute per D6 (9 `--color-syntax-*` tokens — one open call: light code-bg `#ffffff` vs `#f6f8fa`) + D8 (reuse-first chat tokens) + D14 (gradient tokens). Markdown/v-html → step 5 with `prose` (typography plugin) evaluated first — it may delete most of the markdown CSS. `.light-mode`/`.dark-mode` → tokens/`.dark`. Split into 3–4 PRs (syntax theme / chat chrome / markdown / cleanup) |
| `TraceDetailsSidebar.vue` (643) | D11: alive, migrate mechanically; 3 blocks incl. global `table/th/td` restyle → `:deep` under root class |
| `SetupCardRenderer.vue` (419) | D10: private `--clay/--panel/--text-*` vocabulary → global tokens (pure rename), then ladder |
| `ThreadView.vue`/`ThreadToolCalls.vue` (450) | D9: `--color-thread-*` role tokens; own `--dark` mechanism → `.dark` |
| `OCodeBlock.vue` (215) / `TraceErrorTab.vue` (138) | D6 shared syntax tokens; Monaco/hljs internals stay step 5 |
| `CodeQueryEditor.vue` (213) | Monaco internals → step 5 |
| `PipelineEditor.vue`/`CustomNode.vue`/`PipelineFlow.vue`/`ServiceGraph.vue` | vue-flow internals → step 5; `CustomNode`'s teleported `.pipeline-error-tooltip` needs `:global()` (known trap) |
| `AlertSettingsHelpDrawer.vue` (365), onlineEvals forms (~920) | Mostly easy-tier content that happens to be big — treat as W2.a files with extra care |
| `ServiceGraphNodeSidePanel.vue` (92) | D7 (Edge panel already deleted): always-dark treatment — register always-dark `--color-graph-panel-*` per decision |

### 5.6 What explicitly does NOT change

- `DestinationPreview.vue` brand replicas, WebinarBanner promo art (D12/D13 allowlist decisions) — **color values**; its phantom `--q-secondary` refs DO get fixed in PQ.
- `stylePxUnit` stays ratchet-only (never zero-tolerance) per §12.4 of the main plan — px→rem is opportunistic-on-touch.
- D19/D20 dark-mechanism final sweep — parked, runs last as separate commits.
- `@font-face` blocks in `base.css` — not classes; moving them to a `fonts.css` is optional polish (P3 in §8).

### 5.7 PQ — Quasar-exit purge (jumps the queue: fixes broken UI today)

Quasar is out of `package.json` and templates (verified), but §2.4's residue remains. One small PR:

1. **Phantom `var(--q-*)` refs (~25) → modern tokens** (reuse the Phase-0 §7.3 map):
   `--q-background` → `--color-surface-base` · `--q-border-color` → `--color-border-default` ·
   `--q-header-bg` → `--color-surface-panel` · `--q-text-secondary` → `--color-text-secondary` ·
   `--q-negative` → `--color-status-negative` (or `status-error-text` for text) ·
   `--q-positive` → `--color-status-positive` · `--q-secondary` → `--color-theme-secondary`-equivalent
   (check what `theme.ts` emits; WebinarBanner's use is promo art — pick per D13) ·
   `--q-dark-page` → `--color-surface-base` · `--q-color-dark` → `--color-text-primary`.
   Files: `TelemetryCorrelationPanel.vue`, `WebinarBanner.vue`, `UploadSourceMaps.vue`, `SourceMaps.vue`,
   `SourceMapDropzone.vue`, `TabsSettings.vue`, `AddAkeylessType.vue` (+ any the grep in §7.5 surfaces).
2. **`var(--q-primary)` (29 refs) → `var(--color-theme-accent)`** (value-identical — that's what the alias points to). Then delete the alias lines `semantic.css:220` and `dark.css:587`.
3. **`check-css-tokens.mjs`: remove the entire `--q-*` exact-name allowlist** (the "10 real Quasar variables" no longer exist). After this, any `--q-*` ref fails CI forever.
4. **Delete dead `.q-*` rules** in the 15 style-block files (54 hits) + the `.q-field__native`/`.q-splitter__separator` copies. Per-rule confirmation: the selector must not match any template class (`grep -r "q-field__native" src --include='*.vue'` on the template sections — pre-flight script covers this).
5. **Remove dead `q-*` template classes** (`q-caption` in `AddAkeylessType.vue:62,138`, plus whatever `grep -rEn 'class="[^"]*\bq-[a-z]' src --include='*.vue'` finds) — replace with the utility that matches the *intended* look (same "was it dead or alive" visual check as the old `tw:` strip).

Verification (§7.5) + visual: TelemetryCorrelationPanel, RUM source-map screens, WebinarBanner, AnomalySummary, cipher-keys Akeyless form — all in light + dark (these are the screens rendering wrong today).

---

## 6. Enforcement changes (what makes this stick)

| Guard | Now | After PQ / W1.e | After W2.d |
|---|---|---|---|
| `check-css-tokens.mjs` `--q-*` allowlist | 10 names allowlisted (**hole** — Quasar gone) | **removed at PQ** — any `--q-*` ref fails CI | error |
| `lint:token-purity` (NEW) | — | **error, zero non-token constructs** in the 4 token files (W1.e) | error |
| `lint:design` `unscopedStyle` | ratchet (204) | ratchet ↓ | **0 → zero-tolerance** |
| `lint:design` `styleBlockHex` | ratchet (632) | ratchet ↓ | **0 → zero-tolerance** |
| `lint:design` `styleKeepComment` (NEW at W2.d): every `<style>` block must be `scoped` AND start with `/* keep(<tag>): … */` | — | — | **error** — a style block without a justification cannot merge |
| ESLint `vue/enforce-style-attribute` | warn | warn | **error** (only `scoped`/`module` allowed) |
| stylelint `color-no-hex` (`.vue` override) | warn | warn | **error** |
| `lint:design` `stylePxUnit` | ratchet (1,015) | ratchet | ratchet (permanent, by design) |

New-code rules are already covered by the house rules (no new style blocks at all); these flips make the *burned-down* state unregressable.

---

## 7. Verification playbook

### 7.1 Per-PR gate (every batch, no exceptions)

```sh
cd web
npm run lint:tokens              # no undefined tokens
npm run lint:token-purity        # token files clean / not worse (P0+)
npm run lint:design              # every touched category ≤ baseline; re-run with --baseline on improvement, commit it
npm run lint:styles              # stylelint
npm run lint:ci                  # eslint
npm run type-check
npm run test:unit                # specs updated in-PR where they asserted classes
npm run build                    # tailwind compiles all new utility usage
```

### 7.2 Output-CSS selector diff (the safety net for W1.b/W1.d and any global-CSS move)

Proves a refactor is a no-op (or shows exactly what changed) at the *built stylesheet* level:

```sh
cd web
# on the base commit:
npm run build-only && node scripts/css-selector-diff.mjs dist/assets/*.css > /tmp/css-before.txt
# on the migration branch:
npm run build-only && node scripts/css-selector-diff.mjs dist/assets/*.css > /tmp/css-after.txt
diff /tmp/css-before.txt /tmp/css-after.txt
```

Expected diffs are only: selectors intentionally deleted/moved (same declarations, new location/layer) and new token-backed declarations replacing hex. Anything else = investigate before merge.

### 7.3 Pre-flight before deleting any class rule

```sh
node scripts/find-class-consumers.mjs logPage_bkcss histogram-container context-menu ...
# → lists every consumer file (templates, :class bindings, string fragments, specs).
# Zero consumers → safe delete. Consumers only in the target file → colocate. Else → migrate consumers in the same PR.
```

Interim (until the script exists): `grep -rnE "(class(Name)?=|:class|classList|['\"\`])[^'\"\`]*\bCLASSNAME\b" src --include='*.vue' --include='*.ts'`

### 7.4 Visual verification matrix (light + dark, per affected phase)

| Phase | Surfaces to eyeball |
|---|---|
| PQ | TelemetryCorrelationPanel; RUM source-map upload + dropzone; WebinarBanner; AnomalySummary; cipher-keys Akeyless form — the phantom-var screens rendering wrong today |
| W1.a | Incident drawer RCA report; logs pin tooltip; field list badges; print preview of a dashboard; scrollbars on logs + traces + a dialog |
| W1.b | Global smoke: headings/links/labels/placeholders on 3 dense screens; every form on one settings page; a table-heavy page |
| W1.c | Every AI button entry point (logs toolbar, header, empty states); syntax guides (logs/metrics/traces) |
| W1.d | **Full logs page**: search bar, index menu, histogram (+loading/error/empty), results table (sticky header/footer, expand, copy buttons, context menu), detail dialog, saved views; schema/index details; splitter drag on logs & traces |
| W2.a | Per batch: the batch's main screens; forced empty/error/loading states of touched components; every dialog/menu/tooltip a touched file owns |
| W2.b | A sample of 5+ empty states (animation + reduced-motion); scrollbars app-wide; index tables in logs/traces/metrics |
| W2.c | Per file: its full surface both themes (AI chat incl. code blocks + markdown; trace sidebar; thread view; pipelines canvas incl. error tooltip; service graph panels; setup cards) |

### 7.5 PQ definition-of-done

```sh
cd web
# zero --q-* references of any kind (after alias deletion):
grep -rEn 'var\(--q-|\(--q-|\[--q-' src --include='*.vue' --include='*.ts' --include='*.css'   # → 0
# zero --q-* definitions:
grep -rn '\-\-q-[a-z-]*\s*:' src --include='*.css' --include='*.vue'                            # → 0
# zero dead Quasar selectors/classes:
grep -rEn '\.q-[a-z]' src --include='*.vue' --include='*.css'                                   # → 0
grep -rEn 'class="[^"]*\bq-[a-z]' src --include='*.vue'                                         # → 0
npm run lint:tokens        # green with the --q- allowlist removed
```

Progress tracking at any time:

```sh
cd web
grep -rEoh '<style[^>]*>' --include='*.vue' src | grep -cv scoped     # unscoped blocks → 0
node scripts/check-design-consistency.mjs                              # all ratchet counts
awk '/<style/{f=1} f{n++} /<\/style>/{f=0} END{print n}' $(grep -rl '<style' --include='*.vue' -r src)  # total block lines trend
```

---

## 8. Effort & sequencing estimate

| Chunk | Content | Rough size |
|---|---|---|
| P0 | 3 scripts + 2 CSS skeletons + CI wiring | 1 PR, small |
| PQ | Quasar-exit purge (phantom vars, allowlist, dead rules/classes, alias retirement) | 1 PR, small — **do first, fixes live breakage** |
| W1.a–c | ~940 lines evacuated, quick wins first | 4–6 PRs |
| W1.d | ~1,710 lines (logs/schema/layout) | 5–7 PRs |
| W2.a | 168 files / ~6,150 lines | 10–12 batch PRs |
| W2.b | 3 consolidations (~50 files touched) | 3 PRs |
| W2.c | 63 files, top-10 individually | 12–15 PRs |
| Flips | W1.e + W2.d enforcement | 2 PRs |

Total ≈ **35–45 PRs**, each independently shippable and ratchet-frozen. W1 and W2.a can run in parallel from day one; only the O2AIChat/D6 work waits on the one open design call (light code-bg pick).

## 9. Decision log & remaining calls

**Resolved 2026-07-16 (review ruling):**
1. ✅ **End-state policy** — hardest-possible zero. Keepers limited to keyframes/animations, external-lib overrides (mandatory keep-comment naming the lib and reason), v-html/generated content, and print sections. All survivors `scoped`. Prefer component extraction over shared classes; `@utility` demoted to last resort.
2. ✅ **Quasar** — out of the system; all `.q-*` rules / `q-*` classes are dead → delete (phase PQ). Discovered in the same verification: ~25 phantom `var(--q-*)` refs are broken today — PQ fixes them and closes the token-guard allowlist hole.
3. ✅ **`@media print`** — stays (printable sections are a product requirement); simple cases via `print:` utilities.
4. ✅ **External-lib overrides** — keep, each with an explicit keep-comment stating why.

**Still open (small, none block starting P0/PQ/W1.a/W2.a):**
1. **EmptyState consolidation shape** — wrapper component (recommended, matches the components-over-classes ruling) vs shared stylesheet.
2. **D6 light code-bg pick** (`#ffffff` vs `#f6f8fa`) — the one outstanding design call, blocks only the O2AIChat/OCodeBlock/TraceErrorTab syntax-theme PRs.
3. **F10 approach confirmation** — logs mega-block classes colocated to owning components (with `:deep`) rather than kept global. (Recommended: colocate.)
4. **`--q-secondary` in WebinarBanner** — promo art per D13; pick its replacement token (promo token vs theme secondary) during PQ.

Execution starts on explicit go-ahead: P0 + PQ first, then W1.a + the first W2.a batch concurrently.

---

## 10. Execution log — P0 + PQ (2026-07-16)

### 10.1 What landed

**P0 — scaffolding (complete)**
- `scripts/check-token-purity.mjs` + `token-purity-baseline.json`, wired as `npm run lint:token-purity`.
  Ratchet mode, **baseline 249**. Deleting the baseline file flips it to zero-tolerance (that IS the W1.e step).
  `--list` prints every offending construct; `--baseline` re-writes.
- `scripts/find-class-consumers.mjs` — pre-flight for §7.3. Classifies hits into definitions / consumers /
  specs / dynamic-construction candidates and prints a verdict
  (`NO CONSUMERS` / `SELF-CONTAINED` / `HAS CONSUMERS`).
- `scripts/css-selector-diff.mjs` — §7.2 output-CSS diff. Normalises + sorts declarations so a pure MOVE
  hashes identically and produces zero diff noise.
- `src/styles/base-elements.css` + `src/styles/utilities.css` skeletons, imported from `tailwind.css`
  with base-elements at **component.css's exact position** (risk R10 mitigated).
- `tailwind.css` raw `#e5e7eb` → `var(--color-border-default)`.

**PQ — Quasar-exit purge (complete)**
- 119 `--q-primary` refs → `--color-theme-accent`; both alias definitions deleted.
- All other phantom `--q-*` mapped per §5.7; **zero `--q-*` refs and zero `--q-*` definitions remain.**
- `check-css-tokens.mjs`: `QUASAR_REAL` allowlist **removed** — any `--q-*` now fails CI forever.
- 37 dead `.q-*` CSS rules deleted across 19 files; 6 now-empty `<style>` blocks removed.
  `unscopedStyle` 204 → **198**; files with a style block 231 → **227**.
- Provably-inert `q-*` template classes removed (`q-fieldset`, `q-caption`, `q-btn-primary`, `q-pb` —
  each verified to have zero CSS definitions and zero JS selectors).

New tokens registered (all in `@theme inline`, verified resolving live in both themes):
`--color-promo-webinar-accent` (amber-400, decorative) · `--color-promo-webinar-accent-text`
(amber-700 — the badge LABEL needs it; amber-400 on the near-white banner is ~1.7:1 and fails a11y) ·
`--color-section-accent-secondary` (teal-600 light / teal-400 dark).

### 10.2 Findings that CORRECT this plan — read before starting W1/W2

1. **`.q-field` is NOT dead — the §3/§9 ruling "all `q-*` classes are dead → delete" is wrong for it.**
   `ODialog.vue:217` / `ODrawer.vue:200` call `body.querySelectorAll('.q-field')` and
   `closest('.q-field, .q-input, .q-select')` at runtime, the cipherkeys forms hand-add
   `class="flex q-field"` to 5 labels, and `ODialog.spec.ts` / `ODrawer.spec.ts` encode the contract.
   **Deliberately left intact.** §7.5's `grep '\.q-[a-z]' → 0` DoD is therefore NOT met and should be
   amended: the target is zero `.q-*` in **CSS** (achieved), not in JS.
2. **Dead Quasar *JS* is a whole unscoped category** the plan never mentions. All now-inert:
   `useAlertForm.ts:1124,1418` (`.q-field--error`), `utils/alerts/focusManager.ts:154`
   (`.q-field__native`), `JsonPreview.vue:622` (`closest('.q-btn')` — always null now),
   `AlertList.vue:921-930` (`.q-drawer__content`, `q-drawer__backdrop`, `q-layout__shadow` — its
   click-outside guard is likely misbehaving today). **Needs its own phase (suggest PQ2).**
3. **A second guard hole existed and is now closed.** `check-css-tokens.mjs` only regexed literal
   `var(--x)`, so Tailwind v4's shorthand `bg-(--x)` / `text-(--x)` — which compiles to a
   **no-fallback** `var(--x)` — bypassed the checker entirely. Closing it revealed **17** phantom
   tokens, not the ~25 the plan guessed at (of which only ~10 were visible in the literal `var()` form).
4. **Three phantom tokens were NOT Quasar at all** and are unrelated to PQ — they were hiding behind
   the same shorthand hole: `--text-md` (`UsageReportBanner.vue:7`), `--color-border` and
   `--color-card-bg-solid` (`ScorerFormPage.vue` ×3). All near-miss typos for real tokens
   (`--text-base`, `--color-border-default`, `--color-card-bg`); fixed.
5. **`.card-container` has 178 consumers across 102 files**, not the ~5 implied by §1.1/§5.2.
   "Inline utilities at call sites" (§5.2 F5) is not viable at that scale — it needs a component.
   Re-scope F5 before starting W1.b.
6. **The `tailwind.css` hex swap was a real dark-mode bug fix, not a no-op.** Verified live:
   the default border on a bare 1px element was `#e5e7eb` (light grey) in **dark** mode; it is now
   `#454545`. Light mode moves `#e5e7eb` → `#e5e5e5` (imperceptible).
7. **`--color-theme-accent` is runtime-driven by `theme.ts`** (observed `rgba(107,118,227,1)`, not the
   static `#3F7994` in semantic.css). The `--q-primary` rename is still provably value-identical because
   `--q-primary` was *defined as* `var(--color-theme-accent)` in both themes.
8. **§1.1 counts drifted** from the live tree: `styleBlockHex` baseline is 480 (plan says 632);
   `tailwind.css`'s raw hex was at L149, not L85–90.

### 10.3 Pre-existing, NOT caused by this work

`npm run lint:design` **already fails on `fix/token`** with 3 regressions above baseline —
`TableRenderer.vue [bareRounded]`, `AddFunction.vue [arbPx]`, `General.vue [bareRounded]`.
Confirmed present before any change here. The baseline was deliberately **not** re-written, since
re-baselining would silently freeze that debt in as accepted.

### 10.4 Verification performed

`lint:tokens` (green with the allowlist removed AND the shorthand hole closed — strictly stronger than
before) · `lint:token-purity` (249, at baseline) · `type-check` (clean) · `stylelint` (0 errors,
unchanged 174 warnings) · `eslint` on all 67 changed files (0 errors; 31 pre-existing
`enforce-style-attribute` warnings) · unit tests for every touched area (ODialog, ODrawer,
SearchFieldList, AlertList, SyntaxGuideMetrics, JsonPreview, QueryEditorDialog, TraceDetailsSidebar,
AddAlert, ServiceGraph, EvalTemplateEditor, PlayerEventsSidebar, RenderDashboardCharts) — all pass ·
SFC tag-balance check across all 67 changed `.vue` files · live token resolution probed in the running
dev server in **both** themes.

> Regression caught during verification: the dead-rule sweep removed EvalTemplateEditor.vue's closing
> `</script>` along with its style block (SFC failed to parse). Fixed, and an SFC tag-balance check over
> every changed file is now part of the routine — **worth repeating for every W2 batch**, since removing
> whole `<style>` blocks is exactly the W2.a expected outcome.

### 10.5 Next up

**PQ2 (new, small):** retire the dead Quasar JS in §10.2.2, and decide the `.q-field` contract —
either rename it off the `q-` namespace (ODialog + ODrawer + 5 cipherkeys labels + both specs together)
or document it as an intentional keeper.
Then **W1.a** (quick wins: F15/F12/F1/F18/F16 + single-consumer F2/F9/F11) and the first **W2.a** batch,
which are independent and can run in parallel.

Open design calls: §9 #2 (D6 light code-bg `#ffffff` vs `#f6f8fa`) is still open — blocks only the
O2AIChat/OCodeBlock/TraceErrorTab syntax-theme PRs. §9 #1 (EmptyState → wrapper component) and #3
(F10 → colocate) confirmed as the plan's own recommended defaults. §9 #4 resolved: promo amber.

---

## 11. Execution log — PQ2 + W1.a (2026-07-16)

### 11.1 PQ2 — dead Quasar JS retired (complete)

| Site | Was | Now |
|---|---|---|
| `AlertList.vue` click-outside + ESC | Queried `.q-drawer__backdrop` / `.alert-details-drawer .q-drawer__content` — **matched nothing, so click-outside-to-close was entirely dead** | Both hand-rolled handlers **deleted**. ODrawer already wires `@escape-key-down` + `@interact-outside` (reka-ui DismissableLayer), and its version is *better* — it ignores clicks inside portaled dropdowns |
| `JsonPreview.vue:622` | `closest(".q-btn")` → always null → `!null` → **context menu closed on EVERY click, including its own items** | `closest(".context-menu")` — items close it via their own handlers |
| `useAlertForm.ts` ×2 | `.q-field--error` → null → **focus-on-first-error and scroll-to-error both silently did nothing** | `[aria-invalid="true"]` |
| `focusManager.ts:154` | `.q-field__native` in a fallback selector list | removed (no-op — `input`/`select`/`textarea` entries already cover it) |
| 5 cipherkeys `q-field` labels | `<label class="flex q-field">` | class removed — they are plain `<label><b>text</b></label>` with no focusable content and no `resetValidation` on their parent, i.e. provably inert |

Supporting lib change: **`OInput` and `OSelect` now emit `:aria-invalid="hasError || undefined"`**, matching the
convention 6 other lib form components (OFile/OColor/ODate/OSlider/OTime/ORange) already followed. This is both an
a11y fix and what gives `useAlertForm` a real, queryable error marker — the role Quasar's `.q-field--error` used to play.

**Zero `q-*` classes remain in any template.**

> **Still open (deliberately NOT fixed here — a behavioural change, not a styling one):**
> `ODialog`/`ODrawer.clearBodyValidation()` queries `.q-field` and calls
> `__vueParentComponent.ctx.resetValidation` — an API only Quasar's QField exposed. **Nothing in the app
> carries `.q-field` any more and only `OForm` exposes `resetValidation`, so "reset validation on
> cancel-close" is dead.** Its specs pass because they hand-build `<div class="q-field">` fixtures with fake
> `__vueParentComponent` — false confidence. The real fix is to target OForm's `<form>` root, but that
> changes *when* dialog validation resets app-wide and needs its own PR + spec rewrite.

### 11.2 W1.a — component.css quick wins (complete)

**Token purity: 249 → 220 constructs (−29).** Baseline re-committed at each step.
All `@media` and all but one `@keyframes` are now out of the token layer.

| Family | Done | Notes |
|---|---|---|
| F15 | partial — **plan corrected** | `.cursor-pointer` / `.select-none` / `.text-left` deleted (verified byte-identical to Tailwind's own; live-checked that the utilities still deliver the same computed values). `.full-width` deleted (0 consumers). **`.full-height` NOT deleted** — see §11.3.1 |
| F12 | ✅ — **plan corrected** | Only **7** selectors were genuinely identical. Deleted the *earlier* copy of each (cascade-safe: the later already wins; deleting the later could hand a win to an intervening rule). See §11.3.2 |
| F1 | ✅ | `glow-pulse` deleted (0 consumers). `pulse` deleted — see §11.3.3, it was an app-wide bug. `histogram-bar-shimmer` stays: it is referenced only by an F10 logs rule, so it travels with F10 in W1.d |
| F18 | ✅ | `@media print` → `base-elements.css`, verbatim. Safe in `@layer base`: the rules are `!important`, so they outrank normal utility declarations regardless of layer |
| F16 | ✅ | Scrollbars → `base-elements.css` `@layer base`. Safe: no Tailwind utility targets scrollbars. Raw `--color-grey-*` refs became semantic `--color-scrollbar-thumb` / `-hover` (light + dark), values unchanged and verified live in both themes |
| F2 | ✅ | `.field-type-container` / `.field-expand-icon` → template utilities in `SearchFieldList.vue`. Also deleted that file's own scoped copies, which duplicated the template utilities. See §11.3.4 — the ordering here was a trap |
| F9 | ✅ verbatim | RCA report → `IncidentRCAAnalysis.vue`, `<style scoped>` + `:deep()`. **Plan corrected:** the single consumer is *IncidentRCAAnalysis.vue* (which v-html's it), not IncidentDetailDrawer.vue (which only builds the string) |
| F11 | ✅ verbatim | Pin tooltip → `SearchResult.vue`, `<style scoped>` |

**F9/F11 were moved VERBATIM on purpose.** W1's goal is token-layer purity; both are now out of the token
layer with **zero visual risk**. Their hex→token and px→rem passes are deferred to W2.c, where the plan (§7.4)
requires eyeballing the logs pin tooltip and the incident RCA report in both themes — verification that needs a
logged-in app. Both carry keep-comments recording the intended token mapping
(`--color-status-info-*` / `--color-status-error-*`, already theme-aware, which will collapse their dark twins).

### 11.3 Findings that CORRECT this plan (continued from §10.2)

1. **F15 mis-classifies `.full-height`.** It is not a Tailwind duplicate — it is a real 6-declaration rule
   (`height/max-height/padding/margin/box-sizing/overflow`, all `!important`) with **22 usages across 10 files**.
   Deleting it per §1.2 would have broken all of them. Reclassified: it needs the ladder (→ utilities at call
   sites), and the plan's own R2 says every `!important` rule is review-tier, never auto-tier.
2. **F12 mis-classifies `.expanded-content`.** §1.2 names it as a dead duplicate, but its two copies are
   **DIFFERENT** — it is a live override, not dead weight. Of 18 duplicated selectors only 7 are byte-identical
   (`copy-btn-sql`, `copy-btn-function`, `expanded-sql`, `expanded-function`, `scrollable-content`,
   `field-value-key`, `field-value-count`). The rest (`.expanded-content`, `.warning-text` ×3, `.search-list`,
   `.searchdetaildialog`, `.indexDetailsContainer`, `.field-value-container`, `.report-list-tabs`, `.dark`)
   all differ and must be resolved by hand in W1.d, not swept.
3. **`@keyframes pulse` was an app-wide bug, not just "F1 keyframes to move".** FOUR competing global `pulse`
   definitions existed: Tailwind's own (`50%{opacity:.5}`), component.css's (`0.7`), and — from **unscoped**
   `<style>` blocks — `LoadingProgress.vue`'s (`0.2/0.4`) and `QueryEditorDialog.vue`'s (`0.3`). Worse,
   **`LoadingProgress.vue` also redefined the `.animate-pulse` *utility class* globally.** Because SFC styles
   are unlayered they outrank Tailwind's layered utilities, so every `animate-pulse` in the app (MenuLink,
   OSkeleton, OTable, sparklines, ErrorTrendCell) was being driven by LoadingProgress's timing/opacity —
   *if and only if that component happened to be loaded*, making the animation load-order dependent.
   Fixed: component.css's copy deleted; both SFC copies namespaced (`loading-progress-pulse`,
   `query-editor-dot-pulse`); the `.animate-pulse` override deleted. **Verified live: `@keyframes pulse` now
   resolves to Tailwind's canonical `50% { opacity: 0.5 }`.** This is a worked example of the R1 risk and a
   preview of what W2.a will keep finding in the other 198 unscoped blocks.
4. **F2 hid a cascade trap worth remembering for W2.a.** `SearchFieldList` had the class in *three* places:
   component.css (unlayered, global), its own scoped rules, and template utilities. Because unlayered CSS beats
   layered, component.css's `width:1rem` was beating the `w-[0.55rem]` **utility** — the scoped rule (higher
   specificity) was the only reason the icon rendered at 0.55rem. Deleting rules in the naive order would have
   silently resized it. The `position:relative`/`position:absolute` pair that makes the 1rem chevron overflow
   its 0.55rem container lived **only** in the global rule and had to be moved onto the template explicitly.
   *Lesson: when a class exists in both a style block and the token layer, resolve the computed value first.*
5. **F9's stated consumer is wrong** — see §11.2. Also: `scoped` alone would NOT have worked, because the
   wrapper *and* all children come from `v-html` and never receive the scope id; `:deep()` anchored on the
   template-owned `.rca-content` is required. This is the R3/R4 pair, live.

### 11.4 Pre-existing test failures (NOT caused by this work — verified by stashing / checking out HEAD~1)

- `IncidentTimeline.spec.ts` — **9 failures**, identical before and after my changes. Specs assert hex
  (`'#059669'`) against a component that already returns `var(--color-success-600)`.
- `alerts/steps/Advanced.spec.ts`, `CompareWithPast.spec.ts`, `Deduplication.spec.ts` — assert `light-mode` /
  `dark-mode` root classes that the components no longer render. **Confirmed failing at `HEAD~1`, i.e. before
  the Quasar commit** — fallout from the branch's earlier dark-mechanism work (D19/D20 territory).

These 4 spec files are stale and should be fixed or `it.skip`-ed with a reason; they make `npm run test:unit`
red independently of this migration.

### 11.5 Verification performed

`lint:tokens` · `lint:token-purity` (220, re-baselined) · `type-check` clean · `stylelint` 0 errors
(174 warnings, unchanged) · `eslint` on all changed files: 0 errors · unit tests for every touched area
(AlertList, JsonPreview, AddAlert, ODialog, ODrawer, OInput, OSelect, AddAkeylessType, SearchResult,
SearchFieldList, LoadingProgress, QueryEditorDialog, IncidentRCAAnalysis, IncidentDetailDrawer) — all pass ·
brace-balance + SFC tag-balance checks on every edited file · **live probes in the running dev server**
confirming: the F15 deletions still resolve via Tailwind's own utilities; F16 scrollbar rules still apply
after the `@layer base` move and their tokens match the old palette values in both themes; and
`@keyframes pulse` now resolves to Tailwind's canonical definition.

### 11.6 Next up

**W1.b** (F4 element typography + F7 form rules + F5 app-shell + F3 `.o2-table*` → base-elements/lib) —
note §10.2.5: `.card-container` (F5) has **178 consumers across 102 files**, so §5.2's "inline utilities at
call sites" must be re-scoped to a component first. Then **W1.c**, **W1.d** (F8/F14/F10 — carries
`histogram-bar-shimmer` and the 11 DIFFERENT duplicates from §11.3.2), **W1.e** (delete
`token-purity-baseline.json` → checker becomes zero-tolerance), and the **W2.a** batches (independent — can
run in parallel from now).

Remaining open design call: **D6 light code-bg** (`#ffffff` vs `#f6f8fa`) — blocks only the
O2AIChat/OCodeBlock/TraceErrorTab syntax-theme PRs.
