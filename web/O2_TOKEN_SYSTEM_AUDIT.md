# O2 Token System — Logical Audit

> **Date:** 2026-07-17 · **Branch:** `fix/token` · **Scope:** `web/src`
> **Question asked:** *"We built one token system. Is it actually used correctly? If we change the heading colour / radius / body colour in one place, does it change everywhere?"*
>
> This report answers that empirically. Every number below was measured against the live
> working tree, not carried over from the earlier planning docs (several of which are stale —
> see §9).

---

## 1. Verdict in one paragraph

**The plumbing is genuinely good; the wiring is not.** You have a well-formed 4-layer token
system, a correct global element layer, a real `@theme inline` registration story, zero legacy
`--o2-*` tokens, and Quasar fully removed. The migration is *much* further along than your own
docs claim. But the "single knob" goal fails today for **3 of the 4 things you named**, and it
fails for a reason that is invisible in code review: **not leaks, but aliasing and layer-skipping**.
Two token names mean the same thing, and the wrong one won adoption 3:1. Separately, **61% of the
component layer reaches past the semantic layer straight into the raw palette**. And the CI ratchet
that is supposed to protect all of this **never runs on a pull request**.

| Your scenario | Works? | Est. coverage | Root cause |
|---|---|---|---|
| Change **heading** colour everywhere | ⚠️ Partially | **~40%** | `--color-text-heading` / `--color-text-primary` are aliases; the alias won 3:1 |
| Change **radius** everywhere | ✅ **Yes** | **~88%** | Correctly registered. Only 3 unregistered scale steps + hardcoded values leak |
| Change **body / paragraph** colour everywhere | ⚠️ Partially | **~25%** | `--color-typography-body` is wired to the *heading* token |
| Change **primary brand** colour everywhere | ❌ **No** | **~0%** under a custom theme | JS writes the palette as inline styles on `<html>`, overriding all CSS |

---

## 2. Token inventory — how many tokens exist

Measured across `src/lib/styles/tokens/{base,semantic,component,dark}.css` (3,619 lines).

| Layer | File | Unique tokens | Role |
|---|---|---:|---|
| Base | `base.css` | **238** | Raw palette + type/space scales. No `@theme` block (pure `:root`). |
| Semantic | `semantic.css` | **260** | Intent (`text-heading`, `surface-base`, `border-default`) |
| Component | `component.css` | **643** | Component-specific (`button-*`, `badge-*`, `table-*`) |
| **Light total (unique)** | | **973** | |
| Dark | `dark.css` | **465 overrides** | `.dark` overrides only — correctly overrides **0** base palette tokens |
| **Grand total defined** | | **~987** | (`lint:tokens` reports 1,047 incl. component-local vars) |

**Registration:** 708 tokens are registered in one of four `@theme inline` blocks
(`semantic.css:63`, `component.css:759`, `component.css:1386`, `component.css:1575`).
**0 tokens are registered without a definition** — no dangling registrations. Clean.

---

## 3. What is genuinely done (do not re-litigate these)

Verified green. This is real, finished work:

- ✅ **Legacy `--o2-*` vocabulary: fully eliminated.** 0 references anywhere in `src`.
- ✅ **Quasar: entirely removed.** Not in `package.json`, 0 imports, no CSS loaded. The whole
  `--q-*` phantom-token class of bugs is structurally gone.
- ✅ **`npm run lint:tokens` passes** — 1,047 tokens defined, 951 distinct refs, **0 undefined**.
- ✅ **`npm run lint:token-purity` passes** — token files contain tokens only.
- ✅ **The global element layer is exemplary.** `src/styles/base-elements.css` does exactly the
  right thing: `h1–h6 → var(--color-text-heading)` (`:133`), `body → var(--color-text-body)`
  (`:118`), `p → var(--color-text-body)` (`:181`). The foundation for your goal already exists.
- ✅ **Dark mode converged on a single mechanism.** `.dark` on `<html>`; `.body--dark` /
  `.light-mode` compat classes removed; `darkMechanism` debt fell 390 → **32**.
- ✅ **Radius works** (see §5.B) — the failure mode you feared is not present.

---

