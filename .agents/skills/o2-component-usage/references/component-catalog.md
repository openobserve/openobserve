# O2 Component Catalog

> **DRAFT** — Only add components here once they are built, reviewed, and merged into `web/src/lib/`.
> Do not pre-populate with planned or hypothetical components.

---

## Built Components

_None yet. This catalog will be populated as components are created using the `o2-component-create` skill._

---

## How to Add an Entry

When a component is built and ready, add a row:

```
## {Group} / {ComponentName}

**Import**: `import O{Name} from '@/lib/{group}/{Name}/{Name}.vue'`  
**Use for**: [short description of intended use cases]  
**Do NOT use for**: [what it is not designed for]  
**Props**: see `{Name}.types.ts`  
**Slots**: [list slot names]  
**Emits**: [list emits]
```

**Use for**: Any clickable action trigger — form submissions, navigation triggers, icon-only actions.  
**Props**: `size` (`sm` | `md` | `lg`), `disabled`, `loading`, `type` (`button` | `submit` | `reset`)  
**Slots**: `default` (label), `prefix` (icon left), `suffix` (icon right)  
**Do NOT use for**: Navigation links (use `<router-link>` or `OLink`), decorative elements

### OBadge ✅ (when built)
**Use for**: Status indicators, counts, labels on list items.  
**Props**: `variant` (`default` | `success` | `warning` | `error` | `info`)  
**Do NOT use for**: Interactive elements, buttons styled as badges

### OTag ✅ (when built)
**Use for**: Removable labels, filter chips, selection tags.  
**Props**: `removable`, `disabled`  
**Emits**: `remove`  
**Do NOT use for**: Static badges (use OBadge), navigation

### OCard ✅ (when built)
**Use for**: Grouping related content with a surface background.  
**Slots**: `header`, `default`, `footer`  
**Do NOT use for**: Inline content containers (use `div` with semantic tokens instead)

### OAvatar 🔲
**Use for**: User/entity visual representation with initials or image.

### OIcon 🔲
**Use for**: All icon rendering. Wraps lucide-vue-next icons with consistent sizing.  
**Props**: `name`, `size`

---

## forms/

### OInput ✅ (when built)
**Use for**: Single-line text, email, password, number, search inputs.  
**Props**: `modelValue`, `type`, `placeholder`, `disabled`, `readonly`, `error`, `size`  
**Emits**: `update:modelValue`, `blur`, `focus`  
**Do NOT use for**: Multi-line text (use OTextarea)

### OTextarea ✅ (when built)
**Use for**: Multi-line text entry.  
**Props**: `modelValue`, `rows`, `placeholder`, `disabled`, `error`, `resize`  
**Do NOT use for**: Code editors (use Monaco), single-line inputs

### OSelect ✅ (when built)
**Use for**: Single or multi-option selection from a predefined list.  
**Props**: `modelValue`, `options`, `multiple`, `disabled`, `placeholder`, `searchable`  
**Do NOT use for**: Autocomplete with async search (create OAutocomplete), radio groups with few options (use ORadioGroup instead)

### OCheckbox ✅ (when built)
**Use for**: Binary on/off, multi-select item in a list.  
**Props**: `modelValue`, `disabled`, `indeterminate`, `label`  
**Do NOT use for**: Toggle switches (use OSwitch), single-select (use ORadio)

### ORadio ✅ (when built)
**Use for**: Single selection from mutually exclusive options (typically in a group).  
**Props**: `modelValue`, `value`, `disabled`, `label`  
**Do NOT use for**: Multi-select (use OCheckbox)

### OSwitch ✅ (when built)
**Use for**: Immediate on/off toggles (e.g. feature flags, settings).  
**Props**: `modelValue`, `disabled`, `label`  
**Do NOT use for**: Form selections where user must submit (use OCheckbox)

### OSlider 🔲
**Use for**: Numeric range selection with continuous or stepped values.

### ODatePicker 🔲
**Use for**: Date/date-time selection. Wraps a headless calendar primitive (confirm library first).

### OFileUpload 🔲
**Use for**: File selection and drag-drop upload zones.

### OLabel ✅ (when built)
**Use for**: Form field labels. Associates with input via `for` prop.  
**Props**: `for`, `required`

### OFormField ✅ (when built)
**Use for**: Wrapping an input + label + error message as a cohesive form row.  
**Props**: `label`, `error`, `hint`, `required`  
**Slots**: `default` (the input component)  
**Do NOT use for**: Inline form layouts — it's a vertical stacked field wrapper

---

## navigation/

### OTabs + OTab ✅ (when built)
**Use for**: Tabbed content switching within a view.  
**Do NOT use for**: Page navigation (use router-link), wizard steps (use OSteps)

### OBreadcrumbs ✅ (when built)
**Use for**: Hierarchical navigation path display.

### OPagination ✅ (when built)
**Use for**: Page-based navigation for lists and tables.  
**Props**: `modelValue`, `total`, `perPage`

### OSidebar ✅ (when built)
**Use for**: App-level navigation sidebar.

### OTimeline 🔲
**Use for**: Sequential event display in chronological order.

---

## feedback/

### OAlert ✅ (when built)
**Use for**: Inline informational, success, warning, or error messages.  
**Props**: `variant` (`info` | `success` | `warning` | `error`), `title`, `description`, `dismissible`  
**Do NOT use for**: Toast notifications (use OToast)

### OToast 🔲
**Use for**: Transient notifications triggered by actions (success, error after API calls).  
**Usage**: Via `useToast()` composable, not mounted directly.

### OSpinner ✅ (when built)
**Use for**: Loading state for async operations.  
**Props**: `size`  
**Do NOT use for**: Page-level loading (use OProgress or skeleton screens)

### OProgress 🔲
**Use for**: Determinate or indeterminate progress bars.

---

## overlay/

### OModal ✅ (when built)
**Use for**: Focused dialog interactions requiring user response before continuing.  
**Props**: `modelValue` (open/close), `title`, `size`  
**Slots**: `default`, `footer`  
**Emits**: `update:modelValue`, `close`  
**Do NOT use for**: Non-blocking notifications (use OToast), side panels (use ODrawer)

### OTooltip ✅ (when built)
**Use for**: Supplementary information on hover/focus.  
**Props**: `content`, `placement`  
**Do NOT use for**: Complex rich content (create OPopover)

### OMenu ✅
**Import**: `import OMenu from '@/lib/overlay/Menu/Menu.vue'`
**Use for**: Any floating panel anchored to a trigger element — action menus, option lists, date pickers, context panels.
**Do NOT use for**: Tooltips (use OTooltip), full-page modals (use OModal), right-click context menus (not supported).
**Props**: `modelValue`, `anchor`, `self`, `offset`, `contentStyle`, `persistent` — see `Menu.types.ts`
**Slots**: `default` (scoped: `{ toggle, open, close, isOpen }` — place trigger here), `#content` (floating panel body)
**Emits**: `update:modelValue`
**Replaces**: `q-menu` — use `/skill:o2-menu-migrate` to migrate existing usages.

### ODropdown 🔲
**Use for**: Contextual menus, action menus triggered by a button.

### OPopover 🔲
**Use for**: Rich floating content panels triggered by an element.

---

## data/

### OTable ✅ (when built)
**Use for**: Structured tabular data with sorting, pagination, selection.  
**Do NOT use for**: Simple key-value displays (use a definition list), log streaming (use virtual scroll directly)
