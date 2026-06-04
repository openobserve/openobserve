# O2 — UI Consistency Rules (agent guide)

**Purpose:** a prescriptive rulebook for making changes to the OpenObserve frontend **without
breaking visual or behavioral consistency.** Pair it with `HANDOFF.md` (the full spec) and
`Spec Sheet.html` (visual reference). When this file says "always / never," treat it as a hard
constraint, not a suggestion.

> **Golden rule:** there is exactly **one** correct answer for each decision below. If you find
> two pages doing the same thing differently, the one matching this doc is right — fix the other.
> Never introduce a third way.

---

## 0. Single sources of truth

- **Tokens** live in one place (`:root` custom properties). Every color, radius, shadow, and
  spacing value comes from a token. **Never** write a raw hex, px-radius, or rgba shadow in a
  component. If a value you need isn't a token, add a token — don't inline it.
- **Primitives** (button, input, table, badge, chip, drawer, modal, page header) exist **once** as
  shared components. **Never** re-implement a button or a table inline. If a primitive can't do
  what you need, extend the primitive — don't fork it in a page.
- **Patterns** (admin module, list page, drill page) are shared shells. IAM and Settings render
  from the **same** admin shell. Adding a new admin-style area means *configuring that shell*, not
  writing a new layout.

---

## 1. Color — do / don't

| ✅ Do | ❌ Don't |
|---|---|
| Use semantic aliases (`--text`, `--text-3`, `--border`, `--primary`, `--ok`…) | Reference raw ramp steps (`--g-600`) or hex in components |
| Demote metadata/IDs/timestamps/column-heads to `--text-3` | Render metadata at full `--text` (makes everything shout) |
| Selected/active backgrounds → `--iris-300` | Fill large areas with `--primary` at full strength |
| Status = the 4 semantic pairs only (`--ok/--warn/--danger/--info` + their `-tint`) | Invent new status colors or reuse iris for status |
| Exactly **one** `--primary` action per view | Two primary buttons competing in one header |
| Borders: structural → `--border`, row/section dividers → `--border-soft` | Mix the two arbitrarily |

---

## 2. Typography — do / don't