## 4. The single biggest issue: the ratchet does not run

**This is the highest-priority finding in this report, and it is a five-line fix.**

You have four guard scripts. Here is where they actually run:

| Guard | What it catches | `playwright.yml` (runs on **every PR** + merge queue) | `build-pr-image.yml` |
|---|---|---|---|
| `lint:tokens` | undefined var refs, `--o2-*` | ✅ runs | ✅ runs |
| `lint:styles` | stylelint | ✅ runs — **but see below** | ✅ runs |
| `lint:ci` | ESLint | ✅ runs | ✅ runs |
| **`lint:design`** | **the entire 1,263-violation debt ratchet** | ❌ **NOT RUN** | ✅ runs |
| `lint:token-purity` | token-file purity | ❌ not run | ❌ not run |

`build-pr-image.yml` is **`workflow_dispatch:` only** — a manual trigger. Therefore:

> **`check-design-consistency.mjs` — the mechanism that freezes design debt so it "can only
> shrink" — never executes on a pull request.** The baseline is frozen in theory only. Any PR can
> add unlimited hardcoded hex, raw palette classes, arbitrary px, or new dark-mode mechanisms and
> nothing will object.

**Compounding it:** `lint:styles` *does* run on every PR, but its hex ban is `severity: "warning"`
and the script has no `--max-warnings`. Verified: `npm run lint:styles` reports **14 warnings and
exits 0**. It does not gate either.

**Net effect:** the only design rules hard-enforced on a PR today are *"no `--o2-*` tokens"* and
*"no undefined var refs"*. Everything this audit measures is unenforced.

**Fix (do this first — it costs nothing and protects everything else):**
1. Add `lint:design` and `lint:token-purity` to `playwright.yml` next to the existing lint steps.
2. Change stylelint `color-no-hex` to `severity: "error"`, or add `--max-warnings 0`.

---

## 5. The four scenarios, tested

### A. "Change the heading colour everywhere" → **~40%**

The global rule is correct (`base-elements.css:133`). The problem is that it lives in
`@layer base`, so **any utility class beats it** — and the app's own canonical components opt out.

**Root cause — a self-admitted alias:**
```css
/* semantic.css:15-16 */
--color-text-heading: var(--color-grey-900);  /* h1-h6, modal titles */
--color-text-primary: var(--color-grey-900);  /* alias for heading — backward compat */
```
```css
/* dark.css:77-78 */
--color-text-heading: var(--d-text);
--color-text-primary: var(--d-text);   /* alias for heading */
```

They are **identical in both light and dark**. That is precisely why this has never been caught:
*the bug is invisible until the day someone tries to change one of them.*

**The alias won adoption ~3:1** (verified counts):

| Dialect | Real token | Alias |
|---|---:|---:|
| Utility class | `text-text-heading` = **100** | `text-text-primary` = **298** |
| Raw `var()` | `var(--color-text-heading)` = **29** | `var(--color-text-primary)` = **54** |

**The three leaks that matter:**

1. **`AppPageHeader.vue:105` uses `text-text-primary`, not `text-text-heading`** — and it is
   imported by **87 files**. It is *the* page title of every module in the app. Changing
   `--color-text-heading` does not touch a single page title.
2. **Every `--color-typography-*` token routes to the alias** (`component.css:727-733`) —
   including `--color-typography-page-title` and `--color-typography-panel-title`. `OText`, the
   design system's own typography component, ignores the heading token entirely.
3. **`ODialog.vue:454` renders its title as a plain `<span>`** specifically to escape `<h2>`
   browser styles — a documented, deliberate opt-out from the element layer.

**Fix:** pick one name, codemod the other, add a lint rule banning the loser. Because the two are
currently identical in *both* modes, **this migration is visually risk-free** — you can ship it
today and see nothing change. That is exactly the point.

---

### B. "Change the radius everywhere" → **~88% — this one works** ✅

Two corrections to the premise:

- There are **5 radius tokens** (`base.css:790-794`: sm/md/lg/xl/full), not ~10. `--d-radius*`
  does not exist anywhere.
