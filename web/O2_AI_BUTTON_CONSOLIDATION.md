# AI Button Consolidation — F6 / W2 (component extraction)

**Status:** ready to execute · **Premises verified against** `b51722f7fe` (branch `fix/token`) on 2026-07-17

> ⚠️ **Re-verify §2 before executing.** Parallel agents have been active in this exact
> area — during the session that produced this doc, `utilities.css` and
> `FunctionsToolbar.vue` both changed underneath the analysis. §2 gives the commands
> to re-measure from scratch. Do not trust the tables without re-running them.

---

## 1. What this is

F6 (AI-assistant buttons) has finished W1 (CSS evacuation) but not W2 (component
extraction). The paint is now tokenized and colocated, but the **same icon-toggle
button is still hand-rolled at 8 call sites**, each with its own ~300-char inline
class string, its own hover machinery, and its own icon-size mistake.

This doc covers the W2 extraction: one `AiActionButton`, no variants.

### 1.1 Already done — do not redo

W1.c evacuated F6 from `src/styles/utilities.css` (see the note at its top):

| Rule | Outcome |
|---|---|
| `.ai-hover-btn` (+ dark/hover twins, `:hover img`) | → `<style scoped>` in `lib/core/EmptyState/EmptyStateIngestionChip.vue`. It is that chip's **public modifier API**; the 4 empty states keep passing the class. Now tokenized (`--color-gradient-ai-subtle` / `--color-ai-accent`). **Leave alone.** |
| `.ai-btn-active` CSS | **Deleted** — was a proven no-op (all 5 call sites already carried the equivalent `[background:var(--color-gradient-ai-subtle)]!` unconditionally). Class name survives *only* as a state hook. |
| `.o2-ai-context-btn` | **Deleted**; replaced by template utilities on `common/O2AIContextAddBtn.vue`. |
| `.ai-hover-btn:hover .ai-icon` | **Deleted** — the compound never matched any DOM. |

**Consequence to understand:** the empty-state chips are settled. They keep chip
geometry and wear AI paint via `.ai-hover-btn` scoped to the chip. **They are out of
scope for this doc.** Only the 8 icon toggles are in scope.

### 1.2 Scope boundary

| Group | Sites | Disposition |
|---|---|---|
| **Icon toggles** | 8 | ← **this doc.** One `AiActionButton`. |
| Empty-state chips | 4 | Done in W1.c. Out of scope. |
| Send CTAs (`QueryEditor:47`, `O2AIChat:1361`) | 2 | Keep `variant="ai-gradient"`. Genuinely a different affordance (full gradient at rest, no hover spin, submit not toggle). Out of scope. |

---

## 2. Inventory — RE-VERIFY THIS FIRST

```bash
cd web
# the 8 toggle sites + their paint
grep -rn "gradient-ai-subtle" --include=*.vue src/ | grep -v EmptyState
# dead classes (both have NO css definition anywhere — confirm still true)
grep -rn "header-icon\|ai-icon" --include=*.vue src/
grep -rn "\.header-icon\|\.ai-icon" --include=*.css src/       # expect: no matches
# the state hook
grep -rn "ai-btn-active" --include=*.vue src/
# dead hover machinery
grep -rn "isHovered\|getBtnLogo\|AiHovered\|AiBtnLogo" --include=*.vue src/
```

### 2.1 Measured geometry @ `b51722f7fe`

All four `ai_icon_*.svg` are intrinsically **24×24**. Tailwind `w-7.5` = 1.875rem =
30px = exactly `size-[1.875rem]` (`icon-toolbar`).

