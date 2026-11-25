# Typography and icons — one role, one look

Pick the row by the text's **role**, never by eye. Same role on two pages = same classes.
`OText` variants already encode these rows; prefer them over hand-written classes.

## Type roles

| Role | Classes | `OText` variant |
|---|---|---|
| Page title (`OPageHeader`) | `text-lg font-semibold text-text-heading` | `page-title` |
| Dialog / drawer title | `text-base font-semibold` (owned by `ODialog` / `ODrawer`) | — |
| Section / card / panel title, empty-state title | `text-sm font-semibold text-text-heading` | `card-title`, `panel-title` |
| Body and controls (cells, inputs, menus, buttons) | `text-compact font-normal text-text-body` | — |
| Reading prose (descriptions, help paragraphs) | `text-sm font-normal text-text-body` | `body` |
| Emphasised value, form label, name | `font-medium` at the row's size, `text-text-heading` | `body-strong`, `label` |
| Selected tab or filter chip | `font-semibold`, width reserved (owned by `OTab` / `OStatCard`) | — |
| Label, meta, caption, timestamp, helper | `text-xs font-normal text-text-secondary` | `meta` |
| Group / section label (sidebar, field list, menu group) | `text-xs font-medium text-text-secondary` | `section` |
| Table header | `text-xs font-medium text-text-secondary` (owned by `OTable`) | — |
| Micro: badge, chip, count | `text-2xs font-medium` | — |
| Display number (stat tile value, hero) | `text-2xl`+ `font-semibold`; `font-bold` allowed only here | — |

- **Weights: 400 / 500 / 600 only.** `font-bold` (700) is for display numbers, nothing else; a
  heavier weight never stands in for a missing role.
- **Sentence case everywhere** — titles, buttons, tabs, empty states, menu items. Acronyms and
  product names keep their casing. No `uppercase`, no `tracking-wide` label style.
- Quieter text drops a colour tier (`heading` → `body` → `secondary`), not opacity.

## Icons

Material Symbols Light outlines (`OIcon`). One stroke: the light outline as drawn; where an icon
sits in a secondary control (`.toolbar-btn-rest`, row actions, the date button) refresh.css adds a
0.75px `currentColor` stroke so it reads at the 400 weight. Never add per-site stroke widths.

| Text beside the icon | `OIcon size` | px |
|---|---|---|
| `text-2xs` / `text-xs` (chips, meta, captions) | `xs` | 14 |
| `text-compact` / `text-sm` (controls, menus, body) | `sm` | 16 |
| `text-base` / `text-lg` (dialog and page titles, nav rail) | `md` | 20 |
| Empty state, illustration | `lg` / `xl` | 32 / 40 |

Inside an `OButton`, use `icon-left` / `icon-right` (always `sm`); never resize a button glyph with
`size-*!`.

**Colour — an icon is the colour of its text.** `OIcon` paints `currentColor`; set colour on the
control, not on the icon.

| Context | Colour |
|---|---|
| Secondary control at rest (toolbar, row action, meta, input adornment) | `text-text-secondary` |
| Hovered, open, selected | `text-text-heading` (the control's state colour) |
| Primary signal (primary CTA, active nav, a link) | `text-accent` |
| Status (error, warning, success, info) | `text-status-*-text` — only when the icon *is* the status |
| Destructive glyph (`delete`, `bin-*`) | error colour, owned by `OIcon` |
| Disabled / absent | `text-text-muted` |

Never a palette ramp (`text-error-600`), a fixed grey (`text-icon-color`), a hex or a brand colour
on a UI icon. Brand logos (`img:` icons, `SlackLogo`, `McpLogo`) keep their own colours.