- **They ARE registered** in `@theme inline` (`semantic.css:143-148`). So `rounded-md` compiles to
  `border-radius: var(--radius-md)` and resolves against the project token. **Changing the token
  does change `rounded-md`.** The feared "Tailwind uses its own defaults" failure is not present.

~1,428 tokenized `rounded-*` uses vs ~190 leaks. Remaining leaks:

- **166 hardcoded `border-radius:` declarations**, none using a token. Worst:
  `enterprise/components/onlineEvals/forms/ScorerDetail.vue:839-1028` uses off-scale
  `0.1875rem` / `0.3125rem` that match no token.
- **~23 arbitrary utilities** — `rounded-[0.325rem]` ×4, `rounded-[10px]`, `rounded-[16px]`…
- **3 unregistered scale steps** — `rounded-2xl`, `rounded-3xl`, `rounded-xs` are used but have no
  project token, so they silently fall back to Tailwind's built-ins. This is the failure mode you
  predicted, confined to 3 steps rather than the whole scale. **Register these three.**

> Note: the project's radius values are byte-identical to Tailwind v4's defaults, so the
> registration is a no-op *today*. It becomes load-bearing the moment you change a value — which
> is exactly when you need it. Correct as-is.

---

### C. "Change the body / paragraph colour everywhere" → **~25%**

`--color-text-body` exists (`semantic.css:17`), is registered (`:67`), has a dark override
(`dark.css:80`), and **is correctly applied to both `body` and `p`** globally. That part is right.

But it is inherited colour in `@layer base`, so any utility on any descendant wins — and almost
everything carries one.

**The killer:**
```css
/* component.css:730 */
--color-typography-body: var(--color-text-primary);   /* ← wired to HEADING, not body */
```
The design system's *body text* variant points at the heading token. `--color-text-body` is
architecturally orphaned from the component that should be its main consumer.

**Adoption:** `text-text-body` = **116** vs `text-text-secondary` = **729** and
`text-text-primary` = **298**. Paragraph-ish text in this app overwhelmingly uses `secondary`.
`--color-text-body` governs ~11% of the text utilities in its own semantic neighbourhood.

**Fix:** repoint `--color-typography-*` (7 lines) so `body → --color-text-body` and the title
variants → `--color-text-heading`.

---

### D. "Change the primary brand colour everywhere" → **~0% under a custom theme** ❌

**This is not a CSS problem. JavaScript overwrites your tokens at runtime.**

```ts
// src/utils/theme.ts:163-169
const syncO2LibraryTokens = (themeColor: string): void => {
  const palette = generatePrimaryPalette(themeColor);
  const root = document.documentElement;
  for (const [shade, hex] of Object.entries(palette)) {
    root.style.setProperty(`--color-primary-${shade}`, hex);   // ← inline style on <html>
  }
};
```

Inline styles beat every stylesheet — the code itself concedes this (`theme.ts:188`:
*"inline styles beat stylesheets"*). `bootstrapTheme()` runs pre-mount.

> **If a user has selected any non-default theme, editing `--color-primary-600` in `base.css:555`
> does literally nothing.** The token file is only the default-theme fallback. The 36 hardcoded
> hexes in `src/constants/themes.ts` are the *actual* source of truth for brand colour.

**Aggravating:** `--color-accent` (`semantic.css:59` → `primary-600`) is the correct semantic
brand token, but raw palette use dwarfs it — `var(--color-primary-500)` = 102,
`var(--color-primary-600)` = 95, `var(--color-primary-400)` = 71.

**🐛 REAL SHIPPING BUG — `primary-950` desync.** Verified:
- `generatePrimaryPalette` (`theme.ts:144-156`) generates shades **50–900 only. It never emits 950.**
- The reset path (`theme.ts:191`) clears **50–950**.
- `base.css:559` defines `--color-primary-950: #0d181e` (O2 teal-dark).
- `dark.css:207` and `dark.css:399` **consume** it for `--color-toggle-item-hover-bg` and
  `--color-file-drag-bg`.

→ **Under any custom theme in dark mode, those two surfaces keep the stock O2 teal `#0d181e`
while everything around them takes the new brand hue.** Pick the red theme; toggle-hover stays
blue. One-line fix: add `'950': mixColors(baseHex, '#000000', 20)`.