| # | Site | Button | Icon | Icon comes from | Hover choreography |
|---|---|---|---|---|---|
| 1 | `components/Header.vue:213` | 30×30 | **20** | `w-5 h-5` | rotate + invert ✅ |
| 2 | `components/pipeline/PipelineEditor.vue:138` | 30×30 | **20** | `size-5` | rotate + invert ✅ |
| 3 | `components/common/O2AIContextAddBtn.vue` | 30×30 | **16/20/24** | `:imageHeight/:imageWidth` attrs, per caller | rotate + invert ✅ |
| 4 | `components/alerts/QueryEditorDialog.vue:63` | 30×30 | **18** | inline `style="width:18px;height:18px"` | rotate only ⚠️ no invert |
| 5 | `components/QueryEditor.vue:98` (floating) | 30×30 | **18** | `w-4.5 h-4.5` | rotate + invert ✅ |
| 6 | `components/settings/AddRegexPattern.vue:31` | 30×30 | **24** ← intrinsic | `header-icon` (**dead class**) + no size class | rotate + invert ✅ |
| 7 | `components/pipeline/NodeForm/Query.vue:27` | 30×30 | **24** ← intrinsic | `header-icon ai-icon` (**both dead**) | ❌ none |
| 8 | `components/functions/FunctionsToolbar.vue:55` | **32×32** ← `icon-sm` | **24** ← intrinsic | no size class | ❌ none |

**Read this table as:** 7 of 8 buttons are already exactly 30×30 — QueryEditor's
`w-7.5! h-7.5! min-w-7.5! min-h-7.5!` are **no-ops** that duplicate `icon-toolbar`.
Only FunctionsToolbar (32) is the button outlier. The **icons** are the mess:
24/20/18/16, three of them 24 purely because `header-icon` *looks like* it sizes the
icon and does nothing.

---

## 3. Findings that justify the work

1. **`header-icon` is a dead class** — no CSS definition anywhere in the repo. Present
   on sites 3, 2, 6, 7. Three sites trusted it and render a 24px icon in a 30px box.
2. **`.ai-icon` is now a dead class** — its only rule (`.ai-hover-btn:hover .ai-icon`)
   was deleted in W1.c. Still on sites 3 and 7.
3. **`ai-btn-active` is now vestigial at 4 of its 5 sites.** Its CSS is gone. It is
   read *only* by `FunctionsToolbar.vue:67`'s `[.ai-btn-active_&]:!opacity-100`
   descendant hook. On Header, PipelineEditor, AddRegexPattern, and Query it is a
   no-op class on the element.
4. **The JS hover machinery is redundant where it works, and load-bearing where it
   shouldn't be.** Every site has `isHovered` ref + 2 handlers + a `getBtnLogo`
   computed whose whole job is swapping the icon `src` on hover. But sites 1/2/6 also
   have `group-hover:brightness-0 group-hover:invert`, which forces the icon pure
   white on hover regardless of `src` — so the JS swap is **invisible dead work**.
   At sites 4/8 there is no invert, so the JS swap is the only thing that works.
   Same intent, two mechanisms, inconsistently applied.
5. **`Header.vue` takes `isHovered` as a required prop and emits `update:isHovered`** —
   the hover state of a button lives in its parent component.
6. **`useAiIcon()` already exists** (`composables/useAiIcon.ts`) and does the
   theme-aware swap correctly. Only the 4 empty states use it. Five other files
   hand-roll `isHovered.value || store.state.isAiChatEnabled ? dark : (isDark ? dark : gradient)`.
   `QueryEditorDialog` adds a third icon (`ai_icon_blue.svg`) nobody else uses.
7. **`O2AIContextAddBtn` has a dead `size` prop** — declared (`default: 'xs'`), never
   referenced in the template. `CellActions.vue` passes `:size="'6px'"` and
   `plugins/logs/TenstackTable.vue` passes `:size="'2px'"`, both believing it does
   something.
8. **The enterprise guard is duplicated at all 8 sites:**
   `config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled`.

---

## 4. Target design

```
Call sites (8)     <AiActionButton :active="…" @click="…" />
                            │
AiActionButton     guard + useAiIcon() + rotate/invert + active + icon-size
                            │
OButton            variant="ai-subtle"   ← paint lives in the cva map
```

### 4.1 `OButton` gains ONE paint variant

Add `ai-subtle` to the variant map in `lib/core/Button/OButton.vue` (alongside the
existing `ai-gradient`), built on the existing tokens:

- rest: `bg-[image:var(--color-gradient-ai-subtle)]`
- hover: `bg-[image:var(--color-gradient-ai)]` + shadow via
  `color-mix(in srgb, var(--color-ai-accent) 35%, transparent)`
- dark rest shadow: `color-mix(in srgb, var(--color-ai-accent) 20%, transparent)`

