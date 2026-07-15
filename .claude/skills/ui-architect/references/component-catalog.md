# Component catalog

> Extracted from the ui-architect contract (see ../SKILL.md § Pick a component).

## Component catalog

Every O2 component, grouped by concern, with what it's for. Open the linked
reference file for exact props, slots, emits, and a usage example before writing
markup — don't guess a prop name.

### Reference files

| File | Covers |
| --- | --- |
| [references/core-display.md](core-display.md) | Badge/Tag/DimensionChip, Card, Code, Collapsible, EmptyState, Icon, Separator, Shortcut, **Text (typography)**, VirtualScroll |
| [references/core-controls-table.md](core-controls-table.md) | **Button**/ButtonGroup, Navbar, RefreshButton, Splitter, ToggleGroup, **Table** (+ cell renderers) |
| [references/forms-inputs.md](forms-inputs.md) | Input/Textarea, Select, Combobox, SearchInput, Checkbox, Radio, Switch, OptionGroup |
| [references/forms-specialized.md](forms-specialized.md) | **Form + useOForm**, Color, Date, DateTimeRange, Time, File, Range, Slider |
| [references/forms-validation.md](forms-validation.md) | **Validating a form: OForm + Zod schema, binding rules, submit/loading, conditional rendering, field arrays, testing** |
| [references/keyboard-shortcuts.md](keyboard-shortcuts.md) | **Keyboard shortcuts: registry, `useShortcut`/`useShortcuts`, display via `OShortcut`/`shortcut-id`, cheatsheet** |
| [references/creating-components.md](creating-components.md) | **Building a NEW O2 component: lib vs components, folder contract, families, headless-first (reka-ui), no-UI-prop-leakage, strict TS, tokens, form wrappers, workflow, testing** |
| [references/design-tokens.md](design-tokens.md) | **Design tokens: using `--color-*`, the token files, registering a new token, the `--o2-*` ban + full `--o2-*` → `--color-*` migration map** |
| [references/page-recipes.md](page-recipes.md) | **Whole-page layouts: the listing/table page (full-height flush skeleton, mandatory search · refresh · column-visibility toggle, filtered-vs-first-run empty state) and the detail/editor page** |
| [references/navigation-menus.md](navigation-menus.md) | **Registering a new page in navigation: the route composables, the left-rail item (`linksList`), Settings/IAM sub-pages (`SectionRail`), hover-flyout children (`navGroups.ts`), and cloud/enterprise/RBAC gating** |
| [references/overlay-navigation.md](overlay-navigation.md) | Dialog, Drawer, Dropdown, Popover, Tooltip · Pagination, Stepper, Tabs |
| [references/feedback-data.md](feedback-data.md) | Banner, Toast (+ useToast), Spinner, Skeleton, InnerLoading · ProgressBar, Timeline, Tree · FieldList |

> **Headless vs form-bound.** Most form controls come as a pair: `OInput`
> (headless, `v-model` only) and `OFormInput` (adds label / error / required /
> help). Inside an `OForm`, reach for the `OForm*` variant; for a bare control
> with no label chrome, use the headless one. Details in the forms references.

### Scenario → component

| I need to… | Use | Reference |
| --- | --- | --- |
| Trigger an action (submit, add, open) | `OButton` (`OButtonGroup` for a set) | core-controls-table |
| Show a page/module header | `AppPageHeader` (rule 1) | — |
| Render tabular data | `OTable` + `OTableColumnDef[]` | core-controls-table |
| Show a status label / count / tag | `OBadge`, `OTag`, `ODimensionChip` | core-display |
| Group content in a surface | `OCard` (+ `OCardSection`, `OCardActions`) | core-display |
| Body / heading / muted text | `OText` (pick the `variant`) | core-display |
| Show an icon | `OIcon` (`name` from the icon registry) | core-display |
| A divider / hairline | `OSeparator` | core-display |
| Show code / a code block | `OCode`, `OCodeBlock` | core-display |
| Expand/collapse a section | `OCollapsible` | core-display |
| Empty "no data" state | `OEmptyState` | core-display |
| Render a huge list performantly | `OVirtualScroll` | core-display |
| Single-line / multiline text entry | `OInput` / `OTextarea` (`OForm*` in a form) | forms-inputs |
| Pick one/many from a fixed list | `OSelect` (+ `OSelectItem`) | forms-inputs |
| Typeahead / free-entry combobox | `OCombobox` | forms-inputs |
| A search box | `OSearchInput` | forms-inputs |
| Boolean checkbox / group | `OCheckbox` / `OCheckboxGroup` | forms-inputs |
| Mutually exclusive choice | `ORadioGroup` (few) / `OSelect` (many) | forms-inputs |
| Instant on/off toggle | `OSwitch` | forms-inputs |
| Segmented control | `OToggleGroup` | core-controls-table |
| Build a validated form | `OForm` + Zod schema (binding rules) | **forms-validation** |
| Read form state for conditional rendering | `useOForm` (owner) / `inject`+`useStore` (child) | forms-validation |
| Add repeatable/dynamic field rows | `z.array` + indexed `name`, `:key="index"` | forms-validation |
| Pick a color | `OColor` | forms-specialized |
| Pick a date / date-time range / time | `ODate` / `ODateTimeRange` / `OTime` | forms-specialized |
| Upload a file | `OFile` | forms-specialized |
| Numeric slider / range | `OSlider` / `ORange` | forms-specialized |
| Modal task / short form | `ODialog` (see form-container rule) | overlay-navigation |
| Side panel / large or contextual form | `ODrawer` | overlay-navigation |
| Menu of actions | `ODropdown` (+ `ODropdownItem`) | overlay-navigation |
| Freeform floating content | `OPopover` | overlay-navigation |
| Hover hint | `OTooltip` | overlay-navigation |
| Switch between content sections | `OTabs` (+ `OTab`/`OTabPanel`); `ORouteTab` for route-driven | overlay-navigation |
| Multi-step wizard | `OStepper` (+ `OStep`) | overlay-navigation |
| Paginate a list | `OPagination` | overlay-navigation |
| Persistent inline message | `OBanner` | feedback-data |
| Transient notification (replaces `q-notify`) | `useToast()` (+ `OToastProvider` at root) | feedback-data |
| Loading state | `OSkeleton` (placeholder) / `OSpinner` (bare) / `OInnerLoading` (over a container) | feedback-data |
| Progress indicator | `OProgressBar` | feedback-data |
| Event timeline | `OTimeline` (+ `OTimelineItem`) | feedback-data |
| Hierarchical / tree data | `OTree` (+ `OTreeNode`) | feedback-data |
| Label–value detail rows | `OFieldList` (+ `OFieldRow`, `OFieldLabel`) | feedback-data |
| Confirm / destructive prompt | `ConfirmDialog` + `useConfirmDialog` (app-level, `@/components` + `@/composables`) | — |
| Add a keyboard shortcut | registry entry + `useShortcuts([{ id, handler }])`; display via `OShortcut`/`shortcut-id` | keyboard-shortcuts |
| Build a NEW component (nothing fits) | new `O*` in `web/src/lib` (generic) or named component in `web/src/components` (app-specific) — never inline classes | **creating-components** |
| Add a new page to the nav / menu / settings sub-menu | route composable + `linksList` / `navGroups.ts` / `settingsItems`, gated by env/role | **navigation-menus** |

If a scenario isn't covered by anything above, re-check the reference files
before assuming a component is missing — the list is complete as of this skill's
authoring. If it's genuinely absent, follow the missing-component guidance in
[§ When a rule can't be satisfied](../SKILL.md).
