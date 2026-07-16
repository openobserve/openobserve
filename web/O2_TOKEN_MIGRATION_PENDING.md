# O2 Token Migration — Pending / Needs Team Discussion

> Status snapshot **2026-07-15**. Companion to `O2_TOKEN_MIGRATION_PLAN.md`.
> Phases **0, A, B, F are done**; **C, D ~90% done**; **E and G are pending** and mostly
> blocked on the design decisions below. Everything below is the *intentional residue* the
> automated migration deliberately did **not** touch because it needs a human/design call —
> not missed work. All numbers are current live counts.

## How to read this
Each item lists: **the files**, **why it was left**, and **the decision the team needs to make**.
Nothing here is committed yet (working tree on `fix/token`). The CI ratchet
(`npm run lint:design`) has these frozen — they can't grow, only shrink once decided.

---

## 1. Style blocks needing a dedicated token set (Phase E) — DESIGN CALL

These components carry large, self-contained color systems in their `<style>` blocks that
have **no matching semantic token today**. They can't be mechanically tokenized — each needs
a small dedicated `--color-*` family designed for it (light + dark values).

| File | ~hex left | What it is | Decision needed |
|---|---|---|---|
| `components/O2AIChat.vue` | 159 | `hljs` code-syntax-highlight theme + fine chat-surface shades + `.light-mode`/`.dark-mode` pairs | Design a `--color-chat-*` + `--color-code-syntax-*` token set, or accept a documented exception |
| `plugins/traces/ServiceGraphEdgeSidePanel.vue` | 128 | Always-dark graph inspector panel | See §2 (always-dark decision) |
| `plugins/traces/ServiceGraphNodeSidePanel.vue` | 22 | Always-dark graph inspector panel | See §2 |
| `plugins/traces/TraceDetailsSidebar.vue` | 59 | Mixed surface/border greys + a few status colors | Mostly tokenizable — schedule a focused pass |
| `plugins/traces/components/TraceErrorTab.vue` | 28 | VS-Code-style stacktrace syntax palette (`.stack-*`) | Design a `--color-syntax-*` set (shared with O2AIChat code theme?) |
| `plugins/traces/ThreadView.vue` + `ThreadToolCalls.vue` | 64 | Bespoke LLM-chat aesthetic (per-role accent bubbles) + own `.--dark` mechanism | Design a `--color-thread-*` set + de-couple its dark mechanism |
| `components/ingestion/setupCard/SetupCardRenderer.vue` | 37 | Private `--clay / --panel / --text-1..3 / --ok / --warn` design system | Map its private vars → global tokens (mostly 1:1), or bless it as a scoped sub-system |
| `lib/core/Code/OCodeBlock.vue` | 31 | Code-block syntax theme | Same `--color-code-syntax-*` decision as O2AIChat/TraceErrorTab |
| `enterprise/components/onlineEvals/forms/*` (ScoreConfigDialog, EvalJobDetail, ScorerDetail) | ~40 | Eval form chrome | Tokenizable — schedule a focused pass |

**Also for Phase E:** `unscopedStyle` = **206 blocks** still not `scoped`. Adding `scoped`
changes selector reach, so the plan says this one "needs eyes" (visual verification per file) —
it is the single change we should NOT automate blindly.

---

## 2. "Always-dark" inspector panels — DESIGN CALL

`plugins/traces/ServiceGraphEdgeSidePanel.vue` and `ServiceGraphNodeSidePanel.vue` are styled
with fixed dark values (`#0f1419`, `#1a1f2e`, `#2d3548`, `#60a5fa`, …) and have **no light
variant at all** — likely an intentional "glass panel floating over the graph canvas" look.

**Decision:** Should these be (a) made theme-aware (register `--color-graph-panel-*` with a
light treatment), or (b) intentionally always-dark (register an always-dark token set so
they stop using raw hex but keep the fixed look)? Same question applies to the graph tooltip
translucent `rgba()` backgrounds.

---

## 3. Categorical / data-viz palettes — DECISION (register vs allowlist)

These are multi-hue *categorical* palettes (not semantic single-purpose colors). §12.3 of the
plan asks: allowlist them as the declared "palette home", or move into the token layer?