**Weight scale (the #1 consistency lever):** `700` title peak · `600` nav/buttons/badges/labels ·
`500` record names · `400` body/metadata. Nothing else.

| ✅ Do | ❌ Don't |
|---|---|
| One `700` element per view (the title) | `800` anywhere; multiple bold headings competing |
| Row/record names at `500` | Row names at `600`/`700` (the "wall of bold") |
| Sentence case for all titles, labels, nav, column heads | Title Case ("Cipher Keys") or ALL-CAPS eyebrows |
| Gray section labels at `11.5px / 600`, no letter-spacing | Uppercase + tracked micro-labels |
| `.mono` (IBM Plex Mono) for every ID, hash, count, timestamp, code, regex | Mono for prose, or sans for IDs |
| Base `13px` body / `12px` small (compact) | Ad-hoc font sizes off the scale |

---

## 3. Iconography — do / don't

| ✅ Do | ❌ Don't |
|---|---|
| Outline icons, `1.6px` stroke, round caps, `currentColor` | Filled/duotone icons, emoji, mismatched stroke widths |
| Standard sizes: 21 (rail/header tile), 16 (row actions/buttons), 15 (list), 13 (crumb chevron) | Arbitrary icon sizes |
| Use an icon only when it **differentiates** | The same glyph on every row of a homogeneous list (e.g. a folder icon on every folder) |
| Drop the icon + its gutter when rows aren't differentiated; mark only special rows | Leave an empty icon slot/blank gutter when most rows have no icon |

---

## 4. Layout & navigation — the decision tree

Apply these **in order** when building or fixing any module:

1. **Is it a primary module?** → it's an L1 rail item. The rail never changes per page.
2. **How many sub-sections does it have?**
   - **0** → flat page. Header row 2 = a tagline (or nothing).
   - **2–5** → **tabs** in header row 2.
   - **6+** → **grouped left rail** (`.l2`). *(IAM=7 and Settings=16 both use the rail and must look identical.)*
   - **Never** give one module tabs and a peer module a rail for the same section count.
3. **How is a record edited?**
   - Narrow record, edit beside its list → **drawer** (right slide-in). *(All IAM/Settings records.)*
   - Detail needs full width (canvas, graph, dashboard, big matrix) → **full-page drill** with breadcrumb.
   - **Never** stack a second list-column sidebar inside a module that already has the rail.
4. **Deep category → leaf?** (e.g. Ingestion) → push/pop **drill rail** + leaf grid.

---

## 5. The one-header law — do / don't

| ✅ Do | ❌ Don't |
|---|---|
| Exactly one header per view: row 1 (tile+title+subtitle+primary action), row 2 (one of tabs/breadcrumb/tagline) | A second title bar, or a title in the top bar |
| Keep the header stable across tab switches (only the table/body changes) | Mutate the header per tab |
| Primary `+ New` top-right in row 1, label updates per context | Floating a primary button into the content body |
| Search/filter/scope in the section toolbar below row 2 | Putting primary actions in the section toolbar |
| Row 2 shows **one** of {tabs, breadcrumb, tagline} | Tabs **and** breadcrumb together |

---

## 6. Breadcrumbs — do / don't

| ✅ Do | ❌ Don't |
|---|---|
| Show only on an L3+ drill, in header row 2 | Breadcrumb on a flat list (use a tagline) |
| `Module › Group › Record [› Sub-page]`, crumbs back-navigate | Non-clickable middle crumbs |
| Collapse middle to `…` past 4 levels (keep first + last two) | Let a long path overflow the header |
| When drilling from tabs, breadcrumb **replaces** the tabs | Keep tabs visible under a breadcrumb |

---

## 7. Tables — do / don't

| ✅ Do | ❌ Don't |
|---|---|
| Sticky `thead` (`position:sticky;top:0`), 36px, `12px/600 --text-3` | Non-sticky headers; bold/caps headers |
| Fixed widths for checkbox **40**, serial **48**, actions **90**; **one** fluid name column | Fixed-width name column; fluid action column |
| Action column minimal: 1–3 hover-revealed icon verbs (`opacity .35→1`), overflow in `⋯` | A wide always-on action column with many buttons |
| Action cell `stopPropagation` so icons don't trigger row click | Row click and action click firing together |
| Row name `.c-name` at weight `500`; metadata cols `--text-3` | Every cell at full weight/color |
| Sticky-right action column when the table scrolls horizontally | Action buttons scrolling out of reach |
| Decide a width = widest realistic value @13px + 28px padding, round up | Guessing widths or per-page improvisation |

---

## 8. Overlays — pick the right one

| Surface | Use for | Never use for |
|---|---|---|
| **Popover** | menus, row `⋯`, switchers (transient, anchored, no decision) | a multi-field form or a destructive confirm |
| **Drawer** (right, 460/600px, Esc-close, Delete·Cancel·Save) | editing one record in context of its list | a yes/no confirmation |
| **Modal** (centered, scrim) | a focused decision or short create form; **all destructive confirms** (name the item, state irreversibility) | routine record editing (use the drawer) |
| **Full page** (breadcrumb drill) | detail needing full width | something that fits a drawer |

`+ New` reuses the **same drawer** opened blank — never a separate, differently-styled create screen.

---

## 9. States — every list/table/chart needs all three

- **Ready** — normal data.
- **Loading** — shimmer **skeletons that mirror the real layout** (table-rows for tables, cards for grids), honoring `prefers-reduced-motion`. Never a generic spinner box.
- **Empty** — icon tile + title + description + a **primary action**; distinguish "nothing yet" (offer create) from "no matches" (suggest adjusting search). Different copy for each.

Omitting any of the three is a consistency bug.

---

## 10. Pre-change review checklist

Before committing any UI change, verify:

- [ ] No raw hex / px-radius / inline shadow — all via tokens.
- [ ] No re-implemented primitive — used the shared button/table/badge/drawer/header.
- [ ] Weight scale respected (one `700`; names `500`; no `800`).
- [ ] Sentence case; no ALL-CAPS labels.
- [ ] Icons: outline 1.6px; no same-glyph-every-row; no blank icon gutters.
- [ ] One header; row 2 = exactly one of tabs/breadcrumb/tagline; primary action top-right.
- [ ] Section-count → tabs(2–5)/rail(6+) rule followed; IAM & Settings still identical.
- [ ] Records edit in a drawer (or full page if wide); destructive actions confirm via modal.
- [ ] Table: sticky header, fixed checkbox/serial/action widths, one fluid name column, hover-revealed minimal actions.
- [ ] Loading skeleton + empty state present and layout-matched.
- [ ] Matched an existing page that does the same thing — and they now look/behave the same.

---

## 11. When in doubt

1. Find the **closest existing pattern** in the app and match it exactly.
2. If two pages disagree, the one matching `HANDOFF.md` / this doc wins — fix the other.
3. If no token/primitive/pattern fits, **extend the shared one**; never inline a one-off.
4. Prefer **fewer** visual treatments. Consistency beats cleverness.

*Source of truth order: this rulebook → `HANDOFF.md` → the prototype's `styles.css` & components.*