**This one needs a decision, not a patch.** The runtime theme engine and the token files are two
competing sources of truth for brand colour, and JS wins unconditionally. Either generate the
tokens *from* `themes.ts` at build time, or have the theme engine write a single
`--color-brand-base` that the palette derives from in CSS via `color-mix()`. **The "one token"
goal is unreachable for brand colour while both systems exist.**

---

## 6. The structural defect: the component layer is a second base layer

`base.css:499-501` states, in its own header:

> *"These are NEVER referenced directly in components. Components use semantic or component
> tokens only."*

**Violated 301 times in the sibling file.** Verified by brace-matched parse of `component.css`'s
`:root` block:

| What the component token points at | Count | % |
|---|---:|---:|
| **Base palette directly (violation)** | **301** | **61.1%** |
| Semantic token (correct) | 184 | 37.3% |
| Hardcoded literal (violation) | 7 | 1.4% |

Worst offenders: `--color-button-*` (26), `--color-badge-*` (52), `--color-select-*` (6),
`--color-slider-*` (6), `--color-tabs-*` (5), `--color-input-*` (5).

**Concrete proof of the §5.A failure mode** — 9 component *text* tokens re-derive from grey
directly and will not follow a change to the semantic text scale:
```
component.css:21   --color-input-label-text:          var(--color-grey-800)
component.css:22   --color-input-label-text-disabled:  var(--color-grey-400)
component.css:104  --color-button-warning-foreground:  var(--color-grey-900)
component.css:258  --color-badge-default-solid-text:   var(--color-grey-700)
component.css:679  --color-banner-default-text:        var(--color-grey-800)
…
```
`:22`, `:104` land on the *exact values* `--color-text-disabled` and `--color-text-heading`
already carry. These are semantic decisions re-made by hand at the component layer.

> **⚠️ Important nuance — this is partly forced, so do not "just rewire it".** The shades
> components reach for (`primary-50/100/300/400/800`) **have no semantic equivalent to route
> through**. There is no `--color-surface-accent-subtle`, no `--color-border-accent`, no
> `--color-focus-ring`, no hover/active surface vocabulary. The semantic layer is missing the
> **interaction-state vocabulary** components actually need.
>
> **Fixing this means growing `semantic.css` first, then rewiring `component.css` — not rewiring alone.**

Also: `component.css:35` carries a defensive fallback that should not exist in a token system:
`--color-button-secondary-border: var(--color-border-subtle, #e5e7eb);`

---

## 7. "Only Tailwind utilities in components, no raw CSS tokens"

This is your stated bar. Measured against it:

**2,371 raw `var(--…)` occurrences across 241 `.vue` files.** Of the 2,104 that are `--color-*`
(independently verified):

| | Occurrences | Meaning |
|---|---:|---|
| **Token already has a utility** | **1,757 (84%)** | **Pure migration debt** — swap for the named utility |
| No utility (unregistered) | 347 (16%) | **Blocked** — needs registration first |

Where the raw usage lives:

| Region | Count | % | Assessment |
|---|---:|---:|---|
| `class="...[var(--x)]"` arbitrary values | 653 | 27.5% | Mostly `color-mix()` — see below |
| `<style>` blocks | 733 | 30.9% | 489 plain rules / 243 `:deep()` |
| SVG `fill=` / `stroke=` attrs | 590 | 24.9% | Presentation attrs — *not* a rule violation; low priority |
| `<script>` JS strings | 208 | 8.8% | Only ~10 are chart-shaped |
| inline `style=""` | 91 | 3.8% | **Clearest wins** |
| `:style` bound | 75 | 3.2% | Often a static value hiding in a dynamic object |

**Three competing dialects express the same decision** — this is its own consistency problem:

| Dialect | Count | Verdict |
|---|---:|---|
| `text-text-secondary` (named utility) | ~1,500+ | ✅ the goal |
| `text-(--color-text-secondary)` (v4 arbitrary property) | 198 | ⚠️ works, but bypasses the name |
| `text-[var(--color-text-secondary)]` (arbitrary value) | 179 | ⚠️ same |
| `style="color: var(--color-text-secondary)"` | 91 | ❌ raw |