**Why in the cva map and not as utilities on the wrapper:** today all 7 inline sites
fight `variant="ghost"`'s background with `!` overrides. A variant in the map has no
competitor, so **every `!` disappears** — that is the point. This variant is not for
direct call-site use; `AiActionButton` is its only consumer.

> The dark rest-shadow currently only exists at some sites. Standardize on having it
> (Header/PipelineEditor/AddRegexPattern/O2AIContextAddBtn have it; FunctionsToolbar,
> Query, QueryEditorDialog, QueryEditor do not). This is a deliberate, accepted change.

### 4.2 `AiActionButton` — `lib/core/Button/AiActionButton.vue` (or `components/common/`)

**Props**
| Prop | Type | Default | Why |
|---|---|---|---|
| `active` | `boolean` | `false` | "AI chat is open". Drives icon opacity 70→100 + `src` swap. |
| `disabled` | `boolean` | `false` | FunctionsToolbar (`isSubmitting`), QueryEditor (`disableAi`). |
| `iconSize` | `string` | `'20px'` | **Required** — O2AIContextAddBtn's callers legitimately need 16/20/24. Size is orthogonal to variants; this is not variant proliferation. |

**Owns internally**
- the enterprise/`ai_enabled` guard (`v-if`) → deletes the condition from 8 callers
- `useAiIcon()` → deletes 5 `getBtnLogo` computeds
- the icon `<img>` + `group-hover:rotate-180 group-hover:brightness-0 group-hover:invert`
- **no JS hover state at all** → deletes 5 `isHovered` refs + ~10 handlers
- `<slot>` for a tooltip (Header needs `shortcut-id="aiChatToggle"`; QueryEditor needs a
  disabled-reason tooltip)
- `v-bind="$attrs"` passthrough so `data-test` and positioning classes survive

**Call site becomes:**
```vue
<AiActionButton :active="store.state.isAiChatEnabled" @click="toggleAIChat" />
```

### 4.3 What "active" means — DECIDED

Today `active` means three different things (icon opacity at 8/7; icon `src` swap at
1/2/6; nothing visible at all on some). **Standardize on: icon `src` → `ai_icon_dark.svg`
+ opacity 70→100.** Background stays subtle at rest (matching today — the `.ai-btn-active`
background rules were already a no-op, which is why W1.c deleted them).

> If "chat is open" should be *more* visible than this, that is a **separate design
> change** — do not smuggle it into this refactor.

---

## 5. Execution plan

### Phase A — build + convert (mechanical, zero visual delta)
1. Add `ai-subtle` variant to `OButton.vue` + `OButton.types.ts`.
2. Create `AiActionButton.vue` per §4.2.
3. Convert the 8 sites. **Pin each site's currently-measured `:icon-size`** from §2.1
   (24/24/24, 20/20, 18/18, and per-caller for O2AIContextAddBtn) and keep
   FunctionsToolbar's 32px button. Preserve every `data-test` attribute verbatim.
4. `O2AIContextAddBtn.vue` → becomes a thin wrapper over `AiActionButton`, passing
   `imageHeight`/`imageWidth` through as `iconSize`. **Its 6 callers stay untouched.**
   Delete its dead `size` prop and the `:size="'2px'"` / `:size="'6px'"` args at
   `CellActions.vue` / `plugins/logs/TenstackTable.vue`.
5. Delete: 5 `isHovered` refs + handlers, 5 `getBtnLogo` computeds, Header's
   `isHovered` prop + `update:isHovered` emit (and the parent that feeds it), the
   7 inline gradient class strings, `header-icon` and `ai-icon` from all templates,
   `ai-btn-active` from sites 1/2/6/7.
6. **`FunctionsToolbar` is special:** its `[.ai-btn-active_&]:!opacity-100` hook is the
   last reader of `ai-btn-active`. Once its icon opacity is driven by
   `AiActionButton`'s `active` prop, the class name dies completely. Confirm with
   `grep -rn "ai-btn-active" src/` → expect zero.

Phase A should move **zero pixels**. Twelve-ish files, all risk-free.

