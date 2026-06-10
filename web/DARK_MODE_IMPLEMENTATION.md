# O2 Dark Mode — Implementation & Tuning Guide (for Claude Code)

**Goal:** fix the dark theme so backgrounds form a clear elevation ladder and borders are
actually visible — and make it **tunable from ~12 values** so the design owner can adjust it
without touching components.

**This is grounded in your real codebase.** All tokens, file paths, and the `.body--dark`
mechanism below already exist in `web/src/styles/_variables.scss`. We are **repointing existing
semantic tokens**, not inventing a new system.

---

## 1. Why dark mode looks wrong today (root causes)

In `web/src/styles/_variables.scss`, inside `.body--dark { … }`:

1. **Inverted elevation.** `--o2-card-bg: #1f2223` is *darker* than
   `--o2-primary-background: #2B2D30`. Cards should sit **above** the page (lighter), not below it.
   Right now surfaces sink instead of lift, so nothing separates.
2. **Translucent white borders.** `--o2-border-color: rgba(255, 255, 255, 0.40)` and
   `--o2-border-2: rgba(255,255,255,0.12)` render differently on every background they cross —
   harsh on dark surfaces, invisible on lighter ones. **Borders must be solid hex.**
3. **Near-transparent / gradient page backgrounds** (`--o2-body-primary-bg: rgba(14,19,29,.01)`
   plus a gradient in `app.scss`) give a muddy, low-contrast base instead of one clean surface.
4. **Ad-hoc surface tokens** (`--o2-table-header-bg` uses a teal `color-mix`,
   `--o2-sticky-col-header-bg: #565656`, `--o2-log-table-row-hover: #3a4a78`) don't belong to any
   ladder, so tables look disconnected from the rest of the UI.

**Fix strategy:** define one **elevation foundation** (raw surface + border + text values) at the
top of `.body--dark`, then repoint every semantic token to reference it. The owner tunes the
foundation; everything else follows.

---

## 2. The tuning block — EDIT THESE ~12 VALUES

Add this at the very top of the `.body--dark { … }` rule in
`web/src/styles/_variables.scss`. **These are the only values the design owner needs to touch.**
They are grounded in **Radix Dark (Slate)** — a neutral scale engineered so each step is
perceptually distinct — with the O2 iris accent.

```scss
.body--dark {
  /* ───────────────────────────────────────────────────────────
     DARK MODE FOUNDATION — tune these ~12 values to taste.
     Rule of thumb: each surface ~6% lighter than the one below;
     borders are 2–3 steps ABOVE the surface they sit on (never equal).
     ─────────────────────────────────────────────────────────── */

  /* Surfaces — darkest (recessed) → lightest (raised) */
  --d-backdrop:  #0D0E10;  /* app viewport behind the frame            */
  --d-frame:     #161719;  /* left rail + top bar (recessed chrome)    */
  --d-panel:     #22252A;  /* MAIN surface: cards, tables, drawers     */
  --d-raised:    #2B2F36;  /* inputs, table header, rail, hover fills  */

  /* Borders & dividers — MUST be clearly brighter than surfaces */
  --d-divider:   #363B42;  /* subtle: row & section separators         */
  --d-border:    #474E57;  /* default: card / input / table outlines   */

  /* Text — never pure white */
  --d-text:      #ECEEF1;  /* primary text, headings, record names     */
  --d-text-2:    #BAC1C9;  /* secondary: body, nav, button labels      */
  --d-text-3:    #9AA2AD;  /* metadata, captions, column heads, IDs    */

  /* Accent (iris) + selection */
  --d-primary:   #818AF2;  /* primary buttons, links, active nav text  */
  --d-selected:  #262D4D;  /* selected row / active nav background     */
  --d-hover:     #262A30;  /* neutral row-hover background             */
  /* … repoint mappings below reference ONLY the vars above … */
}
```