| File | What |
|---|---|
| `plugins/traces/TraceDAG.vue` | 14-node-type LLM-span palette (`generation/embedding/agent/tool/…`), light+dark — **97 hex**. Already theme-correct via `dark:`. Needs a `--color-dag-node-*` family (~42 tokens) if we want it tokenized |
| `plugins/traces/TraceEvaluationsView.vue` | `DIM_COLOR_*` 13-dimension eval palette |
| `components/alerts/IncidentDetailDrawer.vue` | icon-category legend chips (amber/blue/purple/green/rose) — **38** |
| `utils/traces/traceColors.ts` (70), `utils/dashboard/colorPalette.ts` (50), `constants/themes.ts` (36) | **already tsHex-allowlisted** as palette sources — confirm we keep them allowlisted |

**Decision:** For each, register a domain token family, or formally allowlist as a palette
source? (TraceDAG is the biggest single call — 42 tokens for one already-working viz.)

---

## 4. Fixed brand / promo mockups — CONFIRM EXCEPTION

Colors here are **intentionally theme-independent** (they replicate other products' brands or
are fixed promo art). Recommend an explicit allowlist, not migration.

| File | What |
|---|---|
| `components/alerts/DestinationPreview.vue` | **89 hex** — pixel-accurate Slack / Teams / Email message replicas (must keep platform colors) |
| `components/WebinarBanner.vue` | Fixed-amber promotional banner + on-amber contrast colors |
| brand gradients | AI-button purple→pink gradients (O2AIChat, pipeline Query.vue, License/OrgStorage), MenuLink notification gradient — no gradient token exists |

**Decision:** Confirm these are permanent exceptions (add to a documented allowlist so the
ratchet ignores them).

---

## 5. `--color-*: initial` palette kill (Phase G) — BLOCKED until 1–4 resolved

Phase G disables Tailwind's default palette so raw classes stop compiling. It **cannot ship**
until the **102 residual raw-palette** + **269 residual hex-class** sites above are either
registered as tokens or explicitly excepted — otherwise their colors silently vanish
(fail to compile). So Phase G is gated on decisions §1–§4.

Also part of Phase G: flip the lint guards (ESLint `no-restricted-syntax`, stylelint
`color-no-hex`, `vue/enforce-style-attribute`) from **warn → error**, and delete the ratchet
baseline for zero-tolerance. Safe to do only after E is done.

---

## 6. §12 open decisions (independent of the above)

| # | Decision | Notes / recommendation |
|---|---|---|
| z-index ladder | Confirm role→step values (raised 10 / sticky 20 / dropdown 30 / overlay 40 / modal 50 / toast 60) and where Quasar's own stacking sits | 49 `z-[…]` sites across ~12 files (MetricList, SearchBar ×2, ServiceGraphEdgeSidePanel, CustomNode, PipelineFlow, WebinarBanner, …) can't be normalized until fixed |
| 10px font floor | Keep a `--text-3xs` (10px) chart-micro-label token, or lift to 11px app-wide? | ~88 `text-[10px]` sites left untouched pending this |
| white / black | After palette kill, re-register `--color-white`/`--color-black` for legit icon-on-accent uses, or ban and force `text-text-inverse`? | ~small set of reviewed-legit sites |
| Utility naming | **DECIDED**: keep full names (`text-text-secondary`) | already applied by the codemod |
| 13px size | **DECIDED**: new `text-compact` token | already applied |

---

## 7. Known follow-ups (not blocking, FYI)

- ✅ **DONE — `utils/theme.ts` local `isDarkMode`** renamed to `darkModeActive` (it's a param-derived
  local, not a store read), so it no longer trips the `no-restricted-syntax` warning. The two-seam
  contract (`useTheme.ts` / `chartTheme.ts`) stays pure — no allowlist entry needed.
- ✅ **DONE — genuine bare `rounded!` utilities** (CustomNode, ThreadView, SearchFieldList) → `rounded-sm!`
  (value-identical, decided radius policy). The remaining `bareRounded` ratchet count is all **false
  positives** — the regex matches the word "rounded" in comments, JS object keys (`rounded: "rounded-md"`),
  and prop defaults (`rounded?: boolean`). **Team follow-up:** tighten the `bareRounded` regex in
  `check-design-consistency.mjs` to skip comments / non-class contexts before Phase G flips it to error.
- **2 AlertList tests** (`tab scheduled shows only matching rows`, `importAlert sets dialog`) fail
  under full-suite parallel load (21s timeout) but **pass in isolation** — pre-existing flakiness,
  not a migration regression.
- **`stylePxUnit`** (px inside `<style>` blocks, ~1077) stays **ratchet-only** (never zero-tolerance)
  per §12.4 — convert px→rem opportunistically when a file is touched for Phase E.