**Genuinely legitimate raw usage — do not migrate these:**
- **`color-mix()` — ~480 occurrences.** No Tailwind utility expresses
  `color-mix(in srgb, TOKEN X%, TOKEN)`. **Recommendation: mint `-soft`/`-faint` tokens** for the
  repeated formulas (O2AIChat repeats one mix 6+ times) — this converts the single largest
  "legitimately raw" bucket into ordinary utilities.
- **`calc()` with `--navbar-height`** (×22) — `h-[calc(100vh-var(--navbar-height))]` needs raw var.
- **Gradients** — no `bg-*` utility exists for gradient tokens.
- **`utils/chartTheme.ts:54`** — `chartColor()` via `getComputedStyle`. This is the *sanctioned*
  JS seam and is correctly built. Canvas cannot read CSS vars; this is right.
- **Component-local CSS vars** (`--tree-parent-x`, `--col-${id}-size` runtime interpolation).

**`<style scoped>`: 141 files / 1,237 rules.** Breakdown: ~65-70% plain own-selector styling that
**should be utilities**; ~28% `:deep()` into internals (legitimate). So scoped CSS is *not* mostly
unavoidable escape-hatching — it is majority ordinary styling.

> ⚠️ **The guard has a blind spot matching this section.** None of `check-design-consistency.mjs`'s
> 17 categories catch raw `var(--color-*)` in a component, and it counts only `unscopedStyle` —
> **scoped blocks are entirely unmeasured.** The thing you care most about is the thing nothing
> measures. Add a `rawVarInComponent` category.

---

## 8. Token hygiene — orphans, aliases, duplicates

### 8.1 Orphans — ~42 genuinely dead tokens

86 raw orphans, but **44 are false positives**: `--color-span-1..50` are constructed at runtime
(`traceColors.ts:97` builds `` `var(--color-span-${i})` ``).

> **⚠️ Any orphan-detection tooling you build MUST parse Tailwind v4's `bg-(--token)` and
> `bg-(image:--token)` syntax, or it will delete live tokens.** `--color-warning-surface` and
> `--color-gradient-danger` look dead to a naive grep but are live via
> `OTableBodyRow.vue:355` and `O2AIChat.vue:1374`.

**The `note` subsystem — 16 tokens, a fully dead vertical slice.** Verified: **0 references**
outside the token files. `component.css:716-721` (6 tokens) are unused *and* are the sole
consumers of `base.css:628-636` (9 tokens) beneath them. Delete the whole chain.
(`--color-note-emphasis` is *also* a layer violation — a dead token that is wired wrong.)

**24 unused palette ramp ends** — consistent pattern: each hue defines 10 shades, the badge system
consumes only `50/500/600/700`, and the `100/200/800/900` ends are dead
(`teal/orange/lime/amber/cyan-100/-200/-800/-900`, …). **8 unused type/scale tokens**
(`--text-3xl`, `--text-4xl`, `--leading-xs`, `--tracking-tighter`, `--font-black`, …).

These violate your own **D18** ("only create what's used"). ~42 deletions.

### 8.2 The alias problem is broader than heading/primary

24 duplicate-value groups in the semantic layer. The dangerous ones:

| Value | Competing names | Risk |
|---|---|---|
| `#a3a3a3` | `--color-text-label`, `--color-text-disabled`, `--color-text-placeholder`, `--color-border-strong`, `--color-scrollbar-thumb-hover` | **5-way collapse.** "label", "disabled", "placeholder" are three *genuinely different intents* that are accidentally identical — changing disabled-text silently repaints every form label |
| `#171717` | `--color-text-heading`, `--color-text-primary` | §5.A |
| `#737373` | `--color-text-secondary`, `--color-text-caption` | Pure duplicate, no distinguishing intent |
| `#3F7994` | `--color-text-link`, `--color-accent`, `--color-theme-accent` (hardcoded), `--color-theme-menu-color` (hardcoded) | **Two parallel brand systems** — `--color-accent` derives from the palette; `--color-theme-accent` is a literal overwritten at runtime by `theme.ts`. Changing brand in `base.css` moves one and not the other. |
| `#e5e5e5` | `--color-surface-subtle-hover`, `--color-border-default` | Surface/border collision |

