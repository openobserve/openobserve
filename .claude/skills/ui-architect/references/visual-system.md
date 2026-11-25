# Visual system (app shell, toolbars, menus)

The finalized look of the modern skin. Values live in tokens and shared
components; this page says which one to reach for. Type and icons:
typography-and-icons.md. Buttons with icons: buttons-and-icons.md. Tables:
core-controls-table.md.

## Surfaces

| Surface | Token | Light | Dark |
|---|---|---|---|
| App shell (behind the sidebar and header) | `surface-shell` | neutral `#eff0f2` | `#0e0e10` |
| Page card (all routed content) | `surface-card` | `#ffffff` | `#161618` |
| Side panels inside a page | `surface-panel` | `#f7f8f9` | `#1b1b1e` |
| Tonal fill, toggle track | `surface-band` | `#eff0f2` | `#242428` |
| Hover | `surface-hover` | `#e4e6e9` | `#2f2f34` |

Greys are neutral, never blue-tinted, so the accent is the only hue. Do not
add another surface step; pick from the ladder.

## Toolbar buttons

- Secondary actions in toolbars, results bars, page-header actions and table
  toolbars rest on a **borderless tonal fill** (`surface-band`); hover and open
  use the ghost hover fill. Put `toolbar-btn-rest` on an `OButton variant="ghost"`
  in a custom toolbar; outline/secondary buttons inside `OPageHeader` actions
  and `OTable` toolbars get it automatically.
- One solid primary per toolbar (Run query, New X). Everything else is tonal.
- Toolbar time pickers (`DateTime` without `field-appearance`) join the set.
- Form fields and dialog Cancel buttons keep their outlines: an outline means
  "you can type here" or "secondary choice in a form".
- An `OButton` rendered `as="div"` (to hold a switch) still gets hover and the
  pointer: OButton uses the `actionable:` variant, never `enabled:`.

## Header (top bar)

- Upgrade, org switcher and utility icons are borderless ghosts on the shell:
  no fill, no edge until hover.
- The solution switcher's icon lines up with the page title below it.
- The command palette search is the only field-styled control in the header.

## Toggle groups (segmented controls)

The selected segment is a raised pill: `surface-raised` (white in light, a
lighter grey in dark) with `shadow-xs` and heading-colour text, on a
`surface-band` track. Never an accent tint; tint is for selected rows and
menu items.

## Dropdowns, selects and menus

One anatomy for every popup list (`menuClasses.ts` holds the classes):
- Rows 28px (36px below md), `px-2`, 13px text, rounded inside a `p-1` inset.
- Surface: `dropdown-bg`, 1px border, `shadow-overlay`, `rounded-default`.
  Menus cap at 20rem wide and 18rem tall (a caller's own `max-h-*` lifts the
  cap, e.g. a panel menu that must show every item); selects cap at 32rem.
- Selected: accent tint plus a trailing `check`. Use `ODropdownItem :selected`,
  never a hand-placed check icon. Multi-select uses a leading checkbox.
- One chevron: `expand-more`, `xs`, trailing, rotating when open.
- Group labels `text-xs` medium secondary; a toggle inside a menu row is a
  trailing `OSwitch`, not a check.
- Search row: borderless, `search` icon `xs`, hairline below. Empty state
  centred `text-compact` secondary.
- Menus keep their depth-based stacking so a menu opened from a dialog sits
  above it.

## Sidebar

- Width `w-42` (10.5rem) expanded, `w-13` collapsed.
- Rows 28px (`h-7`), `px-2`, 13px text, 16px icon in secondary, selected row
  uses the selected tint.
- Group labels `text-xs` medium in the sidebar section colour, `pt-4 pb-1`;
  never uppercase or tracked.

## Badges

Beta and alpha are always `OBetaBadge` (`stage="beta" | "alpha"`): one pill,
`text-2xs` medium, accent tint. Never a hand-written "Beta" chip or `OTag`.

## Login

The login page splits at `lg`: `LoginBrandPanel` (brand gradient token
`bg-gradient-login-hero`, product points from openobserve.ai) beside the
sign-in form. The panel hides below `lg` and on white-labelled installs.
