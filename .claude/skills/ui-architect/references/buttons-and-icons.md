# Buttons with icons

One verb, one icon, everywhere. A reader should recognise an action from its
glyph before reading the label.

## When a button carries an icon

| Button | Icon | Label |
|---|---|---|
| Page-header primary create CTA (`New alert`) | none | yes (house rule 1) |
| Secondary and utility actions in page headers and toolbars (Import, Export, Refresh, Share, Download, Edit, Run) | leading, `size="sm"` | yes |
| Dense toolbars and table row actions | icon only | no; `aria-label` + `OTooltip` with the label |
| Dialog and drawer footers (Cancel / Save / Delete) | none | yes |
| In-section adders (`Add condition`) | leading `add` | yes |
| Menu items (`ODropdownItem`) | leading via `icon-left` when any item in the menu has one; then every item gets one | yes |
| Destructive row action | `delete`, `variant="ghost-destructive"` | icon only |

Pass the glyph with `icon-left` / `icon-right`, not a nested `<OIcon>`, so the
button sizes it (16px in 28px controls, 14px in 24px controls). Never colour
a button icon yourself: it inherits the button's text colour (see
typography-and-icons.md).

## Shortcut hints

`OShortcut` shows one keycap per combo, written as the OS does: `⌘K` on macOS,
`Ctrl+K` elsewhere. Separate keycaps mean a sequence pressed one after another.

## Sizes

All toolbar and row-action buttons are 28px (`size="sm-toolbar"`, or
`size="icon-xs-sq"` for icon-only). Row actions sit in a `gap-1` row, centred
in a 38px row so the hover fill has room above and below.

## Verb → icon map

| Verb | Icon |
|---|---|
| Create / add | `add` |
| Import | `file-upload` |
| Export / download | `download` |
| Refresh / re-run | `refresh` |
| Run query | `play-arrow` |
| Share / copy link | `share` / `link` |
| Edit | `edit` |
| Duplicate / copy | `content-copy` |
| Move | `drive-file-move` |
| Delete | `delete` |
| Filter | `filter-list` |
| Configure / settings | `settings` |
| Open in a new place | `open-in-new` |
| View / preview | `visibility` |
| History | `history` |
| Save | `save` |
| Close / dismiss | `close` |
| More (overflow) | `more-vert` (⋮) for one item: table/list rows, cards, panels; `more-horiz` (⋯) for a page or toolbar. Icon-only with a tooltip. Exception: the labelled "More ⌄" in the Logs and Traces query toolbars |
| Menu trigger chevron | `expand-more`, `xs`, trailing |

Add a row here before introducing a new verb's icon; never pick a second glyph
for a verb already listed.