The `ip`/`ipv4`/`ipv6` and `ts`/`date`/`time` label-chip triplets are three names each for one
decision — 6 tokens that should be 2. `--color-info-*` is a redundant clone of `--color-blue-*`
(5 identical pairs).

> **Aliases are the core disease here.** An alias is a decision made twice. It cannot be seen in
> review, it never renders wrong, and it silently splits adoption — which is exactly how "change
> the heading colour" ended up at 40%.

### 8.3 Registration gaps — 280 defined but unregistered

| File | Unregistered | Verdict |
|---|---:|---|
| `base.css` | 193 | Palette: **correct by design** (Phase G wants semantic-only utilities). **But it silently strands the non-colour scales too** ↓ |
| `semantic.css` | 72 | **The real gap** |
| `component.css` | 15 | Mostly fine |

**The base.css collateral damage:** `--font-sans`/`--font-mono`, `--text-3xs…4xl` (11),
`--leading-*` (9), `--tracking-*` (4), `--font-normal…black` (5), `--spacing-*` (7) are
unregistered → **no utility is generated from these tokens**. This is *why*
`styles/tailwind.css:33-56` needs a hand-written `@layer utilities` block re-pinning `.text-sm` /
`.text-base` by hand. Its own comment concedes the tokens are *"redundant-but-explicit"* against
Tailwind's defaults — i.e. **the app runs on Tailwind's built-in type scale, not on your
`--text-*` tokens.** They are two parallel truths that happen to agree numerically today. This
directly undermines **D16** (font standardization is a MUST).

**The semantic.css gaps that force raw `var()`** (these directly cause §7):
`--color-brand-*` (22 — blocks `DestinationPreview.vue`, 95 raw), `--color-syntax-*` (14 — blocks
`TraceErrorTab.vue`), `--color-dag-node-*` (13 — blocks `TraceDAG.vue`, 71 raw),
`--color-gradient-*` (7), `--color-theme-*` (7), `--color-scrollbar-thumb`, `--color-chat-bubble-*`,
`--navbar-height`, `--color-pivot-header-border`, and `--color-actions-column-shawdow`
(**typo shipped**).

**Registering ~91 already-defined tokens is a mechanical, zero-risk change that unblocks the
single largest cluster of raw-`var()` debt.** Do it first.

### 8.4 Dark-mode gaps — 45 tokens

`component.css` has **zero** dark gaps — that layer's coverage is complete. All 45 gaps are in
`semantic.css`'s "domain colour" annex (lines 230-401), which reads as a migration dumping ground
rather than a designed layer.

**High severity — visibly broken in dark mode:** the 22 `--color-brand-*` tokens contain
near-white backgrounds *and* near-black inks with no dark handling:
```
semantic.css:342  --color-brand-teams-bg:  #f3f2f1   ← near-white bg, stays white in dark
semantic.css:345  --color-brand-teams-ink: #323130   ← near-black text on it
semantic.css:359  --color-brand-slack-link: #1264a3  ← dark blue link on #0d1117
```
A white card in a dark app. **Systematic bug:** all three `--color-brand-*-hover` pairs *darken*
on hover — correct in light, backwards in dark.

`--color-gradient-ai-subtle` has a dark override while its siblings `-ai` and `-ai-faint` do not —
inconsistent coverage within one family of three, a strong signal these were handled ad-hoc.

---

## 9. ⚠️ Your planning docs are significantly stale

`O2_TOKEN_MIGRATION_PENDING.md` and `O2_TOKEN_MIGRATION_PLAN.md` snapshot **2026-07-15** and are
now wrong in a way that will mislead the team. Verified live vs. documented:

| Category | Doc (7/15) | **Live** | Δ |
|---|---:|---:|---:|
| styleBlockHex | 805 | **107** | −698 |
| stylePxUnit | 1,077 | **266** | −811 |
| unscopedStyle | 206 | **10** | −196 |
| darkMechanism | 390 | **32** | −358 |
| arbTextSize | 323 | **3** | −320 |
| hexClass | 269 | **14** | −255 |
| themeTernary | 186 | **9** | −177 |
| rawPalette | 102 | **53** | −49 |
| tsHex | 471 | **471** | 0 |

