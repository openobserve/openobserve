# O2 Component Catalog

> **Living document** — Only add components here once they are built, reviewed, and merged into `web/src/lib/`.
> Do not pre-populate with planned or hypothetical components.
> **Update this file** every time a new O2 component is created (via `o2-component-create` skill) or a migration is completed.

---

## Built Components

_None yet._

---

## Component Families

_None yet._

---

## How to Add a New Entry

When a component is built and merged, add a row to the Built Components table:

| O2 Component | Import path                        | Replaces   | Status |
| ------------ | ---------------------------------- | ---------- | ------ |
| `O{Name}`    | `@/lib/{group}/{Name}/O{Name}.vue` | `q-{name}` | Built  |

Then add a section below with usage details:

```
### O{Name}

**Import**: `import O{Name} from '@/lib/{group}/{Name}/O{Name}.vue'`
**Replaces**: `q-{name}`
**Props**: see `O{Name}.types.ts` — permitted: size, variant, state only
**Slots**: [list slot names]
**Emits**: [list emits]
**Family members**: [list if compound — all must be imported together]
```

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

### ODropdown 🔲

**Use for**: Contextual menus, action menus triggered by a button.

### OPopover 🔲

**Use for**: Rich floating content panels triggered by an element.

---

## data/

### OTable ✅ (when built)

**Use for**: Structured tabular data with sorting, pagination, selection.  
**Do NOT use for**: Simple key-value displays (use a definition list), log streaming (use virtual scroll directly)