### Phase B — standardize (the pixel change; ~5 lines)
7. Delete the per-site `:icon-size` pins. Let the `'20px'` default apply.
8. FunctionsToolbar: `size="icon-sm"` → `icon-toolbar` (32→30).
9. QueryEditorDialog: drop the inline `style="width:18px"` (18→20).
10. QueryEditor floating: drop `w-4.5 h-4.5` (18→20) and the four no-op
    `w-7.5!/h-7.5!/min-w-7.5!/min-h-7.5!` overrides.
11. **Exception:** O2AIContextAddBtn keeps per-caller `iconSize` (16/20/24 are
    legitimate — 16 is a table-cell hover affordance, 24 is TestFunction). Do **not**
    force these to 20.

**Sites that visibly change in Phase B:** AddRegexPattern (24→20), Query (24→20),
FunctionsToolbar (24→20 icon, 32→30 button), QueryEditorDialog (18→20),
QueryEditor floating (18→20). **Risk accepted by the user (2026-07-17).**

> Keeping A and B as separate commits is the whole safety mechanism: if a size
> regression shows up, revert B — a 5-line diff — and the refactor survives.

---

## 6. Verification

There is **no visual-regression harness** in this repo (no Percy/Storybook/Playwright
screenshots; Cypress e2e + Vitest only). So:

```bash
cd web
npm run type-check
npx vitest run src/components/Header.spec.ts \
               src/components/QueryEditor.spec.ts \
               src/components/common/JsonEditor.spec.ts \
               src/components/common/O2AIContextAddBtn.spec.js \
               src/plugins/traces/TracesNoEventsState.spec.ts \
               src/plugins/logs/DetailTable.spec.ts \
               src/plugins/logs/data-table/CellActions.spec.ts
npm run lint:tokens
npm run lint:design        # then re-baseline: the hex/px counts should DROP
```

Specs key off `data-test` attrs — preserving them verbatim is what keeps them green.
Several specs mock `O2AIContextAddBtn` (`TenstackTable.spec.ts`,
`TableRenderer.spec.ts`, `PromQLTableChart.spec.ts`, `TracesTable.spec.ts`,
`TestFunction.spec.ts`) — those mocks should be unaffected, but check.

**Manual pass (the only real visual check).** Requires an **enterprise build with
`ai_enabled`** — none of these render otherwise. Check light + dark:

| Site | Navigation |
|---|---|
| Header toggle (reference impl) | any page, top-right, left of theme switcher |
| FunctionsToolbar | Pipelines → Functions → Add/Edit function → toolbar |
| PipelineEditor | Pipelines → Pipelines → edit → JSON editor → header-right |
| Query.vue | Pipelines → Pipelines → a **scheduled** pipeline → query node form |
| AddRegexPattern | Settings → Regex Patterns → Add/Edit → dialog header |
| QueryEditorDialog | Alerts → Add/Edit Alert → query step → open editor dialog |
| QueryEditor floating + send | Logs → top-right of the query editor box → opens NL bar |
| O2AIContextAddBtn ×6 | Logs → expand a row (DetailTable); hover a cell (CellActions); Alerts list rows; Functions → Test Function |
| Empty-state chips (regression check only) | Logs / Traces on an org with **no data** |

For each: rest state, hover (icon must rotate 180° **and** invert to white), and
active (chat open).

---

## 7. Traps

- **The empty-state chips are done.** `.ai-hover-btn` in
  `EmptyStateIngestionChip.vue`'s scoped style is deliberate and documented as the
  chip's modifier API. Do not "consolidate" it into `AiActionButton` — a chip is not a
  toolbar button, and forcing it in reintroduces the geometry variants this work removes.
- **`w-7.5` == `icon-toolbar` == 30px.** Don't "fix" a size difference that isn't there.
- **Sites 4/8 have no `invert`,** so their JS `src` swap is currently load-bearing.
  Removing `isHovered` there without adding the CSS invert **will** regress hover.
  Add the choreography in the component first.
- **`O2AIContextAddBtn` has 6 callers.** It is not a delete; it is an absorb.
- **Two AI variants on OButton is correct.** `ai-gradient` (full at rest — send CTAs)
  and `ai-subtle` (subtle→full hover — toggles) are different affordances, not a
  variant family. Call sites still only ever touch `<AiActionButton>`.
- **Parallel agents are active here.** Re-run §2 before starting.