Per-file claims in `PENDING.md` §1–4 are equally stale: **O2AIChat 159 hex → 1**;
**DestinationPreview 89 → 0**; **TraceDAG 97 → 2**; **OCodeBlock 31 → 0**.
`ServiceGraphEdgeSidePanel.vue` (D7) and `TraceEvaluationsView.vue` (D4) are **deleted** — those
decisions were executed.

> **Phase E is effectively done, not "🔴 PENDING".** The doc's status table is the single most
> misleading artifact in the repo right now. **Regenerate the snapshot or delete these docs.**

**Also stale — a comment that will actively mislead:** `semantic.css:40-44` warns that *"the
parallel .css set is NOT imported by the app"* and refers to *"the .scss set the app loads"*.
**There is no `.scss` set** — it was removed, and `tailwind.css:4-6` imports these `.css` files
directly. The same false premise is repeated at `component.css:725-726`. Delete both comments.

**What is actually still pending:** **Phase G — not shipped.** There is no `@theme { --color-*:
initial }` block anywhere. Tailwind's default palette still compiles, so `text-gray-400` and
`bg-blue-50` remain legal. This is the lock that makes the token system structurally enforced
rather than CI-enforced.

---

## 10. Other real defects worth fixing

**🐛 `traceColors.ts` — the docstring contradicts the code.**
```ts
/** Provides helper functions to access the 50 span colors defined in tokens/base.css (--color-span-*) */
export const LIGHT_SPAN_COLORS = ["#10B981", "#06B6D4", …]   // 70 hardcoded hexes
```
The file claims to consume the tokens; it hardcodes a **divergent parallel list**. Verified:
50 tokens vs 70 array entries, **1/50 positional matches**. `--color-span-1` is `#3B82F6` but
`LIGHT_SPAN_COLORS[0]` is `#10B981`. The lower half of the file *does* correctly use
`var(--color-span-N)`. **Two sources of truth for one palette, inside one file, disagreeing.**

**`src/styles/utilities.css` is not a utilities file — it is a 40KB global-class escape hatch.**
Despite its comment (*"last resort, kept deliberately tiny"*): **163 selectors**, only 3 real
`@utility` rules, **54 hardcoded hex**, **29 rgba**, **167 `!important`**, **24 manual `.dark`
overrides**, 82 px values. These classes are widely consumed — `card-container` in **103 files**,
`o2-table` in **47**. Manual `.dark .foo` pairs here are a parallel dark-mode system that bypasses
tokens entirely, contradicting the §3 convergence win. `.el-border-radius` hardcodes `0.375rem`
instead of `var(--radius-md)` — a direct leak for scenario B.

**`utils/chartTheme.ts:36-47`** hand-maintains a JS mirror of CSS token values
(`"--color-text-primary": "#171717"`). Architecturally defensible as a canvas fallback, but it is
an **unsynchronized copy that will silently drift**. Codegen it from `base.css`.

**`ColorPaletteDropDown.vue:202-207` duplicates `utils/dashboard/colorPalette.ts:27-38` verbatim** —
same palette maintained in two places.

**No alpha/overlay tokens exist.** ~360 rgba literals in `.vue` are dominated by alpha overlays
(`rgba(255,255,255,0.05)` ×13, `rgba(0,0,0,0.042)` ×12). This is a **genuine token-system gap, not
developer laziness** — there is nowhere for these to go. Mint a `--color-overlay-*` scale.

**`lib/core/` violates its own rules** — `OButton.vue` has 23 arbitrary-px values;
`EmptyState/illustrations/*` carry ~200 raw SVG `var()` and 13 hex. The design system should be
the model.

---

## 11. Recommendations, ranked by payoff-to-effort

### Tier 0 — do now (hours, near-zero risk)
1. **Wire `lint:design` + `lint:token-purity` into `playwright.yml`.** Flip stylelint
   `color-no-hex` to `error`. *Without this, everything below can silently regress.* (§4)
2. **Fix the `primary-950` bug** — add `'950'` to `generatePrimaryPalette`. Real, shipping,
   visible. (§5.D)
