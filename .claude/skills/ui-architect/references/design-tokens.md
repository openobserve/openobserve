# Design Tokens (`--color-*`) & the `--o2-*` Ban

Every color and non-trivial dimension in the app is a **design token**. Tokens
are what make the UI theme-aware — a token resolves to the right value in light
and dark automatically and can be retuned globally in one place. A hardcoded
`#fff` or `12px` opts a single element out of that system permanently.

There is exactly **one** token vocabulary you may use: the modern **`--color-*`**
set. The legacy **`--o2-*`** set is banned (see the bottom of this file).

## Table of contents

- [Using tokens](#using-tokens)
- [The token files](#the-token-files)
- [Registering a new `--color-*` token](#registering-a-new---color--token)
- [The `--o2-*` ban](#the---o2--ban)
- [`--o2-*` → `--color-*` migration map](#--o2----color--migration-map)

## Using tokens

- **Prefer the token-backed Tailwind utility** generated from the `--color-*`
  token — bare, **no `tw:` prefix** (the prefix was removed from this project;
  `tw:bg-surface-base` no longer resolves): `bg-surface-base`, `text-text-heading`,
  `border-border-default`, `bg-button-primary`, `bg-tabs-active-bg`. Grep existing
  views for the names already in use.
- **Don't hand-write the arbitrary-value form when a utility exists.** Every
  `--color-*` token registered in an `@theme inline` block (all the
  semantic/component tokens) emits the full set of utilities, so the utility is
  guaranteed to exist and compiles to the **identical** CSS — the arbitrary value
  is just noisier. The utility name is the token minus the `--color-` prefix:
  ```html
  <!-- avoid -->
  <div
    class="bg-[var(--color-surface-base)] text-[var(--color-text-heading)] border-[var(--color-border-default)]"
  ></div>

  <!-- prefer -->
  <div class="bg-surface-base text-text-heading border-border-default"></div>
  ```
  (`--color-text-heading` → `text-text-heading`, `--color-surface-base` →
  `bg-surface-base`, `--color-border-default` → `border-border-default`.) This also
  covers the v4 shorthand `bg-(--color-x)` — same rule, use `bg-x`.
  > **Retired aliases** (CI-banned, `retiredTextAlias`): `text-text-primary` →
  > `text-text-heading`, `text-text-caption` → `text-text-secondary`.
- **Text colour — pick by SEMANTIC role, never by eye.** The guidelines' four
  colours (T3) map onto the tokens as strong → `heading`, default → `body`,
  secondary → `secondary` / `label`, tertiary → `muted`, plus `disabled`; each has
  exactly one job.
  Using the wrong tier is a bug even though CI can't catch it: `muted` on a real
  value reads as "turned off", and a label in `body` fails to recede.
  - `text-text-heading` — titles, section headings, and the emphasized primary
    value in a tile/row. The strongest text.
  - `text-text-body` — main/primary reading content: the sentence, or the data
    value that is the row's whole point.
  - `text-text-secondary` — labels, captions, metadata, units, sub-labels, and
    any supporting text beside the primary. **This is where "quiet" text goes —
    NOT muted.**
  - `text-text-label` — a form field's own label (the `OForm*` controls render
    it for you; reach for it directly only for a bare field label).
  - `text-text-muted` — the guidelines' **tertiary** tier (T3): timestamps, hints,
    placeholders, and absent content (an em-dash / "not measured" / "none", a
    value nobody supplied, C4). Never a label, never body text, never a live
    value. (`text-text-disabled` is the dedicated disabled-control token.)
  - To make text quieter, drop ONE tier on this ladder (+ size/weight) — never a
    raw `opacity` and never a lighter palette colour.
- **Arbitrary `[var(--color-x)]` in a class now FAILS CI** (`rawVarInTemplate`,
  zero tolerance) — including the v4 shorthand `bg-(--color-x)` and the fallback
  form `bg-[var(--color-x,#fff)]`. "The token has no registered utility" is no
  longer an escape: **register it** in `@theme inline` and use `bg-x`.

  Two other shapes are banned for the same reason, because each is provably
  replaceable:

  | banned                                                      | write instead                               |
  | ----------------------------------------------------------- | ------------------------------------------- |
  | `bg-[var(--color-x)]` · `bg-(--color-x)`                    | `bg-x`                                      |
  | `bg-[color-mix(in_srgb,var(--color-x)_12%,transparent)]`    | `bg-x/12` — byte-identical                  |
  | `bg-[color-mix(in_srgb,var(--color-x)_12%,var(--color-y))]` | name the blend as a token, then `bg-<name>` |

  A mix with `transparent` is only an alpha change, which is exactly what Tailwind's
  `/N` modifier emits. A **2-colour blend** is a genuinely new opaque colour no
  utility can express — that one belongs in the token layer.

  Everything else inside an arbitrary value is exempt because it has no utility
  form at all: a gradient stop, a mask stop, a drop-shadow colour, a `calc()`
  percentage, or a mix whose input is `currentColor` or a runtime-set custom
  property.

- **Raw `var(--color-*)` in a `.vue` file is a counted bypass** (`rawVarInComponent`,
  zero tolerance). It is allowed **only** in the sanctioned residue where no
  utility can reach: inside `:deep()`, `@keyframes`, `color-mix()`, `calc()`, SVG
  `fill`/`stroke`, and `v-html`/JS-generated markup (e.g. an ECharts tooltip string).
  Everywhere else use the utility; if the utility doesn't exist, **register the token**
  (below) instead of reaching for `var()`. In a standalone `.css` file, `var(--color-*)`
  is fine. Never `var(--o2-*)`.
- **Never a literal** — no hex / `rgb()` / `rgba()` / `hsl()` / named colors in a
  component, and no magic `px` dimensions. (Literal hex is allowed in exactly one
  place: the raw palette in `base.css`, which nothing else references directly.)
  Raw Tailwind palette utilities (`bg-gray-400`, `text-red-500`) don't even compile —
  `palette-reset.css` clears the `--color-*` default namespace so only registered
  tokens survive.
- **Reuse before minting; one knob per decision.** Grep for an existing token first;
  mint a new one only when it's genuinely needed and used. Never add a second name for
  a value that already has one — an alias is a decision made twice that splits adoption
  and can't be seen in review.
- **British `grey-*`, not `gray-*`** — `grey-*`/`primary-*` are our project ramps; using
  them raw in feature code is a zero-tolerance bypass (`rawProjectRamp`) — prefer a semantic
  token (`text-text-secondary`, `bg-accent`). `gray-*` is Tailwind's un-themed default and
  is banned (`rawPalette`).

## Corner radius — four tiers by role + circle

Radius is a token too. Pick the tier by the element's role; never eyeball an
arbitrary radius. An O* component already carries its own tier.

| Utility           | Token              | Value | Use for                                                     |
| ----------------- | ------------------ | ----- | ----------------------------------------------------------- |
| `rounded-chip`    | `--radius-chip`    | 4     | chips, badges, kbd, checkbox                                |
| `rounded-default` | `--radius-default` | 6     | buttons, inputs, selects, segmented controls, every control |
| `rounded-menu`    | `--radius-menu`    | 8     | menus, popovers, tooltips                                   |
| `rounded-surface` | `--radius-surface` | 10    | dialogs, drawers, cards, panels, the content frame (L1)     |
| `rounded-full`    | `--radius-full`    | ∞     | pills, avatars, status dots                                 |

Per-corner variants use the same names (`rounded-t-surface`, `rounded-s-default`).
**Banned (all CI-enforced):** bare `rounded`, arbitrary `rounded-[10px]`, and the
retired `rounded-{sm,md,lg,xl}` / `var(--radius-{sm,md,lg,xl})` — they were five names
for one value and were deleted. Change a tier in `base.css` to retune it everywhere.
The old `rounded-checkbox` alias is deleted; a checkbox box is `rounded-chip` (S9).

## Control heights — four tokens (S1, S2)

| Utility (also `min-h-*`, `size-*`) | Token                  | Value | Use for                                                |
| ---------------------------------- | ---------------------- | ----- | ------------------------------------------------------ |
| `h-control-xs`                     | `--spacing-control-xs` | 24    | chips, filter chips, in-row icon buttons               |
| `h-control-sm`                     | `--spacing-control-sm` | 28    | compact density, panel headers, table footer controls  |
| `h-control-md`                     | `--spacing-control-md` | 32    | **default**: every input, select, button, toggle, date |
| `h-control-lg`                     | `--spacing-control-lg` | 36    | sign-in and empty-state call to action only            |

Defined and registered in `semantic.css`. Every O* control maps its `size` prop
(`xs`/`sm`/`md`/`lg`) to these, so a size name is one height everywhere (S1) and
controls in one row share a size (S2). A call site never sets a control's height
with a class: `local/o2-control-height` flags `h-*`, `!h-*`, `size-*` and
`[&_…]:h-*` on O* controls and buttons. Bespoke chrome that must line up with a
control uses `h-control-*`, never a raw step such as `h-8`.

## Control edge and focus (S2)

Every bordered control in a row shares one edge, so a toolbar reads as one set: inputs,
search, selects, textareas, the date-range group, `OFile`'s box, `secondary` buttons
(refresh, column toggle, any bordered icon button), the `OToggleGroup` tray and the
`OStatCard` filter chip. The component tokens (`--color-input-border`,
`--color-select-border`, `--color-button-outline-border`, `--color-toggle-border`, …)
all resolve to these semantic tokens, registered in `semantic.css`:

| Utility                                 | Token                             | Light / dark               | Use for                                    |
| --------------------------------------- | --------------------------------- | -------------------------- | ------------------------------------------ |
| `border-control-border`                 | `--color-control-border`          | grey-350 `#c5cad6` (1.6:1) / `--d-border` (2:1) | every bordered control at rest             |
| `hover:border-control-border-hover`     | `--color-control-border-hover`    | the 3:1 `--color-border-control` | the same edge under the pointer       |
| `border-control-border-selected`        | `--color-control-border-selected` | primary-300 / primary-700  | a pressed `secondary` (with the accent fill) |
| `focus-within:border-control-border-focus` | `--color-control-border-focus` | primary-500                | an input-like control's focused edge       |
| `focus-within:ring-3 focus-within:ring-control-focus-halo` | `--color-control-focus-halo` | primary-500 at 18% | the 3 px outer halo outside that edge |
| `ring-3 ring-control-error-halo`        | `--color-control-error-halo`      | error-500 at 16%           | the same halo on an invalid field          |

Focus on an input-like control is the canvas `.input:focus-within`: a 1 px accent-500 edge
plus a 3 px outer halo, never an opaque or inset ring. An invalid field keeps its red edge
and takes the red halo. Hover is gated with `hover:not-focus-within:` so the pointer never
greys a focused edge. Ghost buttons stay borderless in `text-text-secondary`.

The resting edge is deliberately below the 3:1 of SC 1.4.11: the review found grey-400 too
heavy for a toolbar of inputs. It is an accepted exemption, recorded in
`contrast-manifest.ts`, because the edge is never the only cue: every control carries its
label, value or placeholder at 4.5:1, hover lifts the edge to the 3:1 `--color-border-control`
and focus adds the accent edge and halo. Do not darken it back without a review.

## Type roles (T1)

`text-compact` (13) is the UI text of every O* control, menu, table cell and label.
`text-sm` (14) is reading text only: descriptions, dialog bodies, empty-state text,
notices; semibold, it is the section, card and panel title. Titles rank 18 (page,
`text-lg`, OPageHeader) › 15 (dialog, drawer, `text-title`) › 14 (section). The full role table is in [SKILL.md § rule 3](../SKILL.md) and
[guidelines § 3](guidelines.md#3-type-and-text-colour).

## Enforced by CI (it will fail the build)

None of the above is advisory. Every PR runs, as **required** gating steps:

- `lint:design:strict` — the design-consistency guard. It counts every bypass category
  (hardcoded hex/px, `arbRadius`, `arbShadow`, `bareRounded`, `retiredTextAlias`,
  `retiredRadiusAlias`, `rawPalette`, `rawProjectRamp`, `rawVarInComponent`,
  `rawVarInTemplate`, un-justified `<style>`, …). **Tolerance is zero for all of them** —
  a single occurrence fails. There is no ratchet and no slack to use up.
- `lint:tokens` — every `var(--x)` must resolve to a defined token (no silent voids),
  and **any** `--o2-*` used as a CSS custom property fails, fallback or not.
- `lint:token-purity` — the token files stay pure (no class defs leaking in).
- `lint:styles` (stylelint) — `color-no-hex` in `.vue` styles, the `.dark`-only
  dark-selector rule, banned `var(--o2-*)` / retired `var(--color-text-primary/-caption)`
  values, and **literal font stacks** (`font-family` must be `var(--font-sans)` /
  `var(--font-mono)` — the design script's `literalFontFamily` category counts the
  same thing in class arbitrary values), all at **error** severity.

If a rule blocks you, fix the cause (use the utility, register the token, pick the tier) —
adding an exemption is not the move.

**The counters scan raw text — comments included.** A `16px` / `#fff` /
`var(--color-*)` mentioned in a `<style>`-block comment, or a banned class pattern
(`bg-gray-400`, `tw:`, `w-[320px]`, a retired alias) quoted verbatim in a
template/JS comment, counts as debt exactly like real code and can fail
`lint:design:strict`. Describe values in comments in `rem` or plain words instead
of quoting the banned form.

**There is no baseline any more.** `scripts/design-debt-baseline.json` was deleted
once the last debt-carrying category reached zero — a baseline is a standing hazard,
since every non-zero entry is headroom a future bypass can refill silently. So there
is nothing to regenerate: `--baseline` no longer exists, and `--strict` is accepted
but ignored (`lint:design:strict` and `lint:design` do the same thing). To see what
is failing:

```bash
cd web && node scripts/check-design-consistency.mjs --list
```

**What the guard cannot see** — it is not a proof of cleanliness:

- it walks only `.vue` and `.ts`; **standalone `.css` files are never scanned**
- the arbitrary-property form `[background:color-mix(…)]` has no utility prefix, so
  no category matches it
- a `var()` fallback (`var(--color-accent,#3F7994)`) hides the read from the
  `color-mix` rules _and_ the hex rule

A clean run means "no bypasses of the kinds it looks for, in the two file types it
walks" — review still matters.

## The token files

Plain CSS, Tailwind v4, **no SCSS**. They live in
`web/src/lib/styles/tokens/` and load in order via `web/src/styles/tailwind.css`:

| File            | Holds                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `base.css`      | raw palette primitives (`--color-grey-*`, `--color-primary-*`, radius, shadow) + `@font-face` — the only place literal hex lives  |
| `semantic.css`  | semantic/intent `--color-*` tokens, light `:root` (e.g. `--color-text-heading`, `--color-surface-base`, `--color-border-default`) |
| `component.css` | per-component `--color-*` tokens (e.g. `--color-button-primary`)                                                                  |
| `dark.css`      | **all** dark-mode overrides, under `.dark`                                                                                        |

Dark mode binds to the `.dark` class (set by `utils/theme.ts`), via
`@custom-variant dark` in `tailwind.css` — **not** the OS media query.

## Registering a new `--color-*` token

Only when no existing token fits. Do all three steps, or dark mode / Tailwind
utilities silently break. The new token **must** be a `--color-*` name.

1. **Light value** — add it in the appropriate `:root { … }` block (`semantic.css`
   for a general token, `component.css` for a component-scoped one), pointing at a
   base/semantic token, never a raw literal:
   ```css
   /* semantic.css */
   :root {
     --color-surface-raised: var(--color-grey-50);
   }
   ```
2. **Register for Tailwind** — re-declare it self-referentially in that same
   file's `@theme inline { … }` block so Tailwind emits utilities for it. The
   `inline` keyword is what lets the runtime dark override still win:
   ```css
   @theme inline {
     --color-surface-raised: var(--color-surface-raised);
   }
   ```
3. **Dark override** — add the dark value in `dark.css` under the modern selector
   **only**. A token that already points at a semantic token inherits dark for
   free and needs no override; add one only for base-palette values that must flip:
   ```css
   /* dark.css — real selector; NO .dark-theme, NO .body--dark */
   :root.dark,
   .dark :root,
   .dark {
     --color-surface-raised: var(--color-grey-800);
   }
   ```

Then use it as a utility (`bg-surface-raised`) or `var(--color-surface-raised)`.
Never inline the literal you would have registered.

## The `--o2-*` ban

There are two token vocabularies in the codebase: the modern `--color-*` set
(registered in `@theme inline`, drives Tailwind utilities, proper `.dark`
overrides) and a legacy **`--o2-*`** set (retired, `var()`-only, with its own
drifting `.body--dark` values). The legacy set is **being deleted**, and lint/CI
is being wired to **fail the build** on any `--o2-*`. Treat it as already
forbidden:

- **Never write `var(--o2-*)`** anywhere — not in a `<style>` block, not in a
  Tailwind arbitrary value (`bg-[var(--o2-card-bg)]`), not in a `:style` binding.
  Use the `--color-*` equivalent or a token utility.
- **Never define a new `--o2-*`** token, and **never add a `.body--dark` block**.
  New tokens are `--color-*` only; dark values go under `.dark`.
- **If you touch code that still references an `--o2-*` token**, migrate it to its
  `--color-*` equivalent as you go (map below). If a mapping is genuinely unclear,
  flag it rather than leaving the `--o2-*`.

## `--o2-*` → `--color-*` migration map

Most legacy tokens map to a same-meaning modern token — the heuristic is simply
**`--o2-<meaning>` → `--color-<meaning>`**. Common cases:

| Legacy `--o2-*`                                | Modern `--color-*`                                     |
| ---------------------------------------------- | ------------------------------------------------------ |
| `--o2-text-heading`                            | `--color-text-heading`                                 |
| `--o2-text-primary` / `--o2-text-4`            | `--color-text-heading`                                 |
| `--o2-text-body`                               | `--color-text-body`                                    |
| `--o2-text-secondary` / `--o2-text-2`          | `--color-text-secondary`                               |
| `--o2-text-caption` / `--o2-text-1`            | `--color-text-secondary`                               |
| `--o2-text-label` / `--o2-text-3`              | `--color-text-label`                                   |
| `--o2-text-muted`                              | `--color-text-muted`                                   |
| `--o2-text-placeholder`                        | `--color-text-placeholder`                             |
| `--o2-text-link` / `--o2-text-link-hover`      | `--color-text-link` / `-hover`                         |
| `--o2-text-inverse`                            | `--color-text-inverse`                                 |
| `--o2-border` / `--o2-border-color`            | `--color-border-default`                               |
| `--o2-border-2`                                | `--color-border-subtle`                                |
| `--o2-border-input`                            | `--color-input-border`                                 |
| `--o2-primary-background`                      | `--color-surface-base`                                 |
| `--o2-secondary-background`                    | `--color-surface-panel`                                |
| `--o2-muted-background`                        | `--color-surface-subtle`                               |
| `--o2-card-background` / `--o2-card-bg`        | `--color-surface-base`                                 |
| `--o2-popover-background`                      | `--color-surface-overlay`                              |
| `--o2-code-bg`                                 | `--color-code-bg`                                      |
| `--o2-primary-btn-bg`                          | `--color-button-primary`                               |
| `--o2-primary-btn-text`                        | `--color-button-primary-foreground`                    |
| `--o2-secondary-btn-bg` / `-text` / `-border`  | `--color-button-secondary` / `-foreground` / `-border` |
| `--o2-hover-accent` / `--o2-interactive-hover` | `--color-interactive-hover-bg`                         |

**Authoritative source (always in-tree):** the codemod's machine map is
`web/scripts/o2-token-map.json` (`migrate` key — this is what the CI failure message
points at), and the token files themselves define both
vocabularies — `semantic.css` (light `--o2-*` and `--color-*` values) and
`dark.css` (dark values). If a legacy token isn't in the table above, grep those
files for its value and find the `--color-*` token that carries the same value:

```bash
grep -n -- '--o2-<name>' web/src/lib/styles/tokens/semantic.css web/src/lib/styles/tokens/dark.css
```

A few `--o2-*` tokens are runtime-computed by `utils/theme.ts` (theme color,
table header bg, menu gradients) or are domain data-viz palettes (span-kind,
field-type, label chips, trace, json colors). Those already have or are getting
`--color-*` equivalents; if you hit one with no obvious modern name, flag it
rather than inventing a mapping.