### What each value controls (so tuning is predictable)
| If this looks wrong… | …change |
|---|---|
| Whole app too dark / too light | `--d-backdrop` + `--d-frame` together |
| Cards/tables don't "lift" off the page | raise `--d-panel` (bigger gap from `--d-frame`) |
| Section edges / table outlines invisible | brighten `--d-border` (and `--d-divider`) |
| Inputs/table-header don't stand out | adjust `--d-raised` |
| Body text too dim / harsh | `--d-text-2` / `--d-text-3` |
| Selected row not obvious | brighten `--d-selected` |
| Buttons/links too dull or too neon | `--d-primary` |

> **Contrast guardrails when tuning:** keep `--d-border` ≥ **1.5:1** against `--d-panel`
> (that's the gap that makes sections legible), and `--d-text-3` ≥ **4.5:1** against `--d-panel`
> (WCAG AA for small text). The defaults above already pass both.

---

## 3. Repoint existing semantic tokens to the foundation

Replace the current hardcoded dark values in `.body--dark` with references to the foundation.
**Keep the token names** — components already consume them, so this requires no component edits.

```scss
  /* Backgrounds */
  --o2-body-primary-bg:    var(--d-backdrop);   /* was rgba(14,19,29,.01) — make it solid */
  --o2-body-secondary-bg:  var(--d-backdrop);   /* drop the gradient (see §4)             */
  --o2-primary-background:  var(--d-frame);
  --o2-secondary-background: var(--d-frame);
  --o2-muted-background:    var(--d-raised);

  /* Cards / panels — THE inversion fix: panel must be lighter than frame */
  --o2-card-bg:             var(--d-panel);
  --o2-card-bg-solid:       var(--d-panel);
  --o2-card-background:     var(--d-panel);
  --o2-popover-background:  var(--d-raised);
  --o2-code-bg:             var(--d-raised);
  --o2-table-actions-bg:    var(--d-panel);

  /* Borders — THE rgba-white fix: solid, visible, consistent */
  --o2-border:        var(--d-border);
  --o2-border-color:  var(--d-border);   /* was rgba(255,255,255,0.40) */
  --o2-border-2:      var(--d-divider);  /* was rgba(255,255,255,0.12) */
  --o2-border-input:  var(--d-border);

  /* Text hierarchy */
  --o2-text-heading:    var(--d-text);
  --o2-text-primary:    var(--d-text);
  --o2-text-body:       var(--d-text-2);
  --o2-text-secondary:  var(--d-text-2);
  --o2-text-caption:    var(--d-text-3);
  --o2-text-label:      var(--d-text-3);
  --o2-text-muted:      var(--d-text-3);
  --o2-text-placeholder:var(--d-text-3);
  --o2-text-code:       var(--d-text-2);
  --o2-card-text:       var(--d-text-2);
  --o2-popover-text:    var(--d-text-2);

  /* Interactive / accent */
  --o2-primary-color:       var(--d-primary);
  --o2-primary-btn-bg:      var(--d-primary);
  --o2-primary-btn-text:    #15161A;          /* near-black text on the iris button */
  --o2-primary-foreground:  #15161A;
  --o2-focus-ring:          var(--d-primary);
  --o2-hover-accent:        var(--d-hover);
  --o2-text-link:           var(--d-primary);
  --o2-text-link-hover:     #9AA2FC;

  /* Tables — pull onto the ladder (remove the teal color-mix / #565656 one-offs) */
  --o2-table-header-bg:      var(--d-raised);
  --o2-sticky-col-header-bg: var(--d-raised);
  --o2-log-table-row-bg:     var(--d-panel);
  --o2-log-table-row-alt-bg: #262A31;         /* panel +1 step for zebra */
  --o2-log-table-row-hover:  var(--d-hover);
  --o2-log-table-row-border: var(--d-divider); /* was rgba(255,255,255,0.14) */

  /* Shadows — real shadows read on dark; keep them */
  --o2-hover-shadow: rgba(0, 0, 0, 0.6);
```

### Status colors (badges, dots) — dark-tuned, also via the foundation (optional but recommended)
Brighten the foreground, deepen the tint, so badges pop on dark surfaces:
```scss
  --o2-positive: #46C95A;  --o2-status-success-bg: #16301F;
  --o2-warning:  #DBA432;  --o2-status-warning-bg: #2F2613;
  --o2-negative: #FA6D64;  --o2-status-error-bg:   #341A1A;
  --o2-info:     #5DA8FF;  --o2-status-info-bg:    #14283F;
```

---

## 4. Remove the gradient page background

In `web/src/styles/app.scss` the body uses a gradient
(`linear-gradient(... var(--o2-body-primary-bg), var(--o2-body-secondary-bg))`). On dark mode this
muddies the base. Set both stops to `--d-backdrop` (done in §3) **or** replace the gradient with a
flat fill under `.body--dark`:
```scss
.body--dark body,
.body--dark #app {
  background: var(--d-backdrop) !important;
}
```

---

## 5. The elevation model (keep this intact while tuning)

```
RECESSED ─────────────────────────────────────────────► RAISED
 backdrop   <   frame (rail/topbar)   <   PANEL (cards/tables)   <   raised (inputs/header)
 #0D0E10        #161719                   #22252A                    #2B2F36

 dividers #363B42   <   borders #474E57            (always brighter than every surface)
 selected #262D4D   ·   hover #262A30              (row states on the panel)
```

Two rules that must survive any tuning:
1. **Panel is lighter than frame.** The content card lifts; the rail/top-bar recede. (This is the
   single biggest fix — today it's reversed.)
2. **Borders sit 2–3 steps above their surface.** A border equal to its background is invisible —
   that was the other core bug.

---

## 6. Phase 2 — migrate the inline hardcodes (bigger, do after §1–5 land)

Tokens fix ~80% of surfaces. The rest are components that bypass tokens with inline conditionals,
e.g. `:class="store.state.theme === 'dark' ? 'tw:bg-gray-700' : …"` and raw hex like
`backgroundColor: store.state.theme === 'dark' ? '#444444' : …` (heavy in
`web/src/components/alerts/**`, e.g. `IncidentDetailDrawer.vue`).

Guidance for migration:
- Replace inline `store.state.theme === 'dark' ? Xdark : Xlight` color pairs with a single
  `var(--o2-*)` token that already resolves per theme.
- Map Tailwind `tw:bg-gray-700 / tw:text-gray-400` pairs to the nearest semantic token
  (`--o2-card-bg`, `--o2-text-3`, etc.). Prefer the token over a fixed Tailwind step.
- Grep targets to work through:
  - `store.state.theme === 'dark'` (color branches)
  - hardcoded hex in `:style` / `:class` bindings (`#1F2021`, `#444444`, `#2A2B2C`, `#3A3B3C`…)
  - `var(--q-dark)`, `var(--q-dark-page)`, `$dark-page` (Quasar defaults — replace with `--o2-*`)
- **Rule going forward** (already documented in `app.scss`): *never hardcode a color; always use a
  `var(--o2-*)` token.* New code that needs a color the tokens don't cover should add a token, not
  an inline hex.

---

## 7. How to verify

1. Toggle the app to dark (`store.state.theme = 'dark'`, i.e. Quasar `.body--dark`).
2. Check the four explorer pages + IAM/Settings tables + a record drawer:
   - The content card/table visibly **lifts** off the rail/top-bar.
   - Every table has a clear **header band**, **row dividers**, and an **outer border**.
   - The **selected row** and **hover** are distinct.
   - Inputs show a visible border + iris focus ring.
   - Status badges (active/suspended/error) read clearly.
3. Spot-check contrast: `--d-border` vs `--d-panel` ≥ 1.5:1; `--d-text-3` vs `--d-panel` ≥ 4.5:1.
4. Tune the §2 block if any surface still feels flat — then re-verify.

---

## 8. Files touched
- `web/src/styles/_variables.scss` — the `.body--dark` block (§2, §3) — **the main change**.
- `web/src/styles/app.scss` — remove/flatten the dark gradient body background (§4).
- (Phase 2) component `.vue` files with inline theme conditionals (§6).

*Visual reference for the target look: `prototype/Dark Mode.html` (renders this exact ladder and
token set). Full token rationale: `prototype/DARK_MODE.md`.*