3. **Regenerate or delete the stale docs**; delete the two false `.scss` comments. (§9)
4. **Register the ~91 defined-but-unregistered `--color-*` tokens** (brand-msg, dag-node, syntax,
   theme-*). Mechanical; unblocks the largest raw-`var()` cluster. (§8.3)
5. **Register `--radius-xs/-2xl/-3xl`** — closes scenario B's only real gap. (§5.B)

### Tier 1 — the alias kill (the actual answer to your question)
6. **Collapse `--color-text-primary` → `--color-text-heading`.** Codemod 298 utility + 54 raw
   sites, ban the loser in lint. **Visually risk-free today** — they are identical in both modes.
   This is the single highest-value change in this report. (§5.A)
7. **Repoint `--color-typography-*`** (7 lines) — fixes `OText`, and scenario C with it. (§5.C)
8. **Fix `AppPageHeader.vue:105`** → `text-text-heading`. One line, 87 files. (§5.A)
9. **Disambiguate the 5-way `#a3a3a3` collapse** — `label` / `disabled` / `placeholder` are
   different intents and must not share a value by accident. (§8.2)

### Tier 2 — structural (needs design input)
10. **Grow `semantic.css` an interaction-state vocabulary** (`--color-surface-accent-subtle`,
    `--color-border-accent`, `--color-focus-ring`, hover/active surfaces). **Prerequisite** for
    fixing the 61% layer violation. (§6)
11. **Then rewire `component.css`'s 301 base-palette refs** through the new semantic tokens.
12. **Decide the brand-colour architecture** — runtime theme engine vs. token files. The "one
    token" goal is unreachable for brand while both exist. (§5.D)
13. **Add dark overrides for the 45 semantic annex tokens**; fix the 3 backwards `*-hover` pairs. (§8.4)
14. **Mint `--color-overlay-*` + `-soft`/`-faint` mix tokens** — unblocks ~360 rgba and ~330
    `color-mix()` sites. (§7, §10)

### Tier 3 — hygiene & burn-down
15. **Delete the 16-token dead `note` chain + 24 dead ramp ends + 8 dead type tokens** (~42). (§8.1)
16. **Fix `traceColors.ts`** — delete the hardcoded arrays, derive from tokens. (§10)
17. **Dismantle `utilities.css`** — tokenize its 54 hex, delete the 24 manual `.dark` pairs,
    fix `.el-border-radius`. (§10)
18. **Add a `rawVarInComponent` guard category + count scoped blocks** — close the blind spot so
    §7 is measurable. (§7)
19. **Burn down the 1,757 has-a-utility raw `var()` sites**; start with the 91 inline `style=""`
    and ~350 plain-selector `<style>` rules. (§7)
20. **Ship Phase G** — `@theme { --color-*: initial }`. The final lock. (§9)

---

## 12. Honest caveats

- **~35% of hardcoded hex maps cleanly to an existing token.** The other 65% needs token *design*
  decisions (chart palettes, illustration colours, overlays). **This cannot be fully automated.**
- **`tsHex` = 471 is mostly allowlisted palette sources** and is not straightforwardly "debt". Of
  1,497 raw hex in `.ts`, **~58% are `.spec.ts` fixtures** — assertion literals, not violations.
  Production TS is ~622.
- **SVG `fill=`/`stroke=` (590 raw `var()`) are presentation attributes, not `style=""`** — they
  don't literally violate your rule. Treat as optional.
- **The "no px" rule needs splitting.** `ring-[3px]` / `border-l-[3px]` are sub-4px hairline
  decorations where rem conversion causes rounding artifacts and is arguably *worse*.
  `w-[771px]` / `h-[323px]` are the real violations — magic layout numbers. The current rule
  can't tell them apart.
- **Scenario coverage percentages are estimates** derived from utility/raw usage ratios, not from
  rendered-pixel diffs. Directionally reliable; not exact.

---

## 13. The one-line answer

> You built the token system correctly and then aliased it into ambiguity. The tokens are not the
> problem — **the second name for each token is.** Kill the aliases, register what's already
> defined, and turn the ratchet on in CI. The heading knob starts working the same day.
